import { useEffect, useState } from "react";
import "./SessionTreeDiagram.css";

/**
 * s14 会话分支树动态图。
 * 展示 entry 树的生长、branch 切换、fork 复制、compaction 截断。
 * 核心是 leaf 指针在树上的移动：append 前进、branch 跳转、fork 复制。
 * @author fxbin
 */

interface NodeDef {
	id: string;
	parentId: string | null;
	role: "user" | "assistant" | "compaction" | "branch_summary";
	label: string;
}

interface StepDef {
	phase: string;
	label: string;
	tree: NodeDef[];
	leafId: string | null;
	forkedTree?: NodeDef[];
	forkedLeaf?: string | null;
	context: Array<{ role: string; content: string }>;
	highlight?: string;
}

const INITIAL_TREE: NodeDef[] = [];

const STEPS: StepDef[] = [
	{
		phase: "new",
		label: "新建会话（空树）",
		tree: INITIAL_TREE,
		leafId: null,
		context: [],
	},
	{
		phase: "append",
		label: "appendMessage: 用户提问 a",
		tree: [
			{ id: "a", parentId: null, role: "user", label: "你好" },
		],
		leafId: "a",
		context: [{ role: "user", content: "你好" }],
		highlight: "a",
	},
	{
		phase: "append",
		label: "appendMessage: 助手回复 b",
		tree: [
			{ id: "a", parentId: null, role: "user", label: "你好" },
			{ id: "b", parentId: "a", role: "assistant", label: "我是 agent" },
		],
		leafId: "b",
		context: [
			{ role: "user", content: "你好" },
			{ role: "assistant", content: "我是 agent" },
		],
		highlight: "b",
	},
	{
		phase: "append",
		label: "appendMessage: 用户继续 c",
		tree: [
			{ id: "a", parentId: null, role: "user", label: "你好" },
			{ id: "b", parentId: "a", role: "assistant", label: "我是 agent" },
			{ id: "c", parentId: "b", role: "user", label: "写个 hello" },
		],
		leafId: "c",
		context: [
			{ role: "user", content: "你好" },
			{ role: "assistant", content: "我是 agent" },
			{ role: "user", content: "写个 hello" },
		],
		highlight: "c",
	},
	{
		phase: "branch",
		label: "branch(b)：leaf 指针跳回 b",
		tree: [
			{ id: "a", parentId: null, role: "user", label: "你好" },
			{ id: "b", parentId: "a", role: "assistant", label: "我是 agent" },
			{ id: "c", parentId: "b", role: "user", label: "写个 hello" },
		],
		leafId: "b",
		context: [
			{ role: "user", content: "你好" },
			{ role: "assistant", content: "我是 agent" },
		],
		highlight: "b",
	},
	{
		phase: "append",
		label: "appendMessage: 从 b 分叉新问题 d",
		tree: [
			{ id: "a", parentId: null, role: "user", label: "你好" },
			{ id: "b", parentId: "a", role: "assistant", label: "我是 agent" },
			{ id: "c", parentId: "b", role: "user", label: "写个 hello" },
			{ id: "d", parentId: "b", role: "user", label: "写个 bye" },
		],
		leafId: "d",
		context: [
			{ role: "user", content: "你好" },
			{ role: "assistant", content: "我是 agent" },
			{ role: "user", content: "写个 bye" },
		],
		highlight: "d",
	},
	{
		phase: "fork",
		label: "fork(c)：复制 c 路径到新文件",
		tree: [
			{ id: "a", parentId: null, role: "user", label: "你好" },
			{ id: "b", parentId: "a", role: "assistant", label: "我是 agent" },
			{ id: "c", parentId: "b", role: "user", label: "写个 hello" },
			{ id: "d", parentId: "b", role: "user", label: "写个 bye" },
		],
		leafId: "d",
		forkedTree: [
			{ id: "a", parentId: null, role: "user", label: "你好" },
			{ id: "b", parentId: "a", role: "assistant", label: "我是 agent" },
			{ id: "c", parentId: "b", role: "user", label: "写个 hello" },
		],
		forkedLeaf: "c",
		context: [
			{ role: "user", content: "你好" },
			{ role: "assistant", content: "我是 agent" },
			{ role: "user", content: "写个 bye" },
		],
		highlight: "c",
	},
	{
		phase: "compact",
		label: "compaction：a/b 变灰，上下文只发 summary + d",
		tree: [
			{ id: "a", parentId: null, role: "user", label: "你好" },
			{ id: "b", parentId: "a", role: "assistant", label: "我是 agent" },
			{ id: "c", parentId: "b", role: "user", label: "写个 hello" },
			{ id: "d", parentId: "b", role: "user", label: "写个 bye" },
			{ id: "e", parentId: "d", role: "compaction", label: "摘要" },
		],
		leafId: "e",
		context: [
			{ role: "user", content: "[历史摘要] 用户问候并自我介绍" },
			{ role: "user", content: "写个 bye" },
		],
		highlight: "e",
	},
];

