import { useEffect, useState } from "react";
import "./EventStreamDiagram.css";

/**
 * s12 EventStream 双输出 + repairJson 状态机 动态图示。
 * 图 A（上）：生产者 push → 消费者 for await，可视化 queue/waiting 动态与 result() 双输出。
 * 图 B（下）：repairJson 单布尔 inString 状态机逐字符扫描，可注入三类非法输入，附四层降级瀑布。
 * @author fxbin
 */

const TICK_MS = 1100;

type StreamFrame = {
  producer: string;
  consumer: "await" | "recv" | "done";
  queue: number;
  waiting: number;
  result: string;
  note: string;
};

type Highlight = "normal" | "control" | "badEscape" | "trailing";

type ScanFrame = {
  charLabel: string;
  inString: boolean;
  output: string;
  note: string;
  highlight: Highlight;
};

type Preset = {
  id: string;
  label: string;
  inputDisplay: string;
  scanFrames: ScanFrame[];
  repairedDisplay: string;
  successLayer: number;
};

const STREAM_FRAMES: StreamFrame[] = [
  { producer: "", consumer: "await", queue: 0, waiting: 1, result: "", note: "消费者 await next()，进入 waiting 队列" },
  { producer: "evt-1", consumer: "recv", queue: 0, waiting: 0, result: "", note: "push(evt-1)：有等待者，直接 deliver（绕过 queue）" },
  { producer: "evt-2", consumer: "await", queue: 1, waiting: 1, result: "", note: "push(evt-2)：无等待者，入 queue；消费者回到 await" },
  { producer: "evt-3", consumer: "await", queue: 2, waiting: 1, result: "", note: "push(evt-3)：仍无等待者，queue 增长" },
  { producer: "", consumer: "recv", queue: 1, waiting: 0, result: "", note: "消费者从 queue 取出 evt-2（queue 优先分支）" },
  { producer: "", consumer: "recv", queue: 0, waiting: 0, result: "", note: "消费者从 queue 取出 evt-3" },
  { producer: "[DONE]", consumer: "recv", queue: 0, waiting: 0, result: "[DONE]", note: "push([DONE])：命中 isComplete → done=true，resolveFinalResult" },
  { producer: "", consumer: "done", queue: 0, waiting: 0, result: "[DONE]", note: "迭代结束；await result() 拿到最终聚合值（双输出）" },
];

