#!/usr/bin/env node
/**
 * s06 默写验收：空白页模板
 *
 * 用法：合上 code.ts 与 README，凭记忆把每个函数的函数体补全。
 * 重点默写本章新增的三处：estimateTokens、compact、agentLoop 的压缩闸门。
 * callLlm / runBash / main 是 s01 原样，写不出可以查。
 * 补全后运行 `node practice.ts`，把 maxContextTokens 调到 5000 跑长任务，
 * 能看到 [compaction] 提示且压缩后不崩溃即通过。
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

// ── 工具定义：只有 bash ─────────────────────────────────

const TOOLS: ToolDef[] = [
	{ name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
];

/**
 * 调用 LLM：原生 fetch 非流式请求。
 * 提示：POST `${CONFIG.baseUrl}/v1/messages`，请求头三个
 * （content-type / x-api-key / anthropic-version），body 含
 * model / max_tokens / system / messages / tools。失败抛带状态码的错误。
 * @param messages 对话历史
 * @param tools 工具定义；摘要请求传空数组禁用工具
 * @returns content 块与 stop_reason
 */
async function callLlm(messages: ChatMessage[], tools: ToolDef[] = TOOLS): Promise<MessagesResponse> {
	// TODO: 在这里默写 HTTP 调用
	throw new Error("not implemented");
}

/**
 * 执行 bash 命令：黑名单、超时、输出截断三道护栏。
 * 提示：先过黑名单；spawnSync 开 shell、cwd、encoding、timeout；
 * 合并 stdout/stderr；空输出返回 "(no output)"；超长截断到 maxOutputChars。
 * @param command 模型给出的 shell 命令
 * @returns 合并 stdout/stderr 后的文本
 */
function runBash(command: string): string {
	// TODO: 在这里默写工具执行
	throw new Error("not implemented");
}

/**
 * 把单条消息拍平成纯文本，供 token 估算与摘要序列化复用。
 * 提示：string 直接返回；数组则遍历块——text 取 text，
 * tool_use 取 input.command，tool_result 取 content，用 "\n" 拼接。
 * @param message 一条对话消息
 * @returns 该消息的纯文本表示
 */
function flattenText(message: ChatMessage): string {
	// TODO: 在这里默写拍平逻辑
	throw new Error("not implemented");
}

/**
 * 估算 token 数：所有消息字符总数 / 4。
 * 提示：reduce 累加每条消息 flattenText 后的 length，Math.ceil(总和 / 4)。
 * @param messages 完整对话历史
 * @returns 估算的 token 数
 */
function estimateTokens(messages: ChatMessage[]): number {
	// TODO: 在这里默写 token 估算
	throw new Error("not implemented");
}

/**
 * 压缩上下文：旧消息摘要成一条 user summary，保留最近 keepRecentMessages 条。
 * 提示：splitIndex = Math.max(0, length - keepRecentMessages)；
 * 旧消息 slice 后 map(flattenText).join("\n\n") 拼成对话文本；
 * callLlm 传摘要 prompt + 对话文本，第二参 tools 传 [] 禁用工具；
 * 从 response.content 过滤 text 块拼成 summary；
 * 返回 [{ role:"user", content:`Previous conversation summary: ${summary}` }, ...recent]。
 * @param messages 溢出的完整对话历史
 * @returns [summary 消息, ...最近 keepRecentMessages 条]
 */
async function compact(messages: ChatMessage[]): Promise<ChatMessage[]> {
	// TODO: 在这里默写压缩逻辑
	throw new Error("not implemented");
}

/**
 * agent 主循环：每轮开头检查溢出则压缩，随后问模型、执行工具、回填结果。
 * 提示：while (true) 里先插闸门——
 * 当 length > keepRecentMessages 且 estimateTokens > maxContextTokens 时：
 *   调 compact，用 messages.length = 0 + messages.push(...compacted) 原地替换；
 * 然后 callLlm、push assistant、stop_reason 非 tool_use 则 return；
 * 否则遍历 content 执行 tool_use，收集 tool_result 作为 user 消息回填。
 * @param messages 对话历史，原地累积与压缩
 */
async function agentLoop(messages: ChatMessage[]): Promise<void> {
	// TODO: 在这里默写主循环（含压缩闸门）
	throw new Error("not implemented");
}

/**
 * 交互入口：REPL 读取用户输入，驱动 agentLoop，打印模型最终文本回答。
 * 提示：检查 apiKey；readline + Promise 化的 ask；history 跨轮保留；
 * q / exit / 空行退出；末尾打印 assistant 的 text 块。
 */
async function main(): Promise<void> {
	// TODO: 在这里默写交互入口
	throw new Error("not implemented");
}

await main();
