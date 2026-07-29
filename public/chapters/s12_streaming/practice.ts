#!/usr/bin/env node
/**
 * s12 默写验收：空白页模板
 *
 * 用法：合上 code.ts 与 README，凭记忆把每个函数/方法体补全。
 * 重点默写本章新增的：
 *   - MiniEventStream.push（等待者优先 deliver，否则入队）
 *   - MiniEventStream [Symbol.asyncIterator]（三分支：queue / done / 等待）
 *   - repairJson（单布尔 inString 状态机主循环）
 *   - parseStreamingJson（四层降级 try/catch 瀑布）
 * isControlCharacter / escapeControlCharacter / closeAllOpen / demo 已给出，写不出可查。
 * 补全后运行 `node practice.ts`，能打印出流式累积解析结果即通过。
 *
 * @author fxbin
 */

const COMPLETE_MARKER = "[DONE]";
const CONTROL_CHAR_HEX_BASE = 16;
const UNICODE_PAD = 4;
const CONTROL_RANGE_MAX = 0x1f;
const HEX_DIGITS_PATTERN = /^[0-9a-fA-F]{4}$/;

const VALID_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);

// ── Part 1: MiniEventStream ───────────────────────────
/**
 * 流式事件基类：生产者 push → 消费者 for await，同时 await result() 拿最终聚合值。
 * 提示：无背压——生产者快则入队 queue，消费者快则入队 waiting，事件到达直接 deliver。
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
	 * @param isComplete 判断某事件是否为"完成"事件
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
	 * 提示：done 则直接 return；命中 isComplete 则 done=true 并 resolveFinalResult；
	 *   shift 一个 waiting，有则 deliver { value, done:false }，无则 push 进 queue。
	 */
	push(event: T): void {
		// TODO: 在这里默写 push 逻辑
		throw new Error("not implemented");
	}

	/**
	 * 生产者宣告结束：done=true，唤醒所有等待者返回 { done: true }。
	 */
	end(): void {
		this.done = true;
		while (this.waiting.length > 0) {
			const waiter = this.waiting.shift()!;
			waiter({ value: undefined as unknown as T, done: true });
		}
	}

	/**
	 * 消费者迭代入口：三分支循环。
	 * 提示：queue 有则 yield shift()；否则若 done 则 return；
	 *   否则 new Promise 把 resolve 推入 waiting，await 后若 done 则 return，否则 yield value。
	 */
	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		// TODO: 在这里默写三分支迭代逻辑
		throw new Error("not implemented");
	}

	/**
	 * 双输出第二路径：返回最终聚合结果 Promise。
	 */
	result(): Promise<R> {
		return this.finalResultPromise;
	}
}

// ── Part 2: repairJson + parseStreamingJson ───────────

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
 * 提示：循环每个 char——
 *   不在串内：原样追加，遇 " 切 inString=true；
 *   在串内遇 "：追加并切 inString=false；
 *   在串内遇 \：看 nextChar——undefined 则追加 \\；"u" 且后 4 位是 hex 则保留并 index+5；
 *     合法转义则保留并 index+1；否则追加 \\（反斜杠加倍）；
 *   其余在串内字符：控制字符转义，否则原样追加。
 * @param json 可能残缺或含非法字符的 JSON 文本
 * @returns 修复后的 JSON 文本
 */
function repairJson(json: string): string {
	// TODO: 在这里默写单布尔状态机主循环
	throw new Error("not implemented");
}

/**
 * 简化桩：补全未闭合的字符串与括号（替代 partial-json 库）。
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
 * 提示：空串返回 {}；否则四层 try/catch——
 *   层 1 JSON.parse 原文；
 *   层 2 JSON.parse(repairJson(...))；
 *   层 3 JSON.parse(closeAllOpen(repairJson(...)))；
 *   层 4 返回 {}。
 * @typeParam T 期望的解析类型
 * @param partial 流式累积的部分 JSON 文本
 */
function parseStreamingJson<T = Record<string, unknown>>(partial: string | undefined): T {
	// TODO: 在这里默写四层降级
	throw new Error("not implemented");
}

// ── demo（已给出，无需默写）────────────────────────────
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

	console.log("=== s12 默写验收 ===\n");
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
}

await demo();
