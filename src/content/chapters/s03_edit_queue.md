---
title: Edit Queue
num: S03
description: edit 工具 + promise 链式 file-mutation-queue。
order: 3
concepts:
  - edit vs write
  - file-mutation-queue
  - dispatch 表
  - old_string 唯一性
  - ToolUseBlock.input
---
# s03: edit + 变更队列 — 字符串手术与写盘串行化

> edit 是最难的工具：它修改已有内容，而不是整文件覆盖。

s01 → s02 → `s03` → [s04](/pi-learn/chapters/s04_interrupt/) → ... → s08

---

## 问题

s01 的 agent 只有 bash。想让模型改一个文件？它得 `sed -i`、`echo >`、甚至 `cat <<EOF`——shell 里改文件的语法又碎又险。

更关键的问题：如果 agent 一轮里发两个 edit，改同一个文件，两次写盘可能交错，文件就坏了。

两个问题，两个解法：edit 工具 + 变更队列。

---

## 解决方案

**edit 工具**：读文件 → 找到 old_string → 替换成 new_string → 写回。模型只需给出"改什么"和"改成什么"，不用操心 shell 语法。

**file-mutation-queue**：一条 promise 链，所有写盘操作排队执行。即使两个 edit 同时入队，也一个跑完再跑下一个。

```
edit(path, old, new) ──┐
                       ├──→ mutationQueue（promise 链）──→ 写盘
write(path, content) ──┘
```

dispatch 表把"执行哪个工具"从循环里剥离：新增工具只改一张表，循环本身不动。

---

## 工作原理

打开 [code.ts](/pi-learn/chapters/s03_edit_queue/code.ts)，分四块看。

**第 1 块：变更队列。** 全章最短也最精妙——

```typescript
let mutationQueue: Promise<string> = Promise.resolve("");

function enqueueMutation(fn: () => Promise<string>): Promise<string> {
    mutationQueue = mutationQueue.then(fn).catch(/* 兜底 */);
    return mutationQueue;
}
```

不是真正的队列数据结构，只是一条不断延长的 promise 链。每次 enqueue 把 fn 接到链尾，fn 自然要等前一个 resolve 才执行。`.catch` 兜底防止单次失败断裂整条链。

**第 2 块：edit 工具。** 整章最难的工具——

```typescript
function editTool(path, oldString, newString): Promise<string> {
    return enqueueMutation(async () => {
        const content = readFileSync(path, "utf-8");
        const count = content.split(oldString).length - 1;
        if (count === 0) return `Error: old_string not found`;
        if (count > 1) return `Error: old_string appears ${count} times, must be unique`;
        writeFileSync(path, content.replace(oldString, newString));
        return `Edited ${path}`;
    });
}
```

write 是整文件覆盖，edit 是手术：在已有内容上做定点替换。`String.replace` 只换第一个匹配，所以必须先检查 old_string 唯一——否则改错地方。

**第 3 块：dispatch 表。** 工具名 → 处理函数的映射——

```typescript
type ToolHandler = (input: Record<string, unknown>) => Promise<string>;

const handlers: Record<string, ToolHandler> = {
    bash:  async (i) => runBash(String(i.command)),
    read:  async (i) => readTool(String(i.path)),
    write: async (i) => writeTool(String(i.path), String(i.content)),
    edit:  async (i) => editTool(String(i.path), String(i.old_string), String(i.new_string)),
};
```

循环里一行分发：`const output = await handlers[block.name](block.input)`。加工具不用碰循环。

**第 4 块：循环不变。** agentLoop 的形状和 s01 一模一样，只是工具执行从硬编码 bash 变成了查表分发。`ToolUseBlock.input` 从 s01 的 `{ command: string }` 泛化为 `Record<string, unknown>`，因为不同工具有不同参数。

---

