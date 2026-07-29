#!/usr/bin/env node
/**
 * s08 provider 抽象 + 消息边界转换 —— s01 的循环，可换后端
 *
 * 把 s01 里写死的 fetch 收敛成一个 LlmProvider 接口，两份实现：
 * AnthropicProvider 原样转发；OpenAIProvider 在边界做 tool_use <-> tool_calls 转换。
 * 内部 ChatMessage 形状不变，main() 按 CONFIG.provider 切换后端。
 *
 * 运行：
 *   PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... node code.ts
 *   PROVIDER=openai OPENAI_API_KEY=sk-... node code.ts
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

// ── 线格式对照：同一个 tool_use，两套 wire ──────────────
// Anthropic /v1/messages              OpenAI /v1/chat/completions
// system 独立字段                     system 塞进 messages[0]
// tools[].input_schema                tools[].function.parameters
// assistant.content[].tool_use        assistant.tool_calls[].function
//   { id, name, input:{command} }       { id, type:"function", function:{ name, arguments:"{...}" } }
// user.content[].tool_result          { role:"tool", tool_call_id, content }
// stop_reason: tool_use | end_turn    finish_reason: tool_calls | stop
// 内部 ChatMessage 始终用 Anthropic 形状；转换发生在 OpenAIProvider.complete() 边界。

// ── 类型边界（内部模型，与 s01 完全一致）──────────────
interface TextBlock { type: "text"; text: string }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: { command: string } }
interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
interface ChatMessage { role: "user" | "assistant"; content: string | ContentBlock[] }
interface MessagesResponse { content: ContentBlock[]; stop_reason: string }
interface ToolDef { name: string; description: string; input_schema: object }

// ── Provider 接口：一个接口，两份实现 ──────────────────
/** LLM 提供方抽象：内部消息模型与线格式之间的一道边界，每份实现负责互转。 */
interface LlmProvider {
	name: string;
	complete(messages: ChatMessage[], system: string, tools: ToolDef[]): Promise<MessagesResponse>;
}

// ── AnthropicProvider：原样转发，与 s01 的 callLlm 等价 ──
/** Anthropic Messages API 实现。内部模型即 wire 格式，零转换。 */
class AnthropicProvider implements LlmProvider {
	name = "anthropic";
	private readonly baseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
	private readonly apiKey = process.env.ANTHROPIC_API_KEY ?? "";
	private readonly model = process.env.MODEL_ID ?? "claude-sonnet-4-5";
	private readonly version = "2023-06-01";

	async complete(messages: ChatMessage[], system: string, tools: ToolDef[]): Promise<MessagesResponse> {
		const response = await fetch(`${this.baseUrl}/v1/messages`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": this.version },
			body: JSON.stringify({ model: this.model, max_tokens: CONFIG.maxTokens, system, messages, tools }),
		});
		if (!response.ok) throw new Error(`Anthropic ${response.status}: ${(await response.text()).slice(0, 500)}`);
		return (await response.json()) as MessagesResponse;
	}
}

// ── OpenAIProvider：边界转换 + Chat Completions ───────
/** OpenAI Chat Completions 实现。内部用 Anthropic 形状，complete() 在边界双向转换。 */
interface OpenAIMessage { role: string; content: string | null; tool_call_id?: string; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
interface OpenAIChoice { choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason: string }[] }

class OpenAIProvider implements LlmProvider {
	name = "openai";
	private readonly baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com";
	private readonly apiKey = process.env.OPENAI_API_KEY ?? "";
	private readonly model = process.env.MODEL_ID ?? "gpt-4o";

