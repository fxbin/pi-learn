import { useEffect, useState } from "react";
import "./AgentLoopDiagram.css";

/**
 * s01 Agent Loop 动态循环图。
 * 展示 用户 → LLM → 工具执行 → LLM 的循环过程。
 * @author fxbin
 */

type Step = { from: string; to: string; label: string };

const STEPS: Step[] = [
  { from: "user", to: "llm", label: "用户提问" },
  { from: "llm", to: "tool", label: "tool_use" },
  { from: "tool", to: "llm", label: "tool_result" },
  { from: "llm", to: "user", label: "最终回答" },
];

export default function AgentLoopDiagram() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setStep((s) => (s + 1) % STEPS.length);
    }, 1200);
    return () => clearInterval(id);
  }, [playing]);

  const current = STEPS[step];

  return (
    <div className="ald-root">
      <div className="ald-header">
        <span className="ald-title">AGENT LOOP</span>
        <div className="ald-controls">
          <button onClick={() => setPlaying(!playing)}>{playing ? "PAUSE" : "PLAY"}</button>
          <button onClick={() => { setPlaying(false); setStep(0); }}>RESET</button>
        </div>
      </div>
      <div className="ald-stage">
        <Node id="user" label="用户" active={current.from === "user" || current.to === "user"} />
        <Arrow active={current.from === "user" && current.to === "llm"} label={current.from === "user" && current.to === "llm" ? current.label : ""} />
        <Node id="llm" label="LLM" active={current.from === "llm" || current.to === "llm"} />
        <Arrow active={current.from === "llm" && current.to === "tool"} label={current.from === "llm" && current.to === "tool" ? current.label : ""} reverse />
        <Node id="tool" label="工具执行" active={current.from === "tool" || current.to === "tool"} />
      </div>
      <div className="ald-step">
        <span className="ald-step-num">STEP {step + 1}/{STEPS.length}</span>
        <span className="ald-step-label">{current.label}</span>
      </div>
    </div>
  );
}

function Node({ id, label, active }: { id: string; label: string; active: boolean }) {
  return (
    <div className={`ald-node ${active ? "active" : ""}`} data-id={id}>
      <div className="ald-status"></div>
      <div className="ald-label">{label}</div>
    </div>
  );
}

function Arrow({ active, label, reverse }: { active: boolean; label: string; reverse?: boolean }) {
  return (
    <div className={`ald-arrow-wrap ${reverse ? "reverse" : ""}`}>
      <div className={`ald-arrow ${active ? "active" : ""}`}>
        <div className="ald-arrow-line"></div>
        <div className="ald-arrow-head"></div>
      </div>
      {label && <div className="ald-arrow-label">{label}</div>}
    </div>
  );
}
