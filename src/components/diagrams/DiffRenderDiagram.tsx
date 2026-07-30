import { useEffect, useState } from "react";
import "./DiffRenderDiagram.css";

/**
 * s09 差分渲染动态图示。
 * 展示 previousLines 与 newLines 的逐行比较、firstChanged/lastChanged 定位、
 * 光标移动、区间重画、synchronized output 包裹五步流程。
 * 底部附 doRender 三策略决策树（首帧 / 几何变化 / 差分）。
 * @author fxbin
 */

interface StepDef {
	key: string;
	label: string;
	desc: string;
}

/** 完整动画序列：渲染 → 差分 → 移动光标 → 重画区间 → 同步输出。 */
const STEPS: StepDef[] = [
	{ key: "render", label: "Render：渲染新帧", desc: "组件树 render(width) 输出全部行" },
	{ key: "diff", label: "Diff：扫描变化行", desc: "逐行比较，定位 firstChanged..lastChanged" },
	{ key: "move", label: "Move cursor：移到 firstChanged", desc: "光标从末尾上移到 firstChanged" },
	{ key: "redraw", label: "Redraw range：重画区间", desc: "只重画 [first, last] 区间，逐行清写" },
	{ key: "sync", label: "Sync output：包裹输出", desc: "整段 buffer 用 ?2026h/?2026l 包裹后写出" },
];

/** 演示数据：第 1 行变化，演示单行差分。 */
const PREVIOUS = ["Line 0", "Line 1 (old)", "Line 2", "Line 3", "Line 4"];
const NEW = ["Line 0", "Line 1 (NEW)", "Line 2", "Line 3", "Line 4"];
const FIRST_CHANGED = 1;
const LAST_CHANGED = 1;
const STEP_INTERVAL_MS = 1800;

export default function DiffRenderDiagram() {
	const [step, setStep] = useState(0);
	const [playing, setPlaying] = useState(false);

	useEffect(() => {
		if (!playing) return;
		const id = setInterval(() => {
			setStep((s) => (s + 1) % STEPS.length);
		}, STEP_INTERVAL_MS);
		return () => clearInterval(id);
	}, [playing]);

	const current = STEPS[step];
	const phase = current.key;
	const isDiff = phase === "diff";
	const isMove = phase === "move";
	const isRedraw = phase === "redraw";
	const isSync = phase === "sync";
	const isRedrawDone = isRedraw || isSync;

	/** 计算左侧 previousLines 每行的样式类。 */
	const prevCellClass = (i: number): string => {
		let cls = "drd-cell";
		if (isDiff && i >= FIRST_CHANGED && i <= LAST_CHANGED) cls += " diff-hl";
		return cls;
	};

	/** 计算右侧 newLines 每行的样式类。 */
	const newCellClass = (i: number): string => {
		let cls = "drd-cell";
		if (isDiff && i >= FIRST_CHANGED && i <= LAST_CHANGED) cls += " diff-hl";
		if (isRedrawDone && i >= FIRST_CHANGED && i <= LAST_CHANGED) cls += " redraw-done";
		return cls;
	};

	return (
		<div className="drd-root diagram diagram-wide">
			<div className="drd-header">
				<span className="drd-title">DIFF RENDER</span>
				<div className="drd-controls">
					<button onClick={() => setPlaying(!playing)} type="button">
						{playing ? "PAUSE" : "PLAY"}
					</button>
					<button
						onClick={() => {
							setPlaying(false);
							setStep(0);
						}}
						type="button"
					>
						RESET
					</button>
				</div>
			</div>

			<div className={`drd-stage ${isSync ? "synced" : ""}`}>
				{isSync && <div className="drd-sync-band drd-sync-top">ESC[?2026h</div>}
				<div className="drd-panel">
					<div className="drd-panel-label">previousLines（上一帧）</div>
					{PREVIOUS.map((line, i) => (
						<div key={i} className={prevCellClass(i)}>
							<span className="drd-row-idx">{i}</span>
							<span className="drd-row-text">{line}</span>
							{isDiff && i === FIRST_CHANGED && (
								<span className="drd-marker drd-marker-first">firstChanged</span>
							)}
							{isDiff && i === LAST_CHANGED && (
								<span className="drd-marker drd-marker-last">lastChanged</span>
							)}
						</div>
					))}
				</div>

				<div className="drd-panel drd-panel-new">
					<div className="drd-panel-label">newLines（这一帧）</div>
					{NEW.map((line, i) => (
						<div key={i} className={newCellClass(i)}>
							<span className="drd-row-idx">{i}</span>
							<span className="drd-row-text">{line}</span>
							{isMove && i === FIRST_CHANGED && (
								<span className="drd-cursor">◄ cursor</span>
							)}
						</div>
					))}
				</div>
				{isSync && <div className="drd-sync-band drd-sync-bottom">ESC[?2026l</div>}
			</div>

			<div className="drd-decision">
				<div className="drd-decision-title">doRender 三策略决策树</div>
				<div className="drd-decision-tree">
					<div className="drd-strat">
						<span className="drd-strat-cond">previousLines 为空？</span>
						<span className="drd-strat-act">→ 首帧 fullRender(false)</span>
					</div>
					<div className="drd-strat">
						<span className="drd-strat-cond">宽度变化？</span>
						<span className="drd-strat-act">→ 清屏 fullRender(true)</span>
					</div>
					<div className="drd-strat active">
						<span className="drd-strat-cond">否则</span>
						<span className="drd-strat-act">→ 差分 diffRender（本动画演示）</span>
					</div>
				</div>
			</div>

			<div className="drd-footer">
				<div className="drd-step-info">
					<span className="drd-step-num">
						STEP {step + 1}/{STEPS.length}
					</span>
					<span className="drd-step-label">{current.label}</span>
				</div>
				<div className="drd-step-desc">{current.desc}</div>
			</div>
		</div>
	);
}
