import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import "./AgentExecutionDiagram.css";

/**
 * pi Agent 执行流程动态图（v4）。
 *
 * v3 → v4 升级（基于圆桌 003 设计决策清单 v2 + 研究 002 pi 真实性修正）：
 *   1. ns-1: 修复 frame:100 bug + PLAY/STEP 双轨节奏（PLAY 跳 step 末帧，STEP 逐帧）
 *   2. ns-2: streaming 动态感（打字机 steps(8) + block appear + msg saved + flash-in + 3 包错峰接力 + activePackets）
 *   3. ns-3: 交互补全（节点 click JUMP + 接缝面板展开 + compacted 标记 + msg-7 compactionSummary + phase 指示器）
 *   4. ns-4: 响应式 + 可访问性（SVG 垂直 path + details 折叠 + prefers-reduced-motion 12 项 + ARIA）
 *   5. ns-5: pi 真实性标注（事件流追加 [pi 真实] 行 + phase 真实类型名）
 *
 * 帧索引规则（扁平）：FRAME_MAP[n] = { stepIdx, subframeIdx }，n 从 1 开始
 *   - frame = 0：初始态（未开始）
 *   - frame = 1..N：第 frame 帧（对应 FRAME_MAP[frame-1]）
 *   - frame > N：超出范围
 *
 * @author fxbin
 */

/* ===================================================================
 * 常量定义（禁止魔法值，全部提取到此）
 * =================================================================== */

/** PLAY 模式每步间隔（毫秒，跳 step 末帧） */
const PLAY_INTERVAL = 3500;

/** STEP 模式每子帧间隔（毫秒，逐帧） */
const STEP_INTERVAL = 1200;

/** 速度倍率表 */
const SPEED_MULTIPLIERS: Array<0.5 | 1 | 1.5 | 2> = [0.5, 1, 1.5, 2];

/** text 块长度阈值：超过则用整块淡入，否则用打字机 */
const TEXT_LONG_THRESHOLD = 40;

/** 数据包错峰接力 delay（秒），3 包错峰 */
const PACKET_RELAY_DELAYS = [0, 0.4, 0.8];

/** 数据包单程动画时长（秒） */
const PACKET_DURATION = 1.4;

/** JUMP 距离阈值：≤3 步用慢速，>3 步用快速 + blur */
const JUMP_FAR_THRESHOLD = 3;

/** JUMP 慢速间隔（毫秒，≤3 步） */
const JUMP_INTERVAL_NEAR = 300;

/** JUMP 快速间隔（毫秒，>3 步） */
const JUMP_INTERVAL_FAR = 150;

/** 接缝面板宽度（像素） */
const SEAM_PANEL_WIDTH = 240;

/** overflow 提示条显示时长（毫秒） */
const OVERFLOW_TOAST_MS = 600;

/** pi 真实性标注事件流前缀 */
const PI_REALITY_PREFIX = "> [pi 真实]";

/* ===================================================================
 * 数据类型定义
 * =================================================================== */

/** content block 类型 */
type BlockType = "text" | "tool_use" | "tool_result" | "thinking";

/** 单个 content block */
interface Block {
  type: BlockType;
  content: string;
}

/** 消息条目：角色 + blocks + 流式/保存/compacted 状态 */
interface MsgEntry {
  id: string;
  role: "user" | "assistant" | "toolResult";
  blocks: Block[];
  /** 是否正在流式更新（in-place 填充中） */
  streaming?: boolean;
  /** 是否已保存到 session */
  saved?: boolean;
  /** save 序号（每条独立编号，体现「每条 message_end 都 save」） */
  saveNum?: number;
  /** 是否被 overflow 压缩删除（保留视觉痕迹，不真的 filter） */
  compacted?: boolean;
}

/** 事件流类型 */
type EventType = "stream" | "tool" | "session" | "hook" | "queue" | "error" | "reality";

/** 事件流条目 */
interface EventEntry {
  type: EventType;
  content: string;
}

/** 退出分支类型 */
type ExitBranch = "end" | "aborted" | "overflow";

/** 数据包流动方向 */
interface Packet {
  from: string;
  to: string;
  kind: "tool_use" | "tool_result" | "response";
}

/** 步内子帧定义 */
interface Subframe {
  /** 子帧标签（如 "push 占位"、"流式填充 text"） */
  label: string;
  /** 高亮的节点 id */
  activeNode: string;
  /** 消息操作：新增 / in-place 更新 / 标记已保存 */
  msgOp?: {
    id: string;
    role: "user" | "assistant" | "toolResult";
    blocks: Block[];
    /** append = 新增条目，update = in-place 更新（pi 真实行为） */
    mode: "append" | "update";
    /** 是否触发 session.save */
    save: boolean;
    /** 是否处于流式状态 */
    streaming?: boolean;
  };
  /** 新增的事件列表 */
  newEvents?: EventEntry[];
  /** 数据包流动 */
  packets?: Packet[];
  /** 标记某条消息被 overflow 删除（不真的 filter，保留视觉痕迹） */
  msgDelete?: string;
  /** 标记此帧 blocks 数量增加（STEP 模式触发 aed-block-appear） */
  blockAppear?: boolean;
}

/** 主步骤定义 */
interface ExecStep {
  /** 阶段标签 */
  phase: string;
  /** pi 真实 phase 类型（idle/turn/compaction/branch_summary） */
  piPhase?: "idle" | "turn" | "compaction" | "branch_summary";
  /** 循环次数（0 = 未进入循环） */
  loopCount: number;
  /** content 里 tool_use 块数量 */
  toolUseCount: number;
  /** 步内子帧序列 */
  subframes: Subframe[];
}

/* ===================================================================
 * 10 步主序列 + 25 子帧
 *
 * 扁平帧映射：FRAME_MAP[n] = { stepIdx, subframeIdx }，n 从 1 开始
 * =================================================================== */

