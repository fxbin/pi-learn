import { useEffect, useState } from "react";
import "./ExtensionHookDiagram.css";

/**
 * s10 Extensions 动态图示。
 * 上半部：一次完整 turn 的钩子时序，按 Observer/Interceptor/Transformer 三色标注。
 * 下半部：错误隔离演示——一个扩展抛错被 try/catch 捕获，其余扩展照常运行。
 * 另含 stale context 保护演示：切换会话后旧 ctx 调用抛 stale 错误。
 * @author fxbin
 */

type HookKind = "observer" | "interceptor" | "transformer" | "step";

interface TimelineNode {
  id: string;
  label: string;
  kind: HookKind;
  signature: string;
}

const TIMELINE: TimelineNode[] = [
  { id: "input", label: "input", kind: "step", signature: "用户输入文本" },
  { id: "before_agent_start", label: "before_agent_start", kind: "observer", signature: '(e, ctx) => void' },
  { id: "context", label: "context", kind: "transformer", signature: "(e: { messages[] }, ctx) => { messages? }" },
  { id: "before_provider_request", label: "before_provider_request", kind: "transformer", signature: "(e, ctx) => { request? }" },
  { id: "llm", label: "LLM", kind: "step", signature: "provider.complete(messages, system)" },
  { id: "tool_call", label: "tool_call", kind: "interceptor", signature: "(e: { toolName; input }, ctx) => { block?; reason? }" },
  { id: "tool_result", label: "tool_result", kind: "transformer", signature: "(e, ctx) => { content? }" },
  { id: "message_end", label: "message_end", kind: "transformer", signature: "(e: { text }, ctx) => { text? }" },
  { id: "session_shutdown", label: "session_shutdown", kind: "observer", signature: "(e: { reason }, ctx) => void" },
];

interface ErrorExt {
  name: string;
  status: "pending" | "running" | "error" | "ok";
}

const INITIAL_ERROR_EXTS: ErrorExt[] = [
  { name: "A: logger", status: "pending" },
  { name: "B: profanityFilter", status: "pending" },
  { name: "C: blockDangerousTool", status: "pending" },
];

const STEP_INTERVAL_MS = 700;
const ERROR_STEP_INTERVAL_MS = 600;
const LAST_STEP = TIMELINE.length - 1;
const ERROR_DONE_STEP = INITIAL_ERROR_EXTS.length;

const KIND_LABEL: Record<HookKind, string> = {
  observer: "Observer",
  interceptor: "Interceptor",
  transformer: "Transformer",
  step: "step",
};

function kindClass(kind: HookKind): string {
  return `ehd-${kind}`;
}

