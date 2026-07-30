import { useEffect, useState } from "react";
import "./OverviewDiagram.css";

/**
 * pi 总览动态主图。
 * 按 pi 一次完整执行的顺序，蛇形布局点亮 14 个核心模块，
 * 展示从用户输入到输出返回的完整流程。
 *
 * 布局：3 行蛇形（boustrophedon）
 *   行1（左→右）: 输入 → TUI → Orchestrator → Agent Loop → Provider
 *   行2（右→左）: Session Tree ← Dual Queue ← Extensions ← Skills ← Event Stream
 *   行3（左→右）: 输出 ← Compaction ← Session ← Interrupt ← Edit Queue ← Tools
 *
 * 交互：
 *   - 自动播放：按序点亮每个节点，显示对应章节和一句话职责
 *   - 播放/暂停/重置控制
 *   - 点击已点亮节点跳转对应章节
 *   - 底部状态栏显示当前步骤详情
 *
 * @author fxbin
 */

/** 节点定义：模块名、章节号、一句话职责、跳转链接。 */
interface NodeDef {
  /** 节点唯一标识 */
  id: string;
  /** 显示的模块名 */
  label: string;
  /** 章节号（如 S01） */
  chapter: string;
  /** 一句话职责说明 */
  desc: string;
  /** 跳转链接 */
  href: string;
  /** 在网格中的行（1-3） */
  row: number;
  /** 在网格中的列（1-5） */
  col: number;
}

/**
 * 14 个核心模块，按执行顺序排列。
 * 行1: TUI → Orchestrator → Agent Loop → Provider（左→右）
 * 行2: Event Stream → Skills → Extensions → Dual Queue → Session Tree（左→右，但逻辑上是回程）
 * 行3: Tools → Edit Queue → Interrupt → Session → Compaction（左→右，输出在末尾）
 *
 * 注意：Agent Loop 是循环核心，带 ↻ 标记。
 */
const NODES: NodeDef[] = [
  { id: "tui", label: "TUI", chapter: "S09", desc: "终端界面接收用户输入", href: "/pi-learn/chapters/s09_tui/", row: 1, col: 1 },
  { id: "orchestrator", label: "Session Orchestrator", chapter: "S11", desc: "会话编排，分派到子会话", href: "/pi-learn/chapters/s11_agent_session/", row: 1, col: 2 },
  { id: "agent-loop", label: "Agent Loop", chapter: "S01", desc: "核心循环：有 tool_use 就继续，没有就停", href: "/pi-learn/chapters/s01_agent_loop/", row: 1, col: 3 },
  { id: "provider", label: "Provider", chapter: "S08", desc: "调用 LLM，流式解析响应", href: "/pi-learn/chapters/s08_provider/", row: 1, col: 4 },
  { id: "event-stream", label: "Event Stream", chapter: "S12", desc: "流式事件管道，逐 token 推送", href: "/pi-learn/chapters/s12_streaming/", row: 1, col: 5 },
  { id: "tools", label: "Tools 分发", chapter: "S02", desc: "dispatch 表，tool_use.name → handler", href: "/pi-learn/chapters/s02_tools/", row: 2, col: 5 },
  { id: "edit-queue", label: "Edit Queue", chapter: "S03", desc: "文件变更队列，串行化写入", href: "/pi-learn/chapters/s03_edit_queue/", row: 2, col: 4 },
  { id: "interrupt", label: "Interrupt", chapter: "S04", desc: "AbortSignal 贯穿，Ctrl+C 可中断", href: "/pi-learn/chapters/s04_interrupt/", row: 2, col: 3 },
  { id: "session", label: "Session", chapter: "S05", desc: "会话持久化，JSONL 追加写入", href: "/pi-learn/chapters/s05_session/", row: 2, col: 2 },
  { id: "compaction", label: "Compaction", chapter: "S06", desc: "上下文压缩，超长对话截断", href: "/pi-learn/chapters/s06_compaction/", row: 2, col: 1 },
  { id: "skills", label: "Skills", chapter: "S07", desc: "技能加载，动态注入 system prompt", href: "/pi-learn/chapters/s07_skills/", row: 3, col: 1 },
  { id: "extensions", label: "Extensions", chapter: "S10", desc: "扩展钩子，Observer/Interceptor/Transformer", href: "/pi-learn/chapters/s10_extensions/", row: 3, col: 2 },
  { id: "dual-queue", label: "Dual Queue", chapter: "S13", desc: "主/辅队列，运行中消息注入", href: "/pi-learn/chapters/s13_dual_queue/", row: 3, col: 3 },
  { id: "session-tree", label: "Session Tree", chapter: "S14", desc: "分支树，fork/branch 记录历史", href: "/pi-learn/chapters/s14_session_tree/", row: 3, col: 4 },
];