const PRESETS: Preset[] = [
  {
    id: "control",
    label: "控制字符",
    inputDisplay: '{"a":"x<CTRL>"}',
    repairedDisplay: '{"a":"x\\u0001"}',
    successLayer: 2,
    scanFrames: [
      { charLabel: "{", inString: false, output: "{", note: "字符串外，原样输出", highlight: "normal" },
      { charLabel: '"', inString: true, output: '{"', note: "遇引号，inString 置 true", highlight: "normal" },
      { charLabel: "a", inString: true, output: '{"a', note: "串内普通字符，原样输出", highlight: "normal" },
      { charLabel: '"', inString: false, output: '{"a"', note: "遇引号，inString 置 false", highlight: "normal" },
      { charLabel: ":", inString: false, output: '{"a":', note: "串外，原样输出", highlight: "normal" },
      { charLabel: '"', inString: true, output: '{"a":"', note: "进入字符串", highlight: "normal" },
      { charLabel: "x", inString: true, output: '{"a":"x', note: "串内普通字符", highlight: "normal" },
      { charLabel: "<U+0001>", inString: true, output: '{"a":"x\\u0001', note: "控制字符 → 转义为 \\u0001", highlight: "control" },
      { charLabel: '"', inString: false, output: '{"a":"x\\u0001"', note: "退出字符串", highlight: "normal" },
      { charLabel: "}", inString: false, output: '{"a":"x\\u0001"}', note: "修复完成，层 2 解析成功", highlight: "normal" },
    ],
  },
  {
    id: "escape",
    label: "非法转义",
    inputDisplay: '{"a":"x\\z"}',
    repairedDisplay: '{"a":"x\\\\z"}',
    successLayer: 2,
    scanFrames: [
      { charLabel: "{", inString: false, output: "{", note: "字符串外，原样输出", highlight: "normal" },
      { charLabel: '"', inString: true, output: '{"', note: "进入字符串", highlight: "normal" },
      { charLabel: "a", inString: true, output: '{"a', note: "串内普通字符", highlight: "normal" },
      { charLabel: '"', inString: false, output: '{"a"', note: "退出字符串", highlight: "normal" },
      { charLabel: ":", inString: false, output: '{"a":', note: "串外，原样输出", highlight: "normal" },
      { charLabel: '"', inString: true, output: '{"a":"', note: "进入字符串", highlight: "normal" },
      { charLabel: "x", inString: true, output: '{"a":"x', note: "串内普通字符", highlight: "normal" },
      { charLabel: "\\", inString: true, output: '{"a":"x\\\\', note: "非法转义 \\z → 反斜杠加倍 \\\\", highlight: "badEscape" },
      { charLabel: "z", inString: true, output: '{"a":"x\\\\z', note: "z 作为普通字符输出", highlight: "normal" },
      { charLabel: '"', inString: false, output: '{"a":"x\\\\z"', note: "退出字符串", highlight: "normal" },
      { charLabel: "}", inString: false, output: '{"a":"x\\\\z"}', note: "修复完成，层 2 解析成功", highlight: "normal" },
    ],
  },
  {
    id: "trailing",
    label: "行尾裸 \\",
    inputDisplay: '{"a":"x\\',
    repairedDisplay: '{"a":"x\\\\',
    successLayer: 3,
    scanFrames: [
      { charLabel: "{", inString: false, output: "{", note: "字符串外，原样输出", highlight: "normal" },
      { charLabel: '"', inString: true, output: '{"', note: "进入字符串", highlight: "normal" },
      { charLabel: "a", inString: true, output: '{"a', note: "串内普通字符", highlight: "normal" },
      { charLabel: '"', inString: false, output: '{"a"', note: "退出字符串", highlight: "normal" },
      { charLabel: ":", inString: false, output: '{"a":', note: "串外，原样输出", highlight: "normal" },
      { charLabel: '"', inString: true, output: '{"a":"', note: "进入字符串", highlight: "normal" },
      { charLabel: "x", inString: true, output: '{"a":"x', note: "串内普通字符", highlight: "normal" },
      { charLabel: "\\", inString: true, output: '{"a":"x\\\\', note: "行尾裸 \\ → 反斜杠加倍 \\\\", highlight: "trailing" },
      { charLabel: "<EOF>", inString: true, output: '{"a":"x\\\\', note: "字符串未闭合 → 层 3 closeAllOpen 补 \" 与 }", highlight: "trailing" },
    ],
  },
];

const LAYER_LABELS = [
  "层 1 JSON.parse 原文",
  "层 2 repairJson + parse",
  "层 3 closeAllOpen + parse",
  "层 4 返回 {}",
];

function Cell({ label, active }: { label: string; active: boolean }) {
  return <span className={`es-cell ${active ? "active" : ""}`}>{label}</span>;
}

