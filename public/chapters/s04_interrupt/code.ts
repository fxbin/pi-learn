#!/usr/bin/env node
/**
 * s04 中断与 steering —— 让循环可以被外部打断、被中途消息改写
 *
 * s01 的循环一旦转起来，外界唯一能叫停它的方式是 kill 进程。
 * 生产级 agent 需要两种更细的控制：
 *   1. abort    —— 用户按 Ctrl+C，立刻终止当前 LLM 请求并退出循环
 *   2. steering —— 循环运行中注入一条新指令，把模型"拨"到新方向
 * abort 靠 Web 标准 AbortSignal（传进 fetch 的 RequestInit，abort 时抛 AbortError），
 * 循环里再查 signal.aborted 做兜底。steering 靠回调 getSteeringMessages：
 * 每轮开始前调一次，返回的消息作为 user 消息注入。另加 maxTurns 熔断策略。
 * 运行：export ANTHROPIC_API_KEY=sk-ant-... && node code.ts（运行中按 Ctrl+C 中断）
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
	maxTurns: 10,
	steerAfterMs: 60_000,
} as const;

const BLOCKED_PATTERNS = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
const SYSTEM_PROMPT = `You are a coding agent at ${process.cwd()}. Use bash to solve tasks. Act, don't explain.`;
// ── 类型边界：Anthropic Messages API 的请求/响应形状 ────
interface TextBlock { type: "text"; text: string }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: { command: string } }
interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
interface ChatMessage { role: "user" | "assistant"; content: string | ContentBlock[] }
interface MessagesResponse { content: ContentBlock[]; stop_reason: string }
/** steering 钩子：每轮开始前调用，返回需要注入的 user 消息（空数组表示无注入） */
type SteeringFn = () => Promise<ChatMessage[]>;
const TOOLS = [{
	name: "bash",
	description: "Run a shell command.",
	input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
}];

/**
 * 调用 LLM：原生 fetch，signal 贯穿到 RequestInit。
 * signal abort 时 fetch 抛 AbortError，由调用方捕获；这是 Web 标准，不是 pi 发明。
 * @param messages 截至目前累积的完整对话历史
 * @param signal abort 信号，传入 fetch 让 HTTP 层可被打断
 * @returns API 返回的 content 块与 stop_reason
 */
async function callLlm(messages: ChatMessage[], signal: AbortSignal): Promise<MessagesResponse> {
	const response = await fetch(`${CONFIG.baseUrl}/v1/messages`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-api-key": CONFIG.apiKey,
			"anthropic-version": CONFIG.anthropicVersion,
		},
		body: JSON.stringify({ model: CONFIG.model, max_tokens: CONFIG.maxTokens, system: SYSTEM_PROMPT, messages, tools: TOOLS }),
		signal,
	});
	if (!response.ok) {
		const detail = (await response.text()).slice(0, 500);
		throw new Error(`LLM 请求失败 ${response.status}: ${detail}`);
	}
	return (await response.json()) as MessagesResponse;
}

/**
 * 执行 bash 命令：同步子进程 + 黑名单 + 超时 + 截断四道护栏。
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
	return output.length ? output.slice(0, CONFIG.maxOutputChars) : "(no output)";
}

/**
 * agent 主循环：在 s01 基础上叠加 abort、steering、maxTurns 三层控制。
 * 每轮：查 signal.aborted → 调 steering() 注入 → 调 LLM（abort 抛错则捕获退出）
 *       → 非 tool_use 则结束 → 执行工具 → 再查 signal.aborted → 轮数 +1 超 maxTurns 熔断。
 * @param messages 对话历史，循环过程中原地累积
 * @param signal abort 信号，贯穿到 fetch
 * @param steering 每轮开始前的消息注入钩子
 */
async function agentLoop(messages: ChatMessage[], signal: AbortSignal, steering: SteeringFn): Promise<void> {
	let turns = 0;
	while (true) {
		if (signal.aborted) {
			console.log("\n[aborted]");
			return;
		}
		for (const msg of await steering()) {
			messages.push(msg);
			console.log(`\x1b[35m[steering] ${msg.content}\x1b[0m`);
		}
		let response: MessagesResponse;
		try {
			response = await callLlm(messages, signal);
		} catch (err) {
			if (signal.aborted || (err instanceof Error && err.name === "AbortError")) {
				console.log("\n[aborted]");
				return;
			}
			throw err;
		}
		messages.push({ role: "assistant", content: response.content });
		if (response.stop_reason !== "tool_use") {
			return;
		}
		const results: ToolResultBlock[] = [];
		for (const block of response.content) {
			if (block.type !== "tool_use") {
				continue;
			}
			console.log(`\x1b[33m$ ${block.input.command}\x1b[0m`);
			const output = runBash(block.input.command);
			console.log(output.slice(0, 200));
			results.push({ type: "tool_result", tool_use_id: block.id, content: output });
		}
		messages.push({ role: "user", content: results });
		turns++;
		if (turns >= CONFIG.maxTurns) {
			console.log(`\x1b[31m[max-turns] 已达 ${CONFIG.maxTurns} 轮上限，熔断退出\x1b[0m`);
			return;
		}
		if (signal.aborted) {
			console.log("\n[aborted]");
			return;
		}
	}
}

/**
 * 交互入口：每次提问创建新的 AbortController，Ctrl+C 触发 abort。
 * steering 用时间预算示例：超过 steerAfterMs 注入"立即收尾"指令，演示运行中改写方向。
 */
async function main(): Promise<void> {
	if (!CONFIG.apiKey) {
		console.error("缺少 ANTHROPIC_API_KEY，请先 export 后再运行。");
		process.exit(1);
	}
	console.log("s04: Interrupt & Steering\n运行中按 Ctrl+C 中断当前任务；输入 q 退出。\n");
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = (prompt: string): Promise<string> => new Promise((resolve) => rl.question(prompt, resolve));
	let current: AbortController | null = null;
	rl.on("SIGINT", () => {
		if (current) {
			current.abort();
		} else {
			rl.close();
			process.exit(0);
		}
	});
	const history: ChatMessage[] = [];
	while (true) {
		const query = (await ask("\x1b[36ms04 >> \x1b[0m")).trim();
		if (query === "" || query.toLowerCase() === "q" || query.toLowerCase() === "exit") {
			break;
		}
		history.push({ role: "user", content: query });
		const controller = new AbortController();
		current = controller;
		const startedAt = Date.now();
		const steering: SteeringFn = async () => {
			if (Date.now() - startedAt > CONFIG.steerAfterMs) {
				return [{ role: "user" as const, content: "时间预算到了，请立即收尾并给出最终答案。" }];
			}
			return [];
		};
		await agentLoop(history, controller.signal, steering);
		current = null;
		const last = history[history.length - 1];
		if (Array.isArray(last?.content)) {
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
