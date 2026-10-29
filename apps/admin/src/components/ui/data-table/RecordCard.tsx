/** UIArc owns the card morph and mobile sheet gesture. This adapter supplies read-only business content and defers edits until the preview closes. */
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Card } from "@/registry/components/card/card";
import { BottomSheet } from "@/registry/components/bottom-sheet/bottom-sheet";
import { Button } from "@/registry/components/button/button";
import { Checkbox } from "@/registry/components/checkbox/checkbox";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import styles from "./RecordCard.module.css";

export type CardKind = "membership" | "catalog" | "pricing" | "discount" | "service" | "asset" | "stock" | "location";
export type CardAfterClose = (operation: () => void) => void;
export interface RecordCardConfig<T> {
  kind?: CardKind;
  title: (row: T) => string;
  subtitle?: (row: T) => string;
  media?: (row: T) => ReactNode;
  featured?: (row: T) => boolean;
  status?: (row: T) => ReactNode;
  body: (row: T) => ReactNode;
  details?: (row: T) => ReactNode;
  actions?: (row: T, afterClose: CardAfterClose) => ReactNode;
}

const query = "(max-width: 639px)";
const subscribe = (notify: () => void) => { const media = matchMedia(query); media.addEventListener("change", notify); return () => media.removeEventListener("change", notify); };
const narrowSnapshot = () => matchMedia(query).matches;
function identity() { const state = useAuthStore.getState(); return JSON.stringify([state.tenant?.tenantId, state.currentWorkspaceId, state.user?.id]); }

export function RecordCard<T>({ row, config, rowKey, selected, onSelect, disabled }: {
  row: T; config: RecordCardConfig<T>; rowKey: string; selected?: boolean; onSelect?: (checked: boolean) => void; disabled?: boolean;
}) {
  const { t } = useLocale();
  const narrow = useSyncExternalStore(subscribe, narrowSnapshot, () => false);
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const [selectionHost, setSelectionHost] = useState<HTMLElement | null>(null);
  // Keep selection in the closed article so it moves with the native lift, but
  // outside Card's shared children so it never reappears in the quick look.
  useLayoutEffect(() => { setSelectionHost(wrapper.current?.querySelector("article") ?? null); }, []);
  const owner = useId(), selector = `[data-record-card-preview-owner="${owner}"]`;
  const trigger = useRef<HTMLButtonElement>(null);
  const observer = useRef<MutationObserver | null>(null);
  const pending = useRef<(() => void) | undefined>(undefined);
  const opened = useRef(open); opened.current = open;
  const cancel = () => { observer.current?.disconnect(); observer.current = null; pending.current = undefined; };
  useEffect(() => () => cancel(), []);
  useEffect(() => { setOpen(false); cancel(); }, [narrow]);
  const changeOpen = (next: boolean) => { if (next) cancel(); setOpen(next); };
  const afterClose: CardAfterClose = operation => {
    cancel();
    const scope = identity(); pending.current = operation;
    const run = () => {
      if (document.querySelector(selector)) return;
      observer.current?.disconnect(); observer.current = null;
      requestAnimationFrame(() => {
        const next = pending.current; pending.current = undefined;
        if (!opened.current && scope === identity()) next?.();
      });
    };
    observer.current = new MutationObserver(run);
    observer.current.observe(document.body, { childList: true, subtree: true });
    setOpen(false);
    run();
  };
  const title = config.title(row), subtitle = config.subtitle?.(row), media = config.media?.(row);
  const details = <PreviewContent owner={owner} kind={config.kind} hasMedia={Boolean(media)}>
    {config.details?.(row)}
    {config.actions && <div className={styles.previewActions}>{config.actions(row, afterClose)}</div>}
  </PreviewContent>;
  const summary = <div className={styles.summary} data-kind={config.kind} data-copilot-field="summary" data-copilot-label={t("摘要")}>
    {config.status && <div className={styles.context}>{config.status(row)}</div>}
    {config.body(row)}
  </div>;
  return <div ref={wrapper} className={styles.item} data-copilot-record={rowKey} data-copilot-label={title} data-copilot-disabled={disabled ? "true" : undefined} data-record-card={rowKey} data-kind={config.kind ?? "catalog"} data-has-media={Boolean(media) || undefined} data-featured={config.featured?.(row) || undefined} data-selected={selected || undefined} data-selectable={Boolean(onSelect) || undefined}>
    {onSelect && selectionHost && createPortal(<div className={styles.selection}><Checkbox aria-label={`${t("选择")} ${title}`} checked={Boolean(selected)} disabled={disabled} onCheckedChange={value => onSelect(value === true)} /></div>, selectionHost)}
    <Card title={title} meta={subtitle ? <span className={styles.secondary}>{subtitle}</span> : undefined} className={styles.card} media={media}
      details={narrow ? undefined : details} open={!narrow && open} onOpenChange={changeOpen}
      action={!open ? <Button ref={trigger} size="sm" variant="secondary" onClick={() => changeOpen(true)} aria-label={`${t("查看详情")} ${title}`}>{t("查看详情")}</Button> : undefined}>
      {narrow && <button type="button" className={styles.mobileHit} data-copilot-reference="" aria-label={`${t("查看详情")} ${title}`} onClick={() => changeOpen(true)} />}
      {summary}
    </Card>
    {narrow && <BottomSheet open={open} onOpenChange={next => { changeOpen(next); if (!next && !pending.current) requestAnimationFrame(() => trigger.current?.focus()); }} title={title} description={subtitle} closeLabel={t("关闭详情")} detents={[.6, .92]} initialDetent={1}>
      {media && <div className={styles.sheetMedia}>{media}</div>}{summary}{details}
    </BottomSheet>}
  </div>;
}

