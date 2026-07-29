#!/usr/bin/env node
/**
 * s11 默写验收：空白页模板
 *
 * 用法：合上 code.ts 与 README，凭记忆把 4 个必默写补全：
 *   1. MiniAgentSession 类字段 + getter
 *   2. prompt() 四步流程
 *   3. _checkCompactionAfter 两个 case（overflow + threshold）
 *   4. setModel 三步
 *
 * 其余代码（辅助函数、subscribe、cycleModel、_maybeCompactBefore、main 等）
 * 已给出完整实现，不要改动。补全后运行 `node practice.ts`，/model 切换模型、
 * 跑长任务观察自动 compaction 即通过。
 *
 * @author fxbin
 */

import { spawnSync } from "node:child_process";
import * as readline from "node:readline";

// ── 配置：本文件全部可调项集中于此 ──────────────────────

const CONFIG = {
	baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
	apiKey: process.env.ANTHROPIC_API_KEY ?? "",
	anthropicVersion: "2023-06-01",
	maxTokens: 8000,
	bashTimeoutMs: 120_000,
	maxOutputChars: 50_000,
	keepRecentMessages: 6,
	compactionThreshold: 0.7,
} as const;

const BLOCKED_PATTERNS = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
const SUMMARIZATION_PROMPT =
	"Summarize the following conversation. Preserve key decisions, file paths, and current task state.";

// ── 类型定义 ──────────────────────────────────────────

interface ModelRef { id: string; provider: string; contextWindow: number }
interface TextBlock { type: "text"; text: string }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: { command: string } }
interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
interface ChatMessage { role: "user" | "assistant"; content: string | ContentBlock[] }
interface MessagesResponse { content: ContentBlock[]; stop_reason: string }
interface ToolDef { name: string; description: string; input_schema: object }
type SessionEventType = "agent_start" | "agent_end" | "model_select" | "compaction_start" | "compaction_end";
interface SessionEvent {
	type: SessionEventType;
	model?: ModelRef;
	reason?: string;
	result?: "overflow" | "threshold" | "aborted-recovery";
}
type Listener = (event: SessionEvent) => void;
type RunStopReason = "end" | "aborted" | "overflow";

// ── 工具定义 ──────────────────────────────────────────

const TOOLS: ToolDef[] = [
	{ name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
];

// ── 辅助函数（完整实现，无需默写） ─────────────────────

async function callLlm(messages: ChatMessage[], model: ModelRef, tools: ToolDef[], systemPrompt: string): Promise<MessagesResponse> {
	const response = await fetch(`${CONFIG.baseUrl}/v1/messages`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-api-key": CONFIG.apiKey, "anthropic-version": CONFIG.anthropicVersion },
		body: JSON.stringify({ model: model.id, max_tokens: CONFIG.maxTokens, system: systemPrompt, messages, tools }),
	});
	if (!response.ok) {
		throw new Error(`LLM 请求失败 ${response.status}: ${(await response.text()).slice(0, 500)}`);
	}
	return (await response.json()) as MessagesResponse;
}

function runBash(command: string): string {
	if (BLOCKED_PATTERNS.some((p) => command.includes(p))) return "Error: Dangerous command blocked";
	const result = spawnSync(command, { shell: true, cwd: process.cwd(), encoding: "utf-8", timeout: CONFIG.bashTimeoutMs });
	if (result.error) return `Error: ${result.error.message}`;
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
	return output ? output.slice(0, CONFIG.maxOutputChars) : "(no output)";
}

function flattenText(message: ChatMessage): string {
	if (typeof message.content === "string") return message.content;
	return message.content.map((b) => (b.type === "text" ? b.text : b.type === "tool_use" ? b.input.command : b.content)).join("\n");
}

function estimateTokens(messages: ChatMessage[]): number {
	return Math.ceil(messages.reduce((sum, m) => sum + flattenText(m).length, 0) / 4);
}

function isOverflowError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return msg.includes("context") && (msg.includes("overflow") || msg.includes("too long") || msg.includes("413"));
}