const STEPS: ExecStep[] = [
  {
    phase: "用户输入",
    piPhase: "turn",
    loopCount: 0,
    toolUseCount: 0,
    subframes: [
      {
        label: "push user 消息",
        activeNode: "user",
        msgOp: {
          id: "msg-1",
          role: "user",
          blocks: [{ type: "text", content: "写个 hello.ts 并编译" }],
          mode: "append",
          save: false,
        },
        newEvents: [
          { type: "stream", content: "> user input received" },
          { type: "reality", content: `${PI_REALITY_PREFIX} streamingBehavior 检查：isStreaming=false → 走 executeTurn 正常路径` },
        ],
        packets: [{ from: "user", to: "tui", kind: "response" }],
      },
      {
        label: "message_end → save #1",
        activeNode: "agentSession",
        msgOp: {
          id: "msg-1",
          role: "user",
          blocks: [{ type: "text", content: "写个 hello.ts 并编译" }],
          mode: "update",
          save: true,
        },
        newEvents: [
          { type: "session", content: "> message_end → save #1" },
          { type: "reality", content: `${PI_REALITY_PREFIX} user 消息 message_start 时重置 _overflowRecoveryAttempted=false` },
        ],
        packets: [{ from: "tui", to: "agentSession", kind: "response" }],
      },
    ],
  },
  {
    phase: "第 1 轮 LLM 调用",
    piPhase: "turn",
    loopCount: 1,
    toolUseCount: 1,
    subframes: [
      {
        label: "push 占位（streaming=true）",
        activeNode: "llm",
        msgOp: {
          id: "msg-2",
          role: "assistant",
          blocks: [],
          mode: "append",
          save: false,
          streaming: true,
        },
        newEvents: [
          { type: "hook", content: "> convertToLlm (S08): 7 internal → 3 LLM roles" },
          { type: "stream", content: "> push placeholder assistant (streaming...)" },
          { type: "reality", content: `${PI_REALITY_PREFIX} transformContext (context hook) 可选前置，默认无操作` },
        ],
        packets: [{ from: "agentSession", to: "llm", kind: "response" }],
      },
      {
        label: "in-place 更新: text 填充",
        activeNode: "llm",
        msgOp: {
          id: "msg-2",
          role: "assistant",
          blocks: [{ type: "text", content: "我先创建文件" }],
          mode: "update",
          save: false,
          streaming: true,
        },
        newEvents: [{ type: "stream", content: "> message_delta: text 填充中" }],
      },
      {
        label: "in-place 更新: + tool_use",
        activeNode: "llm",
        msgOp: {
          id: "msg-2",
          role: "assistant",
          blocks: [
            { type: "text", content: "我先创建文件" },
            { type: "tool_use", content: 'write("hello.ts", "console.log(1)")' },
          ],
          mode: "update",
          save: false,
          streaming: true,
        },
        newEvents: [{ type: "stream", content: "> message_delta: + tool_use(write)" }],
      },
      {
        label: "message_end → save #2",
        activeNode: "llm",
        msgOp: {
          id: "msg-2",
          role: "assistant",
          blocks: [
            { type: "text", content: "我先创建文件" },
            { type: "tool_use", content: 'write("hello.ts", "console.log(1)")' },
          ],
          mode: "update",
          save: true,
          streaming: false,
        },
        newEvents: [
          { type: "session", content: "> message_end → save #2" },
          { type: "reality", content: `${PI_REALITY_PREFIX} tool_use 包流动时机：assistant 消息完整后才执行工具（不是 streaming 中途）` },
        ],
        packets: [
          { from: "llm", to: "tool", kind: "tool_use" },
          { from: "agentSession", to: "llm", kind: "response" },
        ],
      },
    ],
  },
  {
    phase: "执行 write 工具",
    piPhase: "turn",
    loopCount: 1,
    toolUseCount: 1,
    subframes: [
      {
        label: "beforeToolCall 钩子",
        activeNode: "tool",
        newEvents: [{ type: "hook", content: "> beforeToolCall (S10) → pass" }],
      },
      {
        label: "execute: write(hello.ts)",
        activeNode: "tool",
        msgOp: {
          id: "msg-3",
          role: "toolResult",
          blocks: [{ type: "tool_result", content: "wrote 18 bytes" }],
          mode: "append",
          save: false,
        },
        newEvents: [{ type: "tool", content: "> execute: write(hello.ts)" }],
      },
      {
        label: "afterToolCall + save #3",
        activeNode: "tool",
        msgOp: {
          id: "msg-3",
          role: "toolResult",
          blocks: [{ type: "tool_result", content: "wrote 18 bytes" }],
          mode: "update",
          save: true,
        },
        newEvents: [
          { type: "hook", content: "> afterToolCall (S10) → pass" },
          { type: "session", content: "> message_end → save #3" },
        ],
        packets: [{ from: "tool", to: "llm", kind: "tool_result" }],
      },
    ],
  },
  {
    phase: "prepareNextTurn 钩子",
    piPhase: "turn",
    loopCount: 1,
    toolUseCount: 1,
    subframes: [
      {
        label: "flush pending writes + rebuild context",
        activeNode: "prepare",
        newEvents: [
          { type: "hook", content: "> prepareNextTurn (S11): flush + createTurnState" },
          { type: "hook", content: "> model unchanged (无排队 setModel)" },
          { type: "reality", content: `${PI_REALITY_PREFIX} inner loop 末尾 drain steering 队列（getSteeringMessages）` },
        ],
      },
    ],
  },
  {
    phase: "第 2 轮 LLM 调用",
    piPhase: "turn",
    loopCount: 2,
    toolUseCount: 1,
    subframes: [
      {
        label: "push 占位（streaming=true）",
        activeNode: "llm",
        msgOp: {
          id: "msg-4",
          role: "assistant",
          blocks: [],
          mode: "append",
          save: false,
          streaming: true,
        },
        newEvents: [
          { type: "hook", content: "> convertToLlm (S08): 7 internal → 3 LLM roles" },
          { type: "stream", content: "> push placeholder (streaming...)" },
        ],
        packets: [{ from: "agentSession", to: "llm", kind: "response" }],
      },
      {
        label: "in-place 更新: text 填充",
        activeNode: "llm",
        msgOp: {
          id: "msg-4",
          role: "assistant",
          blocks: [{ type: "text", content: "文件已创建，现在编译" }],
          mode: "update",
          save: false,
          streaming: true,
        },
        newEvents: [{ type: "stream", content: "> message_delta: text 填充中" }],
      },
      {
        label: "in-place 更新: + tool_use",
        activeNode: "llm",
        msgOp: {
          id: "msg-4",
          role: "assistant",
          blocks: [
            { type: "text", content: "文件已创建，现在编译" },
            { type: "tool_use", content: 'bash("tsc hello.ts")' },
          ],
          mode: "update",
          save: false,
          streaming: true,
        },
        newEvents: [{ type: "stream", content: "> message_delta: + tool_use(bash)" }],
      },
      {
        label: "message_end → save #4",
        activeNode: "llm",
        msgOp: {
          id: "msg-4",
          role: "assistant",
          blocks: [
            { type: "text", content: "文件已创建，现在编译" },
            { type: "tool_use", content: 'bash("tsc hello.ts")' },
          ],
          mode: "update",
          save: true,
          streaming: false,
        },
        newEvents: [
          { type: "session", content: "> message_end → save #4" },
          { type: "reality", content: `${PI_REALITY_PREFIX} tool_use 包流动时机：assistant 消息完整后才执行工具` },
        ],
        packets: [{ from: "llm", to: "tool", kind: "tool_use" }],
      },
    ],
  },
  {
    phase: "执行 bash 工具",
    piPhase: "turn",
    loopCount: 2,
    toolUseCount: 1,
    subframes: [
      {
        label: "beforeToolCall 钩子",
        activeNode: "tool",
        newEvents: [{ type: "hook", content: "> beforeToolCall (S10) → pass" }],
      },
      {
        label: "execute: bash(tsc hello.ts)",
        activeNode: "tool",
        msgOp: {
          id: "msg-5",
          role: "toolResult",
          blocks: [{ type: "tool_result", content: "exit 0, no output" }],
          mode: "append",
          save: false,
        },
        newEvents: [{ type: "tool", content: "> execute: bash(tsc hello.ts)" }],
      },
      {
        label: "afterToolCall + save #5",
        activeNode: "tool",
        msgOp: {
          id: "msg-5",
          role: "toolResult",
          blocks: [{ type: "tool_result", content: "exit 0, no output" }],
          mode: "update",
          save: true,
        },
        newEvents: [
          { type: "hook", content: "> afterToolCall (S10) → pass" },
          { type: "session", content: "> message_end → save #5" },
        ],
        packets: [{ from: "tool", to: "llm", kind: "tool_result" }],
      },
    ],
  },
  {
    phase: "prepareNextTurn 钩子",
    piPhase: "turn",
    loopCount: 2,
    toolUseCount: 1,
    subframes: [
      {
        label: "flush pending writes + rebuild context",
        activeNode: "prepare",
        newEvents: [
          { type: "hook", content: "> prepareNextTurn (S11): flush + createTurnState" },
          { type: "hook", content: "> model unchanged" },
          { type: "reality", content: `${PI_REALITY_PREFIX} inner loop 末尾 drain steering 队列` },
        ],
      },
    ],
  },
  {
    phase: "第 3 轮 LLM 调用",
    piPhase: "turn",
    loopCount: 3,
    toolUseCount: 0,
    subframes: [
      {
        label: "push 占位（streaming=true）",
        activeNode: "llm",
        msgOp: {
          id: "msg-6",
          role: "assistant",
          blocks: [],
          mode: "append",
          save: false,
          streaming: true,
        },
        newEvents: [
          { type: "hook", content: "> convertToLlm (S08): 7 internal → 3 LLM roles" },
          { type: "stream", content: "> push placeholder (streaming...)" },
        ],
        packets: [{ from: "agentSession", to: "llm", kind: "response" }],
      },
      {
        label: "in-place 更新: text only（无 tool_use）",
        activeNode: "llm",
        msgOp: {
          id: "msg-6",
          role: "assistant",
          blocks: [{ type: "text", content: "已创建 hello.ts 并通过编译。" }],
          mode: "update",
          save: false,
          streaming: true,
        },
        newEvents: [{ type: "stream", content: "> message_delta: text only（无 tool_use）" }],
      },
      {
        label: "message_end → save #6",
        activeNode: "llm",
        msgOp: {
          id: "msg-6",
          role: "assistant",
          blocks: [{ type: "text", content: "已创建 hello.ts 并通过编译。" }],
          mode: "update",
          save: true,
          streaming: false,
        },
        newEvents: [
          { type: "session", content: "> message_end → save #6" },
          { type: "reality", content: `${PI_REALITY_PREFIX} 成功 assistant 响应 message_end 时重置 _overflowRecoveryAttempted=false` },
        ],
      },
    ],
  },
  {
    phase: "退出判断",
    piPhase: "turn",
    loopCount: 3,
    toolUseCount: 0,
    subframes: [
      {
        label: "检查 content.tool_use.length",
        activeNode: "exit",
        newEvents: [
          { type: "stream", content: "> content.tool_use.length = 0" },
          { type: "stream", content: "> 内层 while 退出 → 外层 followUp 为空 → break" },
          { type: "reality", content: `${PI_REALITY_PREFIX} outer loop 末尾 drain followUp 队列（getFollowUpMessages）` },
        ],
      },
      {
        label: "emit agent_end",
        activeNode: "exit",
        newEvents: [
          { type: "stream", content: "> emit agent_end（看 content，不看 stop_reason）" },
          { type: "reality", content: `${PI_REALITY_PREFIX} agent_end 事件回调置 phase=idle（非 executeTurn finally）` },
        ],
      },
    ],
  },
  {
    phase: "返回用户",
    piPhase: "idle",
    loopCount: 0,
    toolUseCount: 0,
    subframes: [
      {
        label: "_handlePostAgentRun 检查",
        activeNode: "agentSession",
        newEvents: [
          { type: "session", content: "> _handlePostAgentRun: 无 overflow / 无 retry" },
          { type: "session", content: "> all 6 messages persisted" },
        ],
      },
      {
        label: "return to TUI",
        activeNode: "output",
        newEvents: [{ type: "stream", content: "> return to TUI" }],
        packets: [{ from: "agentSession", to: "output", kind: "response" }],
      },
    ],
  },
];

