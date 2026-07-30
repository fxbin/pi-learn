import { useEffect, useState } from "react";
import "./AgentLoopDiagram.css";

/**
 * s01 Agent Loop 动态循环图。
 * 水平布局：用户提问 → LLM ⇄ 工具（双向箭头形成 loop）→ 最终回答 → 用户。
 *
 * 核心视觉：
 *   - LLM 与工具之间是双向通道：上行 tool_use（LLM→工具，橙色），下行 tool_result（工具→LLM，绿色）。
 *   - 两条箭头并列形成一个可视化的"循环回路"，比单向箭头+弧线更直观地表达 loop 语义。
 *   - LLM 节点带 ↻ 徽章，循环阶段旋转。
 *   - 退出判断与pi 一致：看 content 里有没有 tool_use 块，不看 stop_reason。
 *     stop_reason 只用于异常检测（"error"/"aborted"）。
 *
 * 序列：输入 → 两轮 tool_use/tool_result 循环 → 输出。
 * 两轮用于教学演示，实际循环次数由模型决定。
 * @author fxbin
 */

type Phase = "input" | "tool_use" | "tool_result" | "output";

interface StepDef {
  phase: Phase;
  label: string;
  loopIndex: number;
  message: string;
  /** content 里 tool_use 块的数量；0 表示没有，循环退出 */
  toolUseCount: number;
  /** 模拟的 stop_reason 值，只用于异常检测展示 */
  stopReason: string;
}

const FULL_SEQUENCE: StepDef[] = [
  { phase: "input", label: "用户提问", loopIndex: 0, message: "写个 hello.ts", toolUseCount: 0, stopReason: "—" },
  { phase: "tool_use", label: "LLM 输出 tool_use 块", loopIndex: 1, message: 'write("hello.ts", "console.log(1)")', toolUseCount: 1, stopReason: '"tool_use"' },
  { phase: "tool_result", label: "工具返回写入成功", loopIndex: 1, message: "ok: wrote 18 bytes", toolUseCount: 1, stopReason: '"tool_use"' },
  { phase: "tool_use", label: "LLM 输出 tool_use 块", loopIndex: 2, message: 'bash("tsc hello.ts")', toolUseCount: 1, stopReason: '"tool_use"' },
  { phase: "tool_result", label: "工具返回编译结果", loopIndex: 2, message: "exit 0, no output", toolUseCount: 1, stopReason: '"tool_use"' },
  { phase: "output", label: "LLM 输出最终回答", loopIndex: 0, message: "已创建 hello.ts 并通过编译。", toolUseCount: 0, stopReason: '"end_turn"' }
];

export default function AgentLoopDiagram() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setStep((s) => (s + 1) % FULL_SEQUENCE.length);
    }, 1800);
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
  const inLoop = current.phase === "tool_use" || current.phase === "tool_result";
  const hasToolUse = current.toolUseCount > 0;

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
        <div className="ald-row ald-row-main">
          <div className={`ald-node ald-node-user ${userInputActive ? "active" : ""}`}>
            <div className="ald-status" />
            <div className="ald-label">用户</div>
          </div>

          <div className={`ald-arrow ald-arrow-h ald-arrow-input ${userInputActive ? "active" : ""}`}>
            <span className="ald-arrow-label">提问</span>
          </div>

          <div className={`ald-node ald-node-llm ${llmActive ? "active" : ""}`}>
            <div className="ald-status" />
            <div className="ald-label">LLM</div>
            <div className={`ald-loop-badge ${inLoop ? "spinning" : ""}`}>↻</div>
          </div>

          <div className={`ald-channel-bi ${toolUseActive ? "active-use" : ""} ${toolResultActive ? "active-result" : ""}`}>
            <svg viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
              <line x1="8" y1="20" x2="188" y2="20" className="ald-channel-line ald-channel-use" />
              <polygon points="188,20 178,15 178,25" className="ald-channel-head ald-channel-use-head" />
              <line x1="192" y1="40" x2="12" y2="40" className="ald-channel-line ald-channel-result" />
              <polygon points="12,40 22,35 22,45" className="ald-channel-head ald-channel-result-head" />
            </svg>
            <span className="ald-channel-label ald-channel-label-use">tool_use</span>
            <span className="ald-channel-label ald-channel-label-result">tool_result</span>
          </div>

          <div className={`ald-node ald-node-tool ${toolActive ? "active" : ""}`}>
            <div className="ald-status" />
            <div className="ald-label">工具</div>
          </div>
        </div>

        <div className="ald-row ald-row-output">
          <div className={`ald-arrow ald-arrow-down ald-arrow-output ${llmOutputActive ? "active" : ""}`}>
            <span className="ald-arrow-label">最终回答 · content 无 tool_use 块</span>
          </div>
          <div className={`ald-node ald-node-output ${llmOutputActive ? "active" : ""}`}>
            <div className="ald-status" />
            <div className="ald-label">用户</div>
          </div>
        </div>

        <div className="ald-message">
          <span className="ald-message-label">当前消息</span>
          <code className="ald-message-text">{current.message}</code>
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
        <div className="ald-condition">
          <span className="ald-condition-key">content.tool_use.length</span>
          <span className="ald-condition-op">=</span>
          <span className={`ald-condition-val ${hasToolUse ? "continue" : "exit"}`}>
            {current.toolUseCount}
          </span>
          <span className={`ald-condition-action ${hasToolUse ? "continue" : "exit"}`}>
            {hasToolUse ? "→ 继续" : "→ 退出"}
          </span>
        </div>
        <div className="ald-stop-reason">
          stop_reason: {current.stopReason}
        </div>
      </div>
    </div>
  );
}
