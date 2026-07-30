# pi-learn

从零构建一个 agent harness。每章亲手重建 [pi](https://github.com/earendil-works/pi) 的一个核心机制，章末回到 pi 真实源码做对照。

学完你将得到：一个能对真实仓库干活的 mini-pi，以及阅读、修改任意 coding agent 内部实现的能力。

## 怎么学

每章固定三步：

1. **读**：叙事 README，搞清楚为什么需要这个机制
2. **写**：亲手敲出本章的 `code.ts`（不是复制粘贴，是写），跑起来看到效果
3. **对照**：回到 pi 真实源码，看你的玩具和量产软件差在哪

章末有默写验收：合上书，用 `practice.ts` 空白模板重写本章代码。写不出来说明这一章没学会，回头再写一遍。

## 章节大纲

| 章 | 标题 | 学习目标 | pi 源码锚点 |
|---|---|---|---|
| s01 | agent loop | while 循环 + tool_use 往返的最小骨架 | `packages/agent/src/agent-loop.ts` |
| s02 | bash/read/write | 三个"无聊"工具与 dispatch 表 | `packages/coding-agent/src/core/tools/{bash,read,write}.ts` |
| s03 | edit + 变更队列 | 字符串手术（模糊匹配/diff）与写盘串行化 | `packages/coding-agent/src/core/tools/{edit,edit-diff,file-mutation-queue}.ts` |
| s04 | 中断与 steering | 循环运行中被 AbortSignal 打断、被注入消息改写 | `packages/agent/src/agent-loop.ts`、`packages/agent/src/types.ts` |
| s05 | session/jsonl | append-only 持久化与 resume | `packages/agent/src/harness/session/` |
| s06 | compaction | 上下文预算、溢出检测与摘要 | `packages/agent/src/harness/compaction/compaction.ts` |
| s07 | skills | 文件即提示注入，坏文件返回 diagnostics 而非抛异常 | `packages/agent/src/harness/skills.ts` |
| s08 | provider 抽象 | 一个接口 + anthropic/openai 两实现 + 消息边界转换 | `packages/ai/src/providers/`、`packages/ai/src/api/transform-messages.ts` |
| 番外 | extensions/OAuth/TUI | 给真 pi 写一个扩展，agent 改自己 | `.pi/extensions/` |

s08 附 deepseek 选读小节：演示在 openai 兼容格式上加第三个 provider 的增量成本。

## 工程约束

课程代码使用 TypeScript，规则只有三条：

| 规则 | 执行方式 |
|---|---|
| 零构建 | node >= 22.18 直接跑单文件 `.ts`，无 bundler、无 tsx |
| 只许可擦除语法 | `tsconfig.json` 打开 `erasableSyntaxOnly`，编译器禁掉 enum/decorator/namespace |
| 类型只写边界 | 删掉所有类型注解，代码必须照样能跑 |

这三条与 pi 官方开发规则一致（见 pi 仓库 `AGENTS.md`：Use only erasable TypeScript syntax）。Java/Python 背景的读者先花 10 分钟读 [TS 急救包](appendix/ts-survival-kit.md)，再看[语言无关概念映射](appendix/concept-map.md)。

## 快速开始

```bash
node --version   # 确认 >= 22.18

export ANTHROPIC_API_KEY=sk-ant-...
export MODEL_ID=claude-sonnet-4-5
# 可选：指向兼容端点
# export ANTHROPIC_BASE_URL=https://your-proxy.example.com

node s01_agent_loop/code.ts
```

类型检查（可选，需要一次 `npm install`）：

```bash
npm run check
```

## pi 版本锚定

本课程基于 pi `v0.76.0` 源码快照（本仓库 `.reference/pi/`）。pi 主仓持续演进，若你阅读最新源码时发现行号或结构漂移，以机制为单位对照即可，章节锚点会按需修订。

## 目录结构

```
s01_agent_loop/ ... s08_provider/   八章主线，每章 README + code.ts + practice.ts
appendix/                           TS 急救包 + 语言无关概念映射
extras/                             番外：extensions / OAuth / TUI
.reference/pi/                      pi v0.76.0 源码快照（章末对照用）
.reference/learn-claude-code/       课程范式参照
```

课程范式参照：[learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)。关键差异：本课程一条累积主线长出 mini-pi（非孤立章节代码），章末锚定并可修改 pi 真实源码，每章附妥协清单说明 mini-pi 比真 pi 少做了什么。

作者：fxbin