/** overflow 分支的替代步骤（替换第 8-10 步） */
const STEPS_OVERFLOW: ExecStep[] = [
  {
    phase: "第 3 轮 LLM 调用（overflow 触发）",
    piPhase: "turn",
    loopCount: 3,
    toolUseCount: 0,
    subframes: [
      {
        label: "push 占位（streaming=true）",
        activeNode: "llm",
        msgOp: {
          id: "msg-6",
          role: "assistant",
          blocks: [],
          mode: "append",
          save: false,
          streaming: true,
        },
        newEvents: [{ type: "stream", content: "> push placeholder (streaming...)" }],
        packets: [{ from: "agentSession", to: "llm", kind: "response" }],
      },
      {
        label: "stream 抛出 overflow 错误",
        activeNode: "llm",
        msgOp: {
          id: "msg-6",
          role: "assistant",
          blocks: [{ type: "text", content: "[stream error: context overflow]" }],
          mode: "update",
          save: true,
          streaming: false,
        },
        newEvents: [
          { type: "error", content: "> stopReason=\"error\" + errorMessage matches overflow" },
          { type: "session", content: "> message_end → save #6 (partial)" },
          { type: "reality", content: `${PI_REALITY_PREFIX} handleRunFailure 模拟四事件：message_start + message_end + turn_end + agent_end` },
        ],
      },
      {
        label: "_handlePostAgentRun 检测 overflow",
        activeNode: "agentSession",
        newEvents: [
          { type: "error", content: "> isContextOverflow(error) → true" },
          { type: "reality", content: `${PI_REALITY_PREFIX} _overflowRecoveryAttempted 当前为 false → 允许重试一次` },
        ],
      },
    ],
  },
  {
    phase: "overflow 恢复（compaction）",
    piPhase: "compaction",
    loopCount: 3,
    toolUseCount: 0,
    subframes: [
      {
        label: "删除最后一条 assistant",
        activeNode: "agentSession",
        msgDelete: "msg-6",
        newEvents: [
          { type: "session", content: "> delete msg-6 (overflow 触发，删 partial assistant)" },
          { type: "hook", content: "> AgentHarness.compact() 进入 compaction phase" },
        ],
      },
      {
        label: "compact + agent.continue()",
        activeNode: "agentSession",
        msgOp: {
          id: "msg-7",
          role: "assistant",
          blocks: [{ type: "text", content: "[compacted: 3 messages → 1 summary]" }],
          mode: "append",
          save: true,
        },
        newEvents: [
          { type: "session", content: "> compactionSummary 追加 → context 缩减" },
          { type: "stream", content: "> agent.continue() 续跑（不 push 新 prompt）" },
          { type: "hook", content: "> _overflowRecoveryAttempted = true（一次性保险丝）" },
          { type: "reality", content: `${PI_REALITY_PREFIX} 保险丝重置时机：新 user 消息 / 成功 assistant 响应（不是 setModel）` },
        ],
        packets: [{ from: "agentSession", to: "llm", kind: "response" }],
      },
    ],
  },
  {
    phase: "返回用户（overflow 恢复后）",
    piPhase: "idle",
    loopCount: 0,
    toolUseCount: 0,
    subframes: [
      {
        label: "重跑成功 → agent_end",
        activeNode: "output",
        newEvents: [
          { type: "session", content: "> retry 成功 → agent_end" },
          { type: "stream", content: "> return to TUI" },
        ],
        packets: [{ from: "agentSession", to: "output", kind: "response" }],
      },
    ],
  },
];

/** aborted 分支的替代步骤（替换第 8-10 步） */
const STEPS_ABORTED: ExecStep[] = [
  {
    phase: "第 3 轮 LLM 调用（aborted）",
    piPhase: "turn",
    loopCount: 3,
    toolUseCount: 0,
    subframes: [
      {
        label: "push 占位（streaming=true）",
        activeNode: "llm",
        msgOp: {
          id: "msg-6",
          role: "assistant",
          blocks: [],
          mode: "append",
          save: false,
          streaming: true,
        },
        newEvents: [{ type: "stream", content: "> push placeholder (streaming...)" }],
        packets: [{ from: "agentSession", to: "llm", kind: "response" }],
      },
      {
        label: "用户按 Ctrl+C 中断",
        activeNode: "llm",
        msgOp: {
          id: "msg-6",
          role: "assistant",
          blocks: [{ type: "text", content: "[aborted]" }],
          mode: "update",
          save: true,
          streaming: false,
        },
        newEvents: [
          { type: "error", content: "> stopReason=\"aborted\" (Ctrl+C)" },
          { type: "session", content: "> message_end → save #6 (partial, stopReason=aborted)" },
          { type: "reality", content: `${PI_REALITY_PREFIX} aborted 不触发 retry（_isRetryableError 检查 stopReason !== "error"）` },
        ],
      },
      {
        label: "emit turn_end + agent_end",
        activeNode: "exit",
        newEvents: [
          { type: "stream", content: "> emit turn_end (aborted)" },
          { type: "stream", content: "> emit agent_end" },
        ],
      },
    ],
  },
  {
    phase: "返回用户（aborted）",
    piPhase: "idle",
    loopCount: 0,
    toolUseCount: 0,
    subframes: [
      {
        label: "return to TUI",
        activeNode: "output",
        newEvents: [{ type: "stream", content: "> return to TUI (aborted)" }],
        packets: [{ from: "agentSession", to: "output", kind: "response" }],
      },
    ],
  },
];

/** 事件类型颜色映射（CSS 变量，支持主题切换） */
const EVENT_COLORS: Record<EventType, string> = {
  stream: "var(--text-dim)",
  tool: "var(--orange)",
  session: "var(--green)",
  hook: "var(--purple)",
  queue: "var(--yellow)",
  error: "var(--red)",
  reality: "var(--purple)",
};

/** 事件类型标签 */
const EVENT_LABELS: Record<EventType, string> = {
  stream: "STREAM",
  tool: "TOOL",
  session: "SESSION",
  hook: "HOOK",
  queue: "QUEUE",
  error: "ERROR",
  reality: "PI·REAL",
};

/** 节点定义（含章节锚点 + 接缝标签元数据） */
interface NodeDef {
  id: string;
  label: string;
  /** 主章节号 */
  chapter?: string;
  /** tooltip 副章节 */
  subChapters?: string[];
  /** 接缝标签（convertToLlm / prepareNextTurn 等） */
  seam?: string;
  /** 接缝标识符（用于展开面板） */
  seamKey?: "convertToLlm" | "beforeAfter";
  /** 是否为 hook 节点（视觉区分） */
  isHook?: boolean;
}

/** 节点列表（按拓扑顺序） */
const NODES: NodeDef[] = [
  { id: "user", label: "用户" },
  { id: "tui", label: "TUI", chapter: "s09_tui" },
  { id: "agentSession", label: "AgentSession", chapter: "s11_agent_session" },
  {
    id: "llm",
    label: "LLM",
    chapter: "s01_agent_loop",
    subChapters: ["s08_provider", "s12_streaming"],
    seam: "convertToLlm · S08",
    seamKey: "convertToLlm",
  },
  {
    id: "tool",
    label: "Tools",
    chapter: "s02_tools",
    subChapters: ["s10_extensions"],
    seam: "before/after · S10",
    seamKey: "beforeAfter",
  },
  {
    id: "prepare",
    label: "prepareNextTurn",
    chapter: "s11_agent_session",
    isHook: true,
  },
  { id: "exit", label: "退出判断", chapter: "s01_agent_loop", subChapters: ["s11_agent_session"] },
  { id: "output", label: "输出", chapter: "s09_tui" },
];

