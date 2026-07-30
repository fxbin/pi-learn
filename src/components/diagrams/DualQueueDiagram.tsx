import { useEffect, useState } from "react";
import "./DualQueueDiagram.css";

/**
 * s13 双队列与状态机动态图示。
 *
 * 核心认知：steering 与 followUp 两种注入点的时序差异。
 *   - steering：循环内注入，"下一轮 LLM 调用前"生效（当前轮工具照常跑完）
 *   - followUp：循环外注入，"agent 本该停止时"生效（让循环续跑一轮）
 *
 * 两条 timeline 上下并排展示，关键差异在 drain 节点的位置：
 *   Timeline 1（steering）：drain 出现在 turn_end 之后、下一轮 LLM 之前（循环内）
 *   Timeline 2（followUp）：drain 出现在内层循环退出、agent 即将停止时（循环外）
 *
 * 右侧状态机小图：idle ⇄ running，abort 路径，
 * activeRun 三件套（promise / resolve / abortController）。
 *
 * 交互：用户点击 "+ steer" / "+ followUp" 按钮可向队列里塞一条消息，
 * 播放到对应 drain 节点时被取出并显示注入内容。
 *
 * @author fxbin
 */

type NodeKind =
	| "user"
	| "assistant"
	| "tool_call"
	| "tool_result"
	| "turn_end"
	| "drain_steering"
	| "drain_followUp"
	| "agent_stop"
	| "continue";

interface TimelineNode {
	id: string;
	label: string;
	kind: NodeKind;
}

interface TimelineDef {
	id: "steering" | "followUp";
	title: string;
	accentVar: string;
	nodes: TimelineNode[];
	drainIndex: number;
}

const TIMELINES: TimelineDef[] = [
	{
		id: "steering",
		title: "STEERING · 循环内注入",
		accentVar: "var(--orange)",
		drainIndex: 5,
		nodes: [
			{ id: "s-u1", label: "user 提问", kind: "user" },
			{ id: "s-a1", label: "assistant 流式输出", kind: "assistant" },
			{ id: "s-t1", label: "tool_call", kind: "tool_call" },
			{ id: "s-r1", label: "tool_result", kind: "tool_result" },
			{ id: "s-te1", label: "turn_end", kind: "turn_end" },
			{ id: "s-drain", label: "★ drain steering", kind: "drain_steering" },
			{ id: "s-a2", label: "assistant 基于新指令输出", kind: "assistant" },
			{ id: "s-stop", label: "stop", kind: "agent_stop" },
		],
	},
	{
		id: "followUp",
		title: "FOLLOWUP · 循环外注入",
		accentVar: "var(--purple)",
		drainIndex: 6,
		nodes: [
			{ id: "f-u1", label: "user 提问", kind: "user" },
			{ id: "f-a1", label: "assistant 流式输出", kind: "assistant" },
			{ id: "f-t1", label: "tool_call", kind: "tool_call" },
			{ id: "f-r1", label: "tool_result", kind: "tool_result" },
			{ id: "f-te1", label: "turn_end", kind: "turn_end" },
			{ id: "f-stop", label: "agent 即将停止", kind: "agent_stop" },
			{ id: "f-drain", label: "★ drain followUp", kind: "drain_followUp" },
			{ id: "f-a2", label: "续跑一轮", kind: "continue" },
			{ id: "f-final", label: "stop", kind: "agent_stop" },
		],
	},
];

const TICK_MS = 1100;
const STEER_MSG = "别动 test 目录";
const FOLLOWUP_MSG = "顺便补一个 README";

