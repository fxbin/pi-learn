#!/usr/bin/env node
/**
 * s10 extensions —— 生命周期钩子编排 + 三层错误隔离 + 动态加载
 *
 * s07 的 skills 是"静态 .md 注入"，改知识要重启。本章引入扩展系统：
 * 用 ExtensionFactory 工厂函数动态加载模块，把 26 个事件归纳为三类钩子模式：
 *   - Observer（只观察）：session_start / session_shutdown
 *   - Interceptor（可 cancel/block）：tool_call
 *   - Transformer（链式 reduce）：context / message_end
 * 三层错误隔离：单个 handler 抛错 → try/catch 捕获 → emitError 推送 errorListeners → 其他扩展继续。
 * stale context 保护：invalidate 后旧 ctx 调用 assertActive 抛 stale 错误。
 *
 *     loadExtensions → await factory(api) → api.on(event, handler) 注册
 *     run() → emit(观察) / emitInterceptor(拦截) / emitTransform(链式变换)
 *                       ↓ handler 抛错 → try/catch → emitError → 其他扩展不受影响
 *
 * 运行：node code.ts
 * @author fxbin
 */

// ── 第 1 块：类型定义 ──────────────────────────────────

/** 扩展工厂函数：接收 API，注册钩子。支持同步或异步初始化（对应真 pi 的 ExtensionFactory）。 */
type ExtensionFactory = (api: ExtensionAPI) => void | Promise<void>;

/** Observer 事件：只观察副作用，不返回结果。 */
interface SessionStartEvent { type: "session_start"; cwd: string }
interface SessionShutdownEvent { type: "session_shutdown"; reason: string }

/** Interceptor 事件：可返回 { block, reason } 阻断后续流程。 */
interface ToolCallEvent { type: "tool_call"; toolName: string; input: Record<string, unknown> }
interface ToolCallEventResult { block?: boolean; reason?: string }

/** Transformer 事件：参与链式 reduce，返回变换后的值。 */
interface ContextEvent { type: "context"; messages: unknown[] }
interface MessageEndEvent { type: "message_end"; text: string }

/** 事件联合类型（教学版 6 个；真 pi 有 26 个，见 types.ts 的 ExtensionEvent）。 */
type ExtensionEvent =
	| SessionStartEvent | SessionShutdownEvent | ToolCallEvent | ContextEvent | MessageEndEvent;

/** 钩子返回值：interceptor 用 block/cancel，transformer 用 messages/text。 */
type EventResult = { cancel?: boolean; block?: boolean; reason?: string; messages?: unknown[]; text?: string } | undefined;

/** 钩子函数签名：接收事件与上下文，返回结果（observer 返回 void/undefined）。 */
type EventHandler = (event: ExtensionEvent, ctx: ExtensionContext) => unknown | Promise<unknown>;

/** 已加载扩展：路径名 + 按事件类型分组的 handler 列表 + 注册的工具。 */
interface Extension {
	path: string;
	handlers: Map<string, EventHandler[]>;
	tools: Array<{ name: string; description: string }>;
}

/** 扩展运行时错误：哪个扩展、哪个事件、什么错。 */
interface ExtensionError { extensionPath: string; event: string; error: string }

/** 扩展上下文：handler 拿到的能力。教学版只暴露 assertActive（stale 检查）。 */
interface ExtensionContext { assertActive(): void }

/** 扩展 API：工厂函数用它注册钩子/工具/错误监听。 */
interface ExtensionAPI {
	on(type: string, handler: EventHandler): void;
	registerTool(tool: { name: string; description: string }): void;
	onError(listener: (error: ExtensionError) => void): void;
}

// ── 第 2 块：Runtime + 加载器 ──────────────────────────

/** 运行时状态：stale 消息 + 错误监听器集合 + action 方法（加载期为 throwing stubs）。 */
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
 * 真 pi 的 createExtensionRuntime 把 sendMessage/setModel 等全设成抛错，
 * 等 runner.bindCore() 替换成真实实现；教学版保留 stubs 展示这个模式。
 * @returns 运行时对象，action 方法暂时会抛错
 */
function createExtensionRuntime(): ExtensionRuntime {
	const notInitialized = (): never => { throw new Error(RUNTIME_NOT_INITIALIZED); };
	return {
		errorListeners: new Set(),
		sendMessage: notInitialized,
		setModel: notInitialized,
	};
}

/**
 * 为单个扩展创建 API：on 注册钩子（写入 extension.handlers）、registerTool 注册工具、
 * onError 注册错误监听器（写入 runtime.errorListeners）。真 pi 同名函数签名一致。
 * @param extension 待填充的扩展对象
 * @param runtime 共享运行时（错误监听器写到这里）
 */
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
 * 加载单个扩展：创建 extension 对象 + api，调用 await factory(api) 完成钩子注册。
 * 真 pi 用 jiti 运行时加载 TS 文件（loader.ts:331 loadExtensionModule），
 * 取 default 导出作为 factory：const mod = await jiti.import(path); factory = mod.default;
 * 教学版用传入的 factory 函数演示同样的注册流程（await factory(api) 是核心）。
 * @param factory 工厂函数
 * @param name 扩展名（真 pi 是文件路径）
 * @param runtime 共享运行时
 */
async function loadExtension(factory: ExtensionFactory, name: string, runtime: ExtensionRuntime): Promise<Extension> {
	const extension: Extension = { path: name, handlers: new Map(), tools: [] };
	const api = createExtensionAPI(extension, runtime);
	await factory(api);
	return extension;
}

/** 批量加载扩展：逐个 await factory(api)。加载期错误不可隔离，任意一个抛错则整体失败。 */
async function loadExtensions(specs: Array<{ name: string; factory: ExtensionFactory }>, runtime: ExtensionRuntime): Promise<Extension[]> {
	const extensions: Extension[] = [];
	for (const spec of specs) {
		extensions.push(await loadExtension(spec.factory, spec.name, runtime));
	}
	return extensions;
}