export default function ExtensionHookDiagram() {
  const [step, setStep] = useState<number>(-1);
  const [playing, setPlaying] = useState<boolean>(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [errorStep, setErrorStep] = useState<number>(-1);
  const [stale, setStale] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>("点击 PLAY 开始钩子时序演示");

  useEffect(() => {
    if (!playing) return;
    if (step >= LAST_STEP) {
      setPlaying(false);
      setStatusMsg("一次完整 turn 的钩子触发完成");
      return;
    }
    const timer = window.setTimeout(() => {
      const next = step + 1;
      setStep(next);
      const node = TIMELINE[next];
      setStatusMsg(
        node.kind === "step"
          ? `${node.label}（非钩子步骤）`
          : `emit ${node.label} → ${KIND_LABEL[node.kind]}`
      );
    }, STEP_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [playing, step]);

  useEffect(() => {
    if (errorStep < 0) return;
    if (errorStep >= ERROR_DONE_STEP) {
      setStatusMsg("错误隔离完成：A 抛错被捕获，B/C 照常运行");
      return;
    }
    setStatusMsg(`扩展 ${INITIAL_ERROR_EXTS[errorStep].name} 运行中…`);
    const timer = window.setTimeout(() => setErrorStep((s) => s + 1), ERROR_STEP_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [errorStep]);

  const errorExts: ErrorExt[] = INITIAL_ERROR_EXTS.map((ext, i) => {
    if (errorStep < 0) return { ...ext, status: "pending" };
    if (i === 0) {
      return { ...ext, status: errorStep === 0 ? "running" : "error" };
    }
    if (i === 1) {
      if (errorStep <= 0) return { ...ext, status: "pending" };
      if (errorStep === 1) return { ...ext, status: "running" };
      return { ...ext, status: "ok" };
    }
    if (errorStep <= 1) return { ...ext, status: "pending" };
    if (errorStep === 2) return { ...ext, status: "running" };
    return { ...ext, status: "ok" };
  });

  const handlePlayPause = (): void => {
    if (stale) {
      setStatusMsg("ctx 已 stale，请先 RESET 再 PLAY");
      return;
    }
    if (playing) {
      setPlaying(false);
      setStatusMsg("已暂停");
      return;
    }
    setPlaying(true);
    if (step < 0 || step >= LAST_STEP) {
      setStep(0);
      setStatusMsg(
        TIMELINE[0].kind === "step"
          ? `${TIMELINE[0].label}（非钩子步骤）`
          : `emit ${TIMELINE[0].label} → ${KIND_LABEL[TIMELINE[0].kind]}`
      );
    }
  };

  const handleInjectError = (): void => {
    setErrorStep(0);
    setStatusMsg("注入错误：观察错误隔离…");
  };

  const handleSwitchSession = (): void => {
    setStale(true);
    setPlaying(false);
    setStatusMsg("invalidate() → 旧 ctx 已 stale，emit 抛 stale 错误");
  };

  const handleReset = (): void => {
    setStep(-1);
    setPlaying(false);
    setSelected(null);
    setErrorStep(-1);
    setStale(false);
    setStatusMsg("已重置，点击 PLAY 开始");
  };

  const handleNodeClick = (id: string): void => {
    setSelected((prev) => (prev === id ? null : id));
  };

  return (
    <div className={`ehd-root diagram diagram-wide ${stale ? "ehd-stale" : ""}`}>
      <div className="ehd-header">
        <span className="ehd-title">EXTENSION HOOK LIFECYCLE</span>
        <div className="ehd-controls">
          <button onClick={handlePlayPause} type="button">{playing ? "PAUSE" : "PLAY"}</button>
          <button onClick={handleInjectError} type="button">注入错误</button>
          <button onClick={handleSwitchSession} type="button">切换会话</button>
          <button onClick={handleReset} type="button">RESET</button>
        </div>
      </div>

      <div className="ehd-section">
        <div className="ehd-section-label">钩子时序（一次完整 turn）</div>
        <div className="ehd-timeline">
          {TIMELINE.map((node, i) => (
            <div
              key={node.id}
              className={`ehd-node ${kindClass(node.kind)} ${step === i ? "active" : ""} ${selected === node.id ? "selected" : ""}`}
            >
              <button
                className="ehd-node-btn"
                onClick={() => handleNodeClick(node.id)}
                type="button"
              >
                <span className="ehd-node-label">{node.label}</span>
                <span className="ehd-node-kind">{KIND_LABEL[node.kind]}</span>
              </button>
              {selected === node.id && (
                <div className="ehd-signature">
                  <span className="ehd-sig-prefix">signature:</span>
                  <code>{node.signature}</code>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="ehd-legend">
          <span className="ehd-leg ehd-observer">Observer 只观察</span>
          <span className="ehd-leg ehd-interceptor">Interceptor 可 block</span>
          <span className="ehd-leg ehd-transformer">Transformer 链式 reduce</span>
        </div>
      </div>

      <div className="ehd-section">
        <div className="ehd-section-label">错误隔离演示</div>
        <div className="ehd-error-demo">
          {errorExts.map((ext) => (
            <div key={ext.name} className={`ehd-ext ehd-ext-${ext.status}`}>
              <span className="ehd-ext-name">{ext.name}</span>
              <span className="ehd-ext-status">{ext.status}</span>
            </div>
          ))}
        </div>
        <div className="ehd-flow">
          <span className="ehd-flow-error">A 抛 Error("boom")</span>
          <span className="ehd-arrow">→</span>
          <span className="ehd-flow-step">try/catch 捕获</span>
          <span className="ehd-arrow">→</span>
          <span className="ehd-flow-step">emitError → errorListeners</span>
          <span className="ehd-arrow">→</span>
          <span className="ehd-flow-ok">B ✓ C ✓ 照常运行</span>
        </div>
      </div>

      <div className="ehd-footer">
        {stale ? (
          <span className="ehd-stale-msg">⚠ stale context：旧 ctx 的 emit 抛 stale 错误，防止误用</span>
        ) : (
          statusMsg
        )}
      </div>
    </div>
  );
}
