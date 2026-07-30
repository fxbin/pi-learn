# pi-learn

学习 [pi](https://github.com/earendil-works/pi)（原 Claude Code）源码的笔记记录。每篇对应一个核心机制，先读懂，再手写一遍，最后对照 pi 真实源码看差距。

> 在线版：https://fxbin.github.io/pi-learn/

## 怎么读

每篇固定三步：

1. **读**：网页上的叙事正文，搞清楚这个机制解决什么问题
2. **写**：亲手敲出 `code.ts`（不是复制粘贴），跑起来看到效果
3. **对照**：回到 pi 真实源码，看你的实现和量产软件差在哪

篇末有默写验收：用 `practice.ts` 空白模板重写。写不出说明这篇没吃透，回头再来。

## 笔记目录

14 篇核心机制 + 3 个番外主题，每篇对应 pi 的一个模块。

| 篇 | 标题 | 核心内容 | pi 源码锚点 |
|---|---|---|---|
| s01 | Agent Loop | while 循环 + tool_use 往返的最小骨架 | `packages/agent/src/agent-loop.ts` |
| s02 | Tools | bash/read/write 三个工具与 dispatch 表 | `packages/coding-agent/src/core/tools/{bash,read,write}.ts` |
| s03 | Edit Queue | 字符串手术（模糊匹配/diff）与写盘串行化 | `packages/coding-agent/src/core/tools/{edit,edit-diff,file-mutation-queue}.ts` |
| s04 | Interrupt | 循环运行中被 AbortSignal 打断、被注入消息改写 | `packages/agent/src/agent-loop.ts`、`packages/agent/src/types.ts` |
| s05 | Session | append-only jsonl 持久化与 resume | `packages/agent/src/harness/session/` |
| s06 | Compaction | 上下文预算、溢出检测与摘要 | `packages/agent/src/harness/compaction/compaction.ts` |
| s07 | Skills | 文件即提示注入，坏文件返回 diagnostics 而非抛异常 | `packages/agent/src/harness/skills.ts` |
| s08 | Provider | 两套供应商数据模型平等独立，pi 抽象 AgentMessage 中间层 | `packages/ai/src/providers/`、`packages/ai/src/api/transform-messages.ts` |
| s09 | TUI 渲染 | 终端渲染、输入处理与流式输出 | `packages/coding-agent/src/core/tui/` |
| s10 | Extensions | 动态加载 + 生命周期钩子（Observer/Interceptor/Transformer） | `packages/coding-agent/src/core/extensions/` |
| s11 | AgentSession | 分层架构 + compaction 自动触发 + 模型切换 + 事件订阅 | `packages/coding-agent/src/core/agent-session.ts` |
| s12 | Streaming | SSE 流式协议、in-place partial 更新、事件流分类 | `packages/agent/src/agent-loop.ts`、`packages/ai/src/utils/event-stream.ts` |
| s13 | Stateful Agent | steering/followUp 双队列 + idle/running 状态机 + 事件串行派发 | `packages/coding-agent/src/core/agent-session.ts` |
| s14 | 会话分支树 | id/parentId DAG、leafId 指针、branch/fork/compaction 三态 | `packages/coding-agent/src/core/session/branch-tree.ts` |
| 番外·01 | 扩展系统 | 运行时加载 TS 模块，注册工具/命令/provider/UI/快捷键，三层错误隔离 | `.pi/extensions/`、`packages/coding-agent/examples/extensions/` |
| 番外·02 | 订阅认证 | device code 流程 + PKCE，无浏览器跳转拿访问令牌 | `packages/ai/src/auth/oauth/` |
| 番外·03 | 终端界面 | 事件流消费 + Ink 渲染 + 焦点管理 + 60fps 多窗口布局 | `packages/tui/` |

每篇正文里有动态图示（流式动画、事件流、循环可视化）帮助理解执行过程。总览页 `/overview` 用一张动态大图把整个 agent 执行流程串起来。

## 工程约束

示例代码使用 TypeScript，规则只有三条：

| 规则 | 执行方式 |
|---|---|
| 零构建 | node >= 22.18 直接跑单文件 `.ts`，无 bundler、无 tsx |
| 只许可擦除语法 | `tsconfig.json` 打开 `erasableSyntaxOnly`，编译器禁掉 enum/decorator/namespace |
| 类型只写边界 | 删掉所有类型注解，代码必须照样能跑 |

这三条与 pi 官方开发规则一致（见 pi 仓库 `AGENTS.md`：Use only erasable TypeScript syntax）。Java/Python 背景的读者先花 10 分钟读 [TS 急救包](appendix/ts-survival-kit.md)，再看[语言无关概念映射](appendix/concept-map.md)。

笔记网站本身是 Astro 5 静态站点（正文用 MDX，动态图用 React Islands），与示例代码的"零构建"约束无关——网站是阅读载体，示例代码是要你亲手敲的部分。

## 快速开始

### 跑示例代码

示例默认使用 DeepSeek（通过 Anthropic 兼容端点，s01-s07 代码逻辑无需改动）：

```bash
node --version   # 确认 >= 22.18

# DeepSeek（推荐，国内可直连）
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
export ANTHROPIC_API_KEY=sk-deepseek-...
export MODEL_ID=deepseek-chat

node public/chapters/s01_agent_loop/code.ts
```

也可换回 Anthropic Claude：

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export MODEL_ID=claude-sonnet-4-5

node public/chapters/s01_agent_loop/code.ts
```

DeepSeek 的 Anthropic 兼容端点完整支持 `x-api-key` 认证、`tool_use`/`tool_result`/`input_schema`，s01-s07 的 callLlm 代码零修改。s08 Provider 演示如何用 OpenAI 兼容端点接入第三方供应商。

每篇目录 `public/chapters/sXX_<name>/` 下有 `code.ts`（完整参考实现）和 `practice.ts`（空白默写模板）。

### 本地启动笔记网站

```bash
npm install
npm run dev      # http://localhost:4321/pi-learn
npm run build    # 构建到 dist/
npm run preview  # 预览构建产物
```

类型检查（可选）：

```bash
npm run check
```

## pi 版本锚定

本笔记基于 pi `v0.76.0` 源码快照（[earendil-works/pi@v0.76.0](https://github.com/earendil-works/pi/tree/v0.76.0)，本地克隆镜像在 `.reference/pi/`，该目录被 `.gitignore` 排除、不入库，需自行 `git clone` 做对照）。pi 主仓持续演进，若你阅读最新源码时发现行号或结构漂移，以机制为单位对照即可，篇目锚点会按需修订。

## 目录结构

```
src/
  content/chapters/        14 篇 MDX 正文（s01-s14）
  pages/                   路由：首页 / overview 总览 / chapters/[slug] / extras
  components/
    diagrams/              各篇动态图组件（React + CSS 变量，暗/亮主题）
    CodeDrawer.tsx         源码抽屉（侧边栏打开 + 轻量语法高亮）
    CodeDrawer.css         源码抽屉样式
    ChapterNav.astro       侧边章节导航
    ChapterCard.astro      首页/总览页章节卡片
    Header.astro           全站页头
    ScrollProgress.astro   阅读进度条
    ThemeToggle.tsx        暗/亮主题切换
    highlight.ts           轻量语法高亮规则
  layouts/Layout.astro     全站布局
  styles/global.css        CSS 变量主题
public/chapters/           每篇示例代码 code.ts + practice.ts
appendix/                  TS 急救包 + 语言无关概念映射
.reference/pi/             pi v0.76.0 源码快照（本地克隆镜像，不入库，需自行 clone）
.github/workflows/deploy.yml   GitHub Pages 自动部署
```

## 部署

推送到 main 分支即自动部署到 GitHub Pages：https://fxbin.github.io/pi-learn/

作者：fxbin
