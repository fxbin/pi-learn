import { useEffect, useRef, useState } from "react";
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
 * 交互与无障碍：
 *   - 点击上述链接 → 右侧滑出抽屉
 *   - 抽屉具备 role="dialog" / aria-modal 语义，打开时焦点进入抽屉，
 *     Tab 在抽屉内循环（focus trap），Esc / 关闭按钮 / 遮罩按钮关闭后焦点还原到触发链接
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

/** 关闭按钮的可访问名称。 */
const ARIA_LABEL_CLOSE = "关闭";
/** 遮罩按钮的可访问名称。 */
const ARIA_LABEL_OVERLAY = "关闭代码抽屉";
/** 抽屉无标题时的默认可访问名称。 */
const DIALOG_DEFAULT_LABEL = "代码查看";
/** 复制成功的瞬时提示文案。 */
const COPIED_TEXT = "已复制";
/** 复制成功提示的显示时长（毫秒）。 */
const COPIED_RESET_MS = 1500;

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

  /** 抽屉容器引用，用于焦点管理与 focus trap。 */
  const drawerRef = useRef<HTMLElement>(null);
  /** 触发抽屉的链接引用，关闭后焦点还原到此处。 */
  const triggerRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest("a");
      if (!target) return;
      const href = target.getAttribute("href") || "";
      const info = parseLink(href);
      if (!info) return;
      e.preventDefault();
      triggerRef.current = target;
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

  /**
   * 打开时把焦点移入抽屉，并安装 keydown 监听：
   *   - Esc 关闭
   *   - Tab / Shift+Tab 在抽屉内可聚焦元素间循环（focus trap）
   * 关闭时还原焦点到触发链接。
   */
  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    const firstFocusable = drawer?.querySelector<HTMLElement>("button, a[href]");
    firstFocusable?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeDrawer();
        return;
      }
      if (e.key !== "Tab") return;
      const current = drawerRef.current;
      if (!current) return;
      const focusables = Array.from(
        current.querySelectorAll<HTMLElement>("button, a[href]"),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  /** 关闭抽屉并把焦点还原到触发链接。 */
  function closeDrawer() {
    setOpen(false);
    triggerRef.current?.focus();
    triggerRef.current = null;
  }

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
        btn.textContent = COPIED_TEXT;
        setTimeout(() => {
          if (btn) btn.textContent = original;
        }, COPIED_RESET_MS);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className={`cd-overlay ${open ? "cd-overlay-open" : ""}`}
        onClick={closeDrawer}
        aria-label={ARIA_LABEL_OVERLAY}
        tabIndex={open ? 0 : -1}
      />
      <aside
        ref={drawerRef}
        className={`cd-drawer ${open ? "cd-drawer-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={display || DIALOG_DEFAULT_LABEL}
        aria-hidden={!open}
      >
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
            <button
              type="button"
              className="cd-close-btn"
              onClick={closeDrawer}
              aria-label={ARIA_LABEL_CLOSE}
            >
              <span aria-hidden="true">×</span>
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