const ROLE_COLOR: Record<NodeDef["role"], string> = {
	user: "var(--orange)",
	assistant: "var(--green)",
	compaction: "var(--purple)",
	branch_summary: "var(--yellow)",
};

/**
 * 渲染单个会话树。
 * @param nodes 节点列表
 * @param leafId 当前 leaf 指针
 * @param highlight 高亮节点 id
 */
function TreeView({
	nodes,
	leafId,
	highlight,
}: {
	nodes: NodeDef[];
	leafId: string | null;
	highlight?: string;
}): JSX.Element {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const childrenOf = (parentId: string): NodeDef[] =>
		nodes.filter((n) => n.parentId === parentId);
	const roots = nodes.filter((n) => n.parentId === null);

	const renderNode = (node: NodeDef, depth: number): JSX.Element => {
		const children = childrenOf(node.id);
		const isLeaf = node.id === leafId;
		const isHighlight = node.id === highlight;
		const isCompaction = node.role === "compaction";
		const className = [
			"std-node",
			isLeaf ? "std-node-leaf" : "",
			isHighlight ? "std-node-highlight" : "",
			isCompaction ? "std-node-compaction" : "",
		]
			.filter(Boolean)
			.join(" ");
		return (
			<div className="std-node-wrap" key={node.id}>
				<div className={className}>
					<div
						className="std-node-dot"
						style={{ background: ROLE_COLOR[node.role] }}
					/>
					<div className="std-node-body">
						<div className="std-node-id">{node.id}</div>
						<div className="std-node-label">{node.label}</div>
					</div>
					{isLeaf && <div className="std-node-marker">◀ leaf</div>}
				</div>
				{children.length > 0 && (
					<div className="std-children">
						{children.map((c) => renderNode(c, depth + 1))}
					</div>
				)}
			</div>
		);
	};

	return (
		<div className="std-tree">
			{byId.size === 0 ? (
				<div className="std-empty">(空树)</div>
			) : (
				roots.map((r) => renderNode(r, 0))
			)}
		</div>
	);
}

export default function SessionTreeDiagram(): JSX.Element {
	const [step, setStep] = useState(0);
	const [playing, setPlaying] = useState(false);

	useEffect(() => {
		if (!playing) return;
		const id = setInterval(() => {
			setStep((s) => (s + 1) % STEPS.length);
		}, 2200);
		return () => clearInterval(id);
	}, [playing]);

	const current = STEPS[step]!;

	return (
		<div className="std-root diagram">
			<div className="std-header">
				<span className="std-title">SESSION TREE</span>
				<div className="std-controls">
					<button onClick={() => setPlaying(!playing)} type="button">
						{playing ? "PAUSE" : "PLAY"}
					</button>
					<button
						onClick={() => {
							setPlaying(false);
							setStep(0);
						}}
						type="button"
					>
						RESET
					</button>
				</div>
			</div>

			<div className="std-stage">
				<div className="std-panel">
					<div className="std-panel-label">当前会话</div>
					<TreeView
						nodes={current.tree}
						leafId={current.leafId}
						highlight={current.highlight}
					/>
				</div>

				<div className="std-side">
					{current.forkedTree && (
						<div className="std-panel std-panel-fork">
							<div className="std-panel-label">fork 出的新文件</div>
							<TreeView
								nodes={current.forkedTree}
								leafId={current.forkedLeaf ?? null}
							/>
						</div>
					)}
					<div className="std-panel std-panel-ctx">
						<div className="std-panel-label">LLM 上下文</div>
						<div className="std-ctx-list">
							{current.context.length === 0 ? (
								<div className="std-empty">(空)</div>
							) : (
								current.context.map((msg, i) => (
									<div className="std-ctx-item" key={i}>
										<span
											className="std-ctx-role"
											style={{
												color: msg.content.startsWith("[")
													? "var(--purple)"
													: msg.role === "user"
														? "var(--orange)"
														: "var(--green)",
											}}
										>
											{msg.role}
										</span>
										<span className="std-ctx-content">
											{msg.content.length > 40
												? msg.content.slice(0, 40) + "…"
												: msg.content}
										</span>
									</div>
								))
							)}
						</div>
					</div>
				</div>
			</div>

			<div className="std-footer">
				<span className="std-step">
					STEP {step + 1}/{STEPS.length}
				</span>
				<span className="std-step-label">{current.label}</span>
			</div>
		</div>
	);
}