/** 接缝面板内容（三行结构：说明 + 锚点 + 触发时机） */
const SEAM_PANELS: Record<"convertToLlm" | "beforeAfter", {
  desc: string;
  anchor: string;
  timing: string;
}> = {
  convertToLlm: {
    desc: "AgentMessage 7 roles → LLM 3 roles 边界转换",
    anchor: "s08_provider",
    timing: "LLM 调用前，streamAssistantResponse 内",
  },
  beforeAfter: {
    desc: "工具执行前后的 extension hook 拦截点",
    anchor: "s10_extensions",
    timing: "每次 tool_use 执行前后",
  },
};

/* ===================================================================
 * deriveState(frame, exitBranch, mode) 纯函数
 *
 * 输入帧索引 + 模式，返回当前快照：messages / events / activeNode / packets 等。
 * 幂等：同一 frame + mode 返回同一快照，不累积状态。
 *
 * mode 参数（ns-1）：
 *   - 'play'：events 只取每步末帧的 newEvents（避免 PLAY 跳末帧时事件流跳变）
 *   - 'step'：events 取所有子帧的 newEvents（逐帧显现）
 *   messages 两种模式都累积全部（消息是状态不是事件）
 * =================================================================== */

interface FrameSnapshot {
  stepIdx: number;
  subframeIdx: number;
  phase: string;
  piPhase?: "idle" | "turn" | "compaction" | "branch_summary";
  subframeLabel: string;
  activeNode: string;
  loopCount: number;
  toolUseCount: number;
  messages: MsgEntry[];
  events: EventEntry[];
  packets: Packet[];
  saveCount: number;
  /** 当前子帧是否触发 block appear 动画（STEP 模式新增 block） */
  blockAppear: boolean;
  /** 当前子帧的 msgOp（用于判断 save 闪烁） */
  currentMsgOp?: Subframe["msgOp"] & { id: string };
  /** 当前子帧是否触发 msgDelete */
  currentMsgDelete?: string;
}

/** 根据退出分支选择对应的步骤序列 */
function getSteps(exitBranch: ExitBranch): ExecStep[] {
  if (exitBranch === "overflow") {
    return [...STEPS.slice(0, 7), ...STEPS_OVERFLOW];
  }
  if (exitBranch === "aborted") {
    return [...STEPS.slice(0, 7), ...STEPS_ABORTED];
  }
  return STEPS;
}

/** 扁平帧映射条目 */
interface FrameIdx {
  stepIdx: number;
  subframeIdx: number;
}

/** 构建扁平帧映射表：FRAME_MAP[n] = { stepIdx, subframeIdx }，n 从 0 开始 */
function buildFrameMap(steps: ExecStep[]): FrameIdx[] {
  const map: FrameIdx[] = [];
  steps.forEach((step, i) => {
    step.subframes.forEach((_, j) => {
      map.push({ stepIdx: i, subframeIdx: j });
    });
  });
  return map;
}

/** 预计算每个 step 的最后一帧索引（1-based，ns-1 PLAY TICK 跳末帧用） */
function buildStepLastFrame(steps: ExecStep[]): number[] {
  const result: number[] = [];
  let acc = 0;
  steps.forEach((step) => {
    acc += step.subframes.length;
    result.push(acc);
  });
  return result;
}

/** 获取当前激活的步骤序列的总帧数 */
function getTotalFrames(steps: ExecStep[]): number {
  return buildFrameMap(steps).length;
}

/** 派生当前帧的完整快照。
 *
 * 帧索引规则（扁平）：
 *   - frame = 0：初始态（未开始），返回 null
 *   - frame = 1..N：第 frame 帧（对应 FRAME_MAP[frame-1]）
 *   - frame > N：超出范围，返回 null
 *
 * mode 参数控制 events 累积策略（ns-1）：
 *   - 'play'：只取每步末帧 newEvents
 *   - 'step'：取所有子帧 newEvents
 */
function deriveState(
  frame: number,
  exitBranch: ExitBranch,
  mode: "play" | "step",
): FrameSnapshot | null {
  const steps = getSteps(exitBranch);
  const frameMap = buildFrameMap(steps);
  if (frame === 0 || frame > frameMap.length) return null;

  const { stepIdx, subframeIdx } = frameMap[frame - 1];

  /** 重放所有子帧到当前位置，得到累积的 messages/events */
  const messages: MsgEntry[] = [];
  const events: EventEntry[] = [];
  let saveCount = 0;

  /** activePackets 持续语义（ns-2）：packets 激活后持续到该 step 结束 */
  const stepPackets: Packet[] = [];

  /** 当前子帧元信息 */
  let blockAppear = false;
  let currentMsgOp: Subframe["msgOp"] | undefined;
  let currentMsgDelete: string | undefined;

  for (let i = 0; i <= stepIdx; i++) {
    const curStep = steps[i];
    const curSubframes = curStep.subframes;
    const endSub = i === stepIdx ? subframeIdx : curSubframes.length - 1;
    const stepEntered = i === stepIdx;

    /** 新 step 开始时清空 stepPackets（ns-2 activePackets 跨 step 不持续） */
    if (i !== 0 || stepEntered) {
      stepPackets.length = 0;
    }

    for (let j = 0; j <= endSub; j++) {
      const sf = curSubframes[j];
      const isLastSubInStep = j === curSubframes.length - 1;

      if (sf.msgDelete) {
        const idx = messages.findIndex((m) => m.id === sf.msgDelete);
        if (idx >= 0) {
          messages[idx] = { ...messages[idx], compacted: true };
        }
        if (stepEntered && j === subframeIdx) {
          currentMsgDelete = sf.msgDelete;
        }
      }

      if (sf.msgOp) {
        const op = sf.msgOp;
        if (op.mode === "update") {
          const idx = messages.findIndex((m) => m.id === op.id);
          if (idx >= 0) {
            messages[idx] = {
              ...messages[idx],
              blocks: op.blocks,
              streaming: op.streaming,
              saved: op.save,
              saveNum: op.save ? ++saveCount : messages[idx].saveNum,
            };
          } else {
            messages.push({
              id: op.id,
              role: op.role,
              blocks: op.blocks,
              streaming: op.streaming,
              saved: op.save,
              saveNum: op.save ? ++saveCount : undefined,
            });
          }
        } else {
          messages.push({
            id: op.id,
            role: op.role,
            blocks: op.blocks,
            streaming: op.streaming,
            saved: op.save,
            saveNum: op.save ? ++saveCount : undefined,
          });
        }
      }

      /** events 累积策略（ns-1）：
       *  - play 模式：只取每步末帧 newEvents
       *  - step 模式：取所有子帧 newEvents
       */
      if (sf.newEvents) {
        if (mode === "play") {
          if (isLastSubInStep) {
            events.push(...sf.newEvents);
          }
        } else {
          events.push(...sf.newEvents);
        }
      }

      /** packets 持续语义（ns-2）：激活后持续到 step 结束 */
      if (sf.packets) {
        stepPackets.length = 0;
        stepPackets.push(...sf.packets);
      }

      /** 记录当前子帧元信息 */
      if (stepEntered && j === subframeIdx) {
        blockAppear = sf.blockAppear ?? false;
        currentMsgOp = sf.msgOp;
      }
    }
  }

  const step = steps[stepIdx];
  const currentSubframe = step.subframes[subframeIdx];
  return {
    stepIdx,
    subframeIdx,
    phase: step.phase,
    piPhase: step.piPhase,
    subframeLabel: currentSubframe.label,
    activeNode: currentSubframe.activeNode,
    loopCount: step.loopCount,
    toolUseCount: step.toolUseCount,
    messages,
    events,
    packets: [...stepPackets],
    saveCount,
    blockAppear,
    currentMsgOp: currentMsgOp as FrameSnapshot["currentMsgOp"],
    currentMsgDelete,
  };
}

/* ===================================================================
 * useReducer 状态机（v4）
 *
 * 状态：
 *   - mode: idle/playing/paused/finished/stepping
 *   - playMode: 'result'（PLAY 跳末帧）| 'subframe'（STEP 逐帧）
 *   - frame: 当前帧索引（1-based）
 *   - exitBranch: end/aborted/overflow
 *   - speed: 0.5/1/1.5/2
 *   - isJumping: 节点 click 跳转中标志（ns-3）
 *   - jumpTarget: 跳转目标 stepIdx
 * =================================================================== */

