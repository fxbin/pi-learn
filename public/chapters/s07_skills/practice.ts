#!/usr/bin/env node
/**
 * s07 默写验收：空白页模板
 *
 * 用法：合上 code.ts 与 README，凭记忆把每个函数的函数体补全。
 * 重点默写本章新增的四块：loadSkills、parseSkill、buildSystemPrompt、main 的 skills 装配。
 * callLlm / runBash / agentLoop 是 s01 原样稍改（多传一个 system 参数），写不出可以查。
 * 补全后运行 `node practice.ts`，建 2 个 skill 文件能加载、造 1 个坏文件能看到
 * [skill warn] 但 agent 照常启动即通过。
 *
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
interface LoadedSkill {
	/** skill 名字，取自文件首行 "# Name" */
	name: string;
	/** skill 正文，首行之后的全部内容 */
	content: string;
}

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
 * 提示：statSync 探目录（不存在直接返回空，不报错）；readdirSync 列条目；
 * 逐个 .md 文件 readFileSync（try/catch，失败 push diagnostic + continue）；
 * parseSkill 解析（返回 null 则 push diagnostic + continue）。
 * 全程不抛异常——坏文件不能让 agent 崩。
 * @param dir skills 目录路径
 * @returns 加载成功的 skills 与诊断消息列表
 */
function loadSkills(dir: string): { skills: LoadedSkill[]; diagnostics: string[] } {
	// TODO: 在这里默写扫描 + 优雅降级
	throw new Error("not implemented");
}

/**
 * 解析单个 skill 文件：首行必须形如 "# Name"，其余为内容。
 * 提示：trimStart 去前导空白；正则 /^#\s+(.+?)\s*$/m 匹配首行；
 * 匹配失败返回 null；body = match[0] 之后的部分 trim。
 * @param raw 文件原始文本
 * @returns 解析失败返回 null
 */
function parseSkill(raw: string): LoadedSkill | null {
	// TODO: 在这里默写解析逻辑
	throw new Error("not implemented");
}

/**
 * 把 skills 拼成系统提示词追加段：base + 每个 skill 包成 XML 块。
 * 提示：skills 为空直接返回 BASE_PROMPT；
 * 否则每个 skill 包成 `<skill name="...">\n${content}\n</skill>`，
 * 用 "\n\n" join；拼到 `${BASE_PROMPT}\n\nThe following skills...\n\n${blocks}`。
 * @param skills 已加载的 skill 列表
 * @returns 拼接后的完整 system prompt
 */
function buildSystemPrompt(skills: LoadedSkill[]): string {
	// TODO: 在这里默写 prompt 拼接
	throw new Error("not implemented");
}

/**
 * 调用 LLM：原生 fetch 非流式请求。
 * 提示：POST `${CONFIG.baseUrl}/v1/messages`，请求头三个
 * （content-type / x-api-key / anthropic-version），body 含
 * model / max_tokens / system / messages / tools。失败抛带状态码的错误。
 * @param messages 对话历史
 * @param system 系统提示词（含已注入的 skills）
 * @returns content 块与 stop_reason
 */
async function callLlm(messages: ChatMessage[], system: string): Promise<MessagesResponse> {
	// TODO: 在这里默写 HTTP 调用
	throw new Error("not implemented");
}

/**
 * 执行 bash 命令：黑名单、超时、输出截断三道护栏。
 * 提示：先过黑名单；spawnSync 开 shell、cwd、encoding、timeout；
 * 合并 stdout/stderr；空输出返回 "(no output)"；超长截断到 maxOutputChars。
 * @param command 模型给出的 shell 命令
 * @returns 合并 stdout/stderr 后的文本
 */
function runBash(command: string): string {
	// TODO: 在这里默写工具执行
	throw new Error("not implemented");
}

/**
 * agent 主循环：问模型、执行工具、回填结果，直到模型不再调用工具。
 * 提示：while (true) 里 callLlm（传 system）；push assistant；
 * stop_reason 非 tool_use 则 return；否则遍历 content 执行 tool_use，
 * 收集 tool_result 作为 user 消息回填。
 * @param messages 对话历史
 * @param system 系统提示词（含已注入的 skills）
 */
async function agentLoop(messages: ChatMessage[], system: string): Promise<void> {
	// TODO: 在这里默写主循环
	throw new Error("not implemented");
}

/**
 * 交互入口：加载 skills、构建 system prompt、启动 REPL。
 * 提示：检查 apiKey；loadSkills(CONFIG.skillsDir) 拿 { skills, diagnostics }；
 * 打印加载数量 + diagnostic 警告（黄色）+ skill 名字列表；
 * buildSystemPrompt 拼出 system；REPL 循环里每轮把 system 传给 agentLoop。
 * skills 只在启动时加载一次，整个会话复用同一份 system prompt。
 */
async function main(): Promise<void> {
	// TODO: 在这里默写交互入口（含 skills 装配）
	throw new Error("not implemented");
}

await main();
