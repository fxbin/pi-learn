import { useEffect, useState } from "react";
import "./MutationQueueDiagram.css";

/**
 * s03 edit + 变更队列动态图示。
 * 演示 file-mutation-queue 如何用一条 promise 链把并发写盘串行化。
 * 核心概念：不是队列数据结构，而是不断延长的 promise 链。
 * mutationQueue = mutationQueue.then(fn).catch(...)
 * @author fxbin
 */

type TaskStatus = "queued" | "running" | "done";

interface Task {
  id: string;
  name: string;
  status: TaskStatus;
}

const INITIAL_TASKS: Task[] = [
  { id: "t1", name: "edit a.txt", status: "queued" },
  { id: "t2", name: "write b.txt", status: "queued" },
  { id: "t3", name: "edit a.txt", status: "queued" },
];

/**
 * 动画阶段：
 * 0 = 初始状态（3个任务同时入队）
 * 1-3 = 依次串行执行
 * 4 = 全部完成
 */
const PHASE_IDLE = 0;
const PHASE_DONE = 4;

export default function MutationQueueDiagram() {
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const [phase, setPhase] = useState(PHASE_IDLE);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running || phase >= PHASE_DONE) {
      if (running && phase >= PHASE_DONE) {
        setRunning(false);
      }
      return;
    }

    const delay = phase === 0 ? 1000 : 1200;
    const id = setTimeout(() => {
      const nextPhase = phase + 1;
      setTasks((prev) =>
        prev.map((t, idx) => {
          if (idx === nextPhase - 1) return { ...t, status: "running" };
          if (idx < nextPhase - 1) return { ...t, status: "done" };
          return t;
        })
      );
      setPhase(nextPhase);
    }, delay);

    return () => clearTimeout(id);
  }, [running, phase]);

  const start = () => {
    setTasks(INITIAL_TASKS.map((t) => ({ ...t, status: "queued" })));
    setPhase(PHASE_IDLE);
    setRunning(true);
  };

  const reset = () => {
    setRunning(false);
    setTasks(INITIAL_TASKS);
    setPhase(PHASE_IDLE);
  };

  const currentRunning = tasks.findIndex((t) => t.status === "running");

  return (
    <div className="mqd-root diagram">
      <div className="mqd-header">
        <span className="mqd-title">FILE MUTATION QUEUE</span>
        <div className="mqd-controls">
          <button onClick={start} disabled={running} type="button">
            {running ? "RUNNING" : "RUN"}
          </button>
          <button onClick={reset} type="button">RESET</button>
        </div>
      </div>

      <div className="mqd-stage">
        <div className="mqd-col">
          <div className="mqd-col-label">并发入队</div>
          <div className="mqd-enqueue">
            {tasks.map((task) => (
              <div key={task.id} className={`mqd-task-chip ${task.status}`}>
                <span className="mqd-chip-name">{task.name}</span>
                <span className="mqd-chip-status">{task.status}</span>
              </div>
            ))}
          </div>
          <div className="mqd-hint">3 个写操作同时入队</div>
        </div>

        <div className="mqd-arrow-down">↓<br /><span className="mqd-arrow-label">enqueue</span></div>

        <div className="mqd-col">
          <div className="mqd-col-label">promise 链</div>
          <div className="mqd-chain-vis">
            <div className="mqd-chain-head">
              <span className="mqd-chain-text">Promise.resolve("")</span>
            </div>
            {tasks.map((task, idx) => (
              <div key={task.id} className="mqd-chain-link">
                <div className="mqd-chain-connector">.then(</div>
                <div className={`mqd-chain-node ${task.status}`}>
                  <span className="mqd-chain-name">{task.name}</span>
                  <span className="mqd-chain-status">{task.status}</span>
                </div>
                <div className="mqd-chain-connector">)</div>
              </div>
            ))}
            <div className="mqd-chain-tail">
              <span className="mqd-chain-text">.catch(兜底)</span>
            </div>
          </div>
          <div className="mqd-hint">链不断延长，串行执行</div>
        </div>

        <div className="mqd-arrow-down">↓<br /><span className="mqd-arrow-label">串行</span></div>

        <div className="mqd-col">
          <div className="mqd-col-label">写盘时序</div>
          <div className="mqd-timeline">
            {tasks.map((task, idx) => (
              <div key={task.id} className="mqd-timeline-row">
                <div className={`mqd-timeline-bar ${task.status}`}>
                  <span>{task.name}</span>
                </div>
                {idx < tasks.length - 1 && <div className="mqd-timeline-gap" />}
              </div>
            ))}
          </div>
          <div className="mqd-hint">
            {currentRunning >= 0
              ? `正在执行 #${currentRunning + 1}`
              : phase >= PHASE_DONE
              ? "全部完成"
              : "等待开始"}
          </div>
        </div>
      </div>

      <div className="mqd-footer">
        <code>mutationQueue = mutationQueue.then(fn).catch(...)</code>
        <span className="mqd-note">不是队列数据结构——是一条不断延长的 promise 链。并发入队的写操作在链尾串行执行。</span>
      </div>
    </div>
  );
}
