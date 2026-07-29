import { useState } from "react";
import "./SessionJsonlDiagram.css";

/**
 * s05 Session / JSONL 动态图示。
 * 演示消息数组如何通过 append-only JSONL 文件实现持久化与 resume。
 * @author fxbin
 */

type Message = { role: string; text: string };

const INITIAL_MESSAGES: Message[] = [
  { role: "user", text: "列出当前目录的文件" },
  { role: "assistant", text: "tool_use: bash" },
  { role: "user", text: "tool_result: ..." },
];

export default function SessionJsonlDiagram() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [loaded, setLoaded] = useState(false);

  const pushMessage = () => {
    setMessages((prev) => [
      ...prev,
      { role: "assistant", text: `answer #${prev.length}` },
    ]);
  };

  const simulateCrash = () => {
    setMessages([]);
    setLoaded(false);
  };

  const resume = () => {
    setMessages(INITIAL_MESSAGES);
    setLoaded(true);
  };

  return (
    <div className="sjd-root">
      <div className="sjd-header">
        <span className="sjd-title">APPEND-ONLY JSONL</span>
        <div className="sjd-controls">
          <button onClick={pushMessage} type="button">+ 消息</button>
          <button onClick={simulateCrash} type="button">模拟崩溃</button>
          <button onClick={resume} type="button">RESUME</button>
        </div>
      </div>

      <div className="sjd-stage">
        <div className="sjd-col">
          <div className="sjd-label">内存消息数组</div>
          <div className="sjd-array">
            {messages.map((m, idx) => (
              <div key={idx} className={`sjd-msg ${m.role}`}>
                <span className="sjd-role">{m.role}</span>
                <span className="sjd-text">{m.text}</span>
              </div>
            ))}
            {messages.length === 0 && <div className="sjd-empty">空</div>}
          </div>
        </div>

        <div className="sjd-arrow">→</div>

        <div className="sjd-col">
          <div className="sjd-label">session.jsonl</div>
          <div className="sjd-file">
            {messages.length === 0 ? (
              <div className="sjd-empty">文件丢失或为空</div>
            ) : (
              messages.map((m, idx) => (
                <div key={idx} className="sjd-line">
                  {JSON.stringify({ role: m.role, content: m.text })}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="sjd-arrow">→</div>

        <div className="sjd-col">
          <div className="sjd-label">重启后 load</div>
          <div className={`sjd-array ${loaded ? "loaded" : ""}`}>
            {loaded ? (
              messages.map((m, idx) => (
                <div key={idx} className={`sjd-msg ${m.role}`}>
                  <span className="sjd-role">{m.role}</span>
                  <span className="sjd-text">{m.text}</span>
                </div>
              ))
            ) : (
              <div className="sjd-empty">未恢复</div>
            )}
          </div>
        </div>
      </div>

      <div className="sjd-footer">
        appendFileSync 逐行追加；readFileSync + split + JSON.parse 回放。
      </div>
    </div>
  );
}
