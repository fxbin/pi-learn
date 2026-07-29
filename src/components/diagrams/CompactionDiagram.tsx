import { useState } from "react";
import "./CompactionDiagram.css";

/**
 * s06 Compaction 动态图示。
 * 演示上下文窗口溢出时，如何把历史消息压缩成摘要并保留最近工作集。
 * @author fxbin
 */

type Msg = { id: string; label: string; tokens: number };

const INITIAL_MESSAGES: Msg[] = [
  { id: "m1", label: "user: 任务", tokens: 8 },
  { id: "m2", label: "assistant: tool_use", tokens: 6 },
  { id: "m3", label: "user: 结果 A", tokens: 40 },
  { id: "m4", label: "assistant: tool_use", tokens: 6 },
  { id: "m5", label: "user: 结果 B", tokens: 40 },
  { id: "m6", label: "assistant: tool_use", tokens: 6 },
  { id: "m7", label: "user: 结果 C", tokens: 40 },
  { id: "m8", label: "assistant: 思考", tokens: 10 },
];

const MAX_TOKENS = 100;
const KEEP_RECENT = 3;

export default function CompactionDiagram() {
  const [compacted, setCompacted] = useState(false);

  const total = INITIAL_MESSAGES.reduce((sum, m) => sum + m.tokens, 0);
  const overLimit = total > MAX_TOKENS;

  const recent = INITIAL_MESSAGES.slice(-KEEP_RECENT);
  const old = INITIAL_MESSAGES.slice(0, -KEEP_RECENT);
  const compactedMessages = [
    { id: "summary", label: "summary: 前面做了…", tokens: 20 },
    ...recent,
  ];

  const displayMessages = compacted ? compactedMessages : INITIAL_MESSAGES;
  const displayTotal = displayMessages.reduce((sum, m) => sum + m.tokens, 0);

  return (
    <div className="cd-root">
      <div className="cd-header">
        <span className="cd-title">CONTEXT COMPACTION</span>
        <div className="cd-controls">
          <button onClick={() => setCompacted(false)} type="button">压缩前</button>
          <button onClick={() => setCompacted(true)} type="button">压缩后</button>
        </div>
      </div>

      <div className="cd-stage">
        <div className="cd-col">
          <div className="cd-label">消息序列</div>
          <div className="cd-stack">
            {displayMessages.map((m) => (
              <div
                key={m.id}
                className={`cd-msg ${m.id === "summary" ? "summary" : ""}`}
              >
                <span className="cd-msg-label">{m.label}</span>
                <span className="cd-msg-tokens">{m.tokens}t</span>
              </div>
            ))}
          </div>
        </div>

        <div className="cd-col">
          <div className="cd-label">token 占用</div>
          <div className="cd-meter">
            <div
              className={`cd-fill ${displayTotal > MAX_TOKENS ? "over" : ""}`}
              style={{ height: `${Math.min((displayTotal / MAX_TOKENS) * 100, 100)}%` }}
            ></div>
            <div className="cd-limit">limit {MAX_TOKENS}</div>
          </div>
          <div className="cd-total">{displayTotal} / {MAX_TOKENS}</div>
        </div>
      </div>

      {!compacted && overLimit && (
        <div className="cd-alert">
          检测到溢出：保留最近 {KEEP_RECENT} 条作为工作集，其余压缩成摘要。
        </div>
      )}

      {compacted && (
        <div className="cd-info">
          压缩后：老历史变成 summary，数组引用不变（原地替换）。
        </div>
      )}
    </div>
  );
}
