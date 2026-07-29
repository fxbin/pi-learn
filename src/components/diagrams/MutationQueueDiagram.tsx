import { useEffect, useState } from "react";
import "./MutationQueueDiagram.css";

/**
 * s03 edit + 变更队列动态图示。
 * 演示 file-mutation-queue 如何用一条 promise 链把并发写盘串行化。
 * @author fxbin
 */

type Task = { id: string; name: string; status: "pending" | "running" | "done" | "failed" };

const INITIAL_TASKS: Task[] = [
  { id: "t1", name: "edit a.txt", status: "pending" },
  { id: "t2", name: "write b.txt", status: "pending" },
  { id: "t3", name: "edit a.txt", status: "pending" },
];

export default function MutationQueueDiagram() {
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!running || current >= tasks.length) {
      if (running && current >= tasks.length) {
        setRunning(false);
      }
      return;
    }

    const id = setTimeout(() => {
      setTasks((prev) =>
        prev.map((t, idx) => {
          if (idx === current) return { ...t, status: "done" };
          if (idx === current + 1) return { ...t, status: "running" };
          return t;
        })
      );
      setCurrent((c) => c + 1);
    }, 900);

    return () => clearTimeout(id);
  }, [running, current, tasks.length]);

  const start = () => {
    setTasks(INITIAL_TASKS.map((t, idx) => ({ ...t, status: idx === 0 ? "running" : "pending" })));
    setCurrent(0);
    setRunning(true);
  };

  const reset = () => {
    setRunning(false);
    setTasks(INITIAL_TASKS);
    setCurrent(0);
  };

  return (
    <div className="mqd-root">
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
        <div className="mqd-chain">
          {tasks.map((task, idx) => (
            <div key={task.id} className="mqd-link">
              <div className={`mqd-node ${task.status}`}>
                <span className="mqd-node-name">{task.name}</span>
                <span className="mqd-node-status">{task.status}</span>
              </div>
              {idx < tasks.length - 1 && (
                <div className="mqd-connector">
                  <div className="mqd-connector-line"></div>
                  <div className="mqd-connector-head"></div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mqd-footer">
        <code>mutationQueue = mutationQueue.then(fn).catch(...)</code>
        <span className="mqd-note">并发入队的写操作，在链尾串行执行。</span>
      </div>
    </div>
  );
}
