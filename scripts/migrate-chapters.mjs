#!/usr/bin/env node
/**
 * 将 s01-s08 的 README.md 迁移到 Astro content collection。
 * @author fxbin
 */
import fs from "node:fs";
import path from "node:path";

const root = "/Users/fxbin/Desktop/Project/AIProject/pi-learn";

const chapters = [
  { slug: "s01_agent_loop", title: "Agent Loop", description: "while 循环、tool_use 往返、原生 fetch 直调 Messages API。" },
  { slug: "s02_tools", title: "Tools", description: "bash / read / write 三工具 + dispatch 表 + 路径校验。" },
  { slug: "s03_edit_queue", title: "Edit Queue", description: "edit 工具 + promise 链式 file-mutation-queue。" },
  { slug: "s04_interrupt", title: "Interrupt", description: "AbortSignal + steering 消息注入 + max-turns 熔断。" },
  { slug: "s05_session", title: "Session", description: "jsonl append-only 持久化 + 断点续跑。" },
  { slug: "s06_compaction", title: "Compaction", description: "token 估算 + 溢出检测 + LLM 摘要压缩。" },
  { slug: "s07_skills", title: "Skills", description: "文件即 prompt 注入 + diagnostics 优雅降级。" },
  { slug: "s08_provider", title: "Provider", description: "LlmProvider 接口 + Anthropic/OpenAI 双实现 + 消息边界转换。" },
];

function extractConcepts(text) {
  const match = text.match(/## 前置概念清单[\s\S]*?(?=\n##)/);
  if (!match) return [];
  const lines = match[0].split("\n").filter((l) => /^\d+\. \*\*/.test(l));
  return lines.map((l) => l.replace(/^\d+\. \*\*([^*]+)\*\*.*/, "$1"));
}

function convertLinks(text, slug) {
  // 章节内资源指向 public 下的静态文件
  text = text.replace(/\(code\.ts\)/g, "(/pi-learn/chapters/" + slug + "/code.ts)");
  text = text.replace(/\(practice\.ts\)/g, "(/pi-learn/chapters/" + slug + "/practice.ts)");
  // 跨章节相对链接
  text = text.replace(/\.\.\/(s\d{2}_[a-z_]+)\//g, "/pi-learn/chapters/$1/");
  return text;
}

for (const [index, ch] of chapters.entries()) {
  const readmePath = path.join(root, ch.slug, "README.md");
  const raw = fs.readFileSync(readmePath, "utf-8");
  const concepts = extractConcepts(raw);
  const body = convertLinks(raw, ch.slug);

  const frontmatter = [
    "---",
    `title: ${ch.title}`,
    `num: S${String(index + 1).padStart(2, "0")}`,
    `description: ${ch.description}`,
    `order: ${index + 1}`,
    `concepts:`,
    ...concepts.map((c) => `  - ${c}`),
    "---",
    "",
  ].join("\n");

  fs.mkdirSync(path.join(root, "src/content/chapters"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/content/chapters", `${ch.slug}.md`), frontmatter + body);

  // 复制代码文件到 public
  const publicDir = path.join(root, "public/chapters", ch.slug);
  fs.mkdirSync(publicDir, { recursive: true });
  for (const file of ["code.ts", "practice.ts"]) {
    const src = path.join(root, ch.slug, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(publicDir, file));
    }
  }

  console.log(`✓ ${ch.slug}`);
}
