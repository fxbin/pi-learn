# 语言无关概念映射

agent harness 的概念与实现语言无关。这张表把你已有技术栈里的直觉钩子接到课程的每个概念上。给钩子，不给第三份代码——迁移代码你自己写得出。

| 课程概念 | 一句话本质 | Java/Spring 直觉 | 数据库直觉 |
|---|---|---|---|
| agent loop | 状态机：问模型 → 执行工具 → 回填，直到终止条件 | 事件驱动循环；`while` + 策略接口 | 存储过程的递归调用，每轮结果作为下一轮输入 |
| 消息数组 | 唯一状态，按序追加，全量重发 | 事件溯源（Event Sourcing）：状态 = 事件序列的重放 | redo log：恢复 = 从头回放 |
| tool_use | 模型输出的结构化调用请求，harness 代执行 | RPC stub 的反方向：客户端（模型）发请求，服务端（harness）在本地执行 | 存储过程调用约定：名字 + 参数 schema |
| 工具注册表 | 名字 → 实现 的分发表 | Spring 容器按名字取 Bean；`Map<String, Tool>` | 函数字典，无魔法 |
| AbortSignal | 跨层传递的取消令牌 | `Future.cancel(true)` / `Thread.interrupt` 的显式版本 | 事务超时传播 |
| steering 消息 | 循环运行中从外部注入新输入 | 阻塞队列：生产者（用户）随时塞，消费者（循环）每轮开头取 | 复制延迟期间追写 binlog |
| session/jsonl | append-only 文件持久化对话历史 | 审计日志表，只 INSERT 不 UPDATE | WAL：先落盘再应答，resume = 重放 |
| compaction | 上下文超长时压缩成摘要继续 | JVM GC：对象图太大，标记存活的、压缩空间，代价是停顿与信息丢失 | 日志归档：明细转汇总，省空间丢精度 |
| skills | 文件即提示词，按需注入 system prompt | `@ConditionalOnProperty` 的配置化能力开关 | 视图定义：不存数据，查询时展开 |
| provider 抽象 | 一个接口，多家 LLM 各自实现 wire format | JDBC `Driver`：统一 `Connection`，各家实现协议 | 方言（Dialect）：同一句 SQL 翻译成各家语法 |
| 消息边界转换 | 内部模型 ≠ LLM wire 模型，边界处单向转换 | DTO 与领域模型分离，Mapper 在控制器层 | 逻辑模型与物理模型分离 |

## 用这张表的方式

- 学新章之前，先看左列概念在中间两列的对应物，用已知锚定未知
- 类比只负责建立直觉，不负责精确。session 像 redo log，但 jsonl 没有 checkpoint 和二进制格式——类比的边界在各章「妥协清单」里
- 把 mini-pi 迁回你的技术栈时，这张表就是移植清单：每一行是一个要实现的分母
