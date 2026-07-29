#!/usr/bin/env node
/**
 * s14 默写验收：空白页模板
 *
 * 用法：合上 code.ts 与 README，凭记忆把每个函数的函数体补全。
 * 补全后运行 `node practice.ts demo`，能跑出完整的分支树生命周期即通过。
 * 写不出某个函数，回到 README 的「工作原理」重读对应步骤，再来默写。
 *
 * @author fxbin
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ── 配置 ──────────────────────────────────────────────

const CONFIG = {
	sessionDir: path.join(process.cwd(), ".session-tree-practice"),
	currentVersion: 3,
	idLength: 8,
	idRetryLimit: 100,
} as const;

// ── 类型边界 ─────────────────────────────────────────

interface SessionEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}

interface SessionMessageEntry extends SessionEntryBase {
	type: "message";
	role: "user" | "assistant" | "tool";
	content: string;
}

interface CompactionEntry extends SessionEntryBase {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
}

interface BranchSummaryEntry extends SessionEntryBase {
	type: "branch_summary";
	fromId: string | null;
	summary: string;
}

type SessionEntry =
	| SessionMessageEntry
	| CompactionEntry
	| BranchSummaryEntry;

interface SessionHeader {
	type: "session";
	version: number;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

type FileLine = SessionHeader | SessionEntry;

interface SessionTreeNode {
	entry: SessionEntry;
	children: SessionTreeNode[];
}

// ── ID 生成 ──────────────────────────────────────────

/**
 * 生成 8 字符 hex ID，带碰撞检测。
 * 提示：randomUUID 取前 8 位，最多重试 100 次；都碰撞就退回完整 UUID。
 * @param existing 已存在的 id 集合
 * @returns 8 字符 hex 字符串
 */
function generateId(existing: Set<string>): string {
	// TODO: 在这里默写 ID 生成
	throw new Error("not implemented");
}

// ── SessionTree ──────────────────────────────────────

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
	 * 提示：生成 sessionId；构造 header；清空 lines/byId/leafId；
	 * 设置 sessionFile（文件名 = 时间戳_sessionId.jsonl，时间戳把 : 和 . 换成 -）；
	 * ensureDir + flush。
	 * @returns 新会话 id
	 */
	newSession(): string {
		// TODO: 在这里默写 newSession
		throw new Error("not implemented");
	}

	/**
	 * 追加一条消息 entry。
	 * 提示：构造 SessionMessageEntry，parentId = 当前 leafId；
	 * 调用 appendEntry 内部方法；返回新 id。
	 * @param role 消息角色
	 * @param content 消息文本
	 * @returns 新 entry 的 id
	 */
	appendMessage(role: SessionMessageEntry["role"], content: string): string {
		// TODO: 在这里默写 appendMessage
		throw new Error("not implemented");
	}

	/**
	 * 追加一条 compaction entry。
	 * 提示：与 appendMessage 同形，只是 type/字段不同。
	 */
	appendCompaction(
		summary: string,
		firstKeptEntryId: string,
		tokensBefore: number,
	): string {
		// TODO: 在这里默写 appendCompaction
		throw new Error("not implemented");
	}

	/**
	 * 切换分支：只改 leafId 指针，不追加 entry。
	 * 提示：校验 targetId 存在；改 this.leafId；flush。
	 * @param targetId 要切换到的 entry id
	 */
	branch(targetId: string): void {
		// TODO: 在这里默写 branch
		throw new Error("not implemented");
	}

	/**
	 * fork 到新文件：复制 root→leafId 路径上的所有 entry 到新会话。
	 * 提示：getBranch 取路径；new SessionTree；构造 header（带 parentSession）；
	 * child.lines = [header, ...pathEntries]；rebuildIndex + ensureDir + flush。
	 * @param targetLeafId 要 fork 的叶子节点 id（默认当前 leafId）
	 * @returns 新 SessionTree 实例
	 */
	fork(targetLeafId?: string): SessionTree {
		// TODO: 在这里默写 fork
		throw new Error("not implemented");
	}

	/**
	 * 路径回溯：从 leaf 沿 parentId 链回溯到根。
	 * 提示：用 byId Map；while 循环 unshift 到数组头部；
	 * 直到 parentId 为 null 或找不到父节点。返回 root→leaf 顺序。
	 * @param fromId 起点 entry id（默认当前 leafId）
	 * @returns root→leaf 路径上的 entry 数组
	 */
	getBranch(fromId?: string): SessionEntry[] {
		// TODO: 在这里默写 getBranch
		throw new Error("not implemented");
	}

	/**
	 * 构建 LLM 上下文：从 root→leaf 路径中提取消息。
	 * 关键：遇到 compaction 会截断——只发 summary + firstKeptEntryId 之后的消息。
	 * 提示：先 getBranch；找路径上最后一个 compaction；没有就全部 message 都发；
	 * 有就在 compaction 前找 firstKeptEntryId 之后的消息 + compaction 后的消息；
	 * branch_summary 作为 user 消息发。
	 * @returns 消息数组（role + content）
	 */
	buildContext(): Array<{ role: string; content: string }> {
		// TODO: 在这里默写 buildContext
		throw new Error("not implemented");
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

	/** 构建完整树结构 */
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
		return roots;
	}

	/** 从文件加载 */
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

	/**
	 * 内部：追加 entry 并持久化。
	 * 提示：lines.push + byId.set + leafId 更新 + flush。
	 */
	private appendEntry(entry: SessionEntry): void {
		// TODO: 在这里默写 appendEntry
		throw new Error("not implemented");
	}

	/**
	 * 内部：重建内存索引。
	 * 提示：清空 byId 和 leafId；遍历 lines，跳过 header；
	 * byId.set(id, entry)；leafId = 最后一条 entry 的 id。
	 */
	private rebuildIndex(): void {
		// TODO: 在这里默写 rebuildIndex
		throw new Error("not implemented");
	}

	/** 内部：把整个 lines 数组重写到文件 */
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

// ── 可视化（已实现，不用默写） ─────────────────────────

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

// ── 验收 demo ────────────────────────────────────────

/**
 * 跑一遍完整的分支树生命周期：
 * new → 三轮对话 → branch 回到第 2 轮 → 新分支 → fork → compaction。
 * 全部默写完成后运行 `node practice.ts demo`，能完整跑通即通过。
 */
function runDemo(): void {
	console.log("=== s14 默写验收 demo ===\n");
	fs.rmSync(CONFIG.sessionDir, { recursive: true, force: true });
	const tree = new SessionTree(process.cwd());
	tree.newSession();
	const a = tree.appendMessage("user", "你好");
	const b = tree.appendMessage("assistant", "你好，我是 agent");
	const c = tree.appendMessage("user", "写个 hello");
	tree.appendMessage("assistant", "console.log('hi')");
	printTree(tree);
	printContext(tree);

	tree.branch(b);
	const d = tree.appendMessage("user", "写个 bye");
	tree.appendMessage("assistant", "console.log('bye')");
	printTree(tree);

	const child = tree.fork(c);
	child.appendMessage("assistant", "(fork 后)");
	printTree(child);

	tree.appendCompaction("用户问候并自我介绍", d, 1000);
	printTree(tree);
	printContext(tree);
	console.log("\n通过：分支树生命周期完整。");
}

if (process.argv[2] === "demo") {
	runDemo();
}
