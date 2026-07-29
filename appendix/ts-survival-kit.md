# TS 急救包

给 Java/Python 背景读者的 10 分钟扫盲。只看本课程用到的语法，不多不少。

## 你会反复见到的六样东西

**1. `interface` / `type` — 只在边界上写**

描述对象形状，运行时不存在，删掉代码照跑：

```typescript
interface ChatMessage {
	role: "user" | "assistant";
	content: string | ContentBlock[];
}
```

`"user" | "assistant"` 是字面量联合类型，相当于枚举值的写法但零成本。本课程禁止 `enum`，这就是替代方案。

**2. 可选链 `?.` 与空值合并 `??`**

```typescript
const url = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
```

`??`：左边是 `null`/`undefined` 才取右边（`||` 会把空字符串也判掉，别混用）。`?.`：链上任何一环为空则整体短路为 `undefined`。

**3. import 路径带 `.ts` 后缀**

```typescript
import { runBash } from "./tools.ts";
```

node 直接跑 `.ts`，import 写真实文件名。这不是 typo，是 node strip 模式的要求。

**4. 模板字符串**

反引号 + `${}` 内插，等价于 Python f-string：

```typescript
console.log(`请求失败 ${response.status}`);
```

**5. 数组三板斧**

`map`（变换）、`filter`（筛选）、`some`（任一匹配）。本课程代码里出现频率最高的是：

```typescript
const toolCalls = message.content.filter((c) => c.type === "toolCall");
```

`(c) => ...` 是箭头函数，等价于 Java 的 lambda、Python 的 lambda。

**6. `async` / `await` 与顶层 `await`**

和 Python 语义相同。入口文件最后一行 `await main();` 是合法的（node 22 ESM 支持顶层 await），不需要包一层自调用函数。

## 你不许用的东西

`tsconfig.json` 打开了 `erasableSyntaxOnly`，编译器会直接报错：

| 禁用 | 替代 |
|---|---|
| `enum` | 字面量联合类型：`type Role = "user" \| "assistant"` |
| `namespace` / `module` | 一个文件就是一个模块，用 `import`/`export` |
| `decorator` | 课程里本来就用不到，函数组合即可 |
| constructor 参数属性（`constructor(private x: number)`） | 显式写字段再赋值 |

## 读代码时的三个提醒

1. **类型注解全是可擦除的注释**：读不懂某段类型，直接在脑子里删掉它，剩下的 JS 就是全部运行时行为
2. **`as const`**：把对象字面量的每个属性锁成只读字面量类型，配置区常见，运行时零效果
3. **泛型尖括号**：本课程要求"泛型体操见即删"，你只会见到最简单的 `Promise<T>`、`Array<T>`，读法就是"装着 T 的容器"

读完这一页就可以开写 s01 了。卡壳时回来查，不要提前精读。
