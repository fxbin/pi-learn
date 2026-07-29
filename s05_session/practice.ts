#!/usr/bin/env node
/**
 * s05 默写验收：空白页模板
 *
 * 用法：合上 code.ts 与 README，凭记忆把每个函数的函数体补全。
 * 补全后运行 `node practice.ts`：
 *   - 能正常对话、能调 bash
 *   - 退出后 session.jsonl 有内容
 *   - 再次启动提示"已恢复 N 条消息"
 * 写不出某个函数，回到 README 的「工作原理」重读对应步骤，再来默写。
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
 * 提示：import { appendFileSync } from "node:fs"；
 * 对 messages 数组逐条 JSON.stringify + "\n"，用 appendFileSync 追加。
 * 记住：只追加，不修改，不删除——这是 Event Sourcing 的写入约束。
 * @param messages 待持久化的消息数组
 */
function saveMessages(messages: ChatMessage[]): void {
	// TODO: 在这里默写 append-only 持久化
	throw new Error("not implemented");
}

/**
 * 从 jsonl 文件加载全部消息：读全文 → 按行切 → 过滤空行 → 逐行 JSON.parse。
 * 提示：import { existsSync, readFileSync } from "node:fs"；
 * 文件不存在返回空数组；存在则 readFileSync 读全文，
 * split("\n").filter(非空).map(JSON.parse)。
 * @returns 按写入顺序排列的完整对话历史
 */
function loadMessages(): ChatMessage[] {
	// TODO: 在这里默写日志回放
	throw new Error("not implemented");
}

/**
 * 调用 LLM：原生 fetch 向 Messages API 发一次非流式请求。
 * 提示：POST `${CONFIG.baseUrl}/v1/messages`，请求头三个
 * （content-type / x-api-key / anthropic-version），
 * body 五个字段（model / max_tokens / system / messages / tools）。
 * @param messages 截至目前累积的完整对话历史
 * @returns API 返回的 content 块与 stop_reason
 */
async function callLlm(messages: ChatMessage[]): Promise<MessagesResponse> {
	// TODO: 在这里默写 HTTP 调用
	throw new Error("not implemented");
}

/**
 * 执行 bash 命令：同步子进程，超时与输出长度均有护栏。
 * 提示：先过黑名单；spawnSync 开 shell、cwd、encoding、timeout；
 * 合并 stdout 与 stderr；空输出返回 "(no output)"；超长截断。
 * @param command 模型给出的 shell 命令
 * @returns 合并 stdout/stderr 后的文本
 */
function runBash(command: string): string {
	// TODO: 在这里默写工具执行
	throw new Error("not implemented");
}

/**
 * agent 主循环：在 s01 基础上，每次 push 后立即持久化新增消息。
 * 提示：while (true) 里——
 * 1. callLlm 拿响应，构造 assistantMsg，push 进 messages
 * 2. saveMessages([assistantMsg])   ← 持久化点 1
 * 3. stop_reason 不是 "tool_use" 就 return
 * 4. 遍历 content 块执行 tool_use，收集 tool_result
 * 5. 构造 toolMsg，push 进 messages
 * 6. saveMessages([toolMsg])        ← 持久化点 2
 * 两个 save 调用是本章相对 s01 的全部增量，缺一不可。
 * @param messages 对话历史，循环过程中原地累积
 */
async function agentLoop(messages: ChatMessage[]): Promise<void> {
	// TODO: 在这里默写带持久化的主循环
	throw new Error("not implemented");
}

/**
 * 交互入口：启动时先 loadMessages 恢复历史，再进入 REPL。
 * 提示：先检查 apiKey；loadMessages 拿历史；
 * 有历史提示"已恢复 N 条消息"，无历史提示文件路径；
 * readline 读输入，用户消息也要 saveMessages；
 * q / exit / 空行退出。
 */
async function main(): Promise<void> {
	// TODO: 在这里默写交互入口
	throw new Error("not implemented");
}

await main();
