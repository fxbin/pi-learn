#!/usr/bin/env node
/**
 * s13 默写验收：空白页模板
 *
 * 用法：合上 code.ts 与 README，凭记忆把四个函数体补全。
 * 补全后运行 `node practice.ts`，能正常对话、能调工具、运行中
 * 用 /steer 注入能在下一轮 LLM 前生效、用 /follow 注入能让
 * agent 续跑一轮、/abort 能中止当前 run，即通过。
 * 写不出某个函数，回到 README 的「工作原理」重读对应步骤，再来默写。
 *
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

// ── PendingQueue：双队列共享容器 ─────────────────────────

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
	 * 提示：mode = "all" → slice 全部、清空、返回；
	 *      mode = "one-at-a-time" → 只取首条（messages[0]），余下保留；
	 *      空数组返回 []。
	 * 关键：两种 mode 的语义差异要写对，否则 steer/followUp 行为错位。
	 */
	drain(): ChatMessage[] {
		// TODO: 在这里默写 drain 的两种模式实现
		throw new Error("not implemented");
	}

	clear(): void {
		this.messages = [];
	}
}

// ── MiniAgent：有状态 Agent ──────────────────────────────

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

	steer(message: ChatMessage): void {
		this._steeringQueue.enqueue(message);
	}

	followUp(message: ChatMessage): void {
		this._followUpQueue.enqueue(message);
	}

	clearAllQueues(): void {
		this._steeringQueue.clear();
		this._followUpQueue.clear();
	}

	subscribe(listener: EventListener): () => void {
		this._listeners.add(listener);
		return () => this._listeners.delete(listener);
	}

	abort(): void {
		this._activeRun?.abortController.abort();
	}

	waitForIdle(): Promise<void> {
		return this._activeRun?.promise ?? Promise.resolve();
	}

	async prompt(input: string): Promise<void> {
		if (this._activeRun) {
			throw new Error("Agent 正在运行，请使用 steer() 或 followUp() 注入消息。");
		}
		const userMsg: ChatMessage = { role: "user", content: input };
		this._messages.push(userMsg);
		await this.runWithLifecycle((signal) => this.loop(this._messages.slice(), signal));
	}

	/**
	 * 生命周期包装：状态机三件套。
	 * 提示：
	 * 1. 已有 activeRun 则抛错（防止并发 run）；
	 * 2. new AbortController + new Promise，把 resolve 存到外部变量；
	 * 3. 把 { promise, resolve, abortController } 三件套赋给 this._activeRun；
	 * 4. try { await executor(signal) } finally { this.finishRun() }。
	 * 关键：异常不外抛，错误视为 run 结束，所以 finally 必然执行 finishRun。
	 */
	private async runWithLifecycle(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {
		// TODO: 在这里默写状态机三件套
		throw new Error("not implemented");
	}

	/**
	 * 双层循环 + steering/followUp drain 位置。
	 * 提示（务必记牢两个 drain 点的位置差异）：
	 *
	 * 外层 while (true)：
	 *   - hasToolCalls = true, pending = steeringQueue.drain()（初始）
	 *   - 内层 while (hasToolCalls || pending.length > 0)：
	 *     1. signal.aborted 则 return；
	 *     2. 遍历 pending push 进 messages（内含 [steering] 打印）；
	 *     3. pending = []；
	 *     4. processEvents(turn_start)；
	 *     5. mockStreamAssistant → push 进 messages（两份）；
	 *     6. processEvents(message_start / message_end)；
	 *     7. signal.aborted 则 return；
	 *     8. hasToolCalls = content.includes("[tool:")；
	 *     9. 若 hasToolCalls：push toolResult、turns++、超 maxTurns 则 break；
	 *    10. processEvents(turn_end)；
	 *    11. pending = steeringQueue.drain()（★ 循环内注入点）；
	 *   - 内层退出后：followUpQueue.drain()（★ 循环外注入点）
	 *     - 有则 push 进 messages、continue；
	 *     - 无则 break；
	 * - processEvents(agent_end)。
	 */
	private async loop(initialMessages: ChatMessage[], signal: AbortSignal): Promise<void> {
		// TODO: 在这里默写双层循环 + 两个 drain 位置
		throw new Error("not implemented");
	}

	/**
	 * 事件派发：串行 await listeners。
	 * 提示：
	 * 1. 从 this._activeRun?.abortController.signal 取 signal；
	 * 2. signal 不存在则抛错（listener 在 active run 之外被调用）；
	 * 3. for (const listener of this._listeners) { await listener(event, signal); }
	 * 关键：串行 await，不是 forEach 并发；listener 的 promise 计入 run settlement。
	 */
	private async processEvents(event: AgentEvent): Promise<void> {
		// TODO: 在这里默写串行 await listeners
		throw new Error("not implemented");
	}

	private finishRun(): void {
		this._activeRun?.resolve();
		this._activeRun = undefined;
	}
}

// ── mock 流式 assistant：与 code.ts 同实现 ──────────────

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

// ── main 演示：REPL + /steer + /follow + /abort ──────────

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