export default function EventStreamDiagram() {
  const [running, setRunning] = useState<boolean>(false);
  const [step, setStep] = useState<number>(0);
  const [presetId, setPresetId] = useState<string>("control");

  const preset = PRESETS.find((p) => p.id === presetId)!;
  const streamFrame = STREAM_FRAMES[step % STREAM_FRAMES.length];
  const scanStep = step % preset.scanFrames.length;
  const scanFrame = preset.scanFrames[scanStep];

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setStep((s) => s + 1);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  const handleReset = (): void => {
    setRunning(false);
    setStep(0);
  };

  const handlePreset = (id: string): void => {
    setPresetId(id);
    setStep(0);
    setRunning(false);
  };

  const handleStep = (): void => {
    setRunning(false);
    setStep((s) => s + 1);
  };

  return (
    <div className="es-root diagram diagram-wide">
      <div className="es-header">
        <span className="es-title">EVENTSTREAM 双输出 + REPAIRJSON 状态机</span>
        <div className="es-controls">
          <button type="button" onClick={() => setRunning((r) => !r)} className={running ? "active" : ""}>
            {running ? "PAUSE" : "PLAY"}
          </button>
          <button type="button" onClick={handleStep}>STEP</button>
          <button type="button" onClick={handleReset}>RESET</button>
        </div>
      </div>

      <div className="es-figure">
        <div className="es-figure-label">图 A · EventStream 生产者-消费者时序</div>
        <div className="es-stream-stage">
          <div className="es-side producer">
            <div className="es-side-title">生产者 push</div>
            <div className={`es-event ${streamFrame.producer ? "visible" : ""}`}>
              {streamFrame.producer || "—"}
            </div>
          </div>

          <div className="es-middle">
            <div className="es-counters">
              <div className="es-counter">
                <span className="es-counter-label">queue</span>
                <span className="es-counter-value">{streamFrame.queue}</span>
              </div>
              <div className="es-counter">
                <span className="es-counter-label">waiting</span>
                <span className="es-counter-value">{streamFrame.waiting}</span>
              </div>
            </div>
            <div className="es-buffers">
              <div className="es-buffer">
                <span className="es-buffer-label">queue</span>
                <div className="es-cells">
                  {Array.from({ length: Math.max(streamFrame.queue, 1) }).map((_, i) => (
                    <Cell key={`q${i}`} label={`q${i}`} active={i < streamFrame.queue} />
                  ))}
                </div>
              </div>
              <div className="es-buffer">
                <span className="es-buffer-label">waiting</span>
                <div className="es-cells">
                  {Array.from({ length: Math.max(streamFrame.waiting, 1) }).map((_, i) => (
                    <Cell key={`w${i}`} label="await" active={i < streamFrame.waiting} />
                  ))}
                </div>
              </div>
            </div>
            <div className="es-arrow-row">
              <span className="es-arrow">→</span>
              <span className="es-arrow-note">{streamFrame.note}</span>
            </div>
          </div>

          <div className="es-side consumer">
            <div className="es-side-title">消费者 for await</div>
            <div className={`es-consumer-state ${streamFrame.consumer}`}>
              {streamFrame.consumer === "await" ? "await next()" : streamFrame.consumer === "recv" ? "yield event" : "结束"}
            </div>
          </div>
        </div>
        <div className={`es-result-badge ${streamFrame.result ? "visible" : ""}`}>
          双输出 · result() = {streamFrame.result || "（未解析）"}
        </div>
      </div>

      <div className="es-figure">
        <div className="es-figure-label">图 B · repairJson 单布尔状态机</div>
        <div className="es-repair-controls">
          <span className="es-inject-label">注入：</span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={presetId === p.id ? "active" : ""}
              onClick={() => handlePreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="es-repair-stage">
          <div className="es-repair-col">
            <span className="es-col-label">输入流</span>
            <code className="es-io">{preset.inputDisplay}</code>
          </div>
          <div className="es-repair-col">
            <span className="es-col-label">当前字符</span>
            <code className={`es-char es-hl-${scanFrame.highlight}`}>{scanFrame.charLabel}</code>
          </div>
          <div className="es-repair-col">
            <span className="es-col-label">inString</span>
            <span className={`es-state ${scanFrame.inString ? "true" : "false"}`}>
              {scanFrame.inString ? "true" : "false"}
            </span>
          </div>
          <div className="es-repair-col">
            <span className="es-col-label">输出流</span>
            <code className="es-io es-output">{scanFrame.output || "（空）"}</code>
          </div>
        </div>

        <div className="es-repair-note">{scanFrame.note}</div>

        <div className="es-waterfall">
          <span className="es-waterfall-title">parseStreamingJson 四层降级</span>
          <div className="es-layers">
            {LAYER_LABELS.map((label, i) => (
              <div
                key={label}
                className={`es-layer ${preset.successLayer === i + 1 ? "succeed" : ""}`}
              >
                <span className="es-layer-name">{label}</span>
                <span className="es-layer-status">
                  {preset.successLayer === i + 1 ? "命中" : "失败"}
                </span>
              </div>
            ))}
          </div>
          <div className="es-repaired">
            修复后 = <code>{preset.repairedDisplay}</code>
          </div>
        </div>
      </div>

      <div className="es-footer">
        step {step} · 图 A 帧 {step % STREAM_FRAMES.length + 1}/{STREAM_FRAMES.length} · 图 B 帧 {scanStep + 1}/{preset.scanFrames.length}
      </div>
    </div>
  );
}
