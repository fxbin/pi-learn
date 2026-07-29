#!/usr/bin/env node
/**
 * s13 有状态 Agent —— 双队列与状态机
 *
 * s01 的 agentLoop 是无状态的纯函数：每次调用都从头传 messages。
 * s04 的 steering 只能在循环里轮询回调，没有"对象"承载状态。
 * 本章在 agentLoop 之上包一层 MiniAgent 类，维护：
 *   1. messages / systemPrompt 状态字段
 *   2. steeringQueue + followUpQueue 两个 PendingQueue
 *   3. activeRun 状态机三件套（promise / resolve / abortController）
 *   4. listeners 集合，事件串行 await 派发
 * 双层循环：内层处理 tool-call + steering（循环内注入，下一轮 LLM 前生效），
 *          外层处理 followUp（循环外注入，agent 本该停止时生效）。
 * 运行：node code.ts，REPL 里用 /steer xxx 和 /follow xxx 注入消息。
 * @author fxbin
 */

import * as readline from "node:readline";

// ── 配置：本文件全部可调项集中于此 ──────────────────────
const CONFIG = {
	streamTickMs: 60,
	turnGapMs: 200,
	maxTurns: 6,
	rlPrompt: "\x1b[36ms13 >> \x1b[0m",
	steerCmdPrefix: "/steer ",
	followCmdPrefix: "/follow ",
	abortCmd: "/abort",
	quitCmd: "q",
	exitCmd: "exit",
} as const;

// ── 队列模式：drain 时一次性排干 vs 每次只取一条 ────────
type QueueMode = "all" | "one-at-a-time";

// ── 类型边界：消息、事件、运行时 ────────────────────────
interface ChatMessage {
	role: "user" | "assistant" | "toolResult";
	content: string;
}

type AgentEvent =
	| { type: "turn_start" }
	| { type: "message_start"; message: ChatMessage }
	| { type: "message_end"; message: ChatMessage }
	| { type: "turn_end"; message: ChatMessage }
	| { type: "agent_end" };

type EventListener = (event: AgentEvent, signal: AbortSignal) => Promise<void> | void;

type ActiveRun = {
	promise: Promise<void>;
	resolve: () => void;
	abortController: AbortController;
};

/**
 * 双队列共享容器。drain 行为受 mode 控制：
 *   "all"           一次性返回全部并清空（批量注入）
 *   "one-at-a-time" 每次只取第一条（逐条注入，pi 默认）
 */
class PendingQueue {
	private messages: ChatMessage[] = [];
	public mode: QueueMode;

	constructor(mode: QueueMode) {
		this.mode = mode;
	}

	enqueue(message: ChatMessage): void {
		this.messages.push(message);
	}

	hasItems(): boolean {
		return this.messages.length > 0;
	}

	/**
	 * 排干队列。
	 * mode = "all"：slice 全部、清空、返回（批量）。
	 * mode = "one-at-a-time"：只取首条，余下保留（逐条）。
	 */
	drain(): ChatMessage[] {
		if (this.mode === "all") {
			const drained = this.messages.slice();
			this.messages = [];
			return drained;
		}
		const first = this.messages[0];
		if (!first) {
			return [];
		}
		this.messages = this.messages.slice(1);
		return [first];
	}

	clear(): void {
		this.messages = [];
	}
}

/**
 * 有状态 Agent：在 s01 的 agentLoop 之上包一层。
 * 维护 messages、双队列、activeRun 状态机、listener 集合。
 */
class MiniAgent {
	private _messages: ChatMessage[] = [];
	private _systemPrompt: string;
	private readonly _listeners = new Set<EventListener>();
	private readonly _steeringQueue = new PendingQueue("one-at-a-time");
	private readonly _followUpQueue = new PendingQueue("one-at-a-time");
	private _activeRun?: ActiveRun;

	constructor(systemPrompt: string) {
		this._systemPrompt = systemPrompt;
	}

	get messages(): ChatMessage[] {
		return this._messages;
	}

	get isStreaming(): boolean {
		return this._activeRun !== undefined;
	}

	/** 注入 steering 消息：下一轮 LLM 调用前生效，当前轮工具照常跑完。 */
	steer(message: ChatMessage): void {
		this._steeringQueue.enqueue(message);
	}

