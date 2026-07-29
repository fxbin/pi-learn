import { useState, useEffect } from "react";

/**
 * 工业拨杆式主题切换开关。
 * @author fxbin
 */
export default function ThemeToggle() {
  const [on, setOn] = useState(true);

  useEffect(() => {
    // 当前仅实现视觉拨杆，可扩展为真正的亮/暗模式切换。
    document.body.classList.toggle("theme-on", on);
  }, [on]);

  return (
    <button
      className={`theme-switch ${on ? "on" : ""}`}
      onClick={() => setOn(!on)}
      aria-label="主题切换"
      title="主题切换"
    />
  );
}