// ── 第 3 块：ExtensionRunner ───────────────────────────

/**
 * 扩展运行器：持有扩展注册表 + 运行时，提供三类 emit 方法。
 * 通用 emit 处理 Observer（无返回值）与 Interceptor（cancel/block 短路）；
 * emitTransform 处理 Transformer（链式 reduce）；emitInterceptor 是 Interceptor 的语义入口。
 */
class ExtensionRunner {
	private extensions: Extension[];
	private runtime: ExtensionRuntime;
	private staleMessage?: string;

	constructor(extensions: Extension[], runtime: ExtensionRuntime) {
		this.extensions = extensions;
		this.runtime = runtime;
	}

	/** stale 检查：invalidate 后任何 emit 调用都抛 stale 错误，防止旧 ctx 被误用。 */
	private assertActive(): void {
		if (this.staleMessage) throw new Error(this.staleMessage);
	}

	/** 创建上下文：handler 拿到的能力，当前只暴露 assertActive。 */
	private createContext(): ExtensionContext {
		return { assertActive: () => this.assertActive() };
	}

	/** 标记失效：切换会话/重载后调用，后续 emit 抛 stale 错误（只记录第一条消息）。 */
	invalidate(message: string = STALE_CTX_MESSAGE): void {
		if (!this.staleMessage) this.staleMessage = message;
	}

	/** 推送错误到所有 errorListeners（错误隔离的出口）。 */
	emitError(error: ExtensionError): void {
		for (const listener of this.runtime.errorListeners) listener(error);
	}

	/**
	 * 通用 emit：遍历所有扩展的对应 handler，逐个 await。
	 * Observer handler 返回 void/undefined（不短路）；Interceptor handler 返回 { block/cancel } 时短路。
	 * 每个 handler 用 try/catch 隔离：抛错 → emitError → 继续下一个扩展。
	 * @param event 事件对象（type 决定取哪些 handler）
	 * @returns 拦截结果（若有 block/cancel），否则 undefined
	 */
	async emit(event: ExtensionEvent): Promise<EventResult> {
		this.assertActive();
		const ctx = this.createContext();
		let result: EventResult = undefined;
		for (const ext of this.extensions) {
			const handlers = ext.handlers.get(event.type);
			if (!handlers || handlers.length === 0) continue;
			for (const handler of handlers) {
				try {
					const r = (await handler(event, ctx)) as EventResult;
					if (r && (r.cancel || r.block)) {
						result = r;
						return result;
					}
				} catch (err) {
					this.emitError({ extensionPath: ext.path, event: event.type, error: err instanceof Error ? err.message : String(err) });
				}
			}
		}
		return result;
	}

	/**
	 * Transformer emit：链式 reduce。initial 经 structuredClone 保护后，
	 * 逐个 handler 接收当前值（{ ...event, ...current }）并返回新值（返回 undefined 则保持不变）。
	 * 每个 handler try/catch 隔离：抛错 → emitError → 链不中断，继续下一个。
	 * @param event 事件对象
	 * @param initial 初始值（会被深拷贝，不被原数据污染）
	 * @returns 变换后的最终值
	 */
	async emitTransform<T>(event: ExtensionEvent, initial: T): Promise<T> {
		this.assertActive();
		const ctx = this.createContext();
		let current: T = structuredClone(initial);
		for (const ext of this.extensions) {
			const handlers = ext.handlers.get(event.type);
			if (!handlers || handlers.length === 0) continue;
			for (const handler of handlers) {
				try {
					const next = await handler({ ...event, ...current }, ctx);
					if (next !== undefined && next !== null) {
						current = next as T;
					}
				} catch (err) {
					this.emitError({ extensionPath: ext.path, event: event.type, error: err instanceof Error ? err.message : String(err) });
				}
			}
		}
		return current;
	}

	/**
	 * Interceptor emit：语义入口，返回是否被拦截。
	 * 内部调用通用 emit，检查结果里的 block/cancel。
	 * @returns blocked 是否被阻断、reason 阻断原因
	 */
	async emitInterceptor(event: ExtensionEvent): Promise<{ blocked: boolean; reason?: string }> {
		const result = await this.emit(event);
		const blocked = result?.block === true || result?.cancel === true;
		return { blocked, reason: result?.reason };
	}
}

// ── 第 4 块：示例扩展 + 演示主流程 ─────────────────────

const BOOM_MESSAGE = "boom";
const DANGEROUS_COMMAND = "rm -rf /tmp/x";
const SAMPLE_MESSAGE = "hello damn world";

/** logger 扩展（Observer）：监听 session_start / message_end，打印日志。 */
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

/** boom 扩展：session_start 时抛错，演示错误隔离（其他扩展继续运行）。 */
const boomExtension: ExtensionFactory = (api) => {
	api.on("session_start", () => {
		throw new Error(BOOM_MESSAGE);
	});
};

/** profanityFilter 扩展（Transformer）：message_end 时过滤敏感词。 */
const profanityFilterExtension: ExtensionFactory = (api) => {
	api.on("message_end", (event) => {
		const e = event as MessageEndEvent;
		return { text: e.text.replaceAll("damn", "****") };
	});
};

/** blockDangerousTool 扩展（Interceptor）：tool_call 命中 rm -rf 时 block。 */
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

/**
 * 演示主流程：加载 4 个扩展，跑一次完整 turn，展示三类钩子 + 错误隔离 + stale 保护。
 * 顺序：session_start(observer+boom抛错) → message_end(transformer) → tool_call(interceptor) → session_shutdown → invalidate。
 */
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
