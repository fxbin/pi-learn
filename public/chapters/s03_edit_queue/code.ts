#!/usr/bin/env node
/**
 * s03 edit + 变更队列 —— 字符串手术与写盘串行化
 *
 * 在 s01 的循环上加两件事：
 * 1. edit 工具：读文件 → 替换字符串 → 写回（修改已有内容，而非整文件覆盖）
 * 2. file-mutation-queue：用 promise 链把写盘操作排成队列，串行执行
 * dispatch 表：工具名 → 处理函数，新增工具只改一张表，循环本身不动。
 *
 * 运行：export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic &&
 *       export ANTHROPIC_API_KEY=sk-deepseek-... &&
 *       export MODEL_ID=deepseek-chat &&
 *       node code.ts
 * @author fxbin
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import * as readline from "node:readline";

// ── 配置：本文件全部可调项集中于此 ──────────────────────
const CONFIG = {
	baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
	apiKey: process.env.ANTHROPIC_API_KEY ?? "",
	model: process.env.MODEL_ID ?? "claude-sonnet-4-5",
	anthropicVersion: "2023-06-01",
	maxTokens: 8000,
	bashTimeoutMs: 120_000,
	maxChars: 50_000,
} as const;

const BLOCKED_PATTERNS = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
const SYSTEM_PROMPT = `You are a coding agent at ${process.cwd()}. Use bash/read/write/edit to solve tasks. Act, don't explain.`;

// ── 类型边界：Anthropic Messages API 的请求/响应形状 ────
interface TextBlock { type: "text"; text: string; }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; }
interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string; }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
interface ChatMessage { role: "user" | "assistant"; content: string | ContentBlock[]; }
interface MessagesResponse { content: ContentBlock[]; stop_reason: string; }

// ── 工具定义：bash + read + write + edit ────────────────
const TOOLS = [
	{ name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
	{ name: "read", description: "Read a file's text content.", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
	{ name: "write", description: "Write content to a file (overwrites).", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
	{ name: "edit", description: "Replace old_string with new_string in a file.", input_schema: { type: "object", properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } }, required: ["path", "old_string", "new_string"] } },
];

// ── 文件变更队列：promise 链串行化，同一文件的多次修改不会交错 ──
let mutationQueue: Promise<string> = Promise.resolve("");

/**
 * 把一次文件变更排入队列：fn 在前一次变更完成后才执行。
 * promise 链式排队，不是真正的队列数据结构。catch 兜底防断裂。
 * @param fn 实际执行变更的异步函数，返回工具结果文本
 * @returns fn 的返回值，但在队列中排队等待
 */
function enqueueMutation(fn: () => Promise<string>): Promise<string> {
	mutationQueue = mutationQueue
		.then(fn)
		.catch((e: unknown) => `Error: ${e instanceof Error ? e.message : String(e)}`);
	return mutationQueue;
}

// ── 工具实现 ────────────────────────────────────────────
/** 执行 bash 命令：同步子进程，黑名单 + 超时 + 截断护栏。 */
function runBash(command: string): string {
	if (BLOCKED_PATTERNS.some((p) => command.includes(p))) {
		return "Error: Dangerous command blocked";
	}
	const r = spawnSync(command, { shell: true, cwd: process.cwd(), encoding: "utf-8", timeout: CONFIG.bashTimeoutMs });
	if (r.error) return `Error: ${r.error.message}`;
	return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().slice(0, CONFIG.maxChars) || "(no output)";
}

/** 读取文件文本内容，截断到安全长度。 */
function readTool(path: string): string {
	try {
		return readFileSync(path, "utf-8").slice(0, CONFIG.maxChars);
	} catch (e) {
		return `Error: ${e instanceof Error ? e.message : String(e)}`;
	}
}

/**
 * 路径校验：解析为绝对路径并确认落在 cwd 子树内，防越界。
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

/**
 * 写文件（经变更队列）：安全路径校验 → 建父目录 → 写入。
 * @param path 文件路径
 * @param content 写入内容
 * @returns 排队后的 Promise，resolve 为结果文本
 */
function writeTool(path: string, content: string): Promise<string> {
	return enqueueMutation(async () => {
		const abs = safePath(path);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, content);
		return `Wrote ${content.length} bytes to ${path}`;
	});
}

/**
 * 编辑文件（经变更队列）：安全路径校验 → 读 → 查重 → String.replace → 写回。
 * 教学版只做精确匹配，无模糊匹配、无 BOM/换行符处理。
 * @param path 文件路径
 * @param oldString 要替换的原文，必须在文件中唯一
 * @param newString 替换后的新文
 * @returns 排队后的 Promise，resolve 为结果文本
 */
function editTool(path: string, oldString: string, newString: string): Promise<string> {
	return enqueueMutation(async () => {
		if (!oldString) {
			return `Error: old_string cannot be empty`;
		}
		const abs = safePath(path);
		let content: string;
		try {
			content = readFileSync(abs, "utf-8");
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`;
		}
		const count = content.split(oldString).length - 1;
		if (count === 0) return `Error: old_string not found in ${path}`;
		if (count > 1) return `Error: old_string appears ${count} times in ${path}, must be unique`;
		writeFileSync(abs, content.replace(oldString, newString));
		return `Edited ${path}`;
	});
}

// ── dispatch 表：工具名 → 处理函数 ──────────────────────
type ToolHandler = (input: Record<string, unknown>) => Promise<string>;
const handlers: Record<string, ToolHandler> = {
	bash: async (i) => runBash(String(i.command ?? "")),
	read: async (i) => readTool(String(i.path ?? "")),
	write: async (i) => writeTool(String(i.path ?? ""), String(i.content ?? "")),
	edit: async (i) => editTool(String(i.path ?? ""), String(i.old_string ?? ""), String(i.new_string ?? "")),
};

// ── LLM 调用 ────────────────────────────────────────────
/** 调用 LLM：原生 fetch 向 Messages API 发一次非流式请求。 */
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
 * dispatch 表把"执行哪个工具"从循环里剥离，新增工具只改表。
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
			const output = handler ? await handler(block.input) : `Error: unknown tool ${block.name}`;
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
	console.log("s03: Edit + Mutation Queue");
	console.log("输入问题，回车发送。输入 q 退出。\n");
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = (p: string): Promise<string> => new Promise((r) => rl.question(p, r));
	const history: ChatMessage[] = [];
	while (true) {
		const q = (await ask("\x1b[36ms03 >> \x1b[0m")).trim();
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
