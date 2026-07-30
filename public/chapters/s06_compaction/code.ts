#!/usr/bin/env node
/**
 * s06 compaction —— 上下文溢出检测 + 摘要压缩
 *
 * s01 的消息数组只增不减，长任务迟早撞上下文窗口。本章在循环开头加一道闸：
 * 估算 token，超阈值就把旧消息摘要成一条 summary，只留最近几条继续工作。
 * 本质是给上下文做 GC——留工作集，归档其余。
 *
 *     估算 token → 超阈值？─Yes→ 压缩(摘要旧消息) → [summary, ...recent]
 *                       └No→ 直接进 LLM
 *
 * 运行：export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic &&
 *       export ANTHROPIC_API_KEY=sk-deepseek-... &&
 *       export MODEL_ID=deepseek-chat &&
 *       node code.ts
 *
 * @author fxbin
 */

import { spawnSync } from "node:child_process";
import * as readline from "node:readline";

// ── 配置：本文件全部可调项集中于此 ──────────────────────

const CONFIG = {
	baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
	apiKey: process.env.ANTHROPIC_API_KEY ?? "",
	model: process.env.MODEL_ID ?? "claude-sonnet-4-5",
	anthropicVersion: "2023-06-01",
	maxTokens: 8000,
	bashTimeoutMs: 120_000,
	maxOutputChars: 50_000,
	maxContextTokens: 50_000,
	keepRecentMessages: 6,
} as const;

const BLOCKED_PATTERNS = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
const SYSTEM_PROMPT = `You are a coding agent at ${process.cwd()}. Use bash to solve tasks. Act, don't explain.`;
const SUMMARIZATION_PROMPT =
	"Summarize the following conversation. Preserve key decisions, file paths, and current task state.";

// ── 类型边界：Anthropic Messages API 的请求/响应形状 ────

interface TextBlock { type: "text"; text: string }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: { command: string } }
interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
interface ChatMessage { role: "user" | "assistant"; content: string | ContentBlock[] }
interface MessagesResponse { content: ContentBlock[]; stop_reason: string }
interface ToolDef { name: string; description: string; input_schema: object }

// ── 工具定义：只有 bash，一个工具足够演示循环 ───────────

const TOOLS: ToolDef[] = [
	{ name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
];

/**
 * 调用 LLM：用原生 fetch 向 Messages API 发一次非流式请求。
 * @param messages 截至目前累积的完整对话历史
 * @param tools 工具定义；摘要请求传空数组以禁用工具调用
 * @returns API 返回的 content 块与 stop_reason
 */
async function callLlm(messages: ChatMessage[], tools: ToolDef[] = TOOLS): Promise<MessagesResponse> {
	const response = await fetch(`${CONFIG.baseUrl}/v1/messages`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-api-key": CONFIG.apiKey, "anthropic-version": CONFIG.anthropicVersion },
		body: JSON.stringify({ model: CONFIG.model, max_tokens: CONFIG.maxTokens, system: SYSTEM_PROMPT, messages, tools }),
	});
	if (!response.ok) {
		throw new Error(`LLM 请求失败 ${response.status}: ${(await response.text()).slice(0, 500)}`);
	}
	return (await response.json()) as MessagesResponse;
}

/**
 * 执行 bash 命令：同步子进程，黑名单、超时、输出截断三道护栏。
 * @param command 模型给出的 shell 命令
 * @returns 合并 stdout/stderr 后的文本，截断到安全长度
 */
function runBash(command: string): string {
	if (BLOCKED_PATTERNS.some((p) => command.includes(p))) return "Error: Dangerous command blocked";
	const result = spawnSync(command, { shell: true, cwd: process.cwd(), encoding: "utf-8", timeout: CONFIG.bashTimeoutMs });
	if (result.error) return `Error: ${result.error.message}`;
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
	return output ? output.slice(0, CONFIG.maxOutputChars) : "(no output)";
}

// ── 上下文压缩：GC for context ─────────────────────────

/**
 * 把单条消息的内容拍平成纯文本，供 token 估算与摘要序列化复用。
 * @param message 一条对话消息
 * @returns 该消息的纯文本表示
 */
