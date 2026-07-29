import { useState } from "react";
import "./ProviderDiagram.css";

/**
 * s08 Provider 动态图示。
 * 演示主循环通过 LlmProvider 接口与 Anthropic / OpenAI 后端交互，
 * 边界处完成 wire format 双向转换。
 * @author fxbin
 */

const PROVIDERS = [
  {
    id: "anthropic",
    name: "Anthropic",
    endpoint: "/v1/messages",
    auth: "x-api-key",
    toolCall: "content[].tool_use",
    stopReason: "stop_reason: tool_use",
  },
  {
    id: "openai",
    name: "OpenAI",
    endpoint: "/v1/chat/completions",
    auth: "Authorization: Bearer",
    toolCall: "tool_calls[]",
    stopReason: "finish_reason: tool_calls",
  },
];

export default function ProviderDiagram() {
  const [provider, setProvider] = useState<string>("anthropic");

  const current = PROVIDERS.find((p) => p.id === provider)!;

  return (
    <div className="pd-root">
      <div className="pd-header">
        <span className="pd-title">LLM PROVIDER INTERFACE</span>
        <div className="pd-controls">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              className={provider === p.id ? "active" : ""}
              onClick={() => setProvider(p.id)}
              type="button"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="pd-stage">
        <div className="pd-box loop">
          <div className="pd-box-title">agentLoop</div>
          <code>provider.complete(messages, system, tools)</code>
        </div>

        <div className="pd-connector">
          <div className="pd-arrow">→</div>
          <div className="pd-note">内部模型</div>
        </div>

        <div className="pd-box provider">
          <div className="pd-box-title">LlmProvider</div>
          <div className="pd-provider-name">{current.name}Provider</div>
        </div>

        <div className="pd-connector">
          <div className="pd-arrow">⇄</div>
          <div className="pd-note">边界转换</div>
        </div>

        <div className="pd-box backend">
          <div className="pd-box-title">Wire Format</div>
          <ul className="pd-wire-list">
            <li><strong>端点</strong> {current.endpoint}</li>
            <li><strong>认证</strong> {current.auth}</li>
            <li><strong>工具调用</strong> {current.toolCall}</li>
            <li><strong>停止信号</strong> {current.stopReason}</li>
          </ul>
        </div>
      </div>

      <div className="pd-footer">
        主循环只认内部模型； Anthropic 零转换， OpenAI 在边界做 toWire / fromWire。
      </div>
    </div>
  );
}
