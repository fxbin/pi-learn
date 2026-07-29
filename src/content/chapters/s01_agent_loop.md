---
title: Agent Loop
num: S01
description: while 循环、tool_use 往返、原生 fetch 直调 Messages API。
order: 1
concepts:
  - tool_use
  - stop_reason
  - 消息数组即状态
  - tool_result 回填
  - REPL
---
# s01: Agent Loop — 一个循环就够了

> 一个工具 + 一个循环 = 一个 Agent。

`s01` → [s02](/pi-learn/chapters/s02_tools/) → s03 → ... → s08

---

## 问题

你问模型："帮我看看目录下有哪些文件，然后跑一下 xxx 脚本。"

模型能输出一条 bash 命令，但输出完就停了。它不会自己跑，也不会看到结果后继续推理。

你可以手动跑一遍，把输出贴回对话框，让它接着干。下一条命令出来，你再跑、再贴。每一个来回，你都在做中间层。

把这个中间层自动化，就是本章要做的事。

---

## 解决方案

一个 `while` 循环：模型调用工具就继续，不调用就停。整个过程只有两个信号：

| 信号 | 含义 | 循环动作 |
|---|---|---|
| `stop_reason === "tool_use"` | 模型举手说"我要用工具" | 执行 → 结果喂回去 → 继续 |
| 其他任何值 | 模型说"我做完了" | 退出循环 |

```
+----------+      +-------+      +---------+
|   用户   | ---> |  LLM  | ---> | 工具执行 |
|   提问   |      |       |      |         |
+----------+      +---+---+      +----+----+
                      ^               |
                      |  tool_result  |
                      +---------------+
                     （循环继续）
```

agent 的"记忆"就是一个消息数组：用户提问、模型回答、工具结果，全部按序追加，每轮原样发回给模型。没有隐藏状态。

---

## 工作原理

打开 [code.ts](/pi-learn/chapters/s01_agent_loop/code.ts)，分四块看。

**第 1 块：调用 LLM。** 原生 `fetch` 发一次 POST，请求头三个、body 五个字段，没有 SDK 挡在中间。

```typescript
const response = await fetch(`${CONFIG.baseUrl}/v1/messages`, {
	method: "POST",
	headers: {
		"content-type": "application/json",
		"x-api-key": CONFIG.apiKey,
		"anthropic-version": CONFIG.anthropicVersion,
	},
	body: JSON.stringify({ model: CONFIG.model, max_tokens: CONFIG.maxTokens, system: SYSTEM_PROMPT, messages, tools: TOOLS }),
});
```

**第 2 块：执行工具。** `spawnSync` 同步跑 shell，黑名单、超时、输出截断三道护栏。

**第 3 块：主循环。** 全章核心，只有十几行：

```typescript
while (true) {
	const response = await callLlm(messages);
	messages.push({ role: "assistant", content: response.content });
	if (response.stop_reason !== "tool_use") {
		return;
	}
	// 执行每个 tool_use 块，收集 tool_result
	messages.push({ role: "user", content: results });
}
```

**第 4 块：REPL 入口。** `readline` 读一行问一轮，对话历史跨轮保留，所以你可以追问"它刚才改了哪个文件"。

---

## 运行

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export MODEL_ID=claude-sonnet-4-5     # 可选，有默认值
node code.ts
```

试这三个提示，观察循环转了几轮：

1. `列出当前目录的文件`（一轮工具调用就停）
2. `递归统计当前目录下每个子目录的文件数，把结果写进 report.txt`（多轮）
3. `刚才那个 report.txt 的前三行写了什么`（利用跨轮历史）

---

## 前置概念清单

本章只引入五个新概念，后续的章都建立在它们之上：

1. **tool_use**：模型不只输出文本，还能输出结构化的"我要调用工具"块（带 id、name、input）
2. **stop_reason**：API 告诉你模型这一轮为什么停下；`tool_use` 是循环的油门
3. **消息数组即状态**：agent 的全部记忆是一个按序追加的数组，没有数据库、没有隐藏状态
4. **tool_result 回填**：工具执行结果包装成 `user` 角色的消息发回，id 与 tool_use 一一对应
5. **REPL**：readline 读输入 → 跑循环 → 打印回答，交互外壳与 agent 内核分离

---

## 源码锚点

mini-pi 的十几行循环，在真 pi 里对应 `runLoop`：`.reference/pi/packages/agent/src/agent-loop.ts` 第 155-275 行。先读一遍，再回答三个问题（答案就在代码里）：

1. 第 170 行和第 174 行各有一个 `while`，**两层循环各自为什么存在**？（提示：找 `followUpMessages` 和 `steeringMessages`）
2. 第 211-214 行：当 `stopReason === "length"` 时，pi **一个工具调用都不执行**。为什么这是对的？（提示：token 截断意味着什么）
3. 第 295 行的 `convertToLlm` 把内部消息模型转成 LLM 格式，为什么这个转换放在调 LLM 的边界上，而不是让内部直接用 LLM 格式？（s08 会展开）

**动手任务（改 mini-pi）**：真 pi 有钩子和中断保护，mini-pi 没有。给 `agentLoop` 加一个最大轮数保护：循环超过 10 轮就停下来并提示。这是你的第一个 harness 策略——循环的形状不变，行为多了一条约束。

---

## 妥协清单

mini-pi 比真 pi 少做了什么，以及为什么省略是安全的：

| 省略项 | 真 pi 的做法 | 为什么本章可以省 |
|---|---|---|
| 流式输出 | `streamFn` 逐 token 推送 | 非流式一次性返回，语义相同，只是少了打字机效果 |
| 事件流 | 每步 `emit` 事件供 TUI 渲染 | 用 `console.log` 直接打印，观察者只有终端 |
| 中断 AbortSignal | signal 贯穿全链路 | s04 专门讲，本章循环短，Ctrl+C 够用 |
| steering / follow-up | 双层循环注入运行中消息 | s04 讲；本章一问一答，不存在运行中插话 |
| length 截断保护 | 截断时整批拒执行工具调用 | 单工具 + 8000 token 极少触发；锚点问题 2 已点名 |
| 精细截断 | `utils/truncate.ts` 按行/字节策略截断 | 简单 `slice` 教学够用，s02 会碰到它的边界 |
| 多工具 dispatch | `tools/index.ts` 注册表 | s02 讲；一个工具不需要分发 |
| 错误分类恢复 | `stopReason: error/aborted` 分路径处理 | 本章直接抛异常终止，把失败暴露给学习者 |

这张表是本章的地图：后面七章，就是逐行划掉它。

---

## 默写验收

合上 code.ts 和本 README，打开 [practice.ts](/pi-learn/chapters/s01_agent_loop/practice.ts)，凭记忆补全四个函数体：`callLlm`、`runBash`、`agentLoop`、`main`。

通过标准：`node practice.ts` 跑起来，能完成"列出当前目录文件"这类需要一轮工具调用的任务。

写不出 `agentLoop` 说明主循环没进脑子，回到「工作原理」第 3 块重读，再默写一遍。其他三个函数写不出可以查，主循环不行。

---

下一章：[s02 bash/read/write — 三个"无聊"工具与 dispatch 表](/pi-learn/chapters/s02_tools/)
