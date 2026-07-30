/**
 * 轻量语法高亮 tokenizer。
 *
 * 设计目标：零依赖、覆盖教学场景常见语言（TypeScript/JavaScript/Markdown），
 * 不追求 100% 语法准确（那是 Shiki/highlight.js 的领域），追求"教学代码可读"。
 *
 * 工作原理：按 token 类型的正则 union 顺序匹配，每步消费输入最长的匹配。
 * 输出 HTML 字符串，token 用 <span class="tok-xxx"> 包裹。
 * 所有用户输入经过 HTML 转义，杜绝注入。
 *
 * @author fxbin
 */

/** HTML 转义：把 & < > " 转义为实体，避免注入和误解析。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** TS/JS 关键字集合。 */
const KEYWORDS = new Set([
  "const", "let", "var", "function", "if", "else", "while", "for", "return",
  "import", "export", "from", "default", "async", "await", "class", "extends",
  "implements", "interface", "type", "enum", "namespace", "public", "private",
  "protected", "readonly", "static", "get", "set", "new", "typeof", "instanceof",
  "in", "of", "as", "void", "null", "undefined", "true", "false", "this", "super",
  "throw", "try", "catch", "finally", "break", "continue", "switch", "case",
  "do", "yield", "delete", "with", "satisfies", "declare", "module", "global",
]);

/** 字面量常量。 */
const LITERALS = new Set(["true", "false", "null", "undefined", "this", "super"]);

/** Token 类型与对应正则。顺序敏感：靠前的优先。 */
interface Rule {
  type: string;
  re: RegExp;
}

const TS_RULES: Rule[] = [
  { type: "comment", re: /^\/\/[^\n]*/ },
  { type: "comment", re: /^\/\*[\s\S]*?\*\// },
  { type: "string", re: /^`(?:\\.|[^`\\])*`/ },
  { type: "string", re: /^"(?:\\.|[^"\\])*"/ },
  { type: "string", re: /^'(?:\\.|[^'\\])*'/ },
  { type: "number", re: /^0x[0-9a-fA-F]+|^\d+(?:\.\d+)?(?:e[+-]?\d+)?/i },
  { type: "decorator", re: /^@[A-Za-z_$][\w$]*/ },
  { type: "ident", re: /^[A-Za-z_$][\w$]*/ },
  { type: "punct", re: /^[{}()\[\];:,.<>+\-*/%=!?&|^~?:]/ },
  { type: "space", re: /^\s+/ },
  { type: "other", re: /^[\s\S]/ },
];

/**
 * 给一段代码做语法高亮，返回 HTML 字符串。
 * 标识符在查表后区分为 keyword / literal / function（后跟 (）/ plain。
 * @param code 源码文本
 * @returns HTML 字符串，token 用 span 包裹
 */
function highlightTs(code: string): string {
  let out = "";
  let i = 0;
  while (i < code.length) {
    let matched = false;
    for (const rule of TS_RULES) {
      const m = rule.re.exec(code.slice(i));
      if (!m) continue;
      const text = m[0];
      if (rule.type === "ident") {
        if (KEYWORDS.has(text)) {
          const cls = LITERALS.has(text) ? "tok-literal" : "tok-keyword";
          out += `<span class="${cls}">${escapeHtml(text)}</span>`;
        } else {
          const after = code.slice(i + text.length).match(/^\s*\(/);
          const cls = after ? "tok-fn" : "tok-ident";
          out += `<span class="${cls}">${escapeHtml(text)}</span>`;
        }
      } else if (rule.type === "space" || rule.type === "other") {
        out += escapeHtml(text);
      } else {
        out += `<span class="tok-${rule.type}">${escapeHtml(text)}</span>`;
      }
      i += text.length;
      matched = true;
      break;
    }
    if (!matched) {
      out += escapeHtml(code[i]);
      i += 1;
    }
  }
  return out;
}

/**
 * Markdown 简化高亮：只标记标题行、代码块围栏、行内代码、链接。
 * 教学场景的 .md 文件结构简单，足够可读即可。
 * @param code markdown 源码
 * @returns HTML 字符串
 */
function highlightMd(code: string): string {
  const lines = code.split("\n");
  return lines
    .map((line) => {
      if (/^#{1,6}\s/.test(line)) {
        return `<span class="tok-md-heading">${escapeHtml(line)}</span>`;
      }
      if (/^```/.test(line)) {
        return `<span class="tok-md-fence">${escapeHtml(line)}</span>`;
      }
      let out = "";
      let rest = line;
      while (rest.length > 0) {
        const codeMatch = /^`[^`]*`/.exec(rest);
        if (codeMatch) {
          out += `<span class="tok-md-code">${escapeHtml(codeMatch[0])}</span>`;
          rest = rest.slice(codeMatch[0].length);
          continue;
        }
        const linkMatch = /^\[[^\]]*\]\([^)]*\)/.exec(rest);
        if (linkMatch) {
          out += `<span class="tok-md-link">${escapeHtml(linkMatch[0])}</span>`;
          rest = rest.slice(linkMatch[0].length);
          continue;
        }
        out += escapeHtml(rest[0]);
        rest = rest.slice(1);
      }
      return out;
    })
    .join("\n");
}

/**
 * 按文件后缀选择高亮器。
 * @param code 源码文本
 * @param filename 文件名，用于判断语言
 * @returns HTML 字符串
 */
export function highlight(code: string, filename: string): string {
  if (filename.endsWith(".md")) {
    return highlightMd(code);
  }
  if (filename.endsWith(".ts") || filename.endsWith(".js") || filename.endsWith(".tsx") || filename.endsWith(".jsx")) {
    return highlightTs(code);
  }
  return escapeHtml(code);
}
