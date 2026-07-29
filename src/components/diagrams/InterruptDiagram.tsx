import { useEffect, useState } from "react";
import "./InterruptDiagram.css";

/**
 * s04 中断与 steering 动态图示。
 * 核心认知：三层控制（abort / steering / max-turns）全部叠加在 s01 那个 while 循环上，
 * 不是独立的线性流程。循环节点按顺序：
 *   1. 查 signal.aborted（循环顶部 abort 检测点）
 *   2. steering() 注入新 user 消息
 *   3. call LLM（signal 贯穿 fetch）
 *   4. 执行工具
 *   5. 再查 signal.aborted（工具后 abort 检测点）
 *   6. turns++ 计数 / 超过 maxTurns 熔断
 * 末尾回流箭头回到节点 1，构成循环。
 * @author fxbin
 */

type ModeId = "abort" | "steering" | "maxTurns";

interface ModeDef {
  id: ModeId;
  label: string;
  desc: string;
  triggerNode: number;
  outcome: string;
  outcomeClass: string;
}

interface NodeDef {
  id: string;
  label: string;
  code: string;
}

const MODES: ModeDef[] = [
  {
    id: "abort",
    label: "Abort",
    desc: "signal.aborted 为 true → 硬停退出（fetch 抛 AbortError 或轮询标志）",
    triggerNode: 0,
    outcome: "[aborted] 硬停退出",
    outcomeClass: "abort",
  },
  {
    id: "steering",
    label: "Steering",
    desc: "getSteeringMessages 返回非空 → 注入 user 消息，循环继续",
    triggerNode: 1,
    outcome: "[steering] 注入新消息，循环继续",
    outcomeClass: "steer",
  },
  {
    id: "maxTurns",
    label: "Max-Turns",
    desc: "turns 计数器超过 CONFIG.maxTurns → 熔断退出",
    triggerNode: 5,
    outcome: "[max-turns] 熔断退出",
    outcomeClass: "maxturns",
  },
];

const LOOP_NODES: NodeDef[] = [
  { id: "check-top", label: "查 signal.aborted", code: "if (signal.aborted) return" },
  { id: "steer", label: "steering() 注入", code: "for (m of await steering()) messages.push(m)" },
  { id: "llm", label: "call LLM", code: "await callLlm(messages, signal)" },
  { id: "tool", label: "执行工具", code: "handlers[name](input)" },
  { id: "check-bot", label: "再查 signal.aborted", code: "if (signal.aborted) return" },
  { id: "count", label: "turns++ / 熔断", code: "if (++turns > maxTurns) break" },
];

const TICK_MS = 1100;

export default function InterruptDiagram() {
  const [mode, setMode] = useState<ModeId>("abort");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fired, setFired] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const currentMode = MODES.find((m) => m.id === mode)!;
    if (fired) {
      return;
    }
    const id = setInterval(() => {
      setStep((s) => {
        const next = (s + 1) % LOOP_NODES.length;
        if (next === currentMode.triggerNode && !fired) {
          setFired(true);
          setPlaying(false);
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, mode, fired]);

  const reset = () => {
    setPlaying(false);
    setStep(0);
    setFired(false);
  };

  const switchMode = (next: ModeId) => {
    setMode(next);
    reset();
  };

  const currentMode = MODES.find((m) => m.id === mode)!;

  return (
    <div className="id-root diagram">
      <div className="id-header">
        <span className="id-title">INTERRUPT & STEERING</span>
        <div className="id-controls">
          <button onClick={() => setPlaying(!playing)} disabled={fired} type="button">
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
            onClick={() => switchMode(m.id)}
            type="button"
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="id-stage">
        <div className="id-loop">
          <div className="id-loop-label">while (true)</div>
          <div className="id-loop-body">
            {LOOP_NODES.map((node, idx) => {
              const isActive = step === idx && !fired;
              const isTrigger = idx === currentMode.triggerNode;
              const isFired = fired && isTrigger;
              return (
                <div key={node.id} className="id-loop-row">
                  <div
                    className={`id-node ${isActive ? "active" : ""} ${
                      isTrigger ? "trigger-point" : ""
                    } ${isFired ? "fired" : ""}`}
                  >
                    <div className="id-node-num">{idx + 1}</div>
                    <div className="id-node-body">
                      <div className="id-node-label">{node.label}</div>
                      <code className="id-node-code">{node.code}</code>
                    </div>
                    {isTrigger && (
                      <div className="id-node-tag">{currentMode.label}</div>
                    )}
                  </div>
                  {idx < LOOP_NODES.length - 1 && (
                    <div className="id-arrow-down">↓</div>
                  )}
                </div>
              );
            })}
            <div className="id-loop-back">↑ 回到顶部 · loop</div>
          </div>
        </div>

        <div className="id-side">
          <div className="id-side-section">
            <div className="id-side-label">当前模式</div>
            <div className="id-mode-name">{currentMode.label}</div>
            <div className="id-mode-desc">{currentMode.desc}</div>
          </div>

          <div className="id-side-section">
            <div className="id-side-label">触发点</div>
            <div className="id-trigger-info">
              节点 {currentMode.triggerNode + 1}：{LOOP_NODES[currentMode.triggerNode].label}
            </div>
          </div>

          <div className="id-side-section">
            <div className="id-side-label">运行状态</div>
            <div className="id-status-row">
              <span className="id-status-key">turn</span>
              <span className="id-status-val">{step + 1}/{LOOP_NODES.length}</span>
            </div>
            <div className="id-status-row">
              <span className="id-status-key">fired</span>
              <span className={`id-status-val ${fired ? "on" : "off"}`}>
                {fired ? "true" : "false"}
              </span>
            </div>
          </div>

          <div className={`id-outcome-box ${currentMode.outcomeClass} ${fired ? "show" : ""}`}>
            {currentMode.outcome}
          </div>
        </div>
      </div>

      <div className="id-footer">
        三层控制叠加在同一个 while 循环上：abort 硬停、steering 软改、max-turns 熔断。
      </div>
    </div>
  );
}