function PreviewContent({ owner, kind, hasMedia, children }: { owner: string; kind?: CardKind; hasMedia: boolean; children: ReactNode }) {
  const { t } = useLocale();
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const panel = root.current?.closest('[role="dialog"]');
    if (!panel) return;
    const translate = () => {
      const labels: Record<string, string> = { "Close quick look": t("关闭详情"), "Expand sheet": t("展开面板"), "Collapse sheet": t("收起面板") };
      for (const button of panel.querySelectorAll("button[aria-label]")) { const next = labels[button.getAttribute("aria-label") ?? ""]; if (next) button.setAttribute("aria-label", next); }
    };
    translate();
    const observer = new MutationObserver(translate);
    observer.observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-label"] });
    return () => observer.disconnect();
  }, [t]);
  return <div ref={root} data-record-card-preview-owner={owner} data-kind={kind} data-has-media={hasMedia || undefined} className={styles.preview}>{children}</div>;
}

export function CardMetric({ value, label, suffix }: { value: ReactNode; label: ReactNode; suffix?: ReactNode }) {
  return <div className={styles.metric}><div className={styles.metricValue}>{value}{suffix && <span className={styles.metricSuffix}>{suffix}</span>}</div><div className={styles.secondary}>{label}</div></div>;
}
export function CardFacts({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return <dl className={styles.facts}>{items.map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}
export function CardSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.section}><h4>{title}</h4>{children}</section>;
}
export function CardList({ children }: { children: ReactNode }) { return <ul className={styles.list}>{children}</ul>; }

export function CardBadge({ children, emphasis = false, tone }: { children: ReactNode; emphasis?: boolean; tone?: "positive" | "accent" }) { return <span className={styles.badge} data-emphasis={emphasis || undefined} data-tone={tone}>{children}</span>; }

/** Short, comparable facts below a record's primary value. */
export function CardHighlights({ items }: { items: Array<{ label: ReactNode; value: ReactNode; icon?: ReactNode }> }) {
  return <dl className={styles.highlights}>{items.map((item, index) => <div key={index}><dt>{item.icon}{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}
export function CardFootnote({ children }: { children: ReactNode }) { return <div className={styles.footnote}>{children}</div>; }

export function CardSecondary({ children }: { children: ReactNode }) { return <div className={styles.secondary}>{children}</div>; }
