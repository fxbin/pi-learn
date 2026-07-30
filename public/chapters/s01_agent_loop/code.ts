#!/usr/bin/env node
/**
 * s01 agent loop —— 一个循环就够了
 *
 * 整个 coding agent 的秘密，收敛为一个模式：
 *
 *     while (content 里有 tool_use 块) {
 *         response = LLM(messages, tools)
 *         执行工具
 *         结果回填
 *     }
 *
 *     +----------+      +-------+      +---------+
 *     |   用户   | ---> |  LLM  | ---> | 工具执行 |
 *     |   提问   |      |       |      |         |
 *     +----------+      +---+---+      +----+----+
 *                          ^               |
 *                          |  tool_result  |
 *                          +---------------+
 *                         （循环继续）
 *
 * 模型决定停，循环才停。退出判断看 content 里有没有 tool_use 块，
 * 不是看 stop_reason——后者是 provider 元数据，跨 provider 命名不一。
 * 生产级 agent 在此之上叠加事件流、中断与生命周期控制，
 * 那些是 s04 及以后的事；本章只要这个最小骨架。
 *
 * 运行方式：
 *   export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
 *   export ANTHROPIC_API_KEY=sk-deepseek-...
 *   export MODEL_ID=deepseek-chat
 *   node code.ts
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
} as const;

// 黑名单只做教学演示：让学习者意识到工具执行需要护栏
const BLOCKED_PATTERNS = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];

const SYSTEM_PROMPT = `You are a coding agent at ${process.cwd()}. Use bash to solve tasks. Act, don't explain.`;

// ── 类型边界：Anthropic Messages API 的请求/响应形状 ────

interface TextBlock {
	type: "text";
	text: string;
}

interface ToolUseBlock {
	type: "tool_use";
	id: string;
	name: string;
	input: { command: string };
}

interface ToolResultBlock {
	type: "tool_result";
	tool_use_id: string;
	content: string;
}

type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

interface ChatMessage {
	role: "user" | "assistant";
	content: string | ContentBlock[];
}

interface MessagesResponse {
	content: ContentBlock[];
	stop_reason: string;
}

// ── 工具定义：只有 bash，一个工具足够演示循环 ───────────

const TOOLS = [
	{
		name: "bash",
		description: "Run a shell command.",
		input_schema: {
			type: "object",
			properties: { command: { type: "string" } },
			required: ["command"],
		},
	},
];

/**
 * 调用 LLM：用原生 fetch 向 Messages API 发一次非流式请求。
 * 零第三方依赖：HTTP 层完全透明，为 s08 的 provider 抽象埋下伏笔。
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
	if (BLOCKED_PATTERNS.some((pattern) => command.includes(pattern))) {
		return "Error: Dangerous command blocked";
	}
	const result = spawnSync(command, {
		shell: true,
		cwd: process.cwd(),
		encoding: "utf-8",
		timeout: CONFIG.bashTimeoutMs,
	});
	if (result.error) {
		return `Error: ${result.error.message}`;
	}
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
	if (!output) {
		return "(no output)";
	}
	return output.slice(0, CONFIG.maxOutputChars);
}

/**
 * agent 主循环：把工具结果持续喂回模型，直到模型不再调用工具。
 *
 * 退出判断与真 pi 一致（agent-loop.ts 第 196、203 行）：
 *   - 异常退出：stop_reason 是 "error" 或 "aborted" → 抛错
 *   - 正常退出：content 里没有 tool_use 块 → return
 *
 * 不用 stop_reason === "tool_use" 判断循环继续，是因为 stop_reason 是 provider 元数据，
 * 不同 provider 命名不一（Anthropic 是 "tool_use"，OpenAI 是 "tool_calls"）。
 * content 里的 tool_use 块是 pi 自己 normalized 过的结构化数据，更稳健。
 *
 * 每轮只做三件事：问模型、追加回答、按需执行工具并回填结果。
 * @param messages 对话历史，循环过程中原地累积
 */
async function agentLoop(messages: ChatMessage[]): Promise<void> {
	while (true) {
		const response = await callLlm(messages);
		messages.push({ role: "assistant", content: response.content });
		if (response.stop_reason === "error" || response.stop_reason === "aborted") {
			throw new Error(`LLM 异常终止: stop_reason=${response.stop_reason}`);
		}
		const toolCalls = response.content.filter((block) => block.type === "tool_use");
		if (toolCalls.length === 0) {
			return;
		}
		const results: ToolResultBlock[] = [];
		for (const block of toolCalls) {
			console.log(`\x1b[33m$ ${block.input.command}\x1b[0m`);
			const output = runBash(block.input.command);
			console.log(output.slice(0, 200));
			results.push({
				type: "tool_result",
				tool_use_id: block.id,
				content: output,
			});
		}
		messages.push({ role: "user", content: results });
	}
}

/**
 * 交互入口：REPL 读取用户输入，驱动 agentLoop，打印模型最终文本回答。
 * 输入 q 或空行退出；Ctrl+C / Ctrl+D 同样退出。
 */
async function main(): Promise<void> {
	if (!CONFIG.apiKey) {
		console.error("缺少 ANTHROPIC_API_KEY，请先 export 后再运行。");
		process.exit(1);
	}
	console.log("s01: Agent Loop");
	console.log("输入问题，回车发送。输入 q 退出。\n");
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = (prompt: string): Promise<string> =>
		new Promise((resolve) => rl.question(prompt, resolve));
	const history: ChatMessage[] = [];
	while (true) {
		const query = (await ask("\x1b[36ms01 >> \x1b[0m")).trim();
		if (query === "" || query.toLowerCase() === "q" || query.toLowerCase() === "exit") {
			break;
		}
		history.push({ role: "user", content: query });
		await agentLoop(history);
		const last = history[history.length - 1];
		if (Array.isArray(last.content)) {
			for (const block of last.content) {
				if (block.type === "text") {
					console.log(block.text);
				}
			}
		}
		console.log();
	}
	rl.close();
}

await main();
