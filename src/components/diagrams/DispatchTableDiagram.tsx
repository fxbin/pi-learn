import { useState } from "react";
import "./DispatchTableDiagram.css";

/**
 * s02 Tools dispatch 表动态图示。
 * 展示 tool_use.name 如何通过 Record 映射到对应处理函数，
 * 加工具只改表、不改循环。
 * @author fxbin
 */

const TOOLS = [
  { name: "bash", signature: "runBash(input.command)", desc: "spawnSync 跑 shell" },
  { name: "read", signature: "readFile(input.path)", desc: "readFileSync 直读" },
  { name: "write", signature: "writeFile(input.path, input.content)", desc: "writeFileSync 直写" },
];

export default function DispatchTableDiagram() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="dtd-root diagram">
      <div className="dtd-header">
        <span className="dtd-title">DISPATCH TABLE</span>
        <span className="dtd-subtitle">tool_use.name → handlers[name](input)</span>
      </div>

      <div className="dtd-stage">
        <div className="dtd-call">
          <div className="dtd-label">来自 LLM 的 tool_use</div>
          <div className="dtd-pill">
            {selected ? `{ "name": "${selected}" }` : "{ ... }"}
          </div>
        </div>

        {/*
         * 箭头与它指向的内容绑成一个 cell，防止 flex-wrap 换行时分离。
         * 宽屏：cell 内部水平，箭头 → 指向右侧内容；
         * 窄屏：cell 内部垂直，箭头旋转成 ↓ 指向下方内容。
         */}
        <div className="dtd-arrow-cell">
          <span className="dtd-arrow" aria-hidden="true">→</span>
          <div className="dtd-table">
            {TOOLS.map((tool) => (
              <button
                key={tool.name}
                className={`dtd-row ${selected === tool.name ? "active" : ""}`}
                onClick={() => setSelected(selected === tool.name ? null : tool.name)}
                type="button"
              >
                <span className="dtd-key">"{tool.name}"</span>
                <span className="dtd-sep">:</span>
                <span className="dtd-value">{tool.signature}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="dtd-arrow-cell">
          <span className="dtd-arrow" aria-hidden="true">→</span>
          <div className={`dtd-result ${selected ? "active" : ""}`}>
            <div className="dtd-label">循环里一行分发</div>
            <code className="dtd-code">
              {selected
                ? `handlers["${selected}"](block.input)`
                : "handlers[block.name](block.input)"}
            </code>
            {selected && (
              <div className="dtd-desc">{TOOLS.find((t) => t.name === selected)?.desc}</div>
            )}
          </div>
        </div>
      </div>

      <div className="dtd-hint">点击任意工具名，查看它如何被分发。</div>
    </div>
  );
}
