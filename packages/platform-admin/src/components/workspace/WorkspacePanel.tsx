/** 公共同级面板及窄屏底部浮层，沿原侧栏尺寸/曲线；正文、业务上下文和 AI 权限由宿主提供。 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import { useLocale } from "../../app/locale";
import "./WorkspacePanel.css";

export function WorkspacePanelToggle({ open, onChange, label, controls }: {
  open: boolean; onChange: (open: boolean) => void; label: string; controls: string;
}) {
  return <Tooltip title={label}><button type="button" className="workspace-copilot-entry" aria-label={label}
    aria-controls={controls} aria-expanded={open} data-sound="press" onClick={() => onChange(!open)}>
    {open ? <PanelRightClose size={16} aria-hidden /> : <PanelRightOpen size={16} aria-hidden />}
  </button></Tooltip>;
}

export function WorkspacePanel({ open, onClose, label, id, panel, children }: {
  open: boolean; onClose: () => void; label: string; id: string; panel: ReactNode; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), pane = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const { t } = useLocale();
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = () => setNarrow(node.clientWidth < 640);
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    pane.current?.querySelector<HTMLElement>("button, a[href], [tabindex='0']")?.focus({ preventScroll: true });
    const keys = (event: KeyboardEvent) => {
      if ([...document.querySelectorAll('[role="menu"], dialog[open], [role="dialog"]')]
        .some(node => node !== pane.current)) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab" || !narrow || !pane.current) return;
      const targets = Array.from(pane.current.querySelectorAll<HTMLElement>("button:not(:disabled),a[href],input,textarea,select,[tabindex='0']"));
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && (document.activeElement === first || !pane.current.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keys);
    return () => { document.removeEventListener("keydown", keys); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [open, narrow, onClose, id]);
  return <div ref={root} className={`workspace-panel-host${open ? " is-open" : ""}${narrow ? " is-sheet" : ""}`}>
    <div ref={content} className="workspace-panel-content" inert={open && narrow || undefined}>{children}</div>
    {open && narrow && <div className="workspace-panel-scrim" aria-hidden="true" onClick={onClose} />}
    <div className="workspace-panel-dock" inert={!open || undefined} aria-hidden={!open || undefined}>
      <div ref={pane} id={id} className="workspace-panel-inner" role={narrow ? "dialog" : "complementary"}
        aria-modal={narrow && open || undefined} aria-label={label}>
        <header className="workspace-panel-heading"><span>{label}</span><WorkspacePanelToggle open onChange={onClose} controls={id} label={t("收起面板")} /></header>
        <div className="workspace-panel-body">{panel}</div>
      </div>
    </div>
  </div>;
}
