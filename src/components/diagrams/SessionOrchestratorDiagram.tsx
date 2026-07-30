import { useEffect, useState } from "react";
import "./SessionOrchestratorDiagram.css";

/**
 * s11 AgentSession 动态图示。
 * 三个视图：
 *   arch  — 三层分层架构（Mode / AgentSession / Agent）
 *   prompt — prompt() 四步时序，Step4 展示 overflow vs threshold 两条路径
 *   model  — setModel 三步 + "不重建 Agent" 洞察
 * @author fxbin
 */

type View = "arch" | "prompt" | "model";

interface LayerDef {
  id: string;
  label: string;
  subtitle: string;
  items: string[];
}

interface StepDef {
  id: number;
  label: string;
  code: string;
  desc: string;
}

const LAYERS: LayerDef[] = [
  { id: "mode", label: "Mode", subtitle: "I/O 层", items: ["stdin / stdout", "TUI", "REPL"] },
  { id: "session", label: "AgentSession", subtitle: "编排层", items: ["compaction 触发", "模型切换", "事件订阅", "overflow 恢复"] },
  { id: "agent", label: "Agent", subtitle: "状态层", items: ["agentLoop", "messages", "tools"] },
];

const PROMPT_STEPS: StepDef[] = [
  { id: 0, label: "Step1 入队", code: "this._messages.push({ role: 'user', content: text })", desc: "用户消息入队" },
  { id: 1, label: "Step2 compactBefore", code: "await this._maybeCompactBefore()", desc: "上一轮 aborted → 先压缩" },
  { id: 2, label: "Step3 agentLoop", code: "agentLoop(this._messages, this._model, this._tools, ...)", desc: "复用 s01 跑循环" },
  { id: 3, label: "Step4 compactAfter", code: "await this._checkCompactionAfter()", desc: "overflow 删+compact+retry / threshold compact" },
];

const MODEL_STEPS: StepDef[] = [
  { id: 0, label: "改 _model", code: "this._model = model", desc: "只换模型引用" },
  { id: 1, label: "重置 overflow", code: "this._overflowRecovered = false", desc: "换模型后允许再次恢复" },
  { id: 2, label: "emit model_select", code: "this._emit({ type: 'model_select', model, ... })", desc: "通知订阅者" },
];

const TICK_MS = 1400;

export default function SessionOrchestratorDiagram() {
  const [view, setView] = useState<View>("arch");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);

  const steps = view === "prompt" ? PROMPT_STEPS : MODEL_STEPS;
  const maxStep = steps.length;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setStep((s) => {
        if (s + 1 >= maxStep) {
          setPlaying(false);
          setFinished(true);
          return s;
        }
        return s + 1;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, maxStep]);

  const reset = () => {
    setPlaying(false);
    setStep(0);
    setFinished(false);
  };

  const switchView = (next: View) => {
    setView(next);
    reset();
  };

  return (
    <div className="so-root diagram diagram-wide">
      <div className="so-header">
        <span className="so-title">SESSION ORCHESTRATOR</span>
        <div className="so-controls">
          <button onClick={() => setPlaying(!playing)} disabled={finished || view === "arch"} type="button">
            {playing ? "PAUSE" : "PLAY"}
          </button>
          <button onClick={reset} type="button">RESET</button>
        </div>
      </div>

      <div className="so-tabs">
        <button className={`so-tab ${view === "arch" ? "active" : ""}`} onClick={() => switchView("arch")} type="button">分层架构</button>
        <button className={`so-tab ${view === "prompt" ? "active" : ""}`} onClick={() => switchView("prompt")} type="button">prompt 流程</button>
        <button className={`so-tab ${view === "model" ? "active" : ""}`} onClick={() => switchView("model")} type="button">切换模型</button>
      </div>

      {view === "arch" && <ArchView />}
      {view === "prompt" && <PromptView step={step} finished={finished} />}
      {view === "model" && <ModelView step={step} finished={finished} />}

      <div className="so-footer">
        {view === "arch" && "三层分层：Mode 管 I/O，AgentSession 管编排，Agent 管状态。prompt/subscribe/setModel 是层间调用。"}
        {view === "prompt" && `prompt() 四步 · step ${step + 1}/${maxStep}${finished ? " · 完成" : ""}`}
        {view === "model" && `setModel 三步 · step ${step + 1}/${maxStep}${finished ? " · 完成" : ""}`}
      </div>
    </div>
  );
}

