import { useState } from "react";
import "./SessionJsonlDiagram.css";

/**
 * s05 Session / JSONL 动态图示。
 * 核心认知：append-only JSONL 是持久化层，进程崩溃时内存丢失但磁盘文件保留。
 * 状态分离：
 *   - memory：进程内存中的消息数组，崩溃时清空
 *   - disk：磁盘上的 session.jsonl，append-only，崩溃不丢失
 * RESUME 时从 disk 逐行读回 memory——这就是"持久化"的意义。
 * @author fxbin
 */

type Message = { role: string; text: string };

const INITIAL_MESSAGES: Message[] = [
  { role: "user", text: "列出当前目录的文件" },
  { role: "assistant", text: "tool_use: bash" },
  { role: "user", text: "tool_result: a.txt b.txt" },
];

type Phase = "running" | "crashed" | "resumed";

export default function SessionJsonlDiagram() {
  const [memory, setMemory] = useState<Message[]>(INITIAL_MESSAGES);
  const [disk, setDisk] = useState<Message[]>(INITIAL_MESSAGES);
  const [phase, setPhase] = useState<Phase>("running");

  const appendMessage = () => {
    const next: Message = {
      role: "assistant",
      text: `answer #${memory.length}`,
    };
    setMemory((prev) => [...prev, next]);
    setDisk((prev) => [...prev, next]);
    setPhase("running");
  };

  const simulateCrash = () => {
    setMemory([]);
    setPhase("crashed");
  };

  const resume = () => {
    setMemory(disk.map((m) => ({ ...m })));
    setPhase("resumed");
  };

  const reset = () => {
    setMemory(INITIAL_MESSAGES);
    setDisk(INITIAL_MESSAGES);
    setPhase("running");
  };

  return (
    <div className="sjd-root diagram">
      <div className="sjd-header">
        <span className="sjd-title">APPEND-ONLY JSONL</span>
        <div className="sjd-controls">
          <button onClick={appendMessage} type="button">+ 消息</button>
          <button
            onClick={simulateCrash}
            disabled={phase === "crashed"}
            type="button"
          >
            模拟崩溃
          </button>
          <button
            onClick={resume}
            disabled={phase !== "crashed"}
            type="button"
          >
            RESUME
          </button>
          <button onClick={reset} type="button">RESET</button>
        </div>
      </div>

      <div className="sjd-phase-bar">
        <span className={`sjd-phase ${phase}`}>
          {phase === "running" && "运行中：内存 ↔ 磁盘同步追加"}
          {phase === "crashed" && "已崩溃：内存丢失，磁盘文件保留"}
          {phase === "resumed" && "已恢复：从 JSONL 读回内存"}
        </span>
      </div>

      <div className="sjd-stage">
        <div className="sjd-col">
          <div className="sjd-label">内存消息数组</div>
          <div className={`sjd-array ${phase === "crashed" ? "crashed" : ""} ${phase === "resumed" ? "loaded" : ""}`}>
            {memory.length === 0 ? (
              <div className="sjd-empty">
                {phase === "crashed" ? "进程退出，内存释放" : "空"}
              </div>
            ) : (
              memory.map((m, idx) => (
                <div key={idx} className={`sjd-msg ${m.role}`}>
                  <span className="sjd-role">{m.role}</span>
                  <span className="sjd-text">{m.text}</span>
                </div>
              ))
            )}
          </div>
          <div className="sjd-hint">
            {phase === "crashed" ? "内存丢失" : `${memory.length} 条`}
          </div>
        </div>

        <div className="sjd-arrow-col">
          <div className={`sjd-arrow ${phase === "running" ? "active" : ""}`}>
            {phase === "resumed" ? "← load" : "→ flush"}
          </div>
          <div className="sjd-arrow-label">
            {phase === "resumed" ? "readFileSync + split + JSON.parse" : "appendFileSync"}
          </div>
        </div>

        <div className="sjd-col">
          <div className="sjd-label">session.jsonl (磁盘)</div>
          <div className={`sjd-file ${disk.length > 0 ? "persisted" : ""}`}>
            {disk.length === 0 ? (
              <div className="sjd-empty">文件为空</div>
            ) : (
              disk.map((m, idx) => (
                <div key={idx} className="sjd-line">
                  {JSON.stringify({ role: m.role, content: m.text })}
                </div>
              ))
            )}
          </div>
          <div className="sjd-hint">
            {disk.length > 0 ? `${disk.length} 行 · append-only · 持久化` : "空"}
          </div>
        </div>
      </div>

      <div className="sjd-footer">
        appendFileSync 逐行追加；崩溃时内存清空、磁盘保留；resume 时 readFileSync + split + JSON.parse 回放。
      </div>
    </div>
  );
}
