import { useState } from "react";
import "./ProviderDiagram.css";

/**
 * s08 Provider 动态图示。
 * 三层结构：
 *   1. agentLoop（主循环，只跟 AgentMessage 打交道）
 *   2. AgentMessage 中间抽象层（pi 真实存在，mini-pi 省略）
 *   3. 两个并列、平等的供应商数据模型实现（Anthropic / OpenAI）
 * 切换供应商时高亮当前激活的实现，并展示各自的 wire 格式细节。
 * @author fxbin
 */

/** 供应商数据模型描述 */
interface ProviderModel {
  id: string;
  name: string;
  endpoint: string;
  auth: string;
  sdk: string;
  dataModel: string;
  toolCall: string;
  toolResult: string;
  stopReason: string;
  streaming: string;
}

/** pi 两个核心供应商实现（非完整列表，仅作示意） */
const PROVIDERS: ProviderModel[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    endpoint: "/v1/messages",
    auth: "x-api-key",
    sdk: "@anthropic-ai/sdk",
    dataModel: "content 块数组 + tool_use 块 + input 对象",
    toolCall: "content[].tool_use",
    toolResult: "user 消息里的 tool_result 块",
    stopReason: "stop_reason: tool_use",
    streaming: "SSE message_start / content_block_delta",
  },
  {
    id: "openai",
    name: "OpenAI",
    endpoint: "/v1/chat/completions",
    auth: "Authorization: Bearer",
    sdk: "openai",
    dataModel: "content 字符串 + tool_calls 数组 + arguments JSON 字符串",
    toolCall: "tool_calls[]",
    toolResult: "独立 role: tool 消息 + tool_call_id",
    stopReason: "finish_reason: tool_calls",
    streaming: "SSE choices[].delta",
  },
];

/**
 * ProviderDiagram 组件。
 * 渲染三层：主循环 → AgentMessage 抽象层 → 两个并列的供应商实现。
 */
export default function ProviderDiagram() {
  const [active, setActive] = useState<string>("anthropic");
  const current = PROVIDERS.find((p) => p.id === active)!;

  return (
    <div className="pd-root diagram">
      <div className="pd-header">
        <span className="pd-title">PROVIDER · 三层结构</span>
        <div className="pd-controls">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              className={active === p.id ? "active" : ""}
              onClick={() => setActive(p.id)}
              type="button"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="pd-stage">
        {/* 第 1 层：主循环 */}
        <div className="pd-layer pd-layer-loop">
          <div className="pd-layer-label">第 1 层 · 主循环</div>
          <div className="pd-box loop">
            <div className="pd-box-title">agentLoop</div>
            <code className="pd-box-code">provider.complete(messages, system, tools)</code>
          </div>
        </div>

        <div className="pd-arrow-down">
          <div className="pd-arrow-line" />
          <div className="pd-arrow-tip">▼</div>
          <div className="pd-arrow-label">只跟内部模型打交道</div>
        </div>

        {/* 第 2 层：AgentMessage 中间抽象层 */}
        <div className="pd-layer pd-layer-middle">
          <div className="pd-layer-label">
            第 2 层 · AgentMessage 抽象层
            <span className="pd-layer-tag">pi 真实存在</span>
          </div>
          <div className="pd-box middle">
            <div className="pd-box-title">AgentMessage（内部模型）</div>
            <ul className="pd-feature-list">
              <li>toolCall / toolResult 是独立 role</li>
              <li>不偏向任何供应商</li>
              <li>主循环、工具执行、消息历史全部只跟这套打交道</li>
            </ul>
          </div>
          <div className="pd-simplification-note">
            <span className="pd-note-tag">mini-pi 简化</span>
            <span className="pd-note-text">选 Anthropic 形状当内部模型，省掉这层抽象</span>
          </div>
        </div>

        <div className="pd-arrow-down">
          <div className="pd-arrow-line" />
          <div className="pd-arrow-tip">▼</div>
          <div className="pd-arrow-label">边界翻译（transform-messages）</div>
        </div>

        {/* 第 3 层：两个并列的供应商实现 */}
        <div className="pd-layer pd-layer-providers">
          <div className="pd-layer-label">第 3 层 · 两个平等的供应商数据模型</div>
          <div className="pd-providers-row">
            {PROVIDERS.map((p) => {
              const isActive = p.id === active;
              return (
                <div
                  key={p.id}
                  className={`pd-box provider ${isActive ? "provider-active" : ""}`}
                >
                  <div className="pd-box-title">{p.name}Provider</div>
                  <div className="pd-provider-name">{p.name}</div>
                  <ul className="pd-wire-list">
                    <li><strong>SDK</strong> {p.sdk}</li>
                    <li><strong>端点</strong> {p.endpoint}</li>
                    <li><strong>认证</strong> {p.auth}</li>
                    <li><strong>数据模型</strong> {p.dataModel}</li>
                    <li><strong>工具调用</strong> {p.toolCall}</li>
                    <li><strong>工具结果</strong> {p.toolResult}</li>
                    <li><strong>停止信号</strong> {p.stopReason}</li>
                    <li><strong>流式协议</strong> {p.streaming}</li>
                  </ul>
                </div>
              );
            })}
          </div>
          <div className="pd-providers-note">
            两套是各自完整的独立实现，不是"A 模型翻译成 B 模型"。
            当前激活：<span className="pd-current-name">{current.name}</span>
          </div>
        </div>
      </div>

      <div className="pd-footer">
        pi 在 packages/agent/src/types.ts 定义 AgentMessage；每个 Provider 在 packages/ai/src/providers/ 下有独立文件。
      </div>
    </div>
  );
}