/** 总步数 = 节点数 + 输入 + 输出两个端点。 */
const TOTAL_STEPS = NODES.length + 2;

export default function OverviewDiagram() {
  /** 当前步数，0 = 初始态，1..14 = 各模块，15 = 输出 */
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setStep((s) => {
        if (s >= TOTAL_STEPS - 1) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 1200);
    return () => clearInterval(id);
  }, [playing]);

  const currentNode = step >= 1 && step <= NODES.length ? NODES[step - 1] : null;
  const isInput = step === 1;
  const isOutput = step === TOTAL_STEPS - 1;
  const isFinished = step === TOTAL_STEPS - 1;

  function nodeState(idx: number): "pending" | "active" | "done" {
    const nodeStep = idx + 1;
    if (step === nodeStep) return "active";
    if (step > nodeStep) return "done";
    return "pending";
  }

  return (
    <div className="ovd-root diagram diagram-full">
      <div className="ovd-header">
        <span className="ovd-title">PI EXECUTION FLOW</span>
        <div className="ovd-controls">
          <button
            onClick={() => {
              if (isFinished) {
                setStep(0);
                setPlaying(true);
              } else {
                setPlaying(!playing);
              }
            }}
            type="button"
          >
            {isFinished ? "REPLAY" : playing ? "PAUSE" : "PLAY"}
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

      <div className="ovd-stage">
        <div className="ovd-endpoint ovd-input">
          <div className={`ovd-endpoint-node ${step >= 1 ? "active" : ""}`}>
            <span>用户输入</span>
          </div>
        </div>

        <div className="ovd-grid">
          {NODES.map((node, idx) => {
            const state = nodeState(idx);
            return (
              <a
                key={node.id}
                href={state !== "pending" ? node.href : undefined}
                className={`ovd-node ovd-node-${state}`}
                style={{
                  gridRow: node.row,
                  gridColumn: node.col,
                }}
                data-chapter={node.chapter}
              >
                <span className="ovd-node-chapter">{node.chapter}</span>
                <span className="ovd-node-label">{node.label}</span>
                {node.id === "agent-loop" && (
                  <span className={`ovd-loop-badge ${state === "active" ? "spinning" : ""}`}>↻</span>
                )}
              </a>
            );
          })}
        </div>

        <div className="ovd-endpoint ovd-output">
          <div className={`ovd-endpoint-node ${isOutput ? "active" : ""} ${step >= TOTAL_STEPS - 1 ? "done" : ""}`}>
            <span>输出返回</span>
          </div>
        </div>
      </div>

      <div className="ovd-footer">
        <div className="ovd-step-info">
          <span className="ovd-step-num">
            {step === 0 ? "READY" : `STEP ${step}/${TOTAL_STEPS - 1}`}
          </span>
          {currentNode ? (
            <>
              <a className="ovd-step-label" href={currentNode.href}>
                {currentNode.chapter} · {currentNode.label}
              </a>
              <span className="ovd-step-desc">{currentNode.desc}</span>
            </>
          ) : isInput ? (
            <span className="ovd-step-desc">用户在 TUI 输入一条消息</span>
          ) : isOutput ? (
            <span className="ovd-step-desc">循环退出，最终回答返回用户</span>
          ) : (
            <span className="ovd-step-desc">点击 PLAY 开始演示 pi 的执行流程</span>
          )}
        </div>
      </div>
    </div>
  );
}