## 运行

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node code.ts
```

试这三个提示：

1. `在 test.txt 里写入 hello world，然后把 world 改成 pi`（write + edit 两轮）
2. `读一下 test.txt`（read 验证 edit 生效）
3. `创建 sub/a.txt 和 sub/b.txt，内容相同`（两次 write 经队列串行）

---

## 前置概念清单

1. **edit vs write**：write 整文件覆盖，edit 在已有内容上做定点替换——所以 edit 要先读、再找、再改、再写
2. **file-mutation-queue**：promise 链式排队，不是队列数据结构；同一文件的并发修改串行执行
3. **dispatch 表**：`Record<string, Handler>` 映射，新增工具只改表不改循环
4. **old_string 唯一性**：`String.replace` 只换第一个匹配，old_string 必须在文件中唯一才能改对地方
5. **ToolUseBlock.input**：从 s01 的 `{ command: string }` 泛化为 `Record<string, unknown>`，因为不同工具有不同参数

---

## 源码锚点

mini-pi 的 edit + queue，在真 pi 里对应三个文件：

1. `.reference/pi/packages/agent/src/harness/tools/edit.ts` — edit 工具入口，`withFileMutationQueue` 包裹整个读-改-写
2. `.reference/pi/packages/agent/src/harness/tools/edit-diff.ts` — 模糊匹配、BOM 处理、diff 生成
3. `.reference/pi/packages/agent/src/harness/tools/file-mutation-queue.ts` — 按文件 canonical path 分 key 的队列

先读一遍，再回答三个问题（答案就在代码里）：

1. `file-mutation-queue.ts` 第 9 行用 `WeakMap<ExecutionEnv, ...>` 按 env 隔离队列。为什么用 WeakMap 而不是全局 Map？（提示：env 的生命周期）
2. `edit-diff.ts` 的 `fuzzyFindText` 先精确匹配，再走 `normalizeForFuzzyMatch`。什么情况下精确匹配失败但模糊匹配成功？（提示：看 normalize 做了哪些归一化）
3. `edit.ts` 第 104-110 行：stripBom → detectLineEnding → normalizeToLF → applyEdits → restoreLineEndings。为什么不在原始字节上直接替换？（提示：CRLF 文件里 old_string 写的是 LF）

**动手任务（改 mini-pi）**：给 editTool 加多编辑支持——一次 edit 调用传 `edits: [{old_string, new_string}, ...]`，全部在同一把队列锁内执行。参考 pi 的 `applyEditsToNormalizedContent`：所有 edit 对同一份原文匹配，逆序应用。

---

## 妥协清单

| 省略项 | 真 pi 的做法 | 为什么本章可以省 |
|---|---|---|
| 模糊匹配 | `normalizeForFuzzyMatch` 归一化引号/空格/连字符后再匹配 | 教学版要求 old_string 精确匹配，迫使模型给出足够上下文 |
| BOM 处理 | `stripBom` 拆出 BOM，编辑后拼回 | UTF-8 BOM 在代码文件中罕见，省略不影响教学 |
| 换行符归一 | CRLF → LF 匹配 → 还原 CRLF | Unix 环境默认 LF，跨平台是工程细节不是机制 |
| diff 生成 | `generateDiffString` + `generateUnifiedPatch` 返回给模型看 | 教学版只返回"Edited path"，模型靠 read 验证 |
| 按 path 分 key | `WeakMap<env, Map<canonicalPath, Promise>>` | 全局单队列，教学够用；真 pi 按 canonical path 分锁提升并发 |
| 多编辑 | 一次 `edits[]` 数组，同原文匹配，逆序应用 | 教学版一次一个 old/new，简单直观 |
| AbortSignal | signal 贯穿 read/write/abort 检查 | s04 专题讲，本章队列短 |

---

## 默写验收

合上 code.ts 和本 README，打开 [practice.ts](/pi-learn/chapters/s03_edit_queue/practice.ts)，凭记忆补全：`enqueueMutation`、`writeTool`、`editTool`、`agentLoop`。

通过标准：`node practice.ts` 跑起来，能用 write 创建文件、用 edit 修改文件内容。

写不出 `enqueueMutation` 说明 promise 链没进脑子——回到「工作原理」第 1 块重读。写不出 `editTool` 说明"读-查-改-写"四步没理清——回到第 2 块。

---

下一章：[s04 中断与 steering](/pi-learn/chapters/s04_interrupt/)
