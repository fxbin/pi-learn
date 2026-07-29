#!/usr/bin/env node
/**
 * s12 流式基础设施 —— EventStream 双输出模型 + 流式 JSON 容错解析
 *
 * s08 的 provider 是"一次性返回"，真实 LLM API 是 SSE 流式推送。流式输出有两个难题：
 *   1) 怎么把 push 事件变成 async iterator（生产者-消费者解耦）
 *   2) LLM 输出的 JSON 工具参数可能不完整或非法（半个 chunk / 控制字符 / 非法转义）
 *
 * 本章用教学级 mini 实现覆盖这两点：
 *   - MiniEventStream：生产者 push → 消费者 for await，同时 await result() 拿最终聚合值
 *   - repairJson：单布尔 inString 状态机，逐字符修复非法转义与控制字符
 *   - parseStreamingJson：四层降级 try/catch 瀑布，永远返回一个对象
 *
 * 运行：node code.ts
 *
 * @author fxbin
 */

const COMPLETE_MARKER = "[DONE]";
const CONTROL_CHAR_HEX_BASE = 16;
const UNICODE_PAD = 4;
const CONTROL_RANGE_MAX = 0x1f;
const HEX_DIGITS_PATTERN = /^[0-9a-fA-F]{4}$/;

// ── Part 1: MiniEventStream —— 无背压生产者-消费者 + 双输出 ──
/**
 * 流式事件基类：生产者用 push/end 投放事件，消费者用 for await 迭代。
 * 同时持有 finalResultPromise，任一消费者可 await result() 拿最终聚合值。
 * 无背压：生产者快则入队 queue，消费者快则入队 waiting，事件到达直接 deliver。
 * @typeParam T 事件类型
 * @typeParam R 最终聚合结果类型，默认与事件相同
 */
class MiniEventStream<T, R = T> implements AsyncIterable<T> {
	private queue: T[] = [];
	private waiting: ((value: IteratorResult<T>) => void)[] = [];
	private done = false;
	private readonly finalResultPromise: Promise<R>;
	private resolveFinalResult!: (result: R) => void;
	private readonly isComplete: (event: T) => boolean;
	private readonly extractResult: (event: T) => R;

	/**
	 * @param isComplete 判断某事件是否为"完成"事件（如 SSE 的 [DONE]）
	 * @param extractResult 从完成事件中抽取最终聚合值
	 */
	constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) {
		this.isComplete = isComplete;
		this.extractResult = extractResult;
		this.finalResultPromise = new Promise<R>((resolve) => {
			this.resolveFinalResult = resolve;
		});
	}

	/**
	 * 生产者投放一个事件。
	 * 命中 isComplete 则标记 done 并 resolve 最终结果；
	 * 有等待者直接 deliver（绕过 queue），否则入队。
	 */
	push(event: T): void {
		if (this.done) return;
		if (this.isComplete(event)) {
			this.done = true;
			this.resolveFinalResult(this.extractResult(event));
		}
		const waiter = this.waiting.shift();
		if (waiter) {
			waiter({ value: event, done: false });
		} else {
			this.queue.push(event);
		}
	}

	/**
	 * 生产者宣告结束：唤醒所有等待者返回 { done: true }。
	 * 用于正常关闭流（非 complete 事件触发的结束）。
	 */
	end(): void {
		this.done = true;
		while (this.waiting.length > 0) {
			const waiter = this.waiting.shift()!;
			waiter({ value: undefined as unknown as T, done: true });
		}
	}

	/**
	 * 消费者迭代入口：queue 优先 → done 退出 → 否则 new Promise 等待。
	 * 三分支保证既不丢事件也不死锁。
	 */
	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		while (true) {
			if (this.queue.length > 0) {
				yield this.queue.shift()!;
			} else if (this.done) {
				return;
			} else {
				const result = await new Promise<IteratorResult<T>>((resolve) => this.waiting.push(resolve));
				if (result.done) return;
				yield result.value;
			}
		}
	}

	/**
	 * 双输出第二路径：返回最终聚合结果 Promise。
	 * 与 for await 互不干扰，可被任一消费者 await。
	 */
	result(): Promise<R> {
		return this.finalResultPromise;
	}
}

// ── Part 2: repairJson + parseStreamingJson —— 流式 JSON 容错 ──

/** JSON 字符串内合法的转义后继字符集合。 */
const VALID_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);

/** 判断字符是否为控制字符（U+0000 ~ U+001F）。 */
function isControlCharacter(char: string): boolean {
	const codePoint = char.codePointAt(0);
	return codePoint !== undefined && codePoint >= 0 && codePoint <= CONTROL_RANGE_MAX;
}

/** 把控制字符转义为 JSON 合法形式：\b \f \n \r \t 或 \uXXXX。 */
function escapeControlCharacter(char: string): string {
	switch (char) {
		case "\b":
			return "\\b";
		case "\f":
			return "\\f";
		case "\n":
			return "\\n";
		case "\r":
			return "\\r";
		case "\t":
			return "\\t";
		default:
			return `\\u${char.codePointAt(0)?.toString(CONTROL_CHAR_HEX_BASE).padStart(UNICODE_PAD, "0") ?? "0000"}`;
	}
}