async function compactMessages(messages: ChatMessage[], model: ModelRef): Promise<ChatMessage[]> {
	const splitIndex = Math.max(0, messages.length - CONFIG.keepRecentMessages);
	const conversation = messages.slice(0, splitIndex).map(flattenText).join("\n\n");
	const response = await callLlm([{ role: "user", content: `${SUMMARIZATION_PROMPT}\n\n${conversation}` }], model, [], "");
	const summary = response.content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("\n");
	return [{ role: "user", content: `Previous conversation summary: ${summary}` }, ...messages.slice(splitIndex)];
}

async function agentLoop(messages: ChatMessage[], model: ModelRef, tools: ToolDef[], systemPrompt: string): Promise<RunStopReason> {
	while (true) {
		let response: MessagesResponse;
		try {
			response = await callLlm(messages, model, tools, systemPrompt);
		} catch (err) {
			if (isOverflowError(err)) return "overflow";
			throw err;
		}
		messages.push({ role: "assistant", content: response.content });
		if (response.stop_reason !== "tool_use") return "end";
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

// ── MiniAgentSession 类（4 个必默写标注 TODO） ──────────

class MiniAgentSession {
	// TODO 必默写 1：类字段声明
	// 提示：需要 _messages(ChatMessage[])、_model(ModelRef)、_tools(ToolDef[])、
	//   _systemPrompt(string)、_isStreaming(boolean)、_listeners(Listener[])、
	//   _overflowRecovered(boolean)、_lastStopReason(RunStopReason)、_compactionThreshold(number)
	//   其中 _tools 和 _compactionThreshold 用 readonly，_messages 初始化为 []，
	//   _isStreaming 初始化 false，_listeners 初始化 []，_overflowRecovered 初始化 false，
	//   _lastStopReason 初始化 "end"。
	private _messages!: ChatMessage[];
	private _model!: ModelRef;
	private readonly _tools!: ToolDef[];
	private _systemPrompt!: string;
	private _isStreaming!: boolean;
	private _listeners!: Listener[];
	private _overflowRecovered!: boolean;
	private _lastStopReason!: RunStopReason;
	private readonly _compactionThreshold!: number;

	constructor(options: { model: ModelRef; tools?: ToolDef[]; systemPrompt?: string; compactionThreshold?: number }) {
		this._messages = [];
		this._model = options.model;
		this._tools = options.tools ?? TOOLS;
		this._systemPrompt = options.systemPrompt ?? "";
		this._isStreaming = false;
		this._listeners = [];
		this._overflowRecovered = false;
		this._lastStopReason = "end";
		this._compactionThreshold = options.compactionThreshold ?? CONFIG.compactionThreshold;
	}

	// TODO 必默写 1（续）：getter
	// 提示：messages 返回 this._messages，model 返回 this._model，isStreaming 返回 this._isStreaming。
	get messages(): ChatMessage[] {
		throw new Error("not implemented");
	}
	get model(): ModelRef {
		throw new Error("not implemented");
	}
	get isStreaming(): boolean {
		throw new Error("not implemented");
	}

	/** 订阅会话事件，返回取消订阅函数。 */
	subscribe(listener: Listener): () => void {
		this._listeners.push(listener);
		return () => { this._listeners = this._listeners.filter((l) => l !== listener); };
	}

	private _emit(event: SessionEvent): void {
		for (const l of this._listeners) l(event);
	}

	/**
	 * TODO 必默写 4：setModel 三步
	 * 提示：
	 *   1. 记录 previous = this._model，然后 this._model = model
	 *   2. this._overflowRecovered = false（换模型后重置 overflow 恢复标记）
	 *   3. this._emit({ type: "model_select", model, reason: `set: ${previous.id} → ${model.id}` })
	 * 关键洞察：不重建 Agent——只换模型引用，messages/tools 不动。
	 */
	async setModel(model: ModelRef): Promise<void> {
		throw new Error("not implemented");
	}

	/** 循环切换模型：在候选列表里找当前索引，取下一个。 */
	async cycleModel(models: ModelRef[]): Promise<void> {
		if (models.length <= 1) return;
		const idx = models.findIndex((m) => m.id === this._model.id);
		const next = models[(idx + 1) % models.length];
		await this.setModel(next);
	}

	/**
	 * TODO 必默写 2：prompt 四步流程
	 * 提示：
	 *   Step1 入队：this._messages.push({ role: "user", content: text })
	 *   Step2 跑前检查：await this._maybeCompactBefore()
	 *   Step3 跑 agentLoop：
	 *     this._isStreaming = true; this._emit({ type: "agent_start" });
	 *     this._lastStopReason = await agentLoop(this._messages, this._model, this._tools, this._systemPrompt);
	 *     this._isStreaming = false;
	 *   Step4 跑后检查：await this._checkCompactionAfter(); this._emit({ type: "agent_end" });
	 */
	async prompt(text: string): Promise<void> {
		throw new Error("not implemented");
	}

	/**
	 * 跑前检查：上一轮若 aborted，先压缩残缺上下文再跑新轮。（已实现）
	 */
	private async _maybeCompactBefore(): Promise<void> {
		if (this._lastStopReason !== "aborted") return;
		this._emit({ type: "compaction_start" });
		const compacted = await compactMessages(this._messages, this._model);
		this._messages.length = 0;
		this._messages.push(...compacted);
		this._emit({ type: "compaction_end", reason: "aborted-recovery" });
		this._lastStopReason = "end";
	}

	/**
	 * TODO 必默写 3：_checkCompactionAfter 两个 case
	 * 提示：
	 *   Case1 overflow（this._lastStopReason === "overflow"）：
	 *     if (this._overflowRecovered) return;          // 防无限循环
	 *     this._overflowRecovered = true;
	 *     删最后一条 assistant：if (last && last.role === "assistant") this._messages.pop();
	 *     emit compaction_start → compactMessages → 原地替换 → emit compaction_end(result:"overflow")
	 *     retry：this._isStreaming = true;
	 *            this._lastStopReason = await agentLoop(...)
	 *            this._isStreaming = false;
	 *     return;
	 *   Case2 threshold（token 超阈值但没溢出）：
	 *     tokens = estimateTokens(this._messages)
	 *     threshold = this._model.contextWindow * this._compactionThreshold
	 *     if (tokens > threshold) { compact → 原地替换 → emit(result:"threshold") }
	 *     注意：threshold 不 retry，下一轮自然用压缩后的上下文。
	 */
	private async _checkCompactionAfter(): Promise<void> {
		throw new Error("not implemented");
	}

	/** 手动触发压缩。 */
	async compact(): Promise<void> {
		this._emit({ type: "compaction_start" });
		const compacted = await compactMessages(this._messages, this._model);
		this._messages.length = 0;
		this._messages.push(...compacted);
		this._emit({ type: "compaction_end", result: "threshold" });
	}

	abort(): void { this._lastStopReason = "aborted"; }
	dispose(): void { this._listeners = []; }
}

// ── 交互入口（完整实现，无需默写） ─────────────────────

async function main(): Promise<void> {
	if (!CONFIG.apiKey) {
		console.error("缺少 ANTHROPIC_API_KEY，请先 export 后再运行。");
		process.exit(1);
	}

	const MODELS: ModelRef[] = [
		{ id: "claude-sonnet-4-5", provider: "anthropic", contextWindow: 200_000 },
		{ id: "claude-haiku-4-5", provider: "anthropic", contextWindow: 200_000 },
	];

	const session = new MiniAgentSession({
		model: MODELS[0],
		systemPrompt: `You are a coding agent at ${process.cwd()}. Use bash to solve tasks. Act, don't explain.`,
	});

	session.subscribe((event) => {
		const tag = event.model ? ` → ${event.model.id}` : "";
		const detail = event.reason ?? event.result ?? "";
		console.log(`\x1b[35m[event] ${event.type}${tag}${detail ? ` (${detail})` : ""}\x1b[0m`);
	});

	console.log("s11: AgentSession (practice)");
	console.log("输入问题，回车发送。/model 切换模型，q 退出。\n");

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = (prompt: string): Promise<string> => new Promise((resolve) => rl.question(prompt, resolve));

	while (true) {
		const query = (await ask("\x1b[36ms11 >> \x1b[0m")).trim();
		if (query === "" || query.toLowerCase() === "q" || query.toLowerCase() === "exit") break;
		if (query === "/model") {
			await session.cycleModel(MODELS);
			console.log(`当前模型: ${session.model.id}\n`);
			continue;
		}
		await session.prompt(query);
		const last = session.messages[session.messages.length - 1];
		if (last && Array.isArray(last.content)) {
			for (const block of last.content) {
				if (block.type === "text") console.log(block.text);
			}
		}
		console.log();
	}
	rl.close();
	session.dispose();
}

await main();
