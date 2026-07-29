#!/usr/bin/env node
/**
 * s08 默写验收：空白页模板
 *
 * 用法：合上 code.ts 与 README，凭记忆把每个函数/方法体补全。
 * 重点默写本章新增的：
 *   - LlmProvider 接口 + AnthropicProvider（callLlm 搬进类）
 *   - OpenAIProvider 的 toWire / fromWire（边界双向转换）
 *   - agentLoop（s01 同形，callLlm 换成 provider.complete）
 *   - main（按 CONFIG.provider 选后端）
 * runBash 是 s01 原样，写不出可以查。
 * 补全后运行 `node practice.ts`，anthropic / openai 两个后端都能跑通即通过。
 *
 * @author fxbin
 */

import { spawnSync } from "node:child_process";
import * as readline from "node:readline";

// ── 配置：本文件全部可调项集中于此 ──────────────────────
const CONFIG = {
	provider: (process.env.PROVIDER ?? "anthropic") as "anthropic" | "openai",
	maxTokens: 8000,
	bashTimeoutMs: 120_000,
	maxOutputChars: 50_000,
} as const;

const SYSTEM_PROMPT = `You are a coding agent at ${process.cwd()}. Use bash to solve tasks. Act, don't explain.`;
const BLOCKED_PATTERNS = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];

// ── 类型边界（内部模型，与 s01 完全一致）──────────────
interface TextBlock { type: "text"; text: string }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: { command: string } }
interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
interface ChatMessage { role: "user" | "assistant"; content: string | ContentBlock[] }
interface MessagesResponse { content: ContentBlock[]; stop_reason: string }
interface ToolDef { name: string; description: string; input_schema: object }

// ── OpenAI wire 类型（OpenAIProvider 内部使用）─────────
interface OpenAIMessage { role: string; content: string | null; tool_call_id?: string; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
interface OpenAIChoice { choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason: string }[] }

// ── 工具定义 ───────────────────────────────────────────
const TOOLS: ToolDef[] = [
	{ name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
];

// ── Provider 接口 ──────────────────────────────────────
/**
 * LLM 提供方抽象：内部消息模型与线格式之间的一道边界。
 * 提示：一个 name 属性标识身份；一个 complete 方法负责调 LLM 并返回内部 MessagesResponse。
 * @param messages 内部对话历史（Anthropic 形状）
 * @param system 系统提示词
 * @param tools 工具定义列表
 * @returns 统一的 content 块与 stop_reason
 */
interface LlmProvider {
	name: string;
	complete(messages: ChatMessage[], system: string, tools: ToolDef[]): Promise<MessagesResponse>;
}

// ── AnthropicProvider ──────────────────────────────────
/**
 * Anthropic Messages API 实现。内部模型即 wire 格式，零转换。
 * 提示：与 s01 的 callLlm 等价——POST `${baseUrl}/v1/messages`，
 * 请求头 content-type / x-api-key / anthropic-version，
 * body 含 model / max_tokens / system / messages / tools。
 * 失败抛带状态码的错误，成功返回 response.json()。
 */
class AnthropicProvider implements LlmProvider {
	name = "anthropic";
	private readonly baseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
	private readonly apiKey = process.env.ANTHROPIC_API_KEY ?? "";
	private readonly model = process.env.MODEL_ID ?? "claude-sonnet-4-5";
	private readonly version = "2023-06-01";

	async complete(messages: ChatMessage[], system: string, tools: ToolDef[]): Promise<MessagesResponse> {
		// TODO: 在这里默写 Anthropic 调用
		throw new Error("not implemented");
	}
}

// ── OpenAIProvider ─────────────────────────────────────
/**
 * OpenAI Chat Completions 实现。内部用 Anthropic 形状，边界双向转换。
 * 提示：toWire 把内部消息翻成 OpenAI wire——system 独立成 messages[0]；
 *   assistant 的 tool_use -> tool_calls（arguments 要 JSON.stringify）；
 *   user 的 tool_result -> 独立 role:"tool" 消息（带 tool_call_id）。
 * fromWire 把 OpenAI 响应翻回内部——tool_calls 还原成 tool_use（arguments 要 JSON.parse）；
 *   finish_reason "tool_calls" -> stop_reason "tool_use"，其余 -> "end_turn"。
 */
class OpenAIProvider implements LlmProvider {
	name = "openai";
	private readonly baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com";
	private readonly apiKey = process.env.OPENAI_API_KEY ?? "";
	private readonly model = process.env.MODEL_ID ?? "gpt-4o";

	/**
	 * 内部消息 -> OpenAI wire 消息。
	 * 提示：开头塞 { role:"system", content:system }；
	 * string content 直接 { role, content }；
	 * assistant 数组：text 块拼成 content（空则 null），tool_use 块映射成 tool_calls；
	 * user 数组：tool_result 块拆成 { role:"tool", tool_call_id, content }。
	 */
	private toWire(messages: ChatMessage[], system: string): OpenAIMessage[] {
		// TODO: 在这里默写请求方向转换
		throw new Error("not implemented");
	}

	/**
	 * OpenAI 响应 -> 内部 MessagesResponse。
	 * 提示：取 choices[0].message；content 非空则加 text 块；
	 * tool_calls 遍历加 tool_use 块（arguments 用 JSON.parse 还原成对象）；
	 * finish_reason === "tool_calls" 则 stop_reason = "tool_use"，否则 "end_turn"。
	 */
	private fromWire(data: OpenAIChoice): MessagesResponse {
		// TODO: 在这里默写响应方向转换
		throw new Error("not implemented");
	}

	async complete(messages: ChatMessage[], system: string, tools: ToolDef[]): Promise<MessagesResponse> {
		// TODO: 在这里默写 OpenAI 调用（toWire + fetch + fromWire）
		throw new Error("not implemented");
	}
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
 * agent 主循环：问模型、追加回答、执行工具、回填结果，直到模型不再调用工具。
 * 提示：与 s01 同形，callLlm(messages) 换成 provider.complete(messages, SYSTEM_PROMPT, TOOLS)；
 * stop_reason !== "tool_use" 则 return；否则遍历 content 执行 tool_use，
 * 收集 tool_result 作为 user 消息回填。
 * @param messages 对话历史，原地累积
 * @param provider LLM 提供方，决定线格式
 */
async function agentLoop(messages: ChatMessage[], provider: LlmProvider): Promise<void> {
	// TODO: 在这里默写主循环
	throw new Error("not implemented");
}

/**
 * 交互入口：按 CONFIG.provider 选后端，REPL 驱动 agentLoop。
 * 提示：provider = CONFIG.provider === "openai" ? new OpenAIProvider() : new AnthropicProvider()；
 * 检查对应 apiKey；readline + Promise 化的 ask；history 跨轮保留；
 * q / exit / 空行退出；末尾打印 assistant 的 text 块。
 */
async function main(): Promise<void> {
	// TODO: 在这里默写交互入口
	throw new Error("not implemented");
}

await main();