interface DiagramState {
  mode: "idle" | "playing" | "paused" | "finished" | "stepping";
  /** PLAY 模式 = 'result'（跳末帧），STEP 模式 = 'subframe'（逐帧） */
  playMode: "result" | "subframe";
  frame: number;
  exitBranch: ExitBranch;
  speed: 0.5 | 1 | 1.5 | 2;
  /** JUMP 跳转中标志（ns-3，不增状态机态数） */
  isJumping: boolean;
  /** JUMP 目标 stepIdx */
  jumpTarget: number;
}

type DiagramAction =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "STEP" }
  | { type: "RESET" }
  | { type: "REPLAY" }
  | { type: "TICK" }
  | { type: "SET_SPEED" }
  | { type: "SET_BRANCH"; branch: ExitBranch }
  | { type: "JUMP"; targetStep: number }
  | { type: "JUMP_TICK" };

/** 计算速度倍率对应的播放间隔（毫秒） */
function getPlayInterval(speed: number): number {
  return Math.round(PLAY_INTERVAL / speed);
}

/** 计算速度倍率对应的步进间隔（毫秒） */
function getStepInterval(speed: number): number {
  return Math.round(STEP_INTERVAL / speed);
}

function reducer(state: DiagramState, action: DiagramAction): DiagramState {
  const steps = getSteps(state.exitBranch);
  const totalFrames = getTotalFrames(steps);
  const stepLastFrame = buildStepLastFrame(steps);

  /** 根据当前 frame 反推 stepIdx */
  function frameToStepIdx(frame: number): number {
    if (frame <= 0) return -1;
    for (let i = 0; i < stepLastFrame.length; i++) {
      if (frame <= stepLastFrame[i]) return i;
    }
    return stepLastFrame.length - 1;
  }

  switch (action.type) {
    case "PLAY": {
      /** REPLAY：从 frame=1 重新播放（ns-1 修复 frame:100 bug） */
      if (state.mode === "finished") {
        return { ...state, mode: "playing", playMode: "result", frame: 1, isJumping: false };
      }
      /** 从 idle 进入：frame 从 1 开始（ns-1 修复 frame:100 bug） */
      return {
        ...state,
        mode: "playing",
        playMode: "result",
        frame: state.frame === 0 ? 1 : state.frame,
        isJumping: false,
      };
    }
    case "PAUSE": {
      return { ...state, mode: "paused", isJumping: false };
    }
    case "STEP": {
      /** finished 状态下 STEP 禁用（ns-1 避免 frame+1 越界） */
      if (state.mode === "finished") return state;
      const nextFrame = state.frame + 1;
      if (nextFrame > totalFrames) {
        return { ...state, mode: "finished", isJumping: false };
      }
      return { ...state, mode: "stepping", playMode: "subframe", frame: nextFrame, isJumping: false };
    }
    case "RESET": {
      return {
        ...state,
        mode: "idle",
        playMode: "result",
        frame: 0,
        isJumping: false,
        jumpTarget: 0,
      };
    }
    case "REPLAY": {
      /** REPLAY 从 frame=1 开始（ns-1 修复 frame:100 bug） */
      return { ...state, mode: "playing", playMode: "result", frame: 1, isJumping: false };
    }
    case "TICK": {
      /** PLAY 模式（playMode='result'）：跳到下一个 step 的末帧（ns-1） */
      if (state.playMode === "result") {
        const currentStepIdx = frameToStepIdx(state.frame);
        /** 已在最后一步的末帧 → finished */
        if (currentStepIdx >= stepLastFrame.length - 1) {
          return { ...state, mode: "finished", isJumping: false };
        }
        const nextStepLastFrame = stepLastFrame[currentStepIdx + 1];
        if (nextStepLastFrame > totalFrames) {
          return { ...state, mode: "finished", isJumping: false };
        }
        return { ...state, frame: nextStepLastFrame };
      }
      /** STEP 模式（playMode='subframe'）：逐帧推进 */
      const nextFrame = state.frame + 1;
      if (nextFrame > totalFrames) {
        return { ...state, mode: "finished", isJumping: false };
      }
      return { ...state, frame: nextFrame };
    }
    case "SET_SPEED": {
      const curIdx = SPEED_MULTIPLIERS.indexOf(state.speed);
      const nextIdx = (curIdx + 1) % SPEED_MULTIPLIERS.length;
      return { ...state, speed: SPEED_MULTIPLIERS[nextIdx] };
    }
    case "SET_BRANCH": {
      return {
        ...state,
        exitBranch: action.branch,
        mode: "idle",
        playMode: "result",
        frame: 0,
        isJumping: false,
        jumpTarget: 0,
      };
    }
    case "JUMP": {
      /** ns-3 节点 click 语义跳转：设 isJumping=true，记录目标 */
      if (state.isJumping) return state;
      return { ...state, isJumping: true, jumpTarget: action.targetStep };
    }
    case "JUMP_TICK": {
      /** ns-3 JUMP 推进：跳到下一个 step 末帧，到达目标后清除 isJumping */
      if (!state.isJumping) return state;
      const currentStepIdx = frameToStepIdx(state.frame);
      if (currentStepIdx >= state.jumpTarget) {
        return { ...state, isJumping: false };
      }
      const nextStepLastFrame = stepLastFrame[currentStepIdx + 1];
      if (nextStepLastFrame > totalFrames || currentStepIdx + 1 >= stepLastFrame.length) {
        return { ...state, isJumping: false };
      }
      return { ...state, frame: nextStepLastFrame };
    }
    default:
      return state;
  }
}

const initialState: DiagramState = {
  mode: "idle",
  playMode: "result",
  frame: 0,
  exitBranch: "end",
  speed: 1,
  isJumping: false,
  jumpTarget: 0,
};

/* ===================================================================
 * nodeToStep 动态映射（ns-3）
 *
 * 节点 click 跳转目标 step 计算：
 *   - llm → max(stepIdx where activeNode==='llm' and stepIdx <= currentStepIdx)
 *   - tool → max(stepIdx where activeNode==='tool' and stepIdx <= currentStepIdx)
 *   - exit → 第一个 activeNode==='exit' 的 stepIdx
 *   - output → 最后一个 stepIdx
 *   - 其他 → 当前 stepIdx
 * =================================================================== */
function nodeToStep(nodeId: string, currentFrame: number, exitBranch: ExitBranch): number {
  const steps = getSteps(exitBranch);
  const stepLastFrame = buildStepLastFrame(steps);

  /** 反推当前 stepIdx */
  let currentStepIdx = 0;
  for (let i = 0; i < stepLastFrame.length; i++) {
    if (currentFrame <= stepLastFrame[i]) {
      currentStepIdx = i;
      break;
    }
    currentStepIdx = i;
  }

  if (nodeId === "llm") {
    for (let i = currentStepIdx; i >= 0; i--) {
      if (steps[i].subframes.some((sf) => sf.activeNode === "llm")) return i;
    }
    return steps.findIndex((s) => s.subframes.some((sf) => sf.activeNode === "llm"));
  }
  if (nodeId === "tool") {
    for (let i = currentStepIdx; i >= 0; i--) {
      if (steps[i].subframes.some((sf) => sf.activeNode === "tool")) return i;
    }
    return steps.findIndex((s) => s.subframes.some((sf) => sf.activeNode === "tool"));
  }
  if (nodeId === "exit") {
    return steps.findIndex((s) => s.subframes.some((sf) => sf.activeNode === "exit"));
  }
  if (nodeId === "output") {
    return steps.length - 1;
  }
  if (nodeId === "prepare") {
    for (let i = currentStepIdx; i >= 0; i--) {
      if (steps[i].subframes.some((sf) => sf.activeNode === "prepare")) return i;
    }
    return steps.findIndex((s) => s.subframes.some((sf) => sf.activeNode === "prepare"));
  }
  return currentStepIdx;
}

/* ===================================================================
 * React 组件
 * =================================================================== */

