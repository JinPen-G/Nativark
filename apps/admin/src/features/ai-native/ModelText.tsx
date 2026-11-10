import { useId } from "react";
import { safeDisplayText } from "./safe-display";

export interface ModelTextProps {
  text: string;
  kind?: "text" | "tool_candidate";
}
/** Untrusted text only: neither Markdown nor tool requests execute here. */
export function ModelText({ text, kind = "text" }: ModelTextProps) {
  const id = useId();
  const bounded = safeDisplayText(text, 20_000);
  const preview = bounded.slice(0, 800);
  return (
    <section
      aria-labelledby={id}
      style={{
        minWidth: 0,
        color: "var(--foreground)",
        overflowWrap: "anywhere",
        unicodeBidi: "plaintext",
      }}
      dir="auto"
    >
      <h3 id={id}>
        {kind === "tool_candidate"
          ? "工具动作候选（未执行）"
          : "AI 生成内容（需核对）"}
      </h3>
      <p data-ai-visible-text={kind === 'text' ? '' : undefined} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{preview}</p>
      {bounded.length > preview.length && (
        <details>
          <summary>展开剩余文本</summary>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {bounded.slice(preview.length)}
          </p>
        </details>
      )}
      {typeof text === "string" && text.length > 20_000 && (
        <p role="status">
          内容超过展示上限，已截断。请通过受权宿主核对完整记录。
        </p>
      )}
    </section>
  );
}