	/** 内部消息 -> OpenAI wire：system 独立成条，tool_result 拆成 tool 角色消息 */
	private toWire(messages: ChatMessage[], system: string): OpenAIMessage[] {
		const wire: OpenAIMessage[] = [{ role: "system", content: system }];
		for (const msg of messages) {
			if (typeof msg.content === "string") {
				wire.push({ role: msg.role, content: msg.content });
				continue;
			}
			if (msg.role === "assistant") {
				const text = msg.content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("");
				const calls = msg.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
				wire.push({
					role: "assistant",
					content: text || null,
					...(calls.length ? { tool_calls: calls.map((b) => ({ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input) } })) } : {}),
				});
			} else {
				const texts: string[] = [];
				for (const b of msg.content) {
					if (b.type === "tool_result") wire.push({ role: "tool", content: b.content, tool_call_id: b.tool_use_id });
					else if (b.type === "text") texts.push(b.text);
				}
				if (texts.length) wire.push({ role: "user", content: texts.join("\n") });
			}
		}
		return wire;
	}

	/** OpenAI 响应 -> 内部 MessagesResponse：tool_calls 还原成 tool_use，finish_reason 映射 stop_reason */
	private fromWire(data: OpenAIChoice): MessagesResponse {
		const msg = data.choices[0].message;
		const content: ContentBlock[] = [];
		if (msg.content) content.push({ type: "text", text: msg.content });
		if (msg.tool_calls) for (const tc of msg.tool_calls) {
			content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) as { command: string } });
		}
		return { content, stop_reason: data.choices[0].finish_reason === "tool_calls" ? "tool_use" : "end_turn" };
	}

	async complete(messages: ChatMessage[], system: string, tools: ToolDef[]): Promise<MessagesResponse> {
		const openaiTools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
		const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json", "authorization": `Bearer ${this.apiKey}` },
			body: JSON.stringify({ model: this.model, max_tokens: CONFIG.maxTokens, messages: this.toWire(messages, system), tools: openaiTools }),
		});
		if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 500)}`);
		return this.fromWire(await response.json() as OpenAIChoice);
	}
}

// ── 工具定义 + 执行 ────────────────────────────────────
const TOOLS: ToolDef[] = [
	{ name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
];

/** 执行 bash 命令：黑名单、超时、输出截断三道护栏。 */
function runBash(command: string): string {
	if (BLOCKED_PATTERNS.some((p) => command.includes(p))) return "Error: Dangerous command blocked";
	const result = spawnSync(command, { shell: true, cwd: process.cwd(), encoding: "utf-8", timeout: CONFIG.bashTimeoutMs });
	if (result.error) return `Error: ${result.error.message}`;
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
	return output ? output.slice(0, CONFIG.maxOutputChars) : "(no output)";
}

// ── agent 主循环（与 s01 同形，callLlm 换成 provider.complete）──
/** agent 主循环：问模型、追加回答、执行工具、回填结果，直到模型不再调用工具。 */
async function agentLoop(messages: ChatMessage[], provider: LlmProvider): Promise<void> {
	while (true) {
		const response = await provider.complete(messages, SYSTEM_PROMPT, TOOLS);
		messages.push({ role: "assistant", content: response.content });
		if (response.stop_reason !== "tool_use") return;
		const results: ToolResultBlock[] = [];
		for (const block of response.content) {
			if (block.type !== "tool_use") continue;
			console.log(`\x1b[33m$ ${block.input.command}\x1b[0m`);
			const output = runBash(block.input.command);
			console.log(output.slice(0, 200));
			results.push({ type: "tool_result", tool_use_id: block.id, content: output });
		}
		messages.push({ role: "user", content: results });
	}
}

/** 交互入口：按 CONFIG.provider 选后端，REPL 驱动 agentLoop。 */
async function main(): Promise<void> {
	const provider: LlmProvider = CONFIG.provider === "openai" ? new OpenAIProvider() : new AnthropicProvider();
	const apiKey = provider.name === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		console.error(`缺少 API key（PROVIDER=${CONFIG.provider}），请先 export 后再运行。`);
		process.exit(1);
	}
	console.log(`s08: Provider (${provider.name})\n输入问题，回车发送。输入 q 退出。\n`);
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = (prompt: string): Promise<string> => new Promise((resolve) => rl.question(prompt, resolve));
	const history: ChatMessage[] = [];
	while (true) {
		const query = (await ask("\x1b[36ms08 >> \x1b[0m")).trim();
		if (query === "" || query.toLowerCase() === "q" || query.toLowerCase() === "exit") break;
		history.push({ role: "user", content: query });
		await agentLoop(history, provider);
		const last = history[history.length - 1];
		if (Array.isArray(last.content)) {
			for (const block of last.content) {
				if (block.type === "text") console.log(block.text);
			}
		}
		console.log();
	}
	rl.close();
}

await main();
