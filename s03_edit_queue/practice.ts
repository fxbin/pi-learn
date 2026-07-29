#!/usr/bin/env node
/**
 * s03 默写验收：空白页模板
 *
 * 用法：合上 code.ts 与 README，凭记忆把每个函数的函数体补全。
 * 补全后运行 `node practice.ts`，能 write 创建文件、edit 修改文件即通过。
 * 写不出某个函数，回到 README 的「工作原理」重读对应步骤，再来默写。
 *
 * @author fxbin
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as readline from "node:readline";

// ── 配置 ──────────────────────────────────────────────
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

// ── 类型边界 ──────────────────────────────────────────
interface TextBlock { type: "text"; text: string; }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; }
interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string; }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
interface ChatMessage { role: "user" | "assistant"; content: string | ContentBlock[]; }
interface MessagesResponse { content: ContentBlock[]; stop_reason: string; }

// ── 工具定义 ──────────────────────────────────────────
const TOOLS = [
	{ name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
	{ name: "read", description: "Read a file's text content.", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
	{ name: "write", description: "Write content to a file (overwrites).", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
	{ name: "edit", description: "Replace old_string with new_string in a file.", input_schema: { type: "object", properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } }, required: ["path", "old_string", "new_string"] } },
];

// ── 文件变更队列 ──────────────────────────────────────
let mutationQueue: Promise<string> = Promise.resolve("");

/**
 * 把一次文件变更排入队列。
 * 提示：mutationQueue = mutationQueue.then(fn).catch(返回错误字符串); return mutationQueue;
 * catch 返回错误字符串，防止单次失败断裂整条链。
 * @param fn 实际执行变更的异步函数
 * @returns 排队后的 Promise
 */
function enqueueMutation(fn: () => Promise<string>): Promise<string> {
	throw new Error("not implemented");
}

// ── 工具实现 ──────────────────────────────────────────
/**
 * 执行 bash 命令。
 * 提示：黑名单检查 → spawnSync(shell/cwd/encoding/timeout) → 合并 stdout/stderr → 截断。
 */
function runBash(command: string): string {
	throw new Error("not implemented");
}

/**
 * 读取文件文本内容。
 * 提示：readFileSync utf-8 → slice 截断；catch 返回错误字符串。
 */
function readTool(path: string): string {
	throw new Error("not implemented");
}

/**
 * 写文件（经变更队列）。
 * 提示：enqueueMutation 包裹 async () => { mkdirSync 父目录; writeFileSync; 返回结果 }。
 */
function writeTool(path: string, content: string): Promise<string> {
	throw new Error("not implemented");
}

/**
 * 编辑文件（经变更队列）。
 * 提示：enqueueMutation 包裹 async () => {
 *   读文件(try/catch); split 计算出现次数; 0 次报未找到; >1 次报不唯一;
 *   String.replace 替换; writeFileSync 写回; 返回结果 }。
 */
function editTool(path: string, oldString: string, newString: string): Promise<string> {
	throw new Error("not implemented");
}

// ── dispatch 表 ───────────────────────────────────────
type ToolHandler = (input: Record<string, unknown>) => Promise<string>;

/**
 * dispatch 表：工具名 → 处理函数。
 * 提示：四个条目 bash/read/write/edit，各自从 input 取参数转 String 传给对应函数。
 */
const handlers: Record<string, ToolHandler> = {
	// TODO: 在这里默写四个工具的分发
};

// ── LLM 调用 ──────────────────────────────────────────
/**
 * 调用 LLM。
 * 提示：fetch POST，三个请求头(content-type/x-api-key/anthropic-version)，
 * body 五字段(model/max_tokens/system/messages/tools)，检查 res.ok。
 */
async function callLlm(messages: ChatMessage[]): Promise<MessagesResponse> {
	throw new Error("not implemented");
}

// ── agent 主循环 ──────────────────────────────────────
/**
 * agent 主循环。
 * 提示：while (true) → callLlm → push assistant → stop_reason 不是 "tool_use" 就 return →
 * 遍历 content 块 → handlers[block.name] 分发(await) → 收集 tool_result → push user。
 */
async function agentLoop(messages: ChatMessage[]): Promise<void> {
	throw new Error("not implemented");
}

// ── 交互入口 ──────────────────────────────────────────
/**
 * 交互入口。
 * 提示：检查 apiKey → readline.createInterface → REPL 循环 →
 * agentLoop → 打印 last content 中 type 为 text 的块。
 */
async function main(): Promise<void> {
	throw new Error("not implemented");
}

await main();
