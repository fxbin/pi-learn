#!/usr/bin/env node
/**
 * s14 会话分支树 —— 一个 .jsonl 文件如何承载对话分叉
 *
 * s05 讲的是线性 append-only：每条消息往后追加，只能回放一条路径。
 * 但真实 agent 经常需要"回到第 3 轮重新问一遍"——这时不能改历史，
 * 而是从历史某点分叉出一条新路径，旧路径保留，新路径独立演进。
 *
 * 核心模式：
 *     entry 树：每条 entry 带 id + parentId，构成 DAG
 *     JSONL 持久化：第一行 header，其余每行一个 entry
 *     branch：只改 leafId 指针，不追加 entry（同文件内切换分支）
 *     fork：复制 root→leaf 路径到新文件（跨文件分叉）
 *     compaction 截断：buildContext 时只发 summary + firstKeptEntryId 之后的消息
 *
 *      root (null)
 *       │
 *      msg1 (id=a, parentId=null)
 *       │
 *      msg2 (id=b, parentId=a)
 *       │
 *      msg3 (id=c, parentId=b)        ← leafId 当前在这
 *
 *  branch(a)：把 leafId 改成 a，之后 appendMessage 的新 entry parentId=a，
 *  原来的 b/c 仍在文件里，形成第二条分支。
 *
 *  fork(b)：复制 root→b 路径到新文件，原文件不变。
 *
 * 运行方式：
 *   node code.ts            # 进入 REPL
 *   node code.ts demo       # 跑内置 demo，无 API key 也能看分支树效果
 *
 * @author fxbin
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

// ── 配置：本文件全部可调项集中于此 ──────────────────────

const CONFIG = {
	sessionDir: process.env.SESSION_DIR ?? path.join(process.cwd(), ".session-tree-demo"),
	currentVersion: 3,
	idLength: 8,
	idRetryLimit: 100,
} as const;

// ── 类型边界：entry 树的数据形状 ────────────────────────

/**
 * 所有 entry 的公共字段。
 * id 是 8 字符 hex；parentId 指向父节点 id，根节点为 null；timestamp 是 ISO 字符串。
 */
interface SessionEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}

/**
 * 普通对话消息 entry。
 * role: user / assistant / tool；content 是消息文本（教学版简化，不分块）。
 */
interface SessionMessageEntry extends SessionEntryBase {
	type: "message";
	role: "user" | "assistant" | "tool";
	content: string;
}

/**
 * 上下文压缩 entry。
 * summary 是被压缩历史段的摘要文本；firstKeptEntryId 是保留消息的起始 entry id；
 * tokensBefore 是压缩前的 token 数（教学版只记录，不真实计算）。
 */
interface CompactionEntry extends SessionEntryBase {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
}

/**
 * 分支切换摘要 entry。
 * 从一个分支切换到另一个分支时，可选择追加一条 summary 描述被放弃的分支，
 * 让后续模型知道"为什么历史突然变了"。
 */
interface BranchSummaryEntry extends SessionEntryBase {
	type: "branch_summary";
	fromId: string | null;
	summary: string;
}

type SessionEntry =
	| SessionMessageEntry
	| CompactionEntry
	| BranchSummaryEntry;

/**
 * JSONL 文件第一行的 header。
 * type 固定 "session"；version 是 schema 版本；id 是会话 id；
 * timestamp 是创建时间；cwd 是工作目录；parentSession 指向父会话文件（fork 时用）。
 */
