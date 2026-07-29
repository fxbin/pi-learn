#!/usr/bin/env node
/**
 * s09 TUI 渲染 —— 差分渲染引擎
 *
 * console.log 是 append-only 流，写出去就无法回头改。
 * TUI 的做法：把"终端已显示的行"当状态（previousLines），每帧只发送"变化的行"。
 *
 *     requestRender ──→ scheduleRender (16ms 节流) ──→ doRender
 *                                                            │
 *                            ┌───────────────────────────────┤
 *                            ▼                               ▼
 *                     首帧 / 几何变化                      差分
 *                     fullRender(全量)              firstChanged..lastChanged
 *                                                            │
 *                                       \x1b[?2026h ... \x1b[?2026l (synchronized output)
 *
 * doRender 三策略决策树：
 *   1. previousLines 为空 → 首帧全量渲染（不清屏，假定屏幕干净）
 *   2. 宽度变化           → 几何变化，清屏全量重画
 *   3. 其他               → 差分：扫描 firstChanged/lastChanged，只重画该区间
 *
 * 运行方式：node code.ts
 * 按方向键 ↑/↓ 改变 spinner 速度，观察只有 spinner 那一行被重画。
 *
 * @author fxbin
 */

// ── 常量：本文件全部可调项集中于此 ──────────────────────

const MIN_RENDER_INTERVAL_MS = 16;
const SPINNER_INTERVAL_MS = 200;
const SPINNER_SPEED_STEP_MS = 50;
const SPINNER_MIN_INTERVAL_MS = 50;
const DEMO_TEXT_UPDATE_MS = 3000;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const SYNC_BEGIN = "\x1b[?2026h";
const SYNC_END = "\x1b[?2026l";
const CLEAR_SCREEN = "\x1b[2J\x1b[H";
const CLEAR_LINE = "\x1b[2K";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const KEY_UP = "\x1b[A";
const KEY_DOWN = "\x1b[B";
const CTRL_C = "\x03";

// ── Terminal 接口：极简封装 process.stdin/stdout ─────────

interface Terminal {
	start(): void;
	stop(): void;
	write(data: string): void;
	readonly columns: number;
	readonly rows: number;
	hideCursor(): void;
	showCursor(): void;
}

/**
 * NodeTerminal：用 process.stdin/stdout 实现 Terminal。
 * columns/rows 用 getter 动态读取，终端 resize 时自动反映几何变化。
 */
class NodeTerminal implements Terminal {
	get columns(): number {
		return process.stdout.columns || 80;
	}
	get rows(): number {
		return process.stdout.rows || 24;
	}
	start(): void {
		process.stdin.setRawMode(true);
		process.stdin.resume();
	}
	stop(): void {
		process.stdin.setRawMode(false);
		process.stdin.pause();
	}
	write(data: string): void {
		process.stdout.write(data);
	}
	hideCursor(): void {
		this.write(HIDE_CURSOR);
	}
	showCursor(): void {
		this.write(SHOW_CURSOR);
	}
}

// ── Component 接口 + Container ─────────────────────────

interface Component {
	render(width: number): string[];
	handleInput?(data: string): void;
}

/**
 * Container：持有子组件，render 时把子组件的行拼接成一个数组。
 */
class Container implements Component {
	children: Component[] = [];

	addChild(component: Component): void {
		this.children.push(component);
	}

	render(width: number): string[] {
		const lines: string[] = [];
		for (const child of this.children) {
			for (const line of child.render(width)) {
				lines.push(line);
			}
		}
		return lines;
	}
}

// ── TUI：差分渲染引擎核心 ──────────────────────────────

/**
 * TUI 把已显示内容当状态，每帧只发送变化行。
 * 状态不变量：每次 doRender 结束后，硬件光标停在 previousLines 末尾行首（列 0）。
 */
class TUI extends Container {
	private terminal: Terminal;
	private previousLines: string[] = [];
	private previousWidth: number = 0;
	private renderRequested: boolean = false;
	private renderTimer: ReturnType<typeof setTimeout> | undefined;
	private lastRenderAt: number = 0;
	private stopped: boolean = false;

	constructor(terminal: Terminal) {
		super();
		this.terminal = terminal;
	}

	start(): void {
		this.terminal.start();
		this.terminal.hideCursor();
		this.requestRender();
	}

	stop(): void {
		this.stopped = true;
		if (this.renderTimer) {
			clearTimeout(this.renderTimer);
			this.renderTimer = undefined;
		}
		this.terminal.showCursor();
		this.terminal.write("\r\n");
		this.terminal.stop();
	}

	/** 请求一帧渲染。多次调用会被 process.nextTick 合并成一次。 */
	requestRender(): void {
		if (this.renderRequested) return;
		this.renderRequested = true;
		process.nextTick(() => this.scheduleRender());
	}

	/** 16ms 节流：距上次渲染不足 16ms 时延后补齐，避免高频刷新闪烁。 */
	private scheduleRender(): void {
		if (this.stopped || this.renderTimer || !this.renderRequested) return;
		const elapsed = Date.now() - this.lastRenderAt;
		const delay = Math.max(0, MIN_RENDER_INTERVAL_MS - elapsed);
		this.renderTimer = setTimeout(() => {
			this.renderTimer = undefined;
			if (this.stopped || !this.renderRequested) return;
			this.renderRequested = false;
			this.lastRenderAt = Date.now();
			this.doRender();
		}, delay);
	}

