#!/usr/bin/env node
/**
 * s10 默写验收：空白页模板
 *
 * 用法：合上 code.ts 与 README，凭记忆把每个函数的函数体补全。
 * 重点默写本章新增的 5 个核心：
 *   1. createExtensionRuntime —— throwing stubs（action 方法加载期抛错）
 *   2. loadExtension —— await factory(api) 完成钩子注册
 *   3. assertActive —— staleMessage 检查，invalidate 后抛 stale 错误
 *   4. emit —— 通用 emit（try/catch + emitError + cancel/block 短路）
 *   5. emitTransform —— 链式 reduce（structuredClone 初始值 + 逐个 handler 变换）
 * 其余（createExtensionAPI、loadExtensions、ExtensionRunner 骨架、示例扩展、run）已给出完整实现。
 * 补全后运行 `node practice.ts`，能看到三类钩子分发 + 错误隔离 + stale 保护即通过。
 *
 * @author fxbin
 */

// ── 第 1 块：类型定义（与 code.ts 一致） ────────────────

type ExtensionFactory = (api: ExtensionAPI) => void | Promise<void>;

interface SessionStartEvent { type: "session_start"; cwd: string }
interface SessionShutdownEvent { type: "session_shutdown"; reason: string }
interface ToolCallEvent { type: "tool_call"; toolName: string; input: Record<string, unknown> }
interface ToolCallEventResult { block?: boolean; reason?: string }
interface ContextEvent { type: "context"; messages: unknown[] }
interface MessageEndEvent { type: "message_end"; text: string }

type ExtensionEvent =
	| SessionStartEvent | SessionShutdownEvent | ToolCallEvent | ContextEvent | MessageEndEvent;
type EventResult = { cancel?: boolean; block?: boolean; reason?: string; messages?: unknown[]; text?: string } | undefined;
type EventHandler = (event: ExtensionEvent, ctx: ExtensionContext) => unknown | Promise<unknown>;

interface Extension {
	path: string;
	handlers: Map<string, EventHandler[]>;
	tools: Array<{ name: string; description: string }>;
}
interface ExtensionError { extensionPath: string; event: string; error: string }
interface ExtensionContext { assertActive(): void }
interface ExtensionAPI {
	on(type: string, handler: EventHandler): void;
	registerTool(tool: { name: string; description: string }): void;
	onError(listener: (error: ExtensionError) => void): void;
}

// ── 第 2 块：Runtime + 加载器 ──────────────────────────

interface ExtensionRuntime {
	staleMessage?: string;
	errorListeners: Set<(error: ExtensionError) => void>;
	sendMessage: (msg: string) => void;
	setModel: (model: string) => void;
}

const RUNTIME_NOT_INITIALIZED = "Extension runtime not initialized. Action methods cannot be called during extension loading.";
const STALE_CTX_MESSAGE = "This extension ctx is stale after session replacement. Do not use a captured ctx after invalidate().";

/**
 * 创建扩展运行时：action 方法为 throwing stubs（加载阶段不可调用）。
 * 提示：定义 notInitialized 函数（throws RUNTIME_NOT_INITIALIZED）；
 * 返回 { errorListeners: new Set(), sendMessage: notInitialized, setModel: notInitialized }。
 * 真 pi 把 sendMessage/setModel 等全设成抛错，等 runner.bindCore() 替换。
 * @returns 运行时对象，action 方法暂时会抛错
 */
function createExtensionRuntime(): ExtensionRuntime {
	// TODO: 在这里默写 throwing stubs
	throw new Error("not implemented");
}

/** 为单个扩展创建 API：on/registerTool/onError 写入 extension 与 runtime。已给出。 */
function createExtensionAPI(extension: Extension, runtime: ExtensionRuntime): ExtensionAPI {
	return {
		on(type: string, handler: EventHandler): void {
			const list = extension.handlers.get(type) ?? [];
			list.push(handler);
			extension.handlers.set(type, list);
		},
		registerTool(tool: { name: string; description: string }): void {
			extension.tools.push(tool);
		},
		onError(listener: (error: ExtensionError) => void): void {
			runtime.errorListeners.add(listener);
		},
	};
}

