#!/usr/bin/env node
/**
 * s07 skills —— 文件即 prompt 注入 + 优雅降级
 *
 * s01 的 agent 只有一段写死的 SYSTEM_PROMPT。本章让 agent 能"读外部知识"：
 * 扫描 skills 目录，把每个 .md 文件解析成 { name, content }，追加进 SYSTEM_PROMPT。
 * 关键工程决策：坏文件不抛异常，收集成 diagnostic 继续跑。生产软件容忍坏文件；玩具直接崩。
 *
 *     扫描目录 → 读 .md → 解析(首行 # Name + body) → 追加到 SYSTEM_PROMPT
 *                        ↓ 读失败 / 解析失败 → diagnostic（不抛，继续下一个文件）
 *
 * 运行：export ANTHROPIC_API_KEY=sk-ant-... && node code.ts
 * @author fxbin
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline";

// ── 配置：本文件全部可调项集中于此 ──────────────────────

const CONFIG = {
	baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
	apiKey: process.env.ANTHROPIC_API_KEY ?? "",
	model: process.env.MODEL_ID ?? "claude-sonnet-4-5",
	anthropicVersion: "2023-06-01",
	maxTokens: 8000,
	bashTimeoutMs: 120_000,
	maxOutputChars: 50_000,
	skillsDir: "./skills",
} as const;

const BLOCKED_PATTERNS = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
const BASE_PROMPT = `You are a coding agent at ${process.cwd()}. Use bash to solve tasks. Act, don't explain.`;

// ── 类型边界：Anthropic Messages API 的请求/响应形状 ────

/** 已加载的 skill：名字 + 正文，教学版只保留这两项。 */
interface LoadedSkill { /** 取自文件首行 "# Name" */ name: string; /** 首行之后的全部内容 */ content: string }
interface TextBlock { type: "text"; text: string }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: { command: string } }
interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
interface ChatMessage { role: "user" | "assistant"; content: string | ContentBlock[] }
interface MessagesResponse { content: ContentBlock[]; stop_reason: string }
interface ToolDef { name: string; description: string; input_schema: object }

const TOOLS: ToolDef[] = [
	{ name: "bash", description: "Run a shell command.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
];

/**
 * 扫描目录加载 skills：遍历 .md 文件，解析首行 # Name + 余下 body。
 * 任何单文件错误（读失败、解析失败）收集为 diagnostic 继续走，绝不抛异常。
 * 目录不存在视为空目录，不报错（首次使用还没建 skills/ 是常态）。
 * @param dir skills 目录路径
 * @returns 加载成功的 skills 与诊断消息列表
 */
function loadSkills(dir: string): { skills: LoadedSkill[]; diagnostics: string[] } {
	const skills: LoadedSkill[] = [];
	const diagnostics: string[] = [];
	let rootInfo;
	try { rootInfo = statSync(dir); } catch { return { skills, diagnostics }; }
	if (!rootInfo.isDirectory()) {
		diagnostics.push(`skills path is not a directory: ${dir}`);
		return { skills, diagnostics };
	}
	let entries: string[];
	try { entries = readdirSync(dir); } catch (err) {
		diagnostics.push(`failed to list ${dir}: ${(err as Error).message}`);
		return { skills, diagnostics };
	}
	for (const entry of entries.sort()) {
		if (!entry.endsWith(".md")) continue;
		const fullPath = join(dir, entry);
		let raw: string;
		try { raw = readFileSync(fullPath, "utf-8"); } catch (err) {
			diagnostics.push(`read failed: ${fullPath}: ${(err as Error).message}`);
			continue;
		}
		const parsed = parseSkill(raw);
		if (!parsed) {
			diagnostics.push(`parse failed: ${fullPath}: expected first line "# Skill Name"`);
			continue;
		}
		skills.push(parsed);
	}
	return { skills, diagnostics };
}

/** 解析单个 skill 文件：首行必须形如 "# Name"，其余为内容。解析失败返回 null。
 * @param raw 文件原始文本
 */
function parseSkill(raw: string): LoadedSkill | null {
	const trimmed = raw.trimStart();
	const match = /^#\s+(.+?)\s*$/m.exec(trimmed);
	if (!match) return null;
	const name = match[1];
	const body = trimmed.slice(match[0].length).trim();
	return { name, content: body };
}

/**
 * 把 skills 拼成系统提示词追加段：base + 每个 skill 包成 XML 块。
 * @param skills 已加载的 skill 列表
 * @returns 拼接后的完整 system prompt
 */
function buildSystemPrompt(skills: LoadedSkill[]): string {
	if (skills.length === 0) return BASE_PROMPT;
	const blocks = skills.map((s) => `<skill name="${s.name}">\n${s.content}\n</skill>`).join("\n\n");
	return `${BASE_PROMPT}\n\nThe following skills provide specialized instructions:\n\n${blocks}`;
}

/**
 * 调用 LLM：原生 fetch 非流式请求。
 * @param messages 对话历史
 * @param system 系统提示词（含已注入的 skills）
 * @returns content 块与 stop_reason
 */
async function callLlm(messages: ChatMessage[], system: string): Promise<MessagesResponse> {
	const response = await fetch(`${CONFIG.baseUrl}/v1/messages`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-api-key": CONFIG.apiKey, "anthropic-version": CONFIG.anthropicVersion },
		body: JSON.stringify({ model: CONFIG.model, max_tokens: CONFIG.maxTokens, system, messages, tools: TOOLS }),
	});
	if (!response.ok) {
		throw new Error(`LLM 请求失败 ${response.status}: ${(await response.text()).slice(0, 500)}`);
	}
	return (await response.json()) as MessagesResponse;
}