	/** 三策略决策树：首帧 / 几何变化 / 差分。 */
	private doRender(): void {
		if (this.stopped) return;
		const width = this.terminal.columns;
		const newLines = this.render(width);
		if (this.previousLines.length === 0) {
			this.fullRender(newLines, false);
			return;
		}
		if (this.previousWidth !== width) {
			this.fullRender(newLines, true);
			return;
		}
		this.diffRender(newLines);
	}

	/** 全量渲染：synchronized output 包裹，按需清屏后一次性写出所有行。 */
	private fullRender(newLines: string[], clear: boolean): void {
		let buffer = SYNC_BEGIN;
		if (clear) buffer += CLEAR_SCREEN;
		for (let i = 0; i < newLines.length; i++) {
			if (i > 0) buffer += "\r\n";
			buffer += newLines[i];
		}
		buffer += "\r" + SYNC_END;
		this.terminal.write(buffer);
		this.previousLines = newLines;
		this.previousWidth = this.terminal.columns;
	}

	/** 差分渲染：扫描 firstChanged/lastChanged，只重画该区间。 */
	private diffRender(newLines: string[]): void {
		let firstChanged = -1;
		let lastChanged = -1;
		const maxLines = Math.max(newLines.length, this.previousLines.length);
		for (let i = 0; i < maxLines; i++) {
			const oldLine = i < this.previousLines.length ? this.previousLines[i] : "";
			const newLine = i < newLines.length ? newLines[i] : "";
			if (oldLine !== newLine) {
				if (firstChanged === -1) firstChanged = i;
				lastChanged = i;
			}
		}
		if (firstChanged === -1) return;
		this.redrawRange(newLines, firstChanged, lastChanged);
		this.previousLines = newLines;
	}

	/**
	 * 重画区间：synchronized output + 光标移动 + 逐行清写。
	 * 超出 newLines 的行写空（清除缩短的多余行），最后光标移回 newLines 末尾行首。
	 */
	private redrawRange(newLines: string[], first: number, last: number): void {
		const cursorFrom = this.previousLines.length - 1;
		let buffer = SYNC_BEGIN;
		const moveUp = cursorFrom - first;
		if (moveUp > 0) buffer += `\x1b[${moveUp}A`;
		else if (moveUp < 0) buffer += `\x1b[${-moveUp}B`;
		for (let i = first; i <= last; i++) {
			if (i > first) buffer += "\r\n";
			buffer += CLEAR_LINE + (i < newLines.length ? newLines[i] : "");
		}
		const finalRow = newLines.length - 1;
		const moveFinal = finalRow - last;
		if (moveFinal > 0) buffer += `\x1b[${moveFinal}B`;
		else if (moveFinal < 0) buffer += `\x1b[${-moveFinal}A`;
		buffer += "\r" + SYNC_END;
		this.terminal.write(buffer);
	}

	handleInput(data: string): void {
		for (const child of this.children) {
			child.handleInput?.(data);
		}
	}
}

// ── 示例组件 ──────────────────────────────────────────

/** Text：静态文本，演示内容更新触发差分。 */
class Text implements Component {
	text: string;
	constructor(text: string) {
		this.text = text;
	}
	render(_width: number): string[] {
		return [this.text];
	}
	set(text: string): void {
		this.text = text;
	}
}

/** Spinner：每 N 毫秒切换一帧，演示单行差分只重画一行。 */
class Spinner implements Component {
	private frameIndex: number = 0;
	private intervalMs: number = SPINNER_INTERVAL_MS;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private onFrame: () => void;
	constructor(onFrame: () => void) {
		this.onFrame = onFrame;
	}
	start(): void {
		this.scheduleNext();
	}
	private scheduleNext(): void {
		this.timer = setTimeout(() => {
			this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
			this.onFrame();
			this.scheduleNext();
		}, this.intervalMs);
	}
	stop(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}
	speedUp(): void {
		this.intervalMs = Math.max(SPINNER_MIN_INTERVAL_MS, this.intervalMs - SPINNER_SPEED_STEP_MS);
	}
	slowDown(): void {
		this.intervalMs += SPINNER_SPEED_STEP_MS;
	}
	render(_width: number): string[] {
		return [`${SPINNER_FRAMES[this.frameIndex]} 加载中 (间隔 ${this.intervalMs}ms，↑加速 ↓减速)`];
	}
}

// ── main 入口 ─────────────────────────────────────────

function main(): void {
	const terminal = new NodeTerminal();
	const tui = new TUI(terminal);
	const text = new Text("s09 差分渲染引擎已启动，3 秒后这行文本会更新");
	const spinner = new Spinner(() => tui.requestRender());
	tui.addChild(text);
	tui.addChild(spinner);
	tui.start();
	spinner.start();

	const textTimer = setTimeout(() => {
		text.set("✓ 文本已更新 —— 注意只有这一行被重画，spinner 行不动");
		tui.requestRender();
	}, DEMO_TEXT_UPDATE_MS);

	process.stdin.on("data", (data: Buffer) => {
		const key = data.toString();
		if (key === CTRL_C) {
			spinner.stop();
			clearTimeout(textTimer);
			tui.stop();
			process.exit(0);
		}
		if (key === KEY_UP) spinner.speedUp();
		if (key === KEY_DOWN) spinner.slowDown();
		tui.handleInput(key);
	});

	process.stdout.on("resize", () => tui.requestRender());
}

main();
