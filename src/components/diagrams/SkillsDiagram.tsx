import { useState } from "react";
import "./SkillsDiagram.css";

/**
 * s07 Skills 动态图示。
 * 演示 skills/ 目录下的 .md 文件如何被读取、解析并注入 system prompt，
 * 同时展示坏文件优雅降级。
 * @author fxbin
 */

type SkillFile = { name: string; content: string; valid: boolean };

const INITIAL_FILES: SkillFile[] = [
  { name: "git-rescue.md", content: "当 git 状态混乱时…", valid: true },
  { name: "commit-style.md", content: "提交信息格式…", valid: true },
  { name: "broken.md", content: "这个文件首行不是 #", valid: false },
];

export default function SkillsDiagram() {
  const [files, setFiles] = useState<SkillFile[]>(INITIAL_FILES);
  const [loaded, setLoaded] = useState(false);

  const validSkills = files.filter((f) => f.valid);
  const diagnostics = files.filter((f) => !f.valid).map((f) => `parse failed: ${f.name}`);

  const load = () => setLoaded(true);
  const reset = () => setLoaded(false);
  const toggleBroken = () => {
    setFiles((prev) =>
      prev.map((f) => (f.name === "broken.md" ? { ...f, valid: !f.valid } : f))
    );
    setLoaded(false);
  };

  return (
    <div className="skd-root">
      <div className="skd-header">
        <span className="skd-title">SKILLS AS PROMPT FILES</span>
        <div className="skd-controls">
          <button onClick={load} type="button">LOAD</button>
          <button onClick={toggleBroken} type="button">切换坏文件</button>
          <button onClick={reset} type="button">RESET</button>
        </div>
      </div>

      <div className="skd-stage">
        <div className="skd-col">
          <div className="skd-label">skills/</div>
          <div className="skd-files">
            {files.map((f) => (
              <div key={f.name} className={`skd-file ${f.valid ? "" : "invalid"}`}>
                <span className="skd-filename">{f.name}</span>
                <span className="skd-badge">{f.valid ? "OK" : "BAD"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="skd-arrow">→</div>

        <div className="skd-col">
          <div className="skd-label">loadSkills</div>
          <div className="skd-pipeline">
            {loaded ? (
              <>
                <div className="skd-step">
                  <span className="skd-step-name">读取</span>
                  <span>{validSkills.length} 个成功</span>
                </div>
                {diagnostics.length > 0 && (
                  <div className="skd-step warn">
                    <span className="skd-step-name">诊断</span>
                    <span>{diagnostics.join(", ")}</span>
                  </div>
                )}
                <div className="skd-step">
                  <span className="skd-step-name">注入</span>
                  <span>拼入 system prompt</span>
                </div>
              </>
            ) : (
              <div className="skd-placeholder">等待加载</div>
            )}
          </div>
        </div>

        <div className="skd-arrow">→</div>

        <div className="skd-col">
          <div className="skd-label">system prompt</div>
          <div className="skd-prompt">
            {loaded ? (
              validSkills.map((s) => (
                <div key={s.name} className="skd-skill-block">
                  &lt;skill name="{s.name.replace(".md", "")}"&gt;<br />
                  {s.content}<br />
                  &lt;/skill&gt;
                </div>
              ))
            ) : (
              <div className="skd-placeholder">BASE_PROMPT</div>
            )}
          </div>
        </div>
      </div>

      <div className="skd-footer">
        坏文件进 diagnostics，agent 照常启动——生产软件容忍坏输入。
      </div>
    </div>
  );
}
