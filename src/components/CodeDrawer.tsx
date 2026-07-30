import { useEffect, useState } from "react";
import "./CodeDrawer.css";
import { highlight } from "./highlight";

/**
 * 代码查看抽屉。
 * 拦截所有指向 /pi-learn/chapters/<slug>/<file>.{ts,js,md} 链接的默认下载行为，
 * 改为从右侧滑出面板显示文件内容，并做轻量语法高亮。
 *
 * 交互：
 *   - 点击 .ts / .js / .md 链接 → 右侧滑出抽屉
 *   - 点击关闭按钮 / 遮罩层 / 按 Esc → 关闭抽屉
 *   - 打开时按 Ctrl/Cmd + S 可复制内容
 *
 * @author fxbin
 */

/** 每个代码行的渲染单元：行号 + 高亮后的 HTML。 */
interface Line {
  num: number;
  html: string;
}

export default function CodeDrawer() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [filename, setFilename] = useState("");

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest("a");
      if (!target) return;
      const href = target.getAttribute("href") || "";
      const match = href.match(/\/chapters\/[^/]+\/([a-zA-Z0-9_-]+\.(?:ts|js|md))$/);
      if (!match) return;
      e.preventDefault();
      const filename = match[1];
      const fullUrl = href.replace(/^.*\/chapters\//, "/pi-learn/chapters/");
      setFilename(filename);
      setOpen(true);
      setLoading(true);
      setLines([]);
      fetch(fullUrl)
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        })
        .then((text) => {
          const highlighted = highlight(text, filename);
          const arr = highlighted.split("\n");
          setLines(arr.map((html, i) => ({ num: i + 1, html })));
          setLoading(false);
        })
        .catch((err) => {
          const msg = `加载失败：${err.message}`;
          setLines([{ num: 1, html: msg }]);
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
            <span className="cd-filename">{filename}</span>
            <span className="cd-line-count">{lines.length > 0 ? `${lines.length} 行` : ""}</span>
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
            <button type="button" className="cd-close-btn" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
        </header>
        <div className="cd-body">
          {loading ? (
            <div className="cd-loading">加载中…</div>
          ) : (
            <div className="cd-code-grid">
              {lines.map((line) => (
                <div key={line.num} className="cd-line-row">
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
