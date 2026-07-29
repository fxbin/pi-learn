# CONTRIBUTING

pi-learn 的每一章是教学产品，不是代码堆砌。新增或修改章节必须通过以下质量闸门。

## 章节六件套

每章目录（如 `s01_agent_loop/`）必须包含：

1. **README.md**：叙事文档，结构为 问题 → 解决方案 → 工作原理 → 运行 → 前置概念清单 → 源码锚点 → 妥协清单 → 默写验收
2. **code.ts**：完整可运行实现，单文件，`node code.ts` 直接跑
3. **practice.ts**：默写空白页模板，带提示注释的骨架，学习者填肉后 `node practice.ts` 能跑通即过

README 中的固定小节：

- **前置概念清单**：本章用到的 TS/agent 新概念，不超过 5 条
- **源码锚点**：pi 文件路径 + 对照要点 + 动手任务（阅读锚定或修改真 pi）
- **妥协清单**：明列 mini-pi 比真 pi 少做了什么、为何安全

## 质量闸门检查清单

提交前逐项确认：

- [ ] `node <章节>/code.ts` 在 node >= 22.18 上直接跑通，无构建步骤、无 tsx
- [ ] `npm run check`（`tsc --noEmit`）通过，`erasableSyntaxOnly` 无违规
- [ ] 删掉 `code.ts` 里所有类型注解后代码仍能跑（可擦除性人工抽查）
- [ ] `code.ts` 不超过 200 行；超过则说明概念表面积超标，砍表面积不砍概念
- [ ] 前置概念清单不超过 5 条
- [ ] 源码锚点中的 pi 文件路径、行号、符号名已对照 `.reference/pi/` 快照核实
- [ ] 默写测试：合上书能在 `practice.ts` 上重写本章代码（作者自测一遍）

## 代码风格

- 零 npm 运行时依赖；node 原生模块（`node:fs`、`node:child_process` 等）随意用
- 类型只写边界：对外接口、API 请求/响应形状；内部变量不加注解
- 禁止魔法值：配置与阈值集中定义为具名常量
- 注释用中文；每个函数有 JSDoc 使用说明；注释独立成行，禁止行尾注释
- 文件头标注 `@author fxbin`
- 禁止 enum / decorator / namespace / parameter properties（`erasableSyntaxOnly` 强制）
- 不写单元测试用例；验收方式是运行与默写
