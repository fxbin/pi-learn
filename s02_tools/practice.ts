#!/usr/bin/env node
/**
 * s02 默写验收：空白页模板
 *
 * 用法：合上 code.ts 与 README，凭记忆把每个函数的函数体补全。
 * 补全后运行 `node practice.ts`，能 read 读文件、write 写文件、bash 跑命令即通过。
 * 写不出某个函数，回到 README 的「工作原理」重读对应步骤，再来默写。
 *
 * @author fxbin
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import * as readline from "node:readline";

// ── 配置 ──────────────────────────────────────────────
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
];

/**
 * 路径校验：解析为绝对路径并确认落在 cwd 子树内。
 * 提示：resolve(cwd, raw) → relative(cwd, abs) → 拒绝 startsWith("..") → 返回 abs。
 * @param raw 模型给出的路径
 * @returns 校验通过的绝对路径
 */
function safePath(raw: string): string {
	// TODO: 在这里默写路径校验
	throw new Error("not implemented");
}

// ── 工具实现 ──────────────────────────────────────────
/**
 * 执行 bash 命令。
 * 提示：取 input.command → 过黑名单 → spawnSync(shell/cwd/encoding/timeout) →
 * 合并 stdout/stderr → 截断到 maxOutputChars → 空输出返回 "(no output)"。
 */
function runBash(input: Record<string, unknown>): string {
	// TODO: 在这里默写 bash 工具
	throw new Error("not implemented");
}

/**
 * 读取文件文本内容。
 * 提示：取 input.path → safePath → readFileSync utf-8 → slice 截断到 maxReadChars；
 * try/catch 返回错误字符串。
 */
function readFile(input: Record<string, unknown>): string {
	// TODO: 在这里默写 read 工具
	throw new Error("not implemented");
}

/**
 * 写文件。
 * 提示：取 input.path/content → safePath → mkdirSync 父目录(recursive) →
 * writeFileSync → 返回 `Wrote N bytes to path`；try/catch 返回错误字符串。
 */
function writeFile(input: Record<string, unknown>): string {
	// TODO: 在这里默写 write 工具
	throw new Error("not implemented");
}

// ── dispatch 表 ───────────────────────────────────────
/**
 * dispatch 表：工具名 → 处理函数。
 * 提示：三个条目 bash/read/write，各自指向同名函数（直接引用，不要包 arrow）。
 */
const handlers: Record<string, (input: Record<string, unknown>) => string> = {
	// TODO: 在这里默写三个工具的分发
};

// ── LLM 调用 ──────────────────────────────────────────
/**
 * 调用 LLM。
 * 提示：fetch POST `${CONFIG.baseUrl}/v1/messages`，三个请求头
 * (content-type/x-api-key/anthropic-version)，body 五字段
 * (model/max_tokens/system/messages/tools)，检查 res.ok，失败抛带状态码的错误。
 */
async function callLlm(messages: ChatMessage[]): Promise<MessagesResponse> {
	// TODO: 在这里默写 LLM 调用
	throw new Error("not implemented");
}

// ── agent 主循环 ──────────────────────────────────────
/**
 * agent 主循环。
 * 提示：while (true) → callLlm → push assistant → stop_reason 不是 "tool_use" 就 return →
 * 遍历 content 块 → handlers[block.name] 分发（找不到就返回 unknown tool 错误） →
 * 收集 tool_result → push user。
 */
async function agentLoop(messages: ChatMessage[]): Promise<void> {
	// TODO: 在这里默写主循环
	throw new Error("not implemented");
}

// ── 交互入口 ──────────────────────────────────────────
/**
 * 交互入口。
 * 提示：检查 apiKey → readline.createInterface → REPL 循环 →
 * agentLoop → 打印 last content 中 type 为 text 的块；q/exit/空行退出。
 */
async function main(): Promise<void> {
	// TODO: 在这里默写交互入口
	throw new Error("not implemented");
}

await main();
