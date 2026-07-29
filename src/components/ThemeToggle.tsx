import { useState, useEffect } from "react";

/**
 * 工业拨杆式主题切换开关。
 * ON=亮色主题，OFF=暗色主题（默认）。
 * 状态持久化到 localStorage，首屏由 Layout.astro 的 inline script 提前设置避免 FOUC。
 * @author fxbin
 */
const STORAGE_KEY = "pi-learn-theme";

export default function ThemeToggle() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const light = stored === "light";
    setOn(light);
    document.documentElement.classList.toggle("theme-on", light);
  }, []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    document.documentElement.classList.toggle("theme-on", next);
    localStorage.setItem(STORAGE_KEY, next ? "light" : "dark");
  };

  return (
    <button
      className={`theme-switch ${on ? "on" : ""}`}
      onClick={toggle}
      aria-label="主题切换"
      title="主题切换"
    />
  );
}