	/** 注入 followUp 消息：agent 本该停止时生效，让循环续跑一轮。 */
	followUp(message: ChatMessage): void {
		this._followUpQueue.enqueue(message);
	}

	/** 清空两个队列。 */
	clearAllQueues(): void {
		this._steeringQueue.clear();
		this._followUpQueue.clear();
	}

	/** 订阅事件，listener 按订阅顺序串行 await。返回取消订阅函数。 */
	subscribe(listener: EventListener): () => void {
		this._listeners.add(listener);
		return () => this._listeners.delete(listener);
	}

	/** 终止当前 run（若有）。 */
	abort(): void {
		this._activeRun?.abortController.abort();
	}

	/** 等待当前 run 结束（含所有 listener 的 promise）。 */
	waitForIdle(): Promise<void> {
		return this._activeRun?.promise ?? Promise.resolve();
	}

	/**
	 * 提问入口：入队用户消息 → runWithLifecycle(loop)。
	 * 若已有 activeRun 则抛错——并发的提问需要走 steer / followUp。
	 */
	async prompt(input: string): Promise<void> {
		if (this._activeRun) {
			throw new Error("Agent 正在运行，请使用 steer() 或 followUp() 注入消息。");
		}
		const userMsg: ChatMessage = { role: "user", content: input };
		this._messages.push(userMsg);
		await this.runWithLifecycle((signal) => this.loop(this._messages.slice(), signal));
	}

	/**
	 * 生命周期包装：创建 AbortController + Promise 三件套，置 isStreaming=true，
	 * try/finally 调 finishRun 清场。异常不外抛——错误视为 run 结束。
	 */
	private async runWithLifecycle(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {
		if (this._activeRun) {
			throw new Error("Agent is already processing.");
		}
		const abortController = new AbortController();
		let resolvePromise = () => {};
		const promise = new Promise<void>((resolve) => {
			resolvePromise = resolve;
		});
		this._activeRun = { promise, resolve: resolvePromise, abortController };

		try {
			await executor(abortController.signal);
		} finally {
			this.finishRun();
		}
	}

	/**
	 * 双层循环。
	 * 内层 while：条件 hasToolCalls || pending.length
	 *   - 开头 drain steering 注入（循环内注入点，下一轮 LLM 前）
	 *   - 调 mockStreamAssistant
	 *   - 执行工具（mock：assistant.content 含 [tool: 即视为有工具调用）
	 *   - emit turn_end → drain steering 准备下一轮
	 * 外层：内层退出后 drain followUp（循环外注入点，agent 本该停止时）
	 *   - 有则 continue 续跑一轮
	 *   - 无则 break，emit agent_end
	 */
	private async loop(initialMessages: ChatMessage[], signal: AbortSignal): Promise<void> {
		const messages = initialMessages;
		let turns = 0;
		while (true) {
			let hasToolCalls = true;
			let pending = this._steeringQueue.drain();
			while (hasToolCalls || pending.length > 0) {
				if (signal.aborted) {
					return;
				}
				for (const msg of pending) {
					messages.push(msg);
					this._messages.push(msg);
					console.log(`\x1b[35m[steering] ${msg.content}\x1b[0m`);
				}
				pending = [];

				await this.processEvents({ type: "turn_start" });

				const assistantMsg = await mockStreamAssistant(messages, signal);
				messages.push(assistantMsg);
				this._messages.push(assistantMsg);

				await this.processEvents({ type: "message_start", message: assistantMsg });
				await this.processEvents({ type: "message_end", message: assistantMsg });

				if (signal.aborted) {
					return;
				}

				hasToolCalls = assistantMsg.content.includes("[tool:");
				if (hasToolCalls) {
					const toolResult: ChatMessage = {
						role: "toolResult",
						content: `(工具结果：${assistantMsg.content})`,
					};
					messages.push(toolResult);
					this._messages.push(toolResult);
					turns++;
					if (turns >= CONFIG.maxTurns) {
						console.log(`\x1b[31m[max-turns] ${CONFIG.maxTurns} 轮熔断\x1b[0m`);
						await this.processEvents({ type: "turn_end", message: assistantMsg });
						break;
					}
				}

				await this.processEvents({ type: "turn_end", message: assistantMsg });
				pending = this._steeringQueue.drain();
			}

			const followUps = this._followUpQueue.drain();
			if (followUps.length > 0) {
				for (const msg of followUps) {
					messages.push(msg);
					this._messages.push(msg);
					console.log(`\x1b[35m[followUp] ${msg.content}\x1b[0m`);
				}
				continue;
			}
			break;
		}
		await this.processEvents({ type: "agent_end" });
	}

	/**
	 * 事件派发：按订阅顺序串行 await listener。
	 * listener 的 promise 计入 run settlement——waitForIdle 等到最后一个 settle。
	 */
	private async processEvents(event: AgentEvent): Promise<void> {
		const signal = this._activeRun?.abortController.signal;
		if (!signal) {
			throw new Error("listener 在 active run 之外被调用");
		}
		for (const listener of this._listeners) {
			await listener(event, signal);
		}
	}

	/** 清场：resolve promise + 清空 activeRun。 */
	private finishRun(): void {
		this._activeRun?.resolve();
		this._activeRun = undefined;
	}
}

/**
 * mock 流式 assistant：用 setTimeout 模拟 LLM 延迟返回。
 * 若用户消息含"工具"关键字，返回 [tool: ... 触发一轮工具调用演示。
 */
async function mockStreamAssistant(
	messages: ChatMessage[],
	signal: AbortSignal,
): Promise<ChatMessage> {
	const lastUser = [...messages].reverse().find((m) => m.role === "user");
	const lastContent = lastUser?.content ?? "";
	let reply = `收到："${lastContent.slice(0, 30)}"，我来回答。`;
	if (lastContent.includes("工具") || lastContent.includes("tool")) {
		reply = `[tool: echo ${lastContent.slice(0, 20)}]`;
	}
	await new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, CONFIG.turnGapMs);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
	return { role: "assistant", content: reply };
}