/**
 * 加载单个扩展：创建 extension + api，调用 await factory(api) 完成钩子注册。
 * 提示：const extension = { path: name, handlers: new Map(), tools: [] }；
 * const api = createExtensionAPI(extension, runtime)；await factory(api)；return extension。
 * 核心：await factory(api) —— 工厂函数在此注册所有 on/registerTool 调用。
 * @param factory 工厂函数
 * @param name 扩展名
 * @param runtime 共享运行时
 */
async function loadExtension(factory: ExtensionFactory, name: string, runtime: ExtensionRuntime): Promise<Extension> {
	// TODO: 在这里默写加载流程（核心是 await factory(api)）
	throw new Error("not implemented");
}

/** 批量加载扩展。已给出。 */
async function loadExtensions(specs: Array<{ name: string; factory: ExtensionFactory }>, runtime: ExtensionRuntime): Promise<Extension[]> {
	const extensions: Extension[] = [];
	for (const spec of specs) {
		extensions.push(await loadExtension(spec.factory, spec.name, runtime));
	}
	return extensions;
}

// ── 第 3 块：ExtensionRunner ───────────────────────────

class ExtensionRunner {
	private extensions: Extension[];
	private runtime: ExtensionRuntime;
	private staleMessage?: string;

	constructor(extensions: Extension[], runtime: ExtensionRuntime) {
		this.extensions = extensions;
		this.runtime = runtime;
	}

	/**
	 * stale 检查：invalidate 后任何 emit 调用都抛 stale 错误。
	 * 提示：if (this.staleMessage) throw new Error(this.staleMessage)。
	 * 这是 stale context 保护的核心——防止旧 ctx 被误用。
	 */
	private assertActive(): void {
		// TODO: 在这里默写 stale 检查
		throw new Error("not implemented");
	}

	/** 创建上下文。已给出。 */
	private createContext(): ExtensionContext {
		return { assertActive: () => this.assertActive() };
	}

	/** 标记失效。已给出。 */
	invalidate(message: string = STALE_CTX_MESSAGE): void {
		if (!this.staleMessage) this.staleMessage = message;
	}

	/** 推送错误到所有 errorListeners。已给出。 */
	emitError(error: ExtensionError): void {
		for (const listener of this.runtime.errorListeners) listener(error);
	}

	/**
	 * 通用 emit：遍历所有扩展的对应 handler，逐个 await。
	 * 提示：先 this.assertActive()；const ctx = this.createContext()；
	 * for ext of extensions：取 handlers.get(event.type)，无则 continue；
	 *   for handler of handlers：try { r = await handler(event, ctx) }；
	 *     若 r && (r.cancel || r.block) → return r（短路）；
	 *   catch err → this.emitError({ extensionPath: ext.path, event: event.type, error: ... })；
	 * return undefined。
	 * 关键：try/catch 包住单个 handler，抛错走 emitError 后继续下一个扩展（错误隔离）。
	 * @param event 事件对象
	 * @returns 拦截结果（若有 block/cancel）
	 */
	async emit(event: ExtensionEvent): Promise<EventResult> {
		// TODO: 在这里默写通用 emit（try/catch + emitError + cancel 短路）
		throw new Error("not implemented");
	}

	/**
	 * Transformer emit：链式 reduce。
	 * 提示：先 this.assertActive()；const ctx = this.createContext()；
	 * let current = structuredClone(initial)（深拷贝保护原数据）；
	 * for ext of extensions：取 handlers，无则 continue；
	 *   for handler of handlers：try { next = await handler({ ...event, ...current }, ctx) }；
	 *     if (next !== undefined && next !== null) current = next as T；
	 *   catch err → this.emitError(...)；
	 * return current。
	 * 关键：{ ...event, ...current } 把当前值喂给下一个 handler；structuredClone 防原数据污染。
	 * @param event 事件对象
	 * @param initial 初始值（会被深拷贝）
	 * @returns 变换后的最终值
	 */
	async emitTransform<T>(event: ExtensionEvent, initial: T): Promise<T> {
		// TODO: 在这里默写链式 reduce（structuredClone + 逐个 handler 变换）
		throw new Error("not implemented");
	}