export default function AgentExecutionDiagram() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [expandedSeam, setExpandedSeam] = useState<"convertToLlm" | "beforeAfter" | null>(null);
  const [overflowToast, setOverflowToast] = useState(false);
  const eventRef = useRef<HTMLDivElement>(null);
  const jumpLockRef = useRef(false);

  /** PLAY 模式定时器（ns-1 PLAY_INTERVAL） */
  useEffect(() => {
    if (state.mode !== "playing") return;
    if (state.isJumping) return;
    const interval = state.playMode === "result"
      ? getPlayInterval(state.speed)
      : getStepInterval(state.speed);
    const id = setInterval(() => {
      dispatch({ type: "TICK" });
    }, interval);
    return () => clearInterval(id);
  }, [state.mode, state.playMode, state.speed, state.isJumping]);

  /** JUMP 跳转：setTimeout 递归 dispatch JUMP_TICK（ns-3，避免 React 18 批处理） */
  useEffect(() => {
    if (!state.isJumping) {
      jumpLockRef.current = false;
      return;
    }
    if (jumpLockRef.current) return;
    jumpLockRef.current = true;

    const steps = getSteps(state.exitBranch);
    const stepLastFrame = buildStepLastFrame(steps);
    let currentStepIdx = 0;
    for (let i = 0; i < stepLastFrame.length; i++) {
      if (state.frame <= stepLastFrame[i]) {
        currentStepIdx = i;
        break;
      }
      currentStepIdx = i;
    }
    const distance = Math.abs(state.jumpTarget - currentStepIdx);
    const interval = distance > JUMP_FAR_THRESHOLD ? JUMP_INTERVAL_FAR : JUMP_INTERVAL_NEAR;

    const id = setTimeout(() => {
      dispatch({ type: "JUMP_TICK" });
      jumpLockRef.current = false;
    }, interval);
    return () => {
      clearTimeout(id);
      jumpLockRef.current = false;
    };
  }, [state.isJumping, state.frame, state.jumpTarget, state.exitBranch]);

  /** overflow 分支切换时显示提示条（ns-4） */
  useEffect(() => {
    if (state.exitBranch !== "overflow") {
      setOverflowToast(false);
      return;
    }
    setOverflowToast(true);
    const id = setTimeout(() => setOverflowToast(false), OVERFLOW_TOAST_MS);
    return () => clearTimeout(id);
  }, [state.exitBranch]);

  /** 派生当前快照（ns-1 mode 参数：playing 用 play，其他用 step） */
  const deriveMode: "play" | "step" = state.mode === "playing" && state.playMode === "result"
    ? "play"
    : "step";
  const snapshot = useMemo(
    () => deriveState(state.frame, state.exitBranch, deriveMode),
    [state.frame, state.exitBranch, deriveMode],
  );

  /** 事件流自动滚动到底部 */
  useEffect(() => {
    if (eventRef.current) {
      eventRef.current.scrollTop = eventRef.current.scrollHeight;
    }
  }, [snapshot?.events.length]);

  const steps = getSteps(state.exitBranch);
  const totalFrames = getTotalFrames(steps);
  const isFinished = state.mode === "finished";
  const inLoop = (snapshot?.loopCount ?? 0) > 0 && snapshot?.activeNode !== "output";
  const hasToolUse = (snapshot?.toolUseCount ?? 0) > 0;
  const isJumping = state.isJumping;

  /** 节点状态：pending / active / done */
  function nodeState(nodeId: string): "pending" | "active" | "done" {
    if (!snapshot) return "pending";
    if (snapshot.activeNode === nodeId) return "active";
    const order = NODES.map((n) => n.id);
    const currentIdx = order.indexOf(snapshot.activeNode);
    const nodeIdx = order.indexOf(nodeId);
    if (currentIdx === -1 || nodeIdx === -1) return "pending";
    if (nodeIdx < currentIdx) return "done";
    return "pending";
  }

  /** 主步骤进度（用于进度条） */
  const stepProgress = snapshot
    ? Math.min(snapshot.stepIdx + 1, steps.length)
    : 0;

  /** phase 指示器文本与颜色（ns-3 6 态） */
  const phaseInfo = (() => {
    if (isJumping) return { label: "JUMPING", color: "var(--yellow)" };
    switch (state.mode) {
      case "idle": return { label: "IDLE", color: "var(--text-dim)" };
      case "playing": return { label: "PLAYING", color: "var(--orange)" };
      case "paused": return { label: "PAUSED", color: "var(--yellow)" };
      case "stepping": return { label: "STEPPING", color: "var(--purple)" };
      case "finished": return { label: "FINISHED", color: "var(--green)" };
      default: return { label: "IDLE", color: "var(--text-dim)" };
    }
  })();

  /** 节点 click 跳转（ns-3） */
  function handleNodeClick(nodeId: string) {
    if (isJumping) return;
    const targetStep = nodeToStep(nodeId, state.frame, state.exitBranch);
    if (targetStep < 0) return;
    dispatch({ type: "JUMP", targetStep });
  }

  /** 接缝标签 click/toggle（ns-3） */
  function toggleSeam(seamKey: "convertToLlm" | "beforeAfter") {
    setExpandedSeam(expandedSeam === seamKey ? null : seamKey);
  }

  /** 接缝标签键盘事件（ns-4 ARIA） */
  function handleSeamKeyDown(
    e: React.KeyboardEvent,
    seamKey: "convertToLlm" | "beforeAfter",
  ) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      toggleSeam(seamKey);
    }
  }

  /** 节点键盘事件（ns-4 ARIA） */
  function handleNodeKeyDown(e: React.KeyboardEvent, nodeId: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      handleNodeClick(nodeId);
    }
  }

  return (
    <div className="aed-root diagram diagram-full">
      <div className="aed-header">
        <div className="aed-title-group">
          <span className="aed-title">PI AGENT EXECUTION</span>
          <span className="aed-subtitle">10 步 · 25 子帧 · 3 退出分支 · v4 双轨节奏</span>
        </div>
        <div className="aed-controls">
          <button
            onClick={() => dispatch({ type: isFinished ? "REPLAY" : "PLAY" })}
            type="button"
            className="aed-btn-primary"
            disabled={isJumping}
          >
            {isFinished ? "REPLAY" : state.mode === "playing" ? "PAUSE" : "PLAY"}
          </button>
          <button
            onClick={() => dispatch({ type: "STEP" })}
            type="button"
            className={state.mode === "stepping" ? "aed-btn-active" : ""}
            disabled={isFinished || isJumping}
          >
            STEP
          </button>
          <button
            onClick={() => dispatch({ type: "RESET" })}
            type="button"
            disabled={isJumping}
          >
            RESET
          </button>
          <button
            onClick={() => dispatch({ type: "SET_SPEED" })}
            type="button"
            disabled={isJumping}
          >
            {state.speed}x
          </button>
        </div>
      </div>

      {/* 退出分支切换 */}
      <div className="aed-branch-switcher">
        <span className="aed-branch-label">退出分支：</span>
        {(["end", "aborted", "overflow"] as ExitBranch[]).map((b) => (
          <button
            key={b}
            onClick={() => dispatch({ type: "SET_BRANCH", branch: b })}
            type="button"
            className={`aed-branch-btn ${state.exitBranch === b ? "active" : ""}`}
            disabled={isJumping}
          >
            {b === "end" && "end（正常）"}
            {b === "aborted" && "aborted·error"}
            {b === "overflow" && "overflow → 恢复"}
          </button>
        ))}
        {isJumping && <span className="aed-jumping-hint">JUMPING...</span>}
      </div>

      <div className="aed-stage">
        {/* 节点流程图：CSS Grid 布局 + SVG 连接层 */}
        <div className="aed-flow">
          <div className="aed-flow-track">
            {/* SVG 连接层：数据包流动（用 path 而非 line，因为 animateMotion 的 mpath 只能引用 path） */}
            <svg className="aed-links-svg" viewBox="0 0 960 200" preserveAspectRatio="xMidYMid meet">
              {/* 水平 path 集（宽屏默认） */}
              <path id="path-user-tui" d="M 80 100 L 200 100" className={`aed-link aed-link-h ${nodeState("user") !== "pending" ? "active" : ""}`} />
              <path id="path-tui-agentSession" d="M 200 100 L 320 100" className={`aed-link aed-link-h ${nodeState("tui") !== "pending" ? "active" : ""}`} />
              <path id="path-agentSession-llm" d="M 320 100 L 440 100" className={`aed-link aed-link-h ${nodeState("agentSession") !== "pending" ? "active" : ""}`} />
              <path id="path-loop-exit" d="M 680 100 L 800 100" className={`aed-link aed-link-h ${nodeState("exit") !== "pending" ? "active" : ""}`} />
              <path id="path-exit-output" d="M 800 100 L 900 100" className={`aed-link aed-link-h ${nodeState("output") !== "pending" ? "active" : ""}`} />
              <path
                id="path-llm-tool-use"
                d="M 480 70 L 640 70"
                className={`aed-link aed-link-h aed-link-tool-use ${snapshot?.packets.some((p) => p.kind === "tool_use") ? "active" : ""}`}
              />
              <path
                id="path-tool-llm-result"
                d="M 640 130 L 480 130"
                className={`aed-link aed-link-h aed-link-tool-result ${snapshot?.packets.some((p) => p.kind === "tool_result") ? "active" : ""}`}
              />
              <path id="path-agentSession-output" d="M 320 100 L 900 100" className="aed-link-hidden aed-link-h" />

              {/* 垂直 path 集（窄屏 <768px 用，ns-4） */}
              <path id="path-user-tui-v" d="M 100 40 L 100 120" className={`aed-link aed-link-v ${nodeState("user") !== "pending" ? "active" : ""}`} />
              <path id="path-tui-agentSession-v" d="M 100 160 L 100 240" className={`aed-link aed-link-v ${nodeState("tui") !== "pending" ? "active" : ""}`} />
              <path id="path-agentSession-llm-v" d="M 100 280 L 100 360" className={`aed-link aed-link-v ${nodeState("agentSession") !== "pending" ? "active" : ""}`} />
              <path id="path-loop-exit-v" d="M 100 520 L 100 600" className={`aed-link aed-link-v ${nodeState("exit") !== "pending" ? "active" : ""}`} />
              <path id="path-exit-output-v" d="M 100 640 L 100 720" className={`aed-link aed-link-v ${nodeState("output") !== "pending" ? "active" : ""}`} />
              <path
                id="path-llm-tool-use-v"
                d="M 80 420 L 80 460"
                className={`aed-link aed-link-v aed-link-tool-use ${snapshot?.packets.some((p) => p.kind === "tool_use") ? "active" : ""}`}
              />
              <path
                id="path-tool-llm-result-v"
                d="M 120 460 L 120 420"
                className={`aed-link aed-link-v aed-link-tool-result ${snapshot?.packets.some((p) => p.kind === "tool_result") ? "active" : ""}`}
              />
              <path id="path-agentSession-output-v" d="M 100 280 L 100 720" className="aed-link-hidden aed-link-v" />

              {/* 数据包 3 包错峰接力（ns-2）：每个 packet 渲染 3 个 circle */}
              {snapshot?.packets.map((p, i) => {
                const pathIdH = getPacketPathId(p, "h");
                const pathIdV = getPacketPathId(p, "v");
                if (!pathIdH && !pathIdV) return null;
                return PACKET_RELAY_DELAYS.map((delay, k) => (
                  <g key={`${p.from}-${p.to}-${i}-${k}`}>
                    {pathIdH && (
                      <circle
                        r="5"
                        className={`aed-packet aed-packet-${p.kind} aed-link-h`}
                      >
                        <animateMotion
                          dur={`${PACKET_DURATION}s`}
                          begin={`${delay}s`}
                          repeatCount="indefinite"
                          rotate="auto"
                        >
                          <mpath href={`#${pathIdH}`} />
                        </animateMotion>
                      </circle>
                    )}
                    {pathIdV && (
                      <circle
                        r="5"
                        className={`aed-packet aed-packet-${p.kind} aed-link-v`}
                      >
                        <animateMotion
                          dur={`${PACKET_DURATION}s`}
                          begin={`${delay}s`}
                          repeatCount="indefinite"
                          rotate="auto"
                        >
                          <mpath href={`#${pathIdV}`} />
                        </animateMotion>
                      </circle>
                    )}
                  </g>
                ));
              })}
            </svg>

            {/* 节点层：CSS Grid 定位 */}
            <div className="aed-nodes-grid">
              <div
                className={`aed-node aed-node-${nodeState("user")}`}
                role="button"
                tabIndex={0}
                aria-label="跳转到 用户 步骤"
                onClick={() => handleNodeClick("user")}
                onKeyDown={(e) => handleNodeKeyDown(e, "user")}
              >
                <span className="aed-node-label">用户</span>
              </div>

              <ChapterNode
                node={NODES[1]}
                state={nodeState("tui")}
                onJump={handleNodeClick}
                onKeyDown={handleNodeKeyDown}
              />

              <ChapterNode
                node={NODES[2]}
                state={nodeState("agentSession")}
                onJump={handleNodeClick}
                onKeyDown={handleNodeKeyDown}
              />

              {/* Agent Loop 回环区 */}
              <div className={`aed-loop-region ${inLoop ? "active" : ""}`}>
                <div className="aed-loop-label">
                  AGENT LOOP{snapshot && snapshot.loopCount > 0 ? ` · ×${snapshot.loopCount}` : ""}
                </div>
                <div className="aed-loop-inner">
                  <ChapterNode
                    node={NODES[3]}
                    state={nodeState("llm")}
                    onJump={handleNodeClick}
                    onKeyDown={handleNodeKeyDown}
                    expandedSeam={expandedSeam}
                    onToggleSeam={toggleSeam}
                    onSeamKeyDown={handleSeamKeyDown}
                  />
                  <div className="aed-channel-labels">
                    <span className="aed-channel-up">tool_use ↓</span>
                    <span className="aed-channel-down">tool_result ↑</span>
                  </div>
                  <ChapterNode
                    node={NODES[4]}
                    state={nodeState("tool")}
                    onJump={handleNodeClick}
                    onKeyDown={handleNodeKeyDown}
                    expandedSeam={expandedSeam}
                    onToggleSeam={toggleSeam}
                    onSeamKeyDown={handleSeamKeyDown}
                  />
                </div>
                <div className={`aed-seam aed-seam-prepare ${nodeState("prepare") === "active" ? "active" : ""}`}>
                  <span className="aed-seam-icon">🪝</span>
                  <span className="aed-seam-label">prepareNextTurn · hook S11</span>
                </div>
              </div>

              <ChapterNode
                node={NODES[6]}
                state={nodeState("exit")}
                onJump={handleNodeClick}
                onKeyDown={handleNodeKeyDown}
              />
              <ChapterNode
                node={NODES[7]}
                state={nodeState("output")}
                onJump={handleNodeClick}
                onKeyDown={handleNodeKeyDown}
              />
            </div>
          </div>
        </div>

        {/* 消息数组 + 事件流双面板（窄屏 details 折叠，ns-4） */}
        <div className={`aed-panels ${isJumping ? "jumping" : ""}`}>
          <details className="aed-panel aed-messages-panel" open>
            <summary className="aed-panel-summary">
              <span className="aed-panel-title">消息数组</span>
              <span className="aed-panel-count">
                {snapshot?.messages.length ?? 0} 条 · {snapshot?.saveCount ?? 0} 次保存
              </span>
            </summary>
            <div className="aed-panel-body">
              {overflowToast && (
                <div className="aed-overflow-toast">overflow 恢复中：删除 msg-6 + 生成 compactionSummary</div>
              )}
              {(!snapshot || snapshot.messages.length === 0) ? (
                <div className="aed-empty">等待执行...</div>
              ) : (
                snapshot.messages.map((msg, i) => {
                  /** 判断该消息是否触发 aed-msg-saved（ns-2）：当前帧 msgOp.save=true 且 id 匹配 */
                  const isSavedNow = snapshot.currentMsgOp?.save === true
                    && snapshot.currentMsgOp?.id === msg.id
                    && msg.saved === true;
                  /** 判断该消息是否触发 aed-flash-in（ns-2 PLAY 模式 assistant 出现） */
                  const isFlashIn = state.mode === "playing"
                    && state.playMode === "result"
                    && msg.role === "assistant";
                  /** compacted 消息（ns-3） */
                  const isCompacted = msg.compacted === true;
                  return (
                    <div
                      key={msg.id}
                      className={[
                        "aed-msg",
                        `aed-msg-${msg.role}`,
                        msg.streaming ? "streaming" : "",
                        msg.saved ? "saved" : "",
                        isSavedNow ? "aed-msg-saved" : "",
                        isFlashIn ? "aed-flash-in" : "",
                        isCompacted ? "compacted" : "",
                      ].filter(Boolean).join(" ")}
                    >
                      <div className="aed-msg-header">
                        <span className="aed-msg-role">#{i + 1} {msg.role}</span>
                        {msg.streaming && <span className="aed-streaming-badge">streaming</span>}
                        {msg.saved && <span className="aed-save-badge">✓ S{msg.saveNum}</span>}
                        {isCompacted && (
                          <span className="aed-compacted-badge">compacted: 1 deleted → 1 summary</span>
                        )}
                      </div>
                      <div className="aed-msg-blocks">
                        {msg.blocks.length === 0 ? (
                          <div className="aed-block aed-block-placeholder">[streaming...]</div>
                        ) : (
                          msg.blocks.map((block, j) => {
                            /** 判断是否为新增 block（ns-2 aed-block-appear）：
                             *  STEP 模式 + streaming + blockAppear 标记 + 最后一个 block */
                            const isBlockAppear = state.mode === "stepping"
                              && msg.streaming === true
                              && snapshot.blockAppear === true
                              && j === msg.blocks.length - 1;
                            /** text 块长度判断（ns-2 整块淡入 vs 打字机） */
                            const isLongText = block.type === "text"
                              && block.content.length > TEXT_LONG_THRESHOLD;
                            /** STEP 模式 + streaming 触发打字机（ns-2） */
                            const isTypewriter = state.mode === "stepping"
                              && msg.streaming === true
                              && block.type === "text"
                              && !isLongText;
                            return (
                              <div
                                key={j}
                                className={[
                                  "aed-block",
                                  `aed-block-${block.type}`,
                                  isBlockAppear ? "aed-block-appear" : "",
                                  isLongText ? "aed-block-long-text" : "",
                                  isTypewriter ? "aed-typewriter-text" : "",
                                ].filter(Boolean).join(" ")}
                              >
                                <span className="aed-block-type">{block.type}</span>
                                <span className="aed-block-content">{block.content}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </details>

          <details className="aed-panel aed-events-panel" open>
            <summary className="aed-panel-summary">
              <span className="aed-panel-title">事件流</span>
              <span className="aed-panel-count">{snapshot?.events.length ?? 0} 行</span>
            </summary>
            <div className="aed-panel-body aed-events-body" ref={eventRef}>
              {(!snapshot || snapshot.events.length === 0) ? (
                <div className="aed-empty">等待事件...</div>
              ) : (
                snapshot.events.map((ev, i) => (
                  <div key={i} className="aed-event">
                    <span className="aed-event-tag" style={{ color: EVENT_COLORS[ev.type] }}>
                      [{EVENT_LABELS[ev.type]}]
                    </span>
                    <span className="aed-event-content">{ev.content}</span>
                  </div>
                ))
              )}
            </div>
          </details>
        </div>
      </div>

      <div className="aed-footer">
        {/* phase 指示器（ns-3 6 态，放 footer step-info 前缀） */}
        <div
          className="aed-phase-indicator"
          role="status"
          aria-live="polite"
          style={{ color: phaseInfo.color, borderColor: phaseInfo.color }}
        >
          <span className="aed-phase-dot" style={{ background: phaseInfo.color }} />
          <span className="aed-phase-label">[{phaseInfo.label}]</span>
        </div>
        <div className="aed-step-info">
          <span className="aed-step-num">
            {state.frame === 0 ? "READY" : `STEP ${Math.min((snapshot?.stepIdx ?? 0) + 1, steps.length)}/${steps.length}`}
          </span>
          {snapshot && <span className="aed-step-label">{snapshot.phase}</span>}
          {snapshot && <span className="aed-subframe-label">· {snapshot.subframeLabel}</span>}
        </div>
        {snapshot && snapshot.loopCount > 0 && (
          <div className="aed-loop-count">LOOP ×{snapshot.loopCount}</div>
        )}
        {snapshot && (
          <div className={`aed-condition ${hasToolUse ? "continue" : "exit"}`}>
            <span className="aed-condition-key">content.tool_use.length</span>
            <span className="aed-condition-op">=</span>
            <span className="aed-condition-val">{snapshot.toolUseCount}</span>
            <span className="aed-condition-action">
              {hasToolUse ? "→ 继续" : state.exitBranch === "end" ? "→ 正常退出" : `→ ${state.exitBranch}`}
            </span>
          </div>
        )}
        {/* 进度条 */}
        <div className="aed-progress-bar">
          <div
            className="aed-progress-fill"
            style={{ width: `${(stepProgress / steps.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
 * ChapterNode 子组件：节点 + 章节锚点 + 接缝标签（含展开面板）
 * 三层 click 隔离：节点 div / 章节 <a> / 接缝标签 span
 * =================================================================== */

interface ChapterNodeProps {
  node: NodeDef;
  state: "pending" | "active" | "done";
  onJump: (nodeId: string) => void;
  onKeyDown: (e: React.KeyboardEvent, nodeId: string) => void;
  expandedSeam?: "convertToLlm" | "beforeAfter" | null;
  onToggleSeam?: (seamKey: "convertToLlm" | "beforeAfter") => void;
  onSeamKeyDown?: (
    e: React.KeyboardEvent,
    seamKey: "convertToLlm" | "beforeAfter",
  ) => void;
}

function ChapterNode({
  node,
  state,
  onJump,
  onKeyDown,
  expandedSeam,
  onToggleSeam,
  onSeamKeyDown,
}: ChapterNodeProps) {
  const tooltipText = node.subChapters
    ? [node.chapter, ...node.subChapters]
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.replace("_", " "))
        .join(" · ")
    : node.chapter?.replace("_", " ");

  const isSeamExpanded = node.seamKey && expandedSeam === node.seamKey;
  const seamPanel = node.seamKey ? SEAM_PANELS[node.seamKey] : null;

  return (
    <div
      className={`aed-node aed-node-${state} ${node.isHook ? "aed-node-hook" : ""}`}
      data-tooltip={tooltipText}
      role="button"
      tabIndex={0}
      aria-label={`跳转到 ${node.label} 步骤`}
      onClick={(e) => {
        e.stopPropagation();
        onJump(node.id);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        onKeyDown(e, node.id);
      }}
    >
      <span className="aed-node-label">{node.label}</span>
      {node.chapter && (
        <a
          href={`/pi-learn/chapters/${node.chapter}/`}
          className="aed-node-chapter"
          onClick={(e) => e.stopPropagation()}
        >
          {node.chapter.split("_")[0].toUpperCase()}
        </a>
      )}
      {node.seam && node.seamKey && onToggleSeam && onSeamKeyDown && (
        <span
          className={`aed-seam-tag ${isSeamExpanded ? "expanded" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSeam(node.seamKey!);
          }}
          onKeyDown={(e) => onSeamKeyDown(e, node.seamKey!)}
          role="button"
          tabIndex={0}
          aria-expanded={isSeamExpanded}
          aria-label={`${node.seam} 说明`}
        >
          {node.seam}
          {isSeamExpanded && seamPanel && (
            <span
              className={`aed-seam-panel ${
                node.seamKey === "convertToLlm" ? "aed-seam-panel-down" : "aed-seam-panel-up"
              }`}
              style={{ width: SEAM_PANEL_WIDTH }}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="aed-seam-panel-desc">{seamPanel.desc}</span>
              <a
                href={`/pi-learn/chapters/${seamPanel.anchor}/`}
                className="aed-seam-panel-anchor"
                onClick={(e) => e.stopPropagation()}
              >
                源码：{seamPanel.anchor}
              </a>
              <span className="aed-seam-panel-timing">触发：{seamPanel.timing}</span>
            </span>
          )}
        </span>
      )}
      {node.isHook && <span className="aed-hook-icon">🪝</span>}
      {state === "active" && node.id === "llm" && inLoopBadge}
    </div>
  );
}

/** LLM 节点的循环徽章 */
const inLoopBadge = <span className="aed-spin-badge">↻</span>;

/** 根据数据包 from/to 返回对应 SVG path id（ns-4 支持 h/v 双套） */
function getPacketPathId(p: Packet, orientation: "h" | "v"): string | null {
  const key = `${p.from}-${p.to}-${p.kind}`;
  const mapH: Record<string, string> = {
    "user-tui-response": "path-user-tui",
    "tui-agentSession-response": "path-tui-agentSession",
    "agentSession-llm-response": "path-agentSession-llm",
    "llm-tool-tool_use": "path-llm-tool-use",
    "tool-llm-tool_result": "path-tool-llm-result",
    "agentSession-output-response": "path-agentSession-output",
  };
  const mapV: Record<string, string> = {
    "user-tui-response": "path-user-tui-v",
    "tui-agentSession-response": "path-tui-agentSession-v",
    "agentSession-llm-response": "path-agentSession-llm-v",
    "llm-tool-tool_use": "path-llm-tool-use-v",
    "tool-llm-tool_result": "path-tool-llm-result-v",
    "agentSession-output-response": "path-agentSession-output-v",
  };
  return orientation === "h" ? (mapH[key] ?? null) : (mapV[key] ?? null);
}