interface SessionHeader {
	type: "session";
	version: number;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

type FileLine = SessionHeader | SessionEntry;

/**
 * 树节点：entry + 子节点列表。getTree() 返回这个结构。
 */
interface SessionTreeNode {
	entry: SessionEntry;
	children: SessionTreeNode[];
}

// ── ID 生成：8 字符 hex，带碰撞重试 ─────────────────────

/**
 * 生成 8 字符 hex ID，带碰撞检测。
 * 用 randomUUID 取前 8 位，重试 100 次；都碰撞了就退回完整 UUID。
 * @param existing 已存在的 id 集合，用于碰撞检测
 * @returns 8 字符 hex 字符串
 */
function generateId(existing: Set<string>): string {
	for (let i = 0; i < CONFIG.idRetryLimit; i++) {
		const id = crypto.randomUUID().slice(0, CONFIG.idLength);
		if (!existing.has(id)) {
			return id;
		}
	}
	return crypto.randomUUID();
}

// ── SessionTree：entry 树的核心实现 ─────────────────────

/**
 * 会话分支树。
 * 一个实例对应一个 .jsonl 文件，内部维护 entry 列表 + id 索引 + leafId 指针。
 * 所有写操作都同步追加到文件（教学版简化，无文件锁）。
 */
class SessionTree {
	private lines: FileLine[] = [];
	private byId = new Map<string, SessionEntry>();
	private leafId: string | null = null;
	private sessionId = "";
	private sessionFile: string | null = null;
	private cwd: string;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	/**
	 * 创建新会话：写 header，准备接收 entry。
	 * @returns 新会话 id
	 */
	newSession(): string {
		this.sessionId = crypto.randomUUID();
		const header: SessionHeader = {
			type: "session",
			version: CONFIG.currentVersion,
			id: this.sessionId,
			timestamp: new Date().toISOString(),
			cwd: this.cwd,
		};
		this.lines = [header];
		this.byId.clear();
		this.leafId = null;
		const fileTimestamp = header.timestamp.replace(/[:.]/g, "-");
		this.sessionFile = path.join(
			CONFIG.sessionDir,
			`${fileTimestamp}_${this.sessionId}.jsonl`,
		);
		this.ensureDir();
		this.flush();
		return this.sessionId;
	}

	/**
	 * 追加一条消息 entry。
	 * parentId 自动指向当前 leafId；追加后 leafId 前进到新 entry。
	 * @param role 消息角色
	 * @param content 消息文本
	 * @returns 新 entry 的 id
	 */
	appendMessage(role: SessionMessageEntry["role"], content: string): string {
		const entry: SessionMessageEntry = {
			type: "message",
			id: generateId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			role,
			content,
		};
		this.appendEntry(entry);
		return entry.id;
	}

	/**
	 * 追加一条 compaction entry。
	 * 模拟上下文压缩：summary 是被压缩段的摘要，firstKeptEntryId 是保留消息起点。
	 * @param summary 压缩摘要
	 * @param firstKeptEntryId 保留的第一条消息 entry id
	 * @param tokensBefore 压缩前 token 数
	 * @returns 新 entry 的 id
	 */
	appendCompaction(
		summary: string,
		firstKeptEntryId: string,
		tokensBefore: number,
	): string {
		const entry: CompactionEntry = {
			type: "compaction",
			id: generateId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			summary,
			firstKeptEntryId,
			tokensBefore,
		};
		this.appendEntry(entry);
		return entry.id;
	}

	/**
	 * 切换分支：只改 leafId 指针，不追加任何 entry。
	 * 后续 appendMessage 的新 entry parentId 会指向新的 leafId，
	 * 由此分叉出一条新分支。旧分支的 entry 仍在文件里。
	 * @param targetId 要切换到的 entry id
	 */
	branch(targetId: string): void {
		if (!this.byId.has(targetId)) {
			throw new Error(`Entry ${targetId} 不存在`);
		}
		this.leafId = targetId;
		this.flush();
	}

