import { useEffect, useState } from "react";
import "./InterruptDiagram.css";

/**
 * s04 中断与 steering 动态图示。
 * 演示 agent loop 上的三层控制：abort、steering、max-turns。
 * @author fxbin
 */

const MODES = [
  { id: "abort", label: "Abort", desc: "signal.aborted 为 true 时硬停" },
  { id: "steering", label: "Steering", desc: "每轮注入新 user 消息改方向" },
  { id: "maxTurns", label: "Max-Turns", desc: "turns 计数器超过上限熔断" },
];

export default function InterruptDiagram() {
  const [mode, setMode] = useState<string>("abort");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setStep((s) => (s + 1) % 5);
    }, 900);
    return () => clearInterval(id);
  }, [playing]);

  const reset = () => {
    setPlaying(false);
    setStep(0);
  };

  return (
    <div className="id-root">
      <div className="id-header">
        <span className="id-title">INTERRUPT & STEERING</span>
        <div className="id-controls">
          <button onClick={() => setPlaying(!playing)} type="button">
            {playing ? "PAUSE" : "PLAY"}
          </button>
          <button onClick={reset} type="button">RESET</button>
        </div>
      </div>

      <div className="id-tabs">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`id-tab ${mode === m.id ? "active" : ""}`}
            onClick={() => { setMode(m.id); reset(); }}
            type="button"
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="id-stage">
        <Flow mode={mode} step={step} />
      </div>

      <div className="id-footer">
        <span className="id-mode-label">{MODES.find((m) => m.id === mode)?.desc}</span>
      </div>
    </div>
  );
}

function Flow({ mode, step }: { mode: string; step: number }) {
  const nodes = [
    { id: "check", label: "检查 abort" },
    { id: "steer", label: "steering()" },
    { id: "llm", label: "call LLM" },
    { id: "tool", label: "执行工具" },
    { id: "guard", label: "计数/再查 abort" },
  ];

  const activeIndex =
    mode === "abort"
      ? step < 2 ? step : 4
      : mode === "steering"
      ? step < 2 ? step : 1
      : Math.min(step, 4);

  const abortNode = mode === "abort" && step >= 2;
  const steerNode = mode === "steering" && step >= 2;
  const maxTurnsNode = mode === "maxTurns" && step >= 4;

  return (
    <div className="id-flow">
      {nodes.map((node, idx) => (
        <div key={node.id} className="id-flow-link">
          <div
            className={`id-node ${activeIndex === idx ? "active" : ""} ${
              (abortNode && node.id === "check") ||
              (steerNode && node.id === "steer") ||
              (maxTurnsNode && node.id === "guard")
                ? "trigger"
                : ""
            }`}
          >
            {node.label}
          </div>
          {idx < nodes.length - 1 && <div className="id-flow-arrow">↓</div>}
        </div>
      ))}

      <div className="id-outcome">
        {abortNode && <div className="id-outcome-box abort">[aborted] 硬停</div>}
        {steerNode && <div className="id-outcome-box steer">[steering] 注入新消息</div>}
        {maxTurnsNode && <div className="id-outcome-box maxturns">[max-turns] 熔断</div>}
      </div>
    </div>
  );
}
