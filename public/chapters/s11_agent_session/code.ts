#!/usr/bin/env node
/**
 * s11 AgentSession —— 会话编排与公共 SDK 设计
 *
 * s01 的 agentLoop 是裸循环：messages 散落在 main 里，没有自动 compaction、
 * 没有模型切换、没有事件订阅。真实 pi 在 Agent 之上还有一层 AgentSession
 * 做"会话编排"：管多轮之间的状态收口。
 *
 * 三层分层：
 *   Mode (I/O)  →  AgentSession (Orchestration)  →  Agent (State)
 *   REPL/TUI        compaction / 模型切换 / 事件       agentLoop / messages / tools
 *
 * prompt() 四步：入队 → _maybeCompactBefore → 跑 agentLoop → _checkCompactionAfter
 * compaction 两触发：overflow 删错误消息+retry / threshold 不删不retry
 * setModel 三步：改 _model + 重置 _overflowRecovered + emit（不重建 Agent）
 *
 * 运行：export ANTHROPIC_API_KEY=sk-ant-... && node code.ts
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

// ── 类型定义：模型引用 / 会话事件 / 消息 ────────────────

/** 模型引用：id + provider + 上下文窗口大小（用于 threshold 判断） */
interface ModelRef { id: string; provider: string; contextWindow: number }

interface TextBlock { type: "text"; text: string }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: { command: string } }
interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
interface ChatMessage { role: "user" | "assistant"; content: string | ContentBlock[] }
interface MessagesResponse { content: ContentBlock[]; stop_reason: string }
interface ToolDef { name: string; description: string; input_schema: object }

/** 会话事件类型：外部订阅用，对应 pi 的 AgentSessionEventListener */
type SessionEventType = "agent_start" | "agent_end" | "model_select" | "compaction_start" | "compaction_end";
interface SessionEvent {
	type: SessionEventType;
	model?: ModelRef;
	reason?: string;
	result?: "overflow" | "threshold" | "aborted-recovery";
}
type Listener = (event: SessionEvent) => void;

/** agentLoop 运行结果：end 正常结束 / aborted 被中断 / overflow 上下文溢出 */
type RunStopReason = "end" | "aborted" | "overflow";

// ── 工具定义：只有 bash，一个工具足够演示循环 ───────────

const TOOLS: ToolDef[] = [
	{ name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
];

// ── 复用的辅助函数（s01 agentLoop + s06 compactMessages 简化版） ──

/**
 * 调用 LLM：原生 fetch 非流式请求。model 由调用方传入（s11 不再写死 CONFIG.model）。
 * @param messages 对话历史
 * @param model 本次请求使用的模型引用
 * @param tools 工具定义；摘要请求传空数组禁用工具
 * @param systemPrompt 系统提示词
 * @returns API 返回的 content 块与 stop_reason
 */
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

/**
 * 执行 bash 命令：黑名单、超时、输出截断三道护栏。
 * @param command 模型给出的 shell 命令
 * @returns 合并 stdout/stderr 后的文本
 */
function runBash(command: string): string {
	if (BLOCKED_PATTERNS.some((p) => command.includes(p))) return "Error: Dangerous command blocked";
	const result = spawnSync(command, { shell: true, cwd: process.cwd(), encoding: "utf-8", timeout: CONFIG.bashTimeoutMs });
	if (result.error) return `Error: ${result.error.message}`;
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
	return output ? output.slice(0, CONFIG.maxOutputChars) : "(no output)";
}

/** 把单条消息拍平成纯文本，供 token 估算与摘要序列化复用。 */
function flattenText(message: ChatMessage): string {
	if (typeof message.content === "string") return message.content;
	return message.content.map((b) => (b.type === "text" ? b.text : b.type === "tool_use" ? b.input.command : b.content)).join("\n");
}

/** 估算 token 数：所有消息字符总数 / 4。粗粒度启发式，足以判断是否该压缩。 */
function estimateTokens(messages: ChatMessage[]): number {
	return Math.ceil(messages.reduce((sum, m) => sum + flattenText(m).length, 0) / 4);
}

/** 判断错误是否为上下文溢出：检查错误消息里的关键词。 */
function isOverflowError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return msg.includes("context") && (msg.includes("overflow") || msg.includes("too long") || msg.includes("413"));
}

/**
 * 压缩上下文（复用 s06 compact）：旧消息摘要成一条 summary，保留最近若干条。
 * @param messages 溢出的完整对话历史
 * @param model 用于生成摘要的模型
 * @returns [summary 消息, ...最近 keepRecentMessages 条]
 */
async function compactMessages(messages: ChatMessage[], model: ModelRef): Promise<ChatMessage[]> {
	const splitIndex = Math.max(0, messages.length - CONFIG.keepRecentMessages);
	const conversation = messages.slice(0, splitIndex).map(flattenText).join("\n\n");
	const response = await callLlm(
		[{ role: "user", content: `${SUMMARIZATION_PROMPT}\n\n${conversation}` }],
		model,
		[],
		"",
	);
	const summary = response.content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("\n");
	return [{ role: "user", content: `Previous conversation summary: ${summary}` }, ...messages.slice(splitIndex)];
}