function flattenText(message: ChatMessage): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.map((b) => (b.type === "text" ? b.text : b.type === "tool_use" ? b.input.command : b.content))
		.join("\n");
}

/**
 * 估算 token 数：所有消息字符总数 / 4。粗粒度启发式，与真 pi 的
 * provider usage 精确计数相比有偏差，但足以判断是否该压缩。
 * @param messages 完整对话历史
 * @returns 估算的 token 数
 */
function estimateTokens(messages: ChatMessage[]): number {
	return Math.ceil(messages.reduce((sum, m) => sum + flattenText(m).length, 0) / 4);
}

/**
 * 压缩上下文：把旧消息摘要成一条 summary，保留最近若干条，返回新消息数组。
 * 旧消息整体喂给 LLM 生成摘要，摘要存为一条 user 消息，拼接在工作集前面。
 * @param messages 溢出的完整对话历史
 * @returns [summary 消息, ...最近 keepRecentMessages 条]
 */
async function compact(messages: ChatMessage[]): Promise<ChatMessage[]> {
	const splitIndex = Math.max(0, messages.length - CONFIG.keepRecentMessages);
	const conversation = messages.slice(0, splitIndex).map(flattenText).join("\n\n");
	const response = await callLlm(
		[{ role: "user", content: `${SUMMARIZATION_PROMPT}\n\n${conversation}` }],
		[],
	);
	const summary = response.content
		.filter((b): b is TextBlock => b.type === "text")
		.map((b) => b.text)
		.join("\n");
	return [{ role: "user", content: `Previous conversation summary: ${summary}` }, ...messages.slice(splitIndex)];
}

// ── agent 主循环 ───────────────────────────────────────

/**
 * agent 主循环：每轮开头先检查上下文是否溢出，溢出则压缩；随后照常问模型、
 * 执行工具、回填结果，直到模型不再调用工具。压缩用 length=0 + push 原地替换。
 * @param messages 对话历史，原地累积与压缩
 */
async function agentLoop(messages: ChatMessage[]): Promise<void> {
	while (true) {
		if (messages.length > CONFIG.keepRecentMessages && estimateTokens(messages) > CONFIG.maxContextTokens) {
			console.log("\x1b[35m[compaction] 上下文溢出，开始压缩...\x1b[0m");
			const compacted = await compact(messages);
			messages.length = 0;
			messages.push(...compacted);
		}
		const response = await callLlm(messages);
		messages.push({ role: "assistant", content: response.content });
		if (response.stop_reason !== "tool_use") return;
		const results: ToolResultBlock[] = [];
		for (const block of response.content) {
			if (block.type !== "tool_use") continue;
			console.log(`\x1b[33m$ ${block.input.command}\x1b[0m`);
			const output = runBash(block.input.command);
			console.log(output.slice(0, 200));
			results.push({ type: "tool_result", tool_use_id: block.id, content: output });
		}
		messages.push({ role: "user", content: results });
	}
}

/**
 * 交互入口：REPL 读取用户输入，驱动 agentLoop，打印模型最终文本回答。
 */
async function main(): Promise<void> {
	if (!CONFIG.apiKey) {
		console.error("缺少 ANTHROPIC_API_KEY，请先 export 后再运行。");
		process.exit(1);
	}
	console.log("s06: Compaction\n输入问题，回车发送。输入 q 退出。\n");
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = (prompt: string): Promise<string> => new Promise((resolve) => rl.question(prompt, resolve));
	const history: ChatMessage[] = [];
	while (true) {
		const query = (await ask("\x1b[36ms06 >> \x1b[0m")).trim();
		if (query === "" || query.toLowerCase() === "q" || query.toLowerCase() === "exit") break;
		history.push({ role: "user", content: query });
		await agentLoop(history);
		const last = history[history.length - 1];
		if (Array.isArray(last.content)) {
			for (const block of last.content) {
				if (block.type === "text") console.log(block.text);
			}
		}
		console.log();
	}
	rl.close();
}

await main();
