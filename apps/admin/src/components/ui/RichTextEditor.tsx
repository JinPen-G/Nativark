import { useEffect, useRef, useState } from "react";
import { Undo2, Redo2, RotateCcw } from "lucide-react";
import { ConfigProvider } from "antd";
import { CLIENT_RICH_TEXT_PREFIX, parseClientRichText, type ClientRichTextNode } from "@rental-os/shared";
import { RichTextEditor as ArcEditor, sanitizeHtml, htmlToMarkdown, type RichTextEditorHandle } from "@/registry/components/rich-text-editor/rich-text-editor";
import { useLocale } from "@/app/locale";
import { Button } from "./Button";
import { Segmented } from "./Segmented";
import { CopyButton } from "./CopyButton";
import { ArcLocale } from "./ArcLocale";

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function htmlFor(body: string): string {
  const render = (nodes: ClientRichTextNode[]): string => nodes.map(node => node.type === "text" ? escape(node.text) : `<${node.name}${node.attrs?.href ? ` href="${escape(node.attrs.href)}"` : ""}>${render(node.children)}</${node.name}>`).join("");
  const nodes = parseClientRichText(body, 200000);
  return sanitizeHtml(nodes ? render(nodes) : body.split("\n").map(line => `<p>${escape(line)}</p>`).join(""));
}
function nodesFor(html: string): ClientRichTextNode[] {
  const source = new DOMParser().parseFromString(sanitizeHtml(html), "text/html");
  const convert = (root: Node): ClientRichTextNode[] => Array.from(root.childNodes).flatMap((node): ClientRichTextNode[] => {
    if (node.nodeType === Node.TEXT_NODE) return [{ type: "text", text: node.textContent ?? "" }];
    if (!(node instanceof Element)) return [];
    return [{ type: "node", name: node.tagName.toLowerCase(), ...(node.hasAttribute("href") ? { attrs: { href: node.getAttribute("href")! } } : {}), children: convert(node) }];
  });
  return convert(source.body);
}
/** Form-compatible editor + safe preview; never emits executable HTML. */
export function RichTextEditor({ value = "", onChange, disabled, placeholder, id }: { value?: string; onChange?: (body: string) => void; disabled?: boolean; placeholder?: string; id?: string }) {
  const { t } = useLocale();
  const { componentDisabled: formDisabled } = ConfigProvider.useConfig();
  const [format, setFormat] = useState("markdown");
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const editor = useRef<RichTextEditorHandle>(null);
  const html = htmlFor(value);
  const baseline = useRef(html);
  const emitted = useRef<string | null>(null);
  useEffect(() => { if (value !== emitted.current) baseline.current = html; }, [value, html]);
  const readOnly = disabled ?? formDisabled;
  const source = format === "html" ? html : htmlToMarkdown(html);
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  const words = Array.from(new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)).filter(part => part.isWordLike).length;
  return <div id={id} className="arc-rich-field"><ArcLocale>
    <div className="arc-rich-toolbar" role="toolbar" aria-label={t("正文工具栏")}>
      <Button type="text" size="small" icon={<Undo2 size={18} />} aria-label={t("撤销编辑")} disabled={readOnly || !history.canUndo} onClick={() => editor.current?.undo()} />
      <Button type="text" size="small" icon={<Redo2 size={18} />} aria-label={t("重做编辑")} disabled={readOnly || !history.canRedo} onClick={() => editor.current?.redo()} />
      <Button type="text" size="small" icon={<RotateCcw size={18} />} aria-label={t("还原正文")} disabled={readOnly || html === baseline.current} onClick={() => editor.current?.setHTML(baseline.current)} />
      <span className="arc-rich-count">{words} {t("词数")}</span>
    </div>
    <div className="arc-rich-columns">
      <div className="arc-rich-writing"><ArcEditor ref={editor} value={html} readOnly={readOnly} placeholder={placeholder} aria-label={t("正文")} onHistoryChange={setHistory} onChange={result => {
        if (readOnly || sanitizeHtml(result.html) === html) return;
        const next = result.empty ? "" : CLIENT_RICH_TEXT_PREFIX + JSON.stringify(nodesFor(result.html));
        emitted.current = next;
        onChange?.(next);
      }} /></div>
      <div className="arc-rich-output">
        <div className="arc-rich-output-toolbar"><Segmented aria-label={t("输出格式")} value={format} options={[{ value: "markdown", label: "Markdown" }, { value: "html", label: "HTML" }]} onChange={setFormat} /><CopyButton value={source} label={t("复制")} /></div>
        <pre aria-label={t("正文输出")} tabIndex={0}>{source}</pre>
      </div>
    </div>
  </ArcLocale><div className="text-meta arc-rich-limit" aria-live="polite">{value.length} / 20000</div></div>;
}