/**
 * agent 主循环（s01 简化版）：问模型 → 追加回答 → 执行工具 → 回填结果。
 * 溢出时不崩溃，返回 "overflow" 让调用方决策。
 * @param messages 对话历史，原地累积
 * @param model 本次循环使用的模型
 * @param tools 工具定义
 * @param systemPrompt 系统提示词
 * @returns 运行结果：end / aborted / overflow
 */
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

// ── MiniAgentSession：会话编排器 ───────────────────────

/**
 * 教学级 AgentSession：在 s01 agentLoop 之上包一层会话编排。
 * 职责：compaction 自动触发（overflow + threshold）、模型切换、事件订阅。
 * 不职责：文件持久化（s05）、扩展系统、自动重试、steer 队列。
 */
class MiniAgentSession {
	private _messages: ChatMessage[] = [];
	private _model: ModelRef;
	private readonly _tools: ToolDef[];
	private _systemPrompt: string;
	private _isStreaming = false;
	private _listeners: Listener[] = [];
	private _overflowRecovered = false;
	private _lastStopReason: RunStopReason = "end";
	private readonly _compactionThreshold: number;

	constructor(options: { model: ModelRef; tools?: ToolDef[]; systemPrompt?: string; compactionThreshold?: number }) {
		this._model = options.model;
		this._tools = options.tools ?? TOOLS;
		this._systemPrompt = options.systemPrompt ?? "";
		this._compactionThreshold = options.compactionThreshold ?? CONFIG.compactionThreshold;
	}

	get messages(): ChatMessage[] { return this._messages; }
	get model(): ModelRef { return this._model; }
	get isStreaming(): boolean { return this._isStreaming; }

	/** 订阅会话事件，返回取消订阅函数。 */
	subscribe(listener: Listener): () => void {
		this._listeners.push(listener);
		return () => { this._listeners = this._listeners.filter((l) => l !== listener); };
	}

	private _emit(event: SessionEvent): void {
		for (const l of this._listeners) l(event);
	}

	/**
	 * setModel 三步：改 _model → 重置 _overflowRecovered → emit model_select。
	 * 关键洞察：不重建 Agent——messages/tools/systemPrompt 都在 session 里，
	 * 只换模型引用，对话无缝续接。
	 */
	async setModel(model: ModelRef): Promise<void> {
		const previous = this._model;
		this._model = model;
		this._overflowRecovered = false;
		this._emit({ type: "model_select", model, reason: `set: ${previous.id} → ${model.id}` });
	}

	/** 循环切换模型：在候选列表里找当前索引，取下一个。 */
	async cycleModel(models: ModelRef[]): Promise<void> {
		if (models.length <= 1) return;
		const idx = models.findIndex((m) => m.id === this._model.id);
		const next = models[(idx + 1) % models.length];
		await this.setModel(next);
	}

	/**
	 * prompt 四步：入队 user → _maybeCompactBefore → 跑 agentLoop → _checkCompactionAfter。
	 * 这是 AgentSession 的核心入口，所有多轮状态收口都在这里发生。
	 */
	async prompt(text: string): Promise<void> {
		this._messages.push({ role: "user", content: text });
		await this._maybeCompactBefore();
		this._isStreaming = true;
		this._emit({ type: "agent_start" });
		this._lastStopReason = await agentLoop(this._messages, this._model, this._tools, this._systemPrompt);
		this._isStreaming = false;
		await this._checkCompactionAfter();
		this._emit({ type: "agent_end" });
	}

	/**
	 * 跑前检查：上一轮若 aborted，先压缩残缺上下文再跑新轮。
	 * 对应 pi 的 _checkCompaction(lastAssistant, skipAbortedCheck=false)。
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
	 * 跑后检查两个 case：
	 *   Case1 overflow — LLM 报溢出：删最后一条 assistant（错误消息）+ compact + retry。
	 *     _overflowRecovered 防无限循环：只 retry 一次。
	 *   Case2 threshold — token 超阈值但没溢出：compact 不 retry，下一轮自然用压缩后的上下文。
	 */
	private async _checkCompactionAfter(): Promise<void> {
		if (this._lastStopReason === "overflow") {
			if (this._overflowRecovered) return;
			this._overflowRecovered = true;
			const last = this._messages[this._messages.length - 1];
			if (last && last.role === "assistant") this._messages.pop();
			this._emit({ type: "compaction_start" });
			const compacted = await compactMessages(this._messages, this._model);
			this._messages.length = 0;
			this._messages.push(...compacted);
			this._emit({ type: "compaction_end", result: "overflow" });
			this._isStreaming = true;
			this._lastStopReason = await agentLoop(this._messages, this._model, this._tools, this._systemPrompt);
			this._isStreaming = false;
			return;
		}
		const tokens = estimateTokens(this._messages);
		const threshold = this._model.contextWindow * this._compactionThreshold;
		if (tokens > threshold) {
			this._emit({ type: "compaction_start" });
			const compacted = await compactMessages(this._messages, this._model);
			this._messages.length = 0;
			this._messages.push(...compacted);
			this._emit({ type: "compaction_end", result: "threshold" });
		}
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

// ── 交互入口：REPL + /model 切换 + 事件日志 ─────────────

/**
 * 演示入口：创建 session、订阅事件（观察 compaction 与模型切换）、
 * REPL 驱动 prompt()，/model 命令循环切换模型。
 */
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

	console.log("s11: AgentSession");
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