	/**
	 * 切换分支并追加一条 branch_summary。
	 * 让模型知道"为什么历史突然变了"，避免上下文断裂。
	 * @param targetId 要切换到的 entry id
	 * @param summary 被放弃分支的摘要
	 * @returns 新 branch_summary entry 的 id
	 */
	branchWithSummary(targetId: string, summary: string): string {
		if (!this.byId.has(targetId)) {
			throw new Error(`Entry ${targetId} 不存在`);
		}
		this.leafId = targetId;
		const entry: BranchSummaryEntry = {
			type: "branch_summary",
			id: generateId(this.byId),
			parentId: targetId,
			timestamp: new Date().toISOString(),
			fromId: targetId,
			summary,
		};
		this.appendEntry(entry);
		return entry.id;
	}

	/**
	 * fork 到新文件：复制 root→leafId 路径上的所有 entry 到新会话。
	 * 原文件不变；新会话的 header 会带 parentSession 指向源文件。
	 * @param targetLeafId 要 fork 的叶子节点 id（默认当前 leafId）
	 * @returns 新 SessionTree 实例
	 */
	fork(targetLeafId?: string): SessionTree {
		const leafId = targetLeafId ?? this.leafId;
		if (!leafId) {
			throw new Error("没有当前 leaf，无法 fork");
		}
		const pathEntries = this.getBranch(leafId);
		const child = new SessionTree(this.cwd);
		child.sessionId = crypto.randomUUID();
		const header: SessionHeader = {
			type: "session",
			version: CONFIG.currentVersion,
			id: child.sessionId,
			timestamp: new Date().toISOString(),
			cwd: this.cwd,
			parentSession: this.sessionFile ?? undefined,
		};
		child.lines = [header, ...pathEntries];
		const fileTimestamp = header.timestamp.replace(/[:.]/g, "-");
		child.sessionFile = path.join(
			CONFIG.sessionDir,
			`${fileTimestamp}_${child.sessionId}.jsonl`,
		);
		child.rebuildIndex();
		child.ensureDir();
		child.flush();
		return child;
	}

	/**
	 * clone：等价于 fork(currentLeafId)。
	 * 在当前位置快照一份到新文件。
	 * @returns 新 SessionTree 实例
	 */
	clone(): SessionTree {
		return this.fork(this.leafId ?? undefined);
	}

	/**
	 * 路径回溯：从 leaf 沿 parentId 链回溯到根。
	 * 返回 root→leaf 顺序的 entry 数组（unshift 保证顺序）。
	 * @param fromId 起点 entry id（默认当前 leafId）
	 * @returns root→leaf 路径上的 entry 数组
	 */
	getBranch(fromId?: string): SessionEntry[] {
		const startId = fromId ?? this.leafId;
		const branch: SessionEntry[] = [];
		let current = startId ? this.byId.get(startId) : undefined;
		while (current) {
			branch.unshift(current);
			current = current.parentId
				? this.byId.get(current.parentId)
				: undefined;
		}
		return branch;
	}

	/**
	 * 构建完整树结构：遍历所有 entry，按 parentId 组装父子关系。
	 * 孤儿节点（parentId 指向不存在的 entry）作为 root。
	 * @returns 根节点数组
	 */
	getTree(): SessionTreeNode[] {
		const nodeMap = new Map<string, SessionTreeNode>();
		const roots: SessionTreeNode[] = [];
		for (const entry of this.lines) {
			if (entry.type === "session") continue;
			nodeMap.set(entry.id, { entry, children: [] });
		}
		for (const entry of this.lines) {
			if (entry.type === "session") continue;
			const node = nodeMap.get(entry.id)!;
			if (entry.parentId === null) {
				roots.push(node);
			} else {
				const parent = nodeMap.get(entry.parentId);
				if (parent) {
					parent.children.push(node);
				} else {
					roots.push(node);
				}
			}
		}
		const sortChildren = (nodes: SessionTreeNode[]): void => {
			nodes.sort(
				(a, b) =>
					new Date(a.entry.timestamp).getTime() -
					new Date(b.entry.timestamp).getTime(),
			);
			for (const node of nodes) {
				sortChildren(node.children);
			}
		};
		sortChildren(roots);
		return roots;
	}