export default function DualQueueDiagram() {
	const [step, setStep] = useState(0);
	const [playing, setPlaying] = useState(false);
	const [steerQueue, setSteerQueue] = useState<string[]>([]);
	const [followUpQueue, setFollowUpQueue] = useState<string[]>([]);
	const [aborted, setAborted] = useState(false);

	const totalSteps = Math.max(
		TIMELINES[0].nodes.length,
		TIMELINES[1].nodes.length,
	);

	useEffect(() => {
		if (!playing) return;
		const id = setInterval(() => {
			setStep((s) => {
				if (s + 1 >= totalSteps) {
					setPlaying(false);
					return s;
				}
				return s + 1;
			});
		}, TICK_MS);
		return () => clearInterval(id);
	}, [playing, totalSteps]);

	const reset = () => {
		setPlaying(false);
		setStep(0);
		setSteerQueue([]);
		setFollowUpQueue([]);
		setAborted(false);
	};

	const enqueueSteer = () => {
		setSteerQueue((q) => [...q, STEER_MSG]);
	};

	const enqueueFollowUp = () => {
		setFollowUpQueue((q) => [...q, FOLLOWUP_MSG]);
	};

	const triggerAbort = () => {
		setAborted(true);
		setPlaying(false);
	};

	const phase: "idle" | "running" | "aborted" = aborted
		? "aborted"
		: playing || step > 0
			? "running"
			: "idle";

	const drainSteerFired = step >= TIMELINES[0].drainIndex && steerQueue.length > 0;
	const drainFollowUpFired = step >= TIMELINES[1].drainIndex && followUpQueue.length > 0;

	return (
		<div className="dq-root diagram diagram-wide">
			<div className="dq-header">
				<span className="dq-title">DUAL QUEUE · steering vs followUp</span>
				<div className="dq-controls">
					<button
						onClick={() => {
							if (aborted) setAborted(false);
							setPlaying(!playing);
						}}
						type="button"
					>
						{playing ? "PAUSE" : "PLAY"}
					</button>
					<button onClick={reset} type="button">RESET</button>
					<button onClick={triggerAbort} type="button" disabled={aborted}>
						ABORT
					</button>
				</div>
			</div>

			<div className="dq-timelines">
				{TIMELINES.map((tl) => {
					const isSteer = tl.id === "steering";
					const queue = isSteer ? steerQueue : followUpQueue;
					const drainFired = isSteer ? drainSteerFired : drainFollowUpFired;
					return (
						<div
							key={tl.id}
							className="dq-timeline"
							style={{ ["--accent" as string]: tl.accentVar }}
						>
							<div className="dq-timeline-head">
								<span className="dq-timeline-title">{tl.title}</span>
								<button
									onClick={isSteer ? enqueueSteer : enqueueFollowUp}
									type="button"
									className="dq-inject-btn"
								>
									+ {isSteer ? "steer" : "followUp"}
								</button>
							</div>
							<div className="dq-nodes">
								{tl.nodes.map((node, idx) => {
									const isCurrent = step === idx && !aborted;
									const isDrain = idx === tl.drainIndex;
									const isDone = step > idx;
									return (
										<div
											key={node.id}
											className={`dq-node dq-${node.kind} ${
												isCurrent ? "current" : ""
											} ${isDone ? "done" : ""} ${isDrain ? "drain" : ""} ${
												isDrain && drainFired ? "fired" : ""
											} ${isDrain && !drainFired && queue.length === 0 ? "empty" : ""}`}
										>
											<div className="dq-node-idx">{idx + 1}</div>
											<div className="dq-node-label">{node.label}</div>
										</div>
									);
								})}
							</div>
							<div className="dq-queue-row">
								<span className="dq-queue-label">
									{isSteer ? "steeringQueue" : "followUpQueue"}:
								</span>
								<span className="dq-queue-content">
									{queue.length === 0 ? (
										<em>(空)</em>
									) : (
										queue.map((m, i) => (
											<span key={i} className="dq-queue-item">
												"{m}"
											</span>
										))
									)}
								</span>
							</div>
						</div>
					);
				})}
			</div>

			<div className="dq-bottom">
				<div className="dq-fsm">
					<div className="dq-fsm-title">状态机</div>
					<div className="dq-fsm-graph">
						<div className={`dq-fsm-node idle ${phase === "idle" ? "on" : ""}`}>
							idle
						</div>
						<div className="dq-fsm-edge">
							<span className="dq-fsm-edge-l">prompt()</span>
							<span className="dq-arrow">→</span>
						</div>
						<div className={`dq-fsm-node running ${phase === "running" ? "on" : ""}`}>
							running
						</div>
						<div className="dq-fsm-edge back">
							<span className="dq-arrow">←</span>
							<span className="dq-fsm-edge-l">finishRun()</span>
						</div>
						<div className={`dq-fsm-node aborted ${phase === "aborted" ? "on" : ""}`}>
							aborted
						</div>
					</div>
				</div>

				<div className="dq-activerun">
					<div className="dq-activerun-title">activeRun 三件套</div>
					<div className="dq-activerun-row">
						<span className="dq-ar-key">promise</span>
						<span className={`dq-ar-val ${phase === "running" ? "on" : "off"}`}>
							{phase === "running" ? "pending" : "settled"}
						</span>
					</div>
					<div className="dq-activerun-row">
						<span className="dq-ar-key">resolve</span>
						<span className={`dq-ar-val ${phase === "running" ? "on" : "off"}`}>
							{phase === "running" ? "未调用" : "已调用"}
						</span>
					</div>
					<div className="dq-activerun-row">
						<span className="dq-ar-key">abortController</span>
						<span className={`dq-ar-val ${aborted ? "aborted" : ""}`}>
							{aborted ? "aborted=true" : "aborted=false"}
						</span>
					</div>
				</div>
			</div>

			<div className="dq-footer">
				<span style={{ color: "var(--orange)" }}>steering</span>
				{" "}
				在"下一轮 LLM 调用前"注入（循环内）；{" "}
				<span style={{ color: "var(--purple)" }}>followUp</span>
				{" "}
				在"agent 本该停止时"注入（循环外）。两者都靠 drain 排干队列，只是位置不同。
			</div>
		</div>
	);
}
