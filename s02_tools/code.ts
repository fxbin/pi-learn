#!/usr/bin/env node
/**
 * s02 bash/read/write + dispatch 表 —— 三个"无聊"工具与一张分发表
 *
 * 在 s01 的循环上加两件事：
 * 1. 工具从 1 个变 3 个：bash + read + write，文件操作不再绕 shell
 * 2. 硬编码 bash 调用换成 dispatch 表：工具名 → 处理函数
 * 循环本身不动，新增工具只改一张表。
 *
 * 运行：export ANTHROPIC_API_KEY=sk-ant-... && node code.ts
 * @author fxbin
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import * as readline from "node:readline";

// ── 配置：本文件全部可调项集中于此 ──────────────────────
const CONFIG = {
	baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
	apiKey: process.env.ANTHROPIC_API_KEY ?? "",
	model: process.env.MODEL_ID ?? "claude-sonnet-4-5",
	anthropicVersion: "2023-06-01",
	maxTokens: 8000,
	bashTimeoutMs: 120_000,
	maxReadChars: 50_000,
	maxOutputChars: 50_000,
} as const;

const BLOCKED_PATTERNS = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
const SYSTEM_PROMPT = `You are a coding agent at ${process.cwd()}. Use bash/read/write to solve tasks. Act, don't explain.`;

// ── 类型边界：Anthropic Messages API 的请求/响应形状 ────
interface TextBlock { type: "text"; text: string; }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; }
interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string; }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
interface ChatMessage { role: "user" | "assistant"; content: string | ContentBlock[]; }
interface MessagesResponse { content: ContentBlock[]; stop_reason: string; }

// ── 工具定义：bash + read + write ────────────────────────
const TOOLS = [
	{ name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
	{ name: "read", description: "Read a file's text content.", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
	{ name: "write", description: "Write content to a file (overwrites).", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
];

/**
 * 路径校验：解析为绝对路径并确认落在 cwd 子树内，防越界。
 * 教学版用 resolve + relative 做前缀比较，不处理符号链接。
 * @param raw 模型给出的路径，相对或绝对
 * @returns 校验通过后的绝对路径
 */
function safePath(raw: string): string {
	const abs = resolve(process.cwd(), raw);
	const rel = relative(process.cwd(), abs);
	if (rel.startsWith("..")) {
		throw new Error(`path outside cwd: ${raw}`);
	}
	return abs;
}

// ── 工具实现：签名一致 (input) => string，便于塞进同一张表 ──
/** 执行 bash 命令：同步子进程，黑名单 + 超时 + 截断护栏。 */
function runBash(input: Record<string, unknown>): string {
	const command = String(input.command ?? "");
	if (BLOCKED_PATTERNS.some((p) => command.includes(p))) {
		return "Error: Dangerous command blocked";
	}
	const r = spawnSync(command, { shell: true, cwd: process.cwd(), encoding: "utf-8", timeout: CONFIG.bashTimeoutMs });
	if (r.error) return `Error: ${r.error.message}`;
	return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().slice(0, CONFIG.maxOutputChars) || "(no output)";
}

/** 读取文件文本内容，截断到 maxReadChars，绕过 shell 的引号/转义噪音。 */
function readFile(input: Record<string, unknown>): string {
	const path = String(input.path ?? "");
	try {
		const abs = safePath(path);
		return readFileSync(abs, "utf-8").slice(0, CONFIG.maxReadChars);
	} catch (e) {
		return `Error: ${e instanceof Error ? e.message : String(e)}`;
	}
}

/** 写文件：建父目录 → 写入。整文件覆盖，不做定点编辑。 */
function writeFile(input: Record<string, unknown>): string {
	const path = String(input.path ?? "");
	const content = String(input.content ?? "");
	try {
		const abs = safePath(path);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, content);
		return `Wrote ${content.length} bytes to ${path}`;
	} catch (e) {
		return `Error: ${e instanceof Error ? e.message : String(e)}`;
	}
}

// ── dispatch 表：工具名 → 处理函数 ──────────────────────
const handlers: Record<string, (input: Record<string, unknown>) => string> = {
	bash: runBash,
	read: readFile,
	write: writeFile,
};

// ── LLM 调用 ────────────────────────────────────────────
/**
 * 调用 LLM：原生 fetch 向 Messages API 发一次非流式请求。
 * @param messages 截至目前累积的完整对话历史
 * @returns API 返回的 content 块与 stop_reason
 */
async function callLlm(messages: ChatMessage[]): Promise<MessagesResponse> {
	const res = await fetch(`${CONFIG.baseUrl}/v1/messages`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-api-key": CONFIG.apiKey, "anthropic-version": CONFIG.anthropicVersion },
		body: JSON.stringify({ model: CONFIG.model, max_tokens: CONFIG.maxTokens, system: SYSTEM_PROMPT, messages, tools: TOOLS }),
	});
	if (!res.ok) throw new Error(`LLM 请求失败 ${res.status}: ${(await res.text()).slice(0, 500)}`);
	return (await res.json()) as MessagesResponse;
}

// ── agent 主循环 ────────────────────────────────────────
/**
 * agent 主循环：工具结果持续喂回模型，直到不再调用工具。
 * dispatch 表把"执行哪个工具"从循环里剥离，新增工具只改表不改循环。
 * @param messages 对话历史，循环过程中原地累积
 */
async function agentLoop(messages: ChatMessage[]): Promise<void> {
	while (true) {
		const res = await callLlm(messages);
		messages.push({ role: "assistant", content: res.content });
		if (res.stop_reason !== "tool_use") return;
		const results: ToolResultBlock[] = [];
		for (const block of res.content) {
			if (block.type !== "tool_use") continue;
			const handler = handlers[block.name];
			const output = handler ? handler(block.input) : `Error: unknown tool ${block.name}`;
			console.log(`\x1b[33m$ ${block.name}\x1b[0m`);
			results.push({ type: "tool_result", tool_use_id: block.id, content: output });
		}
		messages.push({ role: "user", content: results });
	}
}

// ── 交互入口 ────────────────────────────────────────────
/** 交互入口：REPL 读取用户输入，驱动 agentLoop，打印模型最终文本回答。 */
async function main(): Promise<void> {
	if (!CONFIG.apiKey) {
		console.error("缺少 ANTHROPIC_API_KEY，请先 export 后再运行。");
		process.exit(1);
	}
	console.log("s02: Tools & Dispatch");
	console.log("输入问题，回车发送。输入 q 退出。\n");
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = (p: string): Promise<string> => new Promise((r) => rl.question(p, r));
	const history: ChatMessage[] = [];
	while (true) {
		const q = (await ask("\x1b[36ms02 >> \x1b[0m")).trim();
		if (q === "" || q.toLowerCase() === "q" || q.toLowerCase() === "exit") break;
		history.push({ role: "user", content: q });
		await agentLoop(history);
		const last = history[history.length - 1];
		if (Array.isArray(last.content)) {
			for (const b of last.content) if (b.type === "text") console.log(b.text);
		}
		console.log();
	}
	rl.close();
}

await main();