	/**
	 * 构建 LLM 上下文：从 root→leaf 路径中提取消息。
	 * 关键：遇到 compaction 会截断——只发 summary + firstKeptEntryId 之后的消息，
	 * compaction 之前的消息不发给 LLM（但仍在文件里，可回溯）。
	 * @returns 消息数组（role + content）
	 */
	buildContext(): Array<{ role: string; content: string }> {
		const branchPath = this.getBranch();
		const messages: Array<{ role: string; content: string }> = [];
		const lastCompaction = branchPath
			.filter((e): e is CompactionEntry => e.type === "compaction")
			.pop();
		if (!lastCompaction) {
			for (const entry of branchPath) {
				if (entry.type === "message") {
					messages.push({ role: entry.role, content: entry.content });
				} else if (entry.type === "branch_summary") {
					messages.push({
						role: "user",
						content: `[分支摘要] ${entry.summary}`,
					});
				}
			}
			return messages;
		}
		messages.push({
			role: "user",
			content: `[历史摘要] ${lastCompaction.summary}`,
		});
		const compactionIdx = branchPath.indexOf(lastCompaction);
		let foundFirstKept = false;
		for (let i = 0; i < compactionIdx; i++) {
			const entry = branchPath[i]!;
			if (entry.id === lastCompaction.firstKeptEntryId) {
				foundFirstKept = true;
			}
			if (foundFirstKept && entry.type === "message") {
				messages.push({ role: entry.role, content: entry.content });
			}
		}
		for (let i = compactionIdx + 1; i < branchPath.length; i++) {
			const entry = branchPath[i]!;
			if (entry.type === "message") {
				messages.push({ role: entry.role, content: entry.content });
			} else if (entry.type === "branch_summary") {
				messages.push({
					role: "user",
					content: `[分支摘要] ${entry.summary}`,
				});
			}
		}
		return messages;
	}

	/**
	 * 从文件加载会话。
	 * 读 JSONL：第一行 header，其余每行一个 entry。
	 * 加载后 leafId = 文件最后一条 entry 的 id（教学版简化，无 LeafEntry）。
	 * @param filePath .jsonl 文件路径
	 */
	load(filePath: string): void {
		const content = fs.readFileSync(filePath, "utf-8");
		const lines = content.split("\n").filter((line) => line.trim());
		if (lines.length === 0) {
			throw new Error(`文件为空: ${filePath}`);
		}
		this.lines = lines.map((line) => JSON.parse(line) as FileLine);
		this.sessionFile = filePath;
		const header = this.lines[0];
		if (!header || header.type !== "session") {
			throw new Error(`缺少 header: ${filePath}`);
		}
		this.sessionId = header.id;
		this.rebuildIndex();
	}

	/** 当前 leafId */
	getLeafId(): string | null {
		return this.leafId;
	}

	/** 当前会话文件路径 */
	getSessionFile(): string | null {
		return this.sessionFile;
	}

	/** 所有 entry（不含 header） */
	getEntries(): SessionEntry[] {
		return this.lines.filter(
			(line): line is SessionEntry => line.type !== "session",
		);
	}

	/**
	 * 内部：追加 entry 并持久化。
	 * @param entry 要追加的 entry
	 */
	private appendEntry(entry: SessionEntry): void {
		this.lines.push(entry);
		this.byId.set(entry.id, entry);
		this.leafId = entry.id;
		this.flush();
	}

	/**
	 * 内部：重建内存索引。
	 * 遍历所有 entry，填充 byId Map；leafId = 最后一条 entry 的 id。
	 */
	private rebuildIndex(): void {
		this.byId.clear();
		this.leafId = null;
		for (const line of this.lines) {
			if (line.type === "session") continue;
			this.byId.set(line.id, line);
			this.leafId = line.id;
		}
	}