/**
 * 执行 bash 命令：黑名单、超时、输出截断三道护栏。
 * @param command 模型给出的 shell 命令
 * @returns 合并 stdout/stderr 后的文本
 */
function runBash(command: string): string {
	if (BLOCKED_PATTERNS.some((p) => command.includes(p))) return "Error: Dangerous command blocked";
	const result = spawnSync(command, { shell: true, cwd: process.cwd(), encoding: "utf-8", timeout: CONFIG.bashTimeoutMs });
	if (result.error) return `Error: ${result.error.message}`;
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
	return output ? output.slice(0, CONFIG.maxOutputChars) : "(no output)";
}

/**
 * agent 主循环：问模型、执行工具、回填结果，直到模型不再调用工具。
 * @param messages 对话历史
 * @param system 系统提示词（含已注入的 skills）
 */
async function agentLoop(messages: ChatMessage[], system: string): Promise<void> {
	while (true) {
		const response = await callLlm(messages, system);
		messages.push({ role: "assistant", content: response.content });
		if (response.stop_reason !== "tool_use") return;
		const results: ToolResultBlock[] = [];
		for (const block of response.content) {
			if (block.type !== "tool_use") continue;
			console.log(`\x1b[33m$ ${block.input.command}\x1b[0m`);
			const output = runBash(block.input.command);
			console.log(output.slice(0, 200));
			results.push({ type: "tool_result", tool_use_id: block.id, content: output });
		}
		messages.push({ role: "user", content: results });
	}
}

/**
 * 交互入口：加载 skills、构建 system prompt、启动 REPL。
 * skills 在启动时一次性加载，整个会话复用同一份 system prompt。
 */
async function main(): Promise<void> {
	if (!CONFIG.apiKey) {
		console.error("缺少 ANTHROPIC_API_KEY，请先 export 后再运行。");
		process.exit(1);
	}
	const { skills, diagnostics } = loadSkills(CONFIG.skillsDir);
	console.log(`s07: Skills（加载 ${skills.length} 个 skill）`);
	for (const d of diagnostics) console.log(`\x1b[33m[skill warn] ${d}\x1b[0m`);
	for (const s of skills) console.log(`  - ${s.name}`);
	const system = buildSystemPrompt(skills);
	console.log("输入问题，回车发送。输入 q 退出。\n");
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = (prompt: string): Promise<string> => new Promise((resolve) => rl.question(prompt, resolve));
	const history: ChatMessage[] = [];
	while (true) {
		const query = (await ask("\x1b[36ms07 >> \x1b[0m")).trim();
		if (query === "" || query.toLowerCase() === "q" || query.toLowerCase() === "exit") break;
		history.push({ role: "user", content: query });
		await agentLoop(history, system);
		const last = history[history.length - 1];
		if (Array.isArray(last.content)) {
			for (const block of last.content) if (block.type === "text") console.log(block.text);
		}
		console.log();
	}
	rl.close();
}
await main();