/** 分层架构视图：三列纵向，列间标注方法调用。 */
function ArchView() {
  return (
    <div className="so-arch">
      {LAYERS.map((layer, idx) => (
        <div key={layer.id} className="so-arch-col-group">
          <div className="so-arch-col">
            <div className="so-arch-label">{layer.label}</div>
            <div className="so-arch-sub">{layer.subtitle}</div>
            <div className="so-arch-items">
              {layer.items.map((item) => (
                <div key={item} className="so-arch-item">{item}</div>
              ))}
            </div>
          </div>
          {idx < LAYERS.length - 1 && (
            <div className="so-arch-arrow">
              <div className="so-arch-arrow-line">→</div>
              <div className="so-arch-arrow-label">
                {idx === 0 ? "prompt() / /model" : "agentLoop()"}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** prompt() 四步时序视图，Step4 展开 overflow vs threshold 两条路径。 */
function PromptView({ step, finished }: { step: number; finished: boolean }) {
  return (
    <div className="so-flow">
      <div className="so-flow-steps">
        {PROMPT_STEPS.map((s, idx) => {
          const isActive = step === idx && !finished;
          const isDone = idx < step || finished;
          return (
            <div key={s.id} className="so-flow-row">
              <div className={`so-flow-node ${isActive ? "active" : ""} ${isDone ? "done" : ""}`}>
                <div className="so-flow-num">{idx + 1}</div>
                <div className="so-flow-body">
                  <div className="so-flow-label">{s.label}</div>
                  <code className="so-flow-code">{s.code}</code>
                  <div className="so-flow-desc">{s.desc}</div>
                </div>
              </div>
              {idx < PROMPT_STEPS.length - 1 && <div className="so-flow-arrow">↓</div>}
            </div>
          );
        })}

        {finished && step === 3 && (
          <div className="so-branch">
            <div className="so-branch-arrow">↓</div>
            <div className="so-branch-row">
              <div className="so-branch-box overflow">
                <div className="so-branch-title">Case1 overflow</div>
                <div className="so-branch-text">删最后一条 assistant</div>
                <div className="so-branch-text">compact + retry</div>
                <div className="so-branch-note">_overflowRecovered 防无限循环</div>
              </div>
              <div className="so-branch-box threshold">
                <div className="so-branch-title">Case2 threshold</div>
                <div className="so-branch-text">token 超阈值</div>
                <div className="so-branch-text">compact 不 retry</div>
                <div className="so-branch-note">下一轮自然用压缩后上下文</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="so-side">
        <div className="so-side-section">
          <div className="so-side-label">当前步骤</div>
          <div className="so-side-val">{PROMPT_STEPS[step].label}</div>
        </div>
        <div className="so-side-section">
          <div className="so-side-label">说明</div>
          <div className="so-side-desc">{PROMPT_STEPS[step].desc}</div>
        </div>
        <div className="so-side-section">
          <div className="so-side-label">状态</div>
          <div className="so-status-row">
            <span className="so-status-key">step</span>
            <span className="so-status-val">{step + 1} / {PROMPT_STEPS.length}</span>
          </div>
          <div className="so-status-row">
            <span className="so-status-key">finished</span>
            <span className={`so-status-val ${finished ? "on" : "off"}`}>{finished ? "true" : "false"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** setModel 三步视图 + "不重建 Agent" 洞察。 */
function ModelView({ step, finished }: { step: number; finished: boolean }) {
  return (
    <div className="so-flow">
      <div className="so-flow-steps">
        {MODEL_STEPS.map((s, idx) => {
          const isActive = step === idx && !finished;
          const isDone = idx < step || finished;
          return (
            <div key={s.id} className="so-flow-row">
              <div className={`so-flow-node ${isActive ? "active" : ""} ${isDone ? "done" : ""}`}>
                <div className="so-flow-num">{idx + 1}</div>
                <div className="so-flow-body">
                  <div className="so-flow-label">{s.label}</div>
                  <code className="so-flow-code">{s.code}</code>
                  <div className="so-flow-desc">{s.desc}</div>
                </div>
              </div>
              {idx < MODEL_STEPS.length - 1 && <div className="so-flow-arrow">↓</div>}
            </div>
          );
        })}

        {finished && (
          <div className="so-insight">
            <div className="so-insight-arrow">↓</div>
            <div className="so-insight-box">
              <div className="so-insight-title">关键洞察：不重建 Agent</div>
              <div className="so-insight-text">
                messages / tools / systemPrompt 都在 session 里，只换 _model 引用。
                对话无缝续接，上下文不丢、工具不重注册。
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="so-side">
        <div className="so-side-section">
          <div className="so-side-label">当前步骤</div>
          <div className="so-side-val">{MODEL_STEPS[step].label}</div>
        </div>
        <div className="so-side-section">
          <div className="so-side-label">说明</div>
          <div className="so-side-desc">{MODEL_STEPS[step].desc}</div>
        </div>
        <div className="so-side-section">
          <div className="so-side-label">状态</div>
          <div className="so-status-row">
            <span className="so-status-key">step</span>
            <span className="so-status-val">{step + 1} / {MODEL_STEPS.length}</span>
          </div>
          <div className="so-status-row">
            <span className="so-status-key">finished</span>
            <span className={`so-status-val ${finished ? "on" : "off"}`}>{finished ? "true" : "false"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