/**
 * 交互入口：REPL + /steer + /follow + /abort 命令在运行中注入消息。
 * 演示两种注入点的时序差异：steering 在循环内、followUp 在循环外。
 */
async function main(): Promise<void> {
	console.log("s13: Stateful Agent — 双队列与状态机");
	console.log("命令：");
	console.log("  /steer <msg>  在下一轮 LLM 调用前注入（循环内）");
	console.log("  /follow <msg> 在 agent 本该停止时注入（循环外）");
	console.log("  /abort       中止当前 run");
	console.log("  q            退出\n");

	const agent = new MiniAgent("You are a coding agent.");
	const unsubscribe = agent.subscribe(async (event) => {
		if (event.type === "turn_end") {
			console.log(`\x1b[32m[event] turn_end: ${event.message.content.slice(0, 40)}\x1b[0m`);
		} else if (event.type === "agent_end") {
			console.log("\x1b[32m[event] agent_end\x1b[0m");
		}
	});

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = (prompt: string): Promise<string> =>
		new Promise((resolve) => rl.question(prompt, resolve));

	rl.on("SIGINT", () => {
		agent.abort();
	});

	while (!rl.closed) {
		let input: string;
		try {
			input = (await ask(CONFIG.rlPrompt)).trim();
		} catch {
			break;
		}
		if (input === "" || input.toLowerCase() === CONFIG.quitCmd || input.toLowerCase() === CONFIG.exitCmd) {
			break;
		}
		if (input.startsWith(CONFIG.steerCmdPrefix)) {
			agent.steer({ role: "user", content: input.slice(CONFIG.steerCmdPrefix.length) });
			console.log("\x1b[33m[enqueued] steering\x1b[0m");
			continue;
		}
		if (input.startsWith(CONFIG.followCmdPrefix)) {
			agent.followUp({ role: "user", content: input.slice(CONFIG.followCmdPrefix.length) });
			console.log("\x1b[33m[enqueued] followUp\x1b[0m");
			continue;
		}
		if (input === CONFIG.abortCmd) {
			agent.abort();
			await agent.waitForIdle();
			continue;
		}
		await agent.prompt(input);
	}

	unsubscribe();
	rl.close();
}

await main();
