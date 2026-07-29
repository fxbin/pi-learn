#!/usr/bin/env node
/**
 * s05 session/jsonl —— append-only 持久化与 resume
 *
 * s01 的 agent 一关就失忆：历史只在内存里，进程退出就没了。
 * 本章给循环加一个"日记本"：每条消息落盘一行 JSON，重启时回放。
 *     saveMessages  →  appendFileSync  →  session.jsonl
 *     loadMessages  ←  readFileSync    ←  session.jsonl
 * 这是 Event Sourcing 的最小形态：state = replay(event_log)。
 * pi 的 session 更复杂（repo、多会话、树形 entry、fork），但内核一样。
 * 运行：export ANTHROPIC_API_KEY=sk-ant-... && node code.ts
 *
 * @author fxbin
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
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
	sessionFile: "./session.jsonl",
} as const;

const BLOCKED_PATTERNS = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
const SYSTEM_PROMPT = `You are a coding agent at ${process.cwd()}. Use bash to solve tasks. Act, don't explain.`;

// ── 类型边界：Anthropic Messages API 的请求/响应形状 ────

interface TextBlock { type: "text"; text: string }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: { command: string } }
interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

interface ChatMessage {
	role: "user" | "assistant";
	content: string | ContentBlock[];
}

interface MessagesResponse { content: ContentBlock[]; stop_reason: string }

// ── 工具定义：只有 bash ─────────────────────────────────

const TOOLS = [{
	name: "bash",
	description: "Run a shell command.",
	input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
}];

/**
 * 把消息追加写入 jsonl 文件：每条消息一行 JSON，append-only。
 * 写入端是 Event Sourcing 的核心：只追加，不修改，不删除。
 * @param messages 待持久化的消息数组，逐条追加到文件末尾
 */
function saveMessages(messages: ChatMessage[]): void {
	for (const msg of messages) {
		appendFileSync(CONFIG.sessionFile, `${JSON.stringify(msg)}\n`, "utf-8");
	}
}

/**
 * 从 jsonl 文件加载全部消息：读全文 → 按行切 → 过滤空行 → 逐行 JSON.parse。
 * 回放端：一行行 JSON 还原成消息数组，状态就重建了。
 * 文件不存在视为新会话，返回空数组。
 * @returns 按写入顺序排列的完整对话历史
 */
function loadMessages(): ChatMessage[] {
	if (!existsSync(CONFIG.sessionFile)) {
		return [];
	}
	const content = readFileSync(CONFIG.sessionFile, "utf-8");
	return content
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => JSON.parse(line) as ChatMessage);
}

/**
 * 调用 LLM：原生 fetch 向 Messages API 发一次非流式请求。
 * @param messages 截至目前累积的完整对话历史
 * @returns API 返回的 content 块与 stop_reason
 */
async function callLlm(messages: ChatMessage[]): Promise<MessagesResponse> {
	const response = await fetch(`${CONFIG.baseUrl}/v1/messages`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-api-key": CONFIG.apiKey,
			"anthropic-version": CONFIG.anthropicVersion,
		},
		body: JSON.stringify({
			model: CONFIG.model,
			max_tokens: CONFIG.maxTokens,
			system: SYSTEM_PROMPT,
			messages,
			tools: TOOLS,
		}),
	});
	if (!response.ok) {
		const detail = (await response.text()).slice(0, 500);
		throw new Error(`LLM 请求失败 ${response.status}: ${detail}`);
	}
	return (await response.json()) as MessagesResponse;
}

/**
 * 执行 bash 命令：同步子进程，超时与输出长度均有护栏。
 * @param command 模型给出的 shell 命令
 * @returns 合并 stdout/stderr 后的文本，截断到安全长度
 */
function runBash(command: string): string {
	if (BLOCKED_PATTERNS.some((p) => command.includes(p))) {
		return "Error: Dangerous command blocked";
	}
	const result = spawnSync(command, { shell: true, cwd: process.cwd(), encoding: "utf-8", timeout: CONFIG.bashTimeoutMs });
	if (result.error) {
		return `Error: ${result.error.message}`;
	}
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
	return output ? output.slice(0, CONFIG.maxOutputChars) : "(no output)";
}

/**
 * agent 主循环：在 s01 基础上，每次 push 后立即持久化新增消息。
 * 两个持久化点：assistant 消息追加后、tool_result 消息追加后。
 * 中途崩溃也不丢已完成轮次，重启从断点继续。
 * @param messages 对话历史，循环过程中原地累积
 */
async function agentLoop(messages: ChatMessage[]): Promise<void> {
	while (true) {
		const response = await callLlm(messages);
		const assistantMsg: ChatMessage = { role: "assistant", content: response.content };
		messages.push(assistantMsg);
		saveMessages([assistantMsg]);
		if (response.stop_reason !== "tool_use") {
			return;
		}
		const results: ToolResultBlock[] = [];
		for (const block of response.content) {
			if (block.type !== "tool_use") continue;
			console.log(`\x1b[33m$ ${block.input.command}\x1b[0m`);
			const output = runBash(block.input.command);
			console.log(output.slice(0, 200));
			results.push({ type: "tool_result", tool_use_id: block.id, content: output });
		}
		const toolMsg: ChatMessage = { role: "user", content: results };
		messages.push(toolMsg);
		saveMessages([toolMsg]);
	}
}

/**
 * 交互入口：启动时先 loadMessages 恢复历史，再进入 REPL。
 * 有历史就提示恢复条数，用户可直接追问；用户输入也持久化。
 */
async function main(): Promise<void> {
	if (!CONFIG.apiKey) {
		console.error("缺少 ANTHROPIC_API_KEY，请先 export 后再运行。");
		process.exit(1);
	}
	const history = loadMessages();
	console.log("s05: Session / JSONL");
	if (history.length > 0) {
		console.log(`已恢复 ${history.length} 条消息，可继续追问。`);
	} else {
		console.log(`新会话，消息将持久化到 ${CONFIG.sessionFile}`);
	}
	console.log("输入问题，回车发送。输入 q 退出。\n");
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = (p: string): Promise<string> => new Promise((r) => rl.question(p, r));
	while (true) {
		const query = (await ask("\x1b[36ms05 >> \x1b[0m")).trim();
		if (query === "" || query.toLowerCase() === "q" || query.toLowerCase() === "exit") {
			break;
		}
		const userMsg: ChatMessage = { role: "user", content: query };
		history.push(userMsg);
		saveMessages([userMsg]);
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
