import { useState, useEffect } from "react";

/**
 * 工业拨杆式主题切换开关。
 * ON=亮色主题，OFF=暗色主题（默认）。
 * 状态持久化到 localStorage；首次访问无存储时跟随系统 prefers-color-scheme。
 * 首屏由 Layout.astro 的 inline script 提前设置避免 FOUC，本组件 hydration 后接管。
 * @author fxbin
 */
const STORAGE_KEY = "pi-learn-theme";
const THEME_LIGHT = "light";
const THEME_DARK = "dark";
const MEDIA_QUERY_LIGHT = "(prefers-color-scheme: light)";
const ARIA_LABEL_TO_LIGHT = "切换到亮色主题";
const ARIA_LABEL_TO_DARK = "切换到暗色主题";

export default function ThemeToggle() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    let light: boolean;
    if (stored === THEME_LIGHT || stored === THEME_DARK) {
      light = stored === THEME_LIGHT;
    } else {
      // 无存储时跟随系统偏好
      light = window.matchMedia(MEDIA_QUERY_LIGHT).matches;
    }
    setOn(light);
    document.documentElement.classList.toggle("theme-on", light);
  }, []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    document.documentElement.classList.toggle("theme-on", next);
    localStorage.setItem(STORAGE_KEY, next ? THEME_LIGHT : THEME_DARK);
  };

  return (
    <button
      className={`theme-switch ${on ? "on" : ""}`}
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? ARIA_LABEL_TO_DARK : ARIA_LABEL_TO_LIGHT}
      title="主题切换"
    />
  );
}
