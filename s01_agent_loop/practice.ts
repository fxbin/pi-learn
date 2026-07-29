#!/usr/bin/env node
/**
 * s01 默写验收：空白页模板
 *
 * 用法：合上 code.ts 与 README，凭记忆把每个函数的函数体补全。
 * 补全后运行 `node practice.ts`，能正常对话、能调 bash 工具即通过。
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
} as const;

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

// ── 工具定义：只有 bash ─────────────────────────────────

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
 * 提示：POST `${CONFIG.baseUrl}/v1/messages`，请求头三个
 * （content-type / x-api-key / anthropic-version），
 * body 五个字段（model / max_tokens / system / messages / tools）。
 * 别忘了检查 response.ok，失败时抛出带状态码的清晰错误。
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
 * 合并 stdout 与 stderr；空输出返回 "(no output)"；
 * 超长输出截断到 CONFIG.maxOutputChars。
 * @param command 模型给出的 shell 命令
 * @returns 合并 stdout/stderr 后的文本
 */
function runBash(command: string): string {
	// TODO: 在这里默写工具执行
	throw new Error("not implemented");
}

/**
 * agent 主循环：把工具结果持续喂回模型，直到模型不再调用工具。
 * 提示：while (true) 里四步——
 * 1. callLlm 拿响应；2. assistant 消息追加进 messages；
 * 3. stop_reason 不是 "tool_use" 就 return；
 * 4. 否则遍历 content 块执行 tool_use，收集 tool_result，
 *    作为一条 user 消息追加，进入下一轮。
 * @param messages 对话历史，循环过程中原地累积
 */
async function agentLoop(messages: ChatMessage[]): Promise<void> {
	// TODO: 在这里默写主循环
	throw new Error("not implemented");
}

/**
 * 交互入口：REPL 读取用户输入，驱动 agentLoop，打印模型最终文本回答。
 * 提示：先检查 apiKey 是否存在；readline.createInterface 包一层
 * Promise 化的 ask；history 数组跨轮次保留；q / exit / 空行退出。
 */
async function main(): Promise<void> {
	// TODO: 在这里默写交互入口
	throw new Error("not implemented");
}

await main();