	/** Interceptor 语义入口。已给出。 */
	async emitInterceptor(event: ExtensionEvent): Promise<{ blocked: boolean; reason?: string }> {
		const result = await this.emit(event);
		const blocked = result?.block === true || result?.cancel === true;
		return { blocked, reason: result?.reason };
	}
}

// ── 第 4 块：示例扩展 + 演示主流程（已给出完整实现） ────

const BOOM_MESSAGE = "boom";
const DANGEROUS_COMMAND = "rm -rf /tmp/x";
const SAMPLE_MESSAGE = "hello damn world";

const loggerExtension: ExtensionFactory = (api) => {
	api.on("session_start", (event) => {
		const e = event as SessionStartEvent;
		console.log(`[logger] session_start cwd=${e.cwd}`);
	});
	api.on("message_end", (event) => {
		const e = event as MessageEndEvent;
		console.log(`[logger] message_end text="${e.text}"`);
	});
};

const boomExtension: ExtensionFactory = (api) => {
	api.on("session_start", () => {
		throw new Error(BOOM_MESSAGE);
	});
};

const profanityFilterExtension: ExtensionFactory = (api) => {
	api.on("message_end", (event) => {
		const e = event as MessageEndEvent;
		return { text: e.text.replaceAll("damn", "****") };
	});
};

const blockDangerousToolExtension: ExtensionFactory = (api) => {
	api.on("tool_call", (event) => {
		const e = event as ToolCallEvent;
		const command = String(e.input.command ?? "");
		if (command.includes("rm -rf")) {
			return { block: true, reason: "dangerous command blocked" };
		}
		return undefined;
	});
};

async function run(): Promise<void> {
	const runtime = createExtensionRuntime();
	runtime.errorListeners.add((err) => {
		console.log(`\x1b[33m[error] ${err.extensionPath}/${err.event}: ${err.error}\x1b[0m`);
	});
	const extensions = await loadExtensions([
		{ name: "logger", factory: loggerExtension },
		{ name: "boom", factory: boomExtension },
		{ name: "profanityFilter", factory: profanityFilterExtension },
		{ name: "blockDangerousTool", factory: blockDangerousToolExtension },
	], runtime);
	const runner = new ExtensionRunner(extensions, runtime);
	console.log(`s10: Extensions（加载 ${extensions.length} 个扩展）\n`);

	console.log("─ session_start（observer + boom 抛错 → error 隔离）");
	await runner.emit({ type: "session_start", cwd: process.cwd() });

	console.log("\n─ message_end（transformer 链式 reduce）");
	const msg = await runner.emitTransform({ type: "message_end", text: "" }, { text: SAMPLE_MESSAGE });
	console.log(`结果: text="${msg.text}"`);

	console.log("\n─ tool_call（interceptor block 短路）");
	const blocked = await runner.emitInterceptor({ type: "tool_call", toolName: "bash", input: { command: DANGEROUS_COMMAND } });
	console.log(`结果: blocked=${blocked.blocked} reason=${blocked.reason}`);

	console.log("\n─ session_shutdown（observer）");
	await runner.emit({ type: "session_shutdown", reason: "done" });

	console.log("\n─ invalidate 后再 emit → 抛 stale 错误");
	runner.invalidate();
	try {
		await runner.emit({ type: "session_shutdown", reason: "stale-test" });
	} catch (err) {
		console.log(`\x1b[31mcaught stale: ${(err as Error).message.slice(0, 60)}...\x1b[0m`);
	}
	console.log("\ns10 演示结束。");
}

await run();
