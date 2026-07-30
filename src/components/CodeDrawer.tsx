import { useEffect, useState } from "react";
import "./CodeDrawer.css";
import { highlight } from "./highlight";

/**
 * 代码查看抽屉。
 * 拦截两类链接，改为从右侧滑出面板显示文件内容，并做轻量语法高亮：
 *   1. 本地教学代码：/pi-learn/chapters/<slug>/<file>.{ts,js,md}
 *   2. pi 仓库源码：https://github.com/earendil-works/pi/blob/<ref>/<path>
 *      （tree 链接是目录，不拦截，保留默认跳转）
 *
 * GitHub 文件通过 raw.githubusercontent.com 拉取。
 * 带 #L<行号> 或 #L<起>-<止> 锚点的链接会自动滚动到对应行并高亮。
 *
 * 交互：
 *   - 点击上述链接 → 右侧滑出抽屉
 *   - 点击关闭按钮 / 遮罩层 / 按 Esc → 关闭抽屉
 *   - 复制按钮：复制代码内容
 *   - GitHub 按钮：在新标签打开原链接（仅 GitHub 源链接显示，作为 fallback）
 *
 * @author fxbin
 */

/** 每个代码行的渲染单元：行号 + 高亮后的 HTML。 */
interface Line {
  num: number;
  html: string;
}

/** 解析后的源码信息：决定 fetch 哪里、怎么显示、是否高亮某段行。 */
interface SourceInfo {
  /** 标题栏显示的文件名或完整路径 */
  display: string;
  /** fetch 用的 URL（本地路径或 raw.githubusercontent.com URL） */
  fetchUrl: string;
  /** 原 GitHub 链接（用于"GitHub"外链按钮，仅 GitHub 源有） */
  githubUrl?: string;
  /** 锚点起始行（1-indexed） */
  anchorStart?: number;
  /** 锚点结束行（1-indexed，含） */
  anchorEnd?: number;
}

/**
 * 解析链接，判断是否由抽屉接管。
 * 返回 null 表示不接管（保留默认跳转）。
 * @param href 链接的 href 属性
 */
function parseLink(href: string): SourceInfo | null {
  // 本地教学代码：/pi-learn/chapters/<slug>/<file>.{ts,js,md}
  const localMatch = href.match(/\/chapters\/[^/]+\/([a-zA-Z0-9_-]+\.(?:ts|js|md))$/);
  if (localMatch) {
    return {
      display: localMatch[1],
      fetchUrl: href.replace(/^.*\/chapters\//, "/pi-learn/chapters/"),
    };
  }

  // GitHub blob 链接（仅文件；tree 链接是目录，不接管）
  const ghMatch = href.match(
    /^https?:\/\/github\.com\/earendil-works\/pi\/blob\/([^/]+)\/([^?#]+)/,
  );
  if (ghMatch) {
    const ref = ghMatch[1];
    const path = ghMatch[2];
    const rawUrl = `https://raw.githubusercontent.com/earendil-works/pi/${ref}/${path}`;

    let anchorStart: number | undefined;
    let anchorEnd: number | undefined;
    const anchorMatch = href.match(/#L(\d+)(?:-(\d+))?/);
    if (anchorMatch) {
      anchorStart = parseInt(anchorMatch[1], 10);
      anchorEnd = anchorMatch[2] ? parseInt(anchorMatch[2], 10) : anchorStart;
    }

    return {
      display: path,
      fetchUrl: rawUrl,
      githubUrl: href,
      anchorStart,
      anchorEnd,
    };
  }

  return null;
}

export default function CodeDrawer() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [display, setDisplay] = useState("");
  const [githubUrl, setGithubUrl] = useState<string | null>(null);
  const [anchorStart, setAnchorStart] = useState<number | null>(null);
  const [anchorEnd, setAnchorEnd] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest("a");
      if (!target) return;
      const href = target.getAttribute("href") || "";
      const info = parseLink(href);
      if (!info) return;
      e.preventDefault();
      setDisplay(info.display);
      setGithubUrl(info.githubUrl ?? null);
      setAnchorStart(info.anchorStart ?? null);
      setAnchorEnd(info.anchorEnd ?? null);
      setOpen(true);
      setLoading(true);
      setLines([]);
      setError(null);
      fetch(info.fetchUrl)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        })
        .then((text) => {
          const highlighted = highlight(text, info.display);
          const arr = highlighted.split("\n");
          setLines(arr.map((html, i) => ({ num: i + 1, html })));
          setLoading(false);
        })
        .catch((err) => {
          setError(`加载失败：${err.message}`);
          setLoading(false);
        });
    }
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  /**
   * 渲染完成后滚动到锚点行并加高亮 class。
   * 监听 lines（加载完成）和 open 状态，用 rAF 等 DOM 渲染完再操作。
   */
  useEffect(() => {
    if (!open || loading || !anchorStart) return;
    const start = anchorStart;
    const end = anchorEnd ?? anchorStart;
    const raf = requestAnimationFrame(() => {
      for (let n = start; n <= end; n++) {
        const row = document.querySelector<HTMLElement>(
          `.cd-line-row[data-num="${n}"]`,
        );
        if (row) row.classList.add("cd-line-anchor");
      }
      const firstRow = document.querySelector<HTMLElement>(
        `.cd-line-row[data-num="${start}"]`,
      );
      firstRow?.scrollIntoView({ block: "center", behavior: "auto" });
    });
    return () => cancelAnimationFrame(raf);
  }, [open, loading, anchorStart, anchorEnd]);

  function copyContent() {
    if (!lines.length) return;
    const text = lines.map((l) => l.html).join("\n").replace(/<[^>]*>/g, "");
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.querySelector<HTMLButtonElement>(".cd-copy-btn");
      if (btn) {
        const original = btn.textContent;
        btn.textContent = "已复制";
        setTimeout(() => {
          if (btn) btn.textContent = original;
        }, 1500);
      }
    });
  }

  return (
    <>
      <div
        className={`cd-overlay ${open ? "cd-overlay-open" : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside className={`cd-drawer ${open ? "cd-drawer-open" : ""}`} aria-hidden={!open}>
        <header className="cd-header">
          <div className="cd-title-bar">
            <span className="cd-filename" title={display}>{display}</span>
            {lines.length > 0 && (
              <span className="cd-line-count">{lines.length} 行</span>
            )}
          </div>
          <div className="cd-actions">
            <button
              type="button"
              className="cd-copy-btn"
              onClick={copyContent}
              disabled={loading || lines.length === 0}
            >
              复制
            </button>
            {githubUrl && (
              <a
                href={githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="cd-github-btn"
              >
                GitHub
              </a>
            )}
            <button type="button" className="cd-close-btn" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
        </header>
        <div className="cd-body">
          {loading ? (
            <div className="cd-loading">加载中…</div>
          ) : error ? (
            <div className="cd-error">
              <p>{error}</p>
              {githubUrl && (
                <a
                  href={githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cd-error-link"
                >
                  在 GitHub 查看 →
                </a>
              )}
            </div>
          ) : (
            <div className="cd-code-grid">
              {lines.map((line) => (
                <div key={line.num} className="cd-line-row" data-num={line.num}>
                  <span className="cd-line-num">{line.num}</span>
                  <code
                    className="cd-line-code"
                    dangerouslySetInnerHTML={{ __html: line.html || "&nbsp;" }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
