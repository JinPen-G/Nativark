import { useLayoutEffect, useRef, useState } from "react";
import { Pagination as AntPagination, type PaginationProps } from "antd";
import { Pagination as ArcPagination } from "@/registry/components/pagination/pagination";
import { Select as ArcSelect } from "@/registry/components/select/select";
import { useLocale } from "@/app/locale";
import { ArcLocale } from "./ArcLocale";
import { Input } from "./Input";
import { Button } from "./Button";
import { AnimatedCountText } from "./AnimatedNumber";

export function Pagination(props: PaginationProps) {
  const { t } = useLocale();
  const [page, setPage] = useState(props.defaultCurrent ?? 1);
  const [size, setSize] = useState(props.defaultPageSize ?? 10);
  const [jump, setJump] = useState("");
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
  const sizeTrigger = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!sizeMenuOpen) return;
    // The original Select portals its panel outside our wrapper. Scope the
    // no-check variant through this trigger's actual aria-controls, never by
    // globally styling all open listboxes. Keep the marker through exit motion.
    const markPanel = () => {
      const panelId = sizeTrigger.current?.getAttribute("aria-controls");
      const panel = panelId ? document.getElementById(panelId) : null;
      if (!panel || panel.getAttribute("role") !== "listbox") return false;
      panel.dataset.rentalPageSizeMenu = "";
      return true;
    };
    if (markPanel()) return;
    // A Portal may mount after the parent's effect. Observe only until it exists.
    const observer = new MutationObserver(() => { if (markPanel()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [sizeMenuOpen]);
  const pageSize = props.pageSize ?? size;
  const total = props.total ?? 0;
  const count = Math.ceil(total / pageSize);
  const current = Math.max(1, Math.min(Math.max(1, count), props.current ?? page));
  if (props.itemRender || (props.showSizeChanger && typeof props.showSizeChanger === "object")) return <AntPagination {...props} />;
  if (props.hideOnSinglePage && count <= 1) return null;
  const changePage = (next: number) => { if (props.disabled || count === 0) return; setPage(next); setSize(pageSize); props.onChange?.(next, pageSize); };
  const go = () => { const next = Number(jump); if (Number.isInteger(next) && next >= 1 && next <= count) { changePage(next); setJump(""); } };
  const range: [number, number] = [total ? (current - 1) * pageSize + 1 : 0, Math.min(total, current * pageSize)];
  const summary = props.showTotal ? props.showTotal(total, range) : `${range[0]}–${range[1]} / ${total}`;
  return <div className={`arc-pagination ${props.className ?? ""}`} style={{ justifyContent: props.align === "start" ? "flex-start" : props.align === "center" ? "center" : "flex-end", ...props.style }} inert={props.disabled || undefined} aria-disabled={props.disabled}>
    <div className="arc-pagination-main"><div className="arc-pagination-summary">{typeof summary === "string" ? <AnimatedCountText text={summary} /> : summary}</div>
      <ArcLocale><ArcPagination page={current} pageCount={count} label={t("分页")} onPageChange={changePage} /></ArcLocale>
    </div>
    {(props.showSizeChanger ?? total > (props.totalBoundaryShowSizeChanger ?? 50)) && <div className="arc-select-field arc-pagination-size"><ArcSelect ref={sizeTrigger} onOpenChange={setSizeMenuOpen} label={t("每页条数")} value={String(pageSize)} disabled={props.disabled}
      options={[...new Set([...(props.pageSizeOptions ?? [10, 20, 50, 100]).map(Number), pageSize])].map(number => ({ value: String(number), label: `${number}\u00a0/\u00a0${t("页")}` }))}
      onValueChange={value => { const nextSize = Number(value); const next = Math.min(current, Math.max(1, Math.ceil(total / nextSize))); setSize(nextSize); setPage(next); props.onShowSizeChange?.(next, nextSize); props.onChange?.(next, nextSize); }} /></div>}
    {props.showQuickJumper && <div className="arc-pagination-jump"><Input type="number" aria-label={t("跳至页码")} min={1} max={count} value={jump} disabled={props.disabled || count === 0} onChange={event => setJump(event.target.value)} onPressEnter={event => { event.preventDefault(); go(); }} /><Button disabled={props.disabled || count === 0} onClick={go}>{t("跳转")}</Button></div>}
  </div>;
}
