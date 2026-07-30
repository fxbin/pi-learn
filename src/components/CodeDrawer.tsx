import { useEffect, useState } from "react";
import "./CodeDrawer.css";

/**
 * 代码查看抽屉。
 * 拦截所有指向 /pi-learn/chapters/<slug>/<file>.ts 链接的默认下载行为，
 * 改为从右侧滑出面板显示文件内容。
 *
 * 交互：
 *   - 点击 .ts / .js / .md 链接 → 右侧滑出抽屉
 *   - 点击关闭按钮 / 遮罩层 / 按 Esc → 关闭抽屉
 *   - 打开时按 Ctrl/Cmd + S 可复制内容
 *
 * @author fxbin
 */
export default function CodeDrawer() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState("");
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
      setCode("");
      fetch(fullUrl)
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        })
        .then((text) => {
          setCode(text);
          setLoading(false);
        })
        .catch((err) => {
          setCode(`加载失败：${err.message}`);
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
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
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

  const lineCount = code ? code.split("\n").length : 0;

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
            <span className="cd-line-count">{lineCount > 0 ? `${lineCount} 行` : ""}</span>
          </div>
          <div className="cd-actions">
            <button
              type="button"
              className="cd-copy-btn"
              onClick={copyContent}
              disabled={loading || !code}
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
            <pre className="cd-pre">
              <code className="cd-code">{code}</code>
            </pre>
          )}
        </div>
      </aside>
    </>
  );
}
