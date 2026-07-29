import { useEffect, useState } from "react";
import "./AgentLoopDiagram.css";

/**
 * s01 Agent Loop 动态循环图。
 * 展示 while 循环结构：用户输入 → LLM↔工具循环 → 最终输出。
 * 核心是 LLM 与工具之间的循环：tool_use → tool_result → 再 tool_use …
 * 直到 stop_reason !== "tool_use" 才跳出循环。
 * @author fxbin
 */

type Phase = "input" | "tool_use" | "tool_result" | "output";

interface StepDef {
  phase: Phase;
  label: string;
  loopIndex: number;
}

/**
 * 完整动画序列：输入 → 两轮 tool_use/tool_result 循环 → 输出。
 * 两轮循环用于教学演示，实际运行时循环次数由模型决定。
 */
const FULL_SEQUENCE: StepDef[] = [
  { phase: "input", label: "用户提问", loopIndex: 0 },
  { phase: "tool_use", label: "tool_use", loopIndex: 1 },
  { phase: "tool_result", label: "tool_result", loopIndex: 1 },
  { phase: "tool_use", label: "tool_use", loopIndex: 2 },
  { phase: "tool_result", label: "tool_result", loopIndex: 2 },
  { phase: "output", label: "最终回答", loopIndex: 0 },
];

/**
 * 根据当前阶段返回 stop_reason 模拟值。
 * @param phase 当前阶段
 * @returns stop_reason 字符串
 */
function getStopReason(phase: Phase): string {
  switch (phase) {
    case "tool_use":
      return '"tool_use"';
    case "tool_result":
      return '"tool_use"';
    case "output":
      return '"end_turn"';
    default:
      return '"';
  }
}

export default function AgentLoopDiagram() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setStep((s) => (s + 1) % FULL_SEQUENCE.length);
    }, 1500);
    return () => clearInterval(id);
  }, [playing]);

  const current = FULL_SEQUENCE[step];
  const loopCount = current.loopIndex;

  const userInputActive = current.phase === "input";
  const llmOutputActive = current.phase === "output";
  const toolUseActive = current.phase === "tool_use";
  const toolResultActive = current.phase === "tool_result";
  const llmActive = current.phase !== "input";
  const toolActive = toolUseActive || toolResultActive;

  return (
    <div className="ald-root diagram">
      <div className="ald-header">
        <span className="ald-title">AGENT LOOP</span>
        <div className="ald-controls">
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

      <div className="ald-stage">
        <div className={`ald-node ${userInputActive || llmOutputActive ? "active" : ""}`}>
          <div className="ald-status" />
          <div className="ald-label">用户</div>
        </div>

        <div className="ald-channel ald-channel-user">
          <div className={`ald-arrow ald-arrow-right ${userInputActive ? "active" : ""}`}>
            <span className="ald-arrow-label">提问</span>
          </div>
          <div className={`ald-arrow ald-arrow-left ${llmOutputActive ? "active" : ""}`}>
            <span className="ald-arrow-label">最终回答</span>
          </div>
        </div>

        <div className={`ald-node ald-node-llm ${llmActive ? "active" : ""}`}>
          <div className="ald-status" />
          <div className="ald-label">LLM</div>
          <div className="ald-loop-icon">↻</div>
        </div>

        <div className="ald-channel ald-channel-loop">
          <div className={`ald-arrow ald-arrow-right ${toolUseActive ? "active" : ""}`}>
            <span className="ald-arrow-label">tool_use</span>
          </div>
          <div className={`ald-arrow ald-arrow-left ${toolResultActive ? "active" : ""}`}>
            <span className="ald-arrow-label">tool_result</span>
          </div>
        </div>

        <div className={`ald-node ${toolActive ? "active" : ""}`}>
          <div className="ald-status" />
          <div className="ald-label">工具执行</div>
        </div>
      </div>

      <div className="ald-footer">
        <div className="ald-step-info">
          <span className="ald-step-num">
            STEP {step + 1}/{FULL_SEQUENCE.length}
          </span>
          <span className="ald-step-label">{current.label}</span>
        </div>
        {loopCount > 0 && (
          <div className="ald-loop-count">LOOP ×{loopCount}</div>
        )}
        <div className="ald-stop-reason">
          stop_reason: {getStopReason(current.phase)}
        </div>
      </div>
    </div>
  );
}