	/**
	 * 内部：把整个 lines 数组重写到文件。
	 * 用于 newSession / fork / load 后的初始化。
	 */
	private flush(): void {
		if (!this.sessionFile) return;
		this.ensureDir();
		const content =
			this.lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
		fs.writeFileSync(this.sessionFile, content, "utf-8");
	}

	/** 内部：确保 session 目录存在 */
	private ensureDir(): void {
		if (this.sessionFile) {
			fs.mkdirSync(path.dirname(this.sessionFile), { recursive: true });
		}
	}
}

// ── 可视化：把树打印到终端 ───────────────────────────────

/**
 * 把 SessionTree 打印成缩进树。
 * 用前缀字符标记层级：├── / └── / │
 * @param tree 会话树实例
 */
function printTree(tree: SessionTree): void {
	const roots = tree.getTree();
	const leafId = tree.getLeafId();
	console.log(`\n会话 ${tree.getSessionFile()?.split(path.sep).pop() ?? "(未保存)"}`);
	console.log(`当前 leaf: ${leafId ?? "(空)"}\n`);
	const render = (nodes: SessionTreeNode[], prefix: string): void => {
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i]!;
			const isLast = i === nodes.length - 1;
			const branch = isLast ? "└── " : "├── ";
			const childPrefix = prefix + (isLast ? "    " : "│   ");
			const entry = node.entry;
			const marker = entry.id === leafId ? " ◀ leaf" : "";
			let label: string;
			if (entry.type === "message") {
				const preview =
					entry.content.length > 40
						? entry.content.slice(0, 40) + "…"
						: entry.content;
				label = `${entry.role}: ${preview}`;
			} else if (entry.type === "compaction") {
				label = `compaction (tokens=${entry.tokensBefore})`;
			} else {
				label = `branch_summary: ${entry.summary.slice(0, 30)}`;
			}
			console.log(`${prefix}${branch}[${entry.id}] ${label}${marker}`);
			render(node.children, childPrefix);
		}
	};
	render(roots, "");
}

/**
 * 打印 buildContext 的结果，让学习者看到 compaction 截断效果。
 * @param tree 会话树实例
 */
function printContext(tree: SessionTree): void {
	const messages = tree.buildContext();
	console.log(`\nLLM 上下文（${messages.length} 条消息）:`);
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]!;
		const preview =
			msg.content.length > 60 ? msg.content.slice(0, 60) + "…" : msg.content;
		console.log(`  ${i + 1}. [${msg.role}] ${preview}`);
	}
}

// ── 内置 demo：无 API key 也能看分支树效果 ────────────────

/**
 * 跑一遍完整的分支树生命周期：
 * 新建会话 → 三轮对话 → branch 回到第 2 轮 → 新分支 → fork → compaction。
 */
function runDemo(): void {
	console.log("=== s14 会话分支树 demo ===\n");
	fs.rmSync(CONFIG.sessionDir, { recursive: true, force: true });
	const tree = new SessionTree(process.cwd());
	tree.newSession();
	console.log("① 新建会话，追加三轮对话");
	const a = tree.appendMessage("user", "你好，介绍一下你自己");
	const b = tree.appendMessage("assistant", "我是 mini agent");
	const c = tree.appendMessage("user", "写个 hello world");
	tree.appendMessage("assistant", "console.log('hello')");
	printTree(tree);
	printContext(tree);

	console.log("\n② branch(b)：回到第 2 轮，重新提问");
	tree.branch(b);
	const d = tree.appendMessage("user", "写个 goodbye world");
	tree.appendMessage("assistant", "console.log('bye')");
	printTree(tree);
	console.log(`\n新分支 entry id: ${d}（parentId=${b}）`);

	console.log("\n③ fork(c)：把第 3 轮分叉到新文件");
	const child = tree.fork(c);
	console.log(`新会话文件: ${child.getSessionFile()}`);
	child.appendMessage("assistant", "(fork 后的回复)");
	printTree(child);

	console.log("\n④ compaction：压缩 a→b 路径");
	tree.appendCompaction("用户问候并自我介绍", d, 1000);
	printTree(tree);
	printContext(tree);
	console.log("\n注意 buildContext：compaction 之前的 a/b 消息不再发给 LLM，");
	console.log("但它们仍在文件里，getTree 仍能看到。这就是「历史保留 + 上下文截断」。\n");
}

