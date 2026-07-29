# 番外（extras）

正文八章之外的选读内容，按规划推进，当前尚未开始。

## 规划内容

| 主题 | 内容 | pi 源码锚点 |
|---|---|---|
| extensions | 给真 pi 写一个扩展：agent 修改和扩展它自己 | `.pi/extensions/`（另有 `packages/coding-agent/examples/extensions/`，动笔前核实两处关系） |
| OAuth | 订阅制账号的认证流程（device code / PKCE） | `packages/ai/src/auth/oauth/` |
| TUI | 终端界面如何消费 agent 事件流 | `packages/tui/` |

## 为什么钉死在番外

这三块是生产级关注点，不是 harness 的机制内核。正文八章坚持"每章只加一个机制"，番外不渗入正文一个字——这是课程的范围纪律。

## 动笔前的待办

- 核实 extensions 锚点：`.pi/extensions/`（用户目录扩展）与 `packages/coding-agent/examples/extensions/`（示例）的分工
- OAuth 章只讲一条链路（建议 device code），不铺开全部 provider
