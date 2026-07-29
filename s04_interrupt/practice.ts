#!/usr/bin/env node
/**
 * s04 默写验收：空白页模板
 *
 * 用法：合上 code.ts 与 README，凭记忆把每个函数的函数体补全。
 * 补全后运行 `node practice.ts`，能正常对话、能调 bash 工具、运行中
 * 按 Ctrl+C 能中断、把 maxTurns 调小能熔断，即通过。
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
 * 提示：POST `${CONFIG.baseUrl}/v1/messages`，请求头三个
 * （content-type / x-api-key / anthropic-version），body 五个字段
 * （model / max_tokens / system / messages / tools）。
 * 关键：把 signal 塞进 fetch 的第二参数，让 abort 能打断 HTTP。
 * 别忘了检查 response.ok，失败时抛出带状态码的清晰错误。
 * @param messages 截至目前累积的完整对话历史
 * @param signal abort 信号，传入 fetch 让 HTTP 层可被打断
 * @returns API 返回的 content 块与 stop_reason
 */
async function callLlm(messages: ChatMessage[], signal: AbortSignal): Promise<MessagesResponse> {
	// TODO: 在这里默写带 signal 的 HTTP 调用
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
 * agent 主循环：在 s01 基础上叠加 abort、steering、maxTurns 三层控制。
 * 提示：while (true) 里按这个顺序——
 * 1. 查 signal.aborted，已中断则打印 [aborted] 并 return；
 * 2. 调 steering()，返回的消息逐条 push 进 messages（可打印 [steering] 提示）；
 * 3. try 里 callLlm；catch 里若 signal.aborted 或 err.name==="AbortError"
 *    则打印 [aborted] 并 return，否则 rethrow；
 * 4. assistant 消息追加；stop_reason 非 "tool_use" 则 return；
 * 5. 遍历 content 块执行 tool_use，收集 tool_result，作为 user 消息追加；
 * 6. turns++；超过 CONFIG.maxTurns 则打印 [max-turns] 并 return；
 * 7. 再查 signal.aborted。
 * @param messages 对话历史，循环过程中原地累积
 * @param signal abort 信号，贯穿到 fetch
 * @param steering 每轮开始前的消息注入钩子
 */
async function agentLoop(messages: ChatMessage[], signal: AbortSignal, steering: SteeringFn): Promise<void> {
	// TODO: 在这里默写带三层控制的主循环
	throw new Error("not implemented");
}

/**
 * 交互入口：每次提问创建新的 AbortController，Ctrl+C 触发 abort。
 * 提示：先检查 apiKey；readline.createInterface 包一层 Promise 化的 ask；
 * 用一个 current 变量持有当前 controller，rl.on("SIGINT") 里若 current
 * 存在就 abort，否则退出；每轮提问 new 一个 controller，传给 agentLoop；
 * steering 用时间预算（Date.now() - startedAt > steerAfterMs 时返回收尾指令）。
 * q / exit / 空行退出。
 */
async function main(): Promise<void> {
	// TODO: 在这里默写交互入口
	throw new Error("not implemented");
}

await main();