// ── REPL 交互入口 ────────────────────────────────────────

/**
 * 交互式 REPL：用命令驱动会话树。
 * 命令：
 *   new              新建会话
 *   send <role> <text>  追加消息（role: user/assistant/tool）
 *   branch <id>      切换分支到指定 entry
 *   fork [id]        fork 当前 leaf 或指定 id 到新文件
 *   clone            在当前位置 fork 一份
 *   compact <id> <summary>  在指定 entry 处压缩
 *   tree             打印树
 *   ctx              打印 LLM 上下文
 *   save             手动 flush（实际每次操作都已 flush）
 *   load <file>      加载文件
 *   demo             跑内置 demo
 *   help             帮助
 *   exit             退出
 */
async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args[0] === "demo") {
		runDemo();
		return;
	}
	console.log("s14: 会话分支树");
	console.log("输入 help 看命令，输入 demo 跑内置演示，输入 exit 退出。\n");
	const tree = new SessionTree(process.cwd());
	tree.newSession();
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	const ask = (prompt: string): Promise<string> =>
		new Promise((resolve) => rl.question(prompt, resolve));
	while (true) {
		const input = (await ask("\x1b[36ms14 >> \x1b[0m")).trim();
		if (!input || input === "exit" || input === "q") {
			break;
		}
		const parts = input.split(/\s+/);
		const cmd = parts[0]!;
		try {
			switch (cmd) {
				case "help":
					console.log("命令: new / send <role> <text> / branch <id> /");
					console.log("      fork [id] / clone / compact <id> <summary> /");
					console.log("      tree / ctx / load <file> / demo / exit");
					break;
				case "new":
					tree.newSession();
					console.log(`新会话: ${tree.getSessionFile()}`);
					break;
				case "send": {
					const role = parts[1] as SessionMessageEntry["role"];
					const content = parts.slice(2).join(" ");
					if (!role || !content) {
						console.log("用法: send <user|assistant|tool> <text>");
						break;
					}
					const id = tree.appendMessage(role, content);
					console.log(`追加 entry: ${id}`);
					break;
				}
				case "branch": {
					const id = parts[1];
					if (!id) {
						console.log("用法: branch <entryId>");
						break;
					}
					tree.branch(id);
					console.log(`leaf 切换到: ${id}`);
					break;
				}
				case "fork": {
					const targetId = parts[1];
					const child = targetId ? tree.fork(targetId) : tree.fork();
					console.log(`fork 到新文件: ${child.getSessionFile()}`);
					break;
				}
				case "clone": {
					const child = tree.clone();
					console.log(`clone 到新文件: ${child.getSessionFile()}`);
					break;
				}
				case "compact": {
					const id = parts[1];
					const summary = parts.slice(2).join(" ") || "(无摘要)";
					if (!id) {
						console.log("用法: compact <firstKeptEntryId> <summary>");
						break;
					}
					tree.appendCompaction(summary, id, 999);
					console.log(`compaction 已追加，firstKept=${id}`);
					break;
				}
				case "tree":
					printTree(tree);
					break;
				case "ctx":
					printContext(tree);
					break;
				case "load": {
					const file = parts[1];
					if (!file) {
						console.log("用法: load <file>");
						break;
					}
					tree.load(file);
					console.log(`已加载: ${file}`);
					break;
				}
				case "demo":
					runDemo();
					break;
				default:
					console.log(`未知命令: ${cmd}（输入 help）`);
			}
		} catch (err) {
			console.log(`错误: ${(err as Error).message}`);
		}
	}
	rl.close();
}

await main();