/**
 * 流式 JSON 修复器：单布尔 inString 状态机，逐字符扫描。
 * 处理三类异常：
 *   - 字符串内的控制字符 → 转义为 \uXXXX
 *   - 非法转义（\ 后非合法字符）→ 反斜杠加倍 \\
 *   - 行尾裸反斜杠（\ 后无字符）→ 加倍 \\
 * 字符串外原样输出，遇引号切换 inString。
 * @param json 可能残缺或含非法字符的 JSON 文本
 * @returns 修复后的 JSON 文本
 */
function repairJson(json: string): string {
	let repaired = "";
	let inString = false;

	for (let index = 0; index < json.length; index++) {
		const char = json[index];

		if (!inString) {
			repaired += char;
			if (char === '"') {
				inString = true;
			}
			continue;
		}

		if (char === '"') {
			repaired += char;
			inString = false;
			continue;
		}

		if (char === "\\") {
			const nextChar = json[index + 1];
			if (nextChar === undefined) {
				repaired += "\\\\";
				continue;
			}
			if (nextChar === "u") {
				const unicodeDigits = json.slice(index + 2, index + 6);
				if (HEX_DIGITS_PATTERN.test(unicodeDigits)) {
					repaired += `\\u${unicodeDigits}`;
					index += UNICODE_PAD + 1;
					continue;
				}
			}
			if (VALID_ESCAPES.has(nextChar)) {
				repaired += `\\${nextChar}`;
				index += 1;
				continue;
			}
			repaired += "\\\\";
			continue;
		}

		repaired += isControlCharacter(char) ? escapeControlCharacter(char) : char;
	}

	return repaired;
}

/**
 * 简化桩：补全未闭合的字符串与括号（替代 partial-json 库）。
 * 扫描括号栈与字符串开闭，结尾补 " } ] 使其尽量可解析。
 */
function closeAllOpen(json: string): string {
	let inString = false;
	let escaped = false;
	const stack: string[] = [];
	for (const char of json) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (char === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (char === "{" || char === "[") stack.push(char);
		else if (char === "}" || char === "]") stack.pop();
	}
	let closed = json;
	if (inString) closed += '"';
	while (stack.length > 0) {
		const open = stack.pop();
		closed += open === "{" ? "}" : "]";
	}
	return closed;
}

/**
 * 流式 JSON 四层降级解析，永远返回一个对象（失败返回 {}）。
 *   层 1：JSON.parse 原文
 *   层 2：repairJson + JSON.parse
 *   层 3：closeAllOpen(repairJson(...)) + JSON.parse
 *   层 4：返回 {}
 * @typeParam T 期望的解析类型
 * @param partial 流式累积的部分 JSON 文本
 */
function parseStreamingJson<T = Record<string, unknown>>(partial: string | undefined): T {
	if (!partial || partial.trim() === "") {
		return {} as T;
	}
	try {
		return JSON.parse(partial) as T;
	} catch {
		try {
			return JSON.parse(repairJson(partial)) as T;
		} catch {
			try {
				return JSON.parse(closeAllOpen(repairJson(partial))) as T;
			} catch {
				return {} as T;
			}
		}
	}
}

// ── demo：模拟 SSE chunk 逐块到达 + 流式 JSON 解析 ────────
/**
 * 演示 EventStream 双输出 + 流式 JSON 修复。
 * 生产者逐 token 推送残缺/含非法字符的 JSON 片段；
 * 消费者累积每步并 parseStreamingJson，观察四层降级；
 * 迭代结束后 await result() 拿最终聚合值。
 */
async function demo(): Promise<void> {
	const stream = new MiniEventStream<string, string>(
		(event) => event === COMPLETE_MARKER,
		(event) => event,
	);

	const tokens: string[] = [
		'{"a":1',
		',"b":"x\x01"',
		',"c":"a\\z"}',
		COMPLETE_MARKER,
	];

	console.log("=== s12 流式基础设施 demo ===\n");
	console.log("[生产者] 逐 token push");
	for (const token of tokens) {
		stream.push(token);
	}

	console.log("\n[消费者] for await 迭代 + 累积解析");
	let accumulated = "";
	for await (const token of stream) {
		if (token === COMPLETE_MARKER) {
			break;
		}
		accumulated += token;
		const parsed = parseStreamingJson<Record<string, unknown>>(accumulated);
		console.log(`  + ${JSON.stringify(token)}`);
		console.log(`    累积=${JSON.stringify(accumulated)}`);
		console.log(`    解析=${JSON.stringify(parsed)}`);
	}

	const final = await stream.result();
	console.log(`\n[双输出] await result() = ${JSON.stringify(final)}`);
	console.log("\n说明：\x1b[33m\\x01\x1b[0m 控制字符 → \\u0001；\x1b[33m\\z\x1b[0m 非法转义 → \\\\z（反斜杠加倍）");
}

await demo();
