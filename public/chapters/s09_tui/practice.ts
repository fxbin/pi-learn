#!/usr/bin/env node
/**
 * s09 默写验收：空白页模板
 *
 * 用法：合上 code.ts 与 README，凭记忆把四个函数的函数体补全。
 * 补全后运行 `node practice.ts`，能看到首帧渲染、spinner 持续刷新、
 * 3 秒后文本更新只重画一行，即通过。
 * 写不出某个函数，回到 README 的「工作原理」重读对应步骤，再来默写。
 *
 * 需要默写的四个函数：
 *   1. scheduleRender()  —— 16ms 节流调度核心
 *   2. doRender()        —— 三策略决策树
 *   3. diffRender()      —— 差分算法（firstChanged/lastChanged 扫描）
 *   4. redrawRange()     —— 差分 buffer 拼接（synchronized output + 光标移动）
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

	requestRender(): void {
		if (this.renderRequested) return;
		this.renderRequested = true;
		process.nextTick(() => this.scheduleRender());
	}

	/**
	 * 16ms 节流：距上次渲染不足 16ms 时延后补齐，避免高频刷新闪烁。
	 * 提示：四步——
	 * 1. 守卫：stopped / 已有 timer 在等 / renderRequested 已被清，直接返回；
	 * 2. 算 elapsed = Date.now() - lastRenderAt，delay = max(0, MIN_RENDER_INTERVAL_MS - elapsed)；
	 * 3. setTimeout(delay) 里清空 renderTimer，再过一遍守卫，清 renderRequested，
	 *    记 lastRenderAt = Date.now()，调 doRender()。
	 */
	private scheduleRender(): void {
		// TODO: 在这里默写节流调度
		throw new Error("not implemented");
	}

	/**
	 * 三策略决策树：首帧 / 几何变化 / 差分。
	 * 提示：先 render(width) 拿 newLines，再按顺序判断——
	 * 1. previousLines 为空 → fullRender(newLines, false)（首帧不清屏）；
	 * 2. previousWidth !== width → fullRender(newLines, true)（几何变化清屏重画）；
	 * 3. 其他 → diffRender(newLines)。
	 */
	private doRender(): void {
		// TODO: 在这里默写决策树
		throw new Error("not implemented");
	}

	fullRender(newLines: string[], clear: boolean): void {
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

	/**
	 * 差分算法：扫描 firstChanged/lastChanged，只重画该区间。
	 * 提示：五步——
	 * 1. firstChanged = -1, lastChanged = -1；
	 * 2. maxLines = max(newLines.length, previousLines.length)；
	 * 3. 逐行比较（越界的一方当 ""），不同就记 first（首次）/ last（每次）；
	 * 4. firstChanged === -1 说明没变化，直接 return；
	 * 5. redrawRange(newLines, firstChanged, lastChanged)，再把 previousLines = newLines。
	 */
	private diffRender(newLines: string[]): void {
		// TODO: 在这里默写差分扫描
		throw new Error("not implemented");
	}

	/**
	 * 差分 buffer 拼接：synchronized output + 光标移动 + 逐行清写。
	 * 提示：状态不变量——调用前光标在 previousLines.length - 1 行首（列 0）。
	 * 1. cursorFrom = previousLines.length - 1，算 moveUp = cursorFrom - first；
	 *    moveUp > 0 发 `\x1b[nA`，< 0 发 `\x1b[nB`；
	 * 2. for i in [first, last]：i > first 先发 "\r\n"，再发 CLEAR_LINE + 内容
	 *    （i >= newLines.length 时内容为 ""，用于清除缩短的多余行）；
	 * 3. finalRow = newLines.length - 1，moveFinal = finalRow - last；
	 *    > 0 发 `\x1b[nB`，< 0 发 `\x1b[nA`，把光标移回末尾行；
	 * 4. 末尾 "\r" 回列 0，再 SYNC_END；write 出去。
	 * 整个 buffer 用 SYNC_BEGIN ... SYNC_END 包裹（synchronized output）。
	 */
	private redrawRange(newLines: string[], first: number, last: number): void {
		// TODO: 在这里默写 buffer 拼接
		throw new Error("not implemented");
	}

	handleInput(data: string): void {
		for (const child of this.children) {
			child.handleInput?.(data);
		}
	}
}

// ── 示例组件 ──────────────────────────────────────────

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
