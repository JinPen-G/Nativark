/** Browse the existing authorized todo response. Preview and pin are local; only the explicit detail action navigates. */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, CircleAlert, Clock3, Pin, PinOff, Wrench } from "lucide-react";
import type { RentalWorkbenchTodo } from "@rental-os/shared";
import { AnimatedNumber, Button, Empty, Segmented, Table } from "@/components/ui";
import { InsightPanel, ViewChoice } from "@/components/insights/OperationalCharts";
import { ContentTransition } from "@/components/workspace/ContentTransition";
import { useLocale } from "@/app/locale";
import { overviewActiveTodo, overviewTodoLabels } from "./workbenchPresentation";
import styles from "./WorkbenchOverview.module.css";

export function WorkbenchTodoQueue({ items, busy, formatAmount, canOpen, onOpen, onRefresh }: {
  items: RentalWorkbenchTodo[]; busy: boolean; formatAmount: (amount: number) => string;
  canOpen: (item: RentalWorkbenchTodo) => boolean; onOpen: (item: RentalWorkbenchTodo) => void; onRefresh: () => Promise<unknown>;
}) {
  const { t, locale } = useLocale();
  const id = useId();
  const [view, setView] = useState("focus");
  const [tableVisited, setTableVisited] = useState(false);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [pinnedId, setPinnedId] = useState<string>();
  const [previewId, setPreviewId] = useState<string>();
  const [focusedId, setFocusedId] = useState<string>();
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const priorityCount = items.filter(item => item.priority === "high").length;
  const filtered = useMemo(() => filter === "priority" ? items.filter(item => item.priority === "high") : items, [filter, items]);
  const visible = useMemo(() => filtered.slice(0, 6), [filtered]);
  const active = overviewActiveTodo(visible, pinnedId, previewId ?? focusedId);
  const pinned = Boolean(active && active.id === pinnedId);
  // Drop obsolete selections instead of letting a later response resurrect an old pin.
  useEffect(() => {
    const retain = (id: string | undefined) => visible.some(item => item.id === id) ? id : undefined;
    setPinnedId(retain); setPreviewId(retain); setFocusedId(retain);
  }, [visible]);
  const dateTime = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : t("时间未提供");
  const description = (item: RentalWorkbenchTodo) => item.type === "work_order" ? item.description : t(item.description);
  const show = (value: string) => { setFilter(value); setPage(1); setPinnedId(undefined); setPreviewId(undefined); setFocusedId(undefined); };
  const changeView = (value: string) => { if (value === "table") setTableVisited(true); setView(value); };
  function onRowKey(event: KeyboardEvent<HTMLElement>, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = ({ ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: visible.length - 1 } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const item = visible[(next + visible.length) % visible.length];
    rowRefs.current.get(item.id)?.focus();
    setPreviewId(undefined); setFocusedId(item.id);
  }

  return <InsightPanel title={t("运营待办")}
    description={<><AnimatedNumber value={items.length} /> {t("项待处理")}{priorityCount > 0 && <span className={styles.prioritySummary}>{t("其中 {count} 项优先处理", { count: priorityCount })}</span>}</>}
    actions={<ViewChoice value={view} onChange={changeView} options={[{ value: "focus", label: t("重点事项") }, { value: "table", label: t("明细") }]} />}>
    <div className={styles.queueTools}>
      <Segmented size="small" aria-label={t("待办筛选")} value={filter} onChange={value => show(String(value))} options={[
        { value: "all", label: t("全部待办") }, { value: "priority", label: t("优先处理") },
      ]} />
      {view === "focus" && visible.length > 0 && <span className={styles.previewHint}>{t("悬停预览，点击固定")}</span>}
    </div>
    <ContentTransition value={`${view}:${filter}`}>
      <div hidden={view !== "table"}>
      {tableVisited && <Table<RentalWorkbenchTodo> rowKey="id" toolbarNote={false} pagination={{ current: page, pageSize, onChange: (next, size) => { setPage(next); setPageSize(size); } }} onRefresh={onRefresh} loading={busy} dataSource={filtered} columns={[
        { title: t("事项"), dataIndex: "title", render: (_, item) => <div className={styles.tableTask}><span>{t(item.title)}</span><small>{item.orderNo ?? t(overviewTodoLabels[item.type])}</small></div> },
        { title: t("说明"), dataIndex: "description", render: (_, item) => description(item) },
        { title: t("优先级"), dataIndex: "priority", render: value => t(value === "high" ? "优先处理" : "常规") },
        { title: t("记录时间"), dataIndex: "createdAt", render: dateTime },
        { title: t("待办金额"), dataIndex: "amount", render: value => value === undefined ? "—" : formatAmount(value) },
        { title: t("操作"), render: (_, item) => canOpen(item) ? <Button size="small" type="text" disabled={busy} onClick={() => onOpen(item)}>{t("查看详情")}</Button> : t("无详情权限") },
      ]} />}
      </div>
      <div hidden={view !== "focus"}>
      {active ? <div className={styles.queueLayout} aria-busy={busy}
        onPointerLeave={() => setPreviewId(undefined)}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(undefined); }}
        onKeyDown={event => {
          if (event.key === "Escape" && pinnedId) {
            event.preventDefault(); event.stopPropagation(); setPinnedId(undefined); setPreviewId(active.id); rowRefs.current.get(active.id)?.focus();
          }
        }}>
        <div className={styles.queueList}>
          <ol className={styles.tasks} aria-label={t("待处理事项")}>
            {visible.map((item, index) => <li key={item.id} className={styles.taskRow} data-active={active.id === item.id || undefined} data-pinned={item.id === pinnedId || undefined}>
              <Button type="text" className={`${styles.taskSelect} ${styles.wideControl}`} aria-controls={`${id}-preview`}
                aria-pressed={pinnedId === item.id} aria-label={t("预览事项：{title}", { title: t(item.title) })}
                ref={node => { if (node) rowRefs.current.set(item.id, node); else rowRefs.current.delete(item.id); }}
                onPointerEnter={event => { if (event.pointerType === "mouse") setPreviewId(item.id); }}
                onFocus={event => { setFocusedId(item.id); if (event.currentTarget.matches(":focus-visible")) setPreviewId(undefined); }} onKeyDown={event => onRowKey(event, index)}
                onClick={() => { setPreviewId(item.id); setPinnedId(previous => previous === item.id ? undefined : item.id); }}>
                <span className={styles.taskContent}>
                  <span className={styles.taskTitle}>{item.type === "work_order" ? <Wrench size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}<span>{t(item.title)}</span></span>
                  <span className={styles.taskDescription}>{description(item)}</span>
                  <span className={styles.taskSubline}><span>{item.orderNo ?? t(overviewTodoLabels[item.type])}</span>{item.priority === "high" && <span className={styles.priorityText}>{t("优先处理")}</span>}</span>
                </span>
              </Button>
              {canOpen(item) && <Button type="text" size="small" disabled={busy} className={styles.quickOpen} icon={<ArrowRight size={16} />} onClick={() => onOpen(item)} aria-label={t("打开事项：{title}", { title: t(item.title) })} />}
            </li>)}
          </ol>
          {filtered.length > visible.length && <Button size="small" type="text" onClick={() => changeView("table")}>{t("查看全部 {count} 项", { count: filtered.length })}</Button>}
        </div>
        <div id={`${id}-preview`} className={styles.todoPreview} role="region" aria-label={t("待办预览")}>
          <div className={styles.previewHeader}><span className={styles.previewType}>{t(overviewTodoLabels[active.type])}</span>
            <Button type="text" size="small" aria-pressed={pinned} icon={pinned ? <PinOff size={14} /> : <Pin size={14} />}
              aria-label={t(pinned ? "取消固定预览" : "固定当前预览")} onClick={() => { setPreviewId(active.id); setPinnedId(pinned ? undefined : active.id); }}>
              {t(pinned ? "已固定" : "固定")}
            </Button>
          </div>
          <ContentTransition value={active.id} className={styles.previewBody}>
            <h3>{t(active.title)}</h3>
            <p className={styles.previewDescription}>{description(active)}</p>
            <dl className={styles.previewFacts}>
              {active.orderNo && <div><dt>{t("关联订单")}</dt><dd>{active.orderNo}</dd></div>}
              {active.amount !== undefined && <div><dt>{t("待办金额")}</dt><dd>{formatAmount(active.amount)}</dd></div>}
            </dl>
          </ContentTransition>
          <div className={styles.previewFooter}>
            <span className={styles.todoTime}><Clock3 size={13} aria-hidden="true" /><time dateTime={active.createdAt}>{dateTime(active.createdAt)}</time></span>
            {canOpen(active) ? <Button size="small" disabled={busy} onClick={() => onOpen(active)}>{t(active.type === "work_order" ? "查看工单" : "查看订单")}<ArrowRight size={14} aria-hidden="true" /></Button> : <span>{t("无详情权限")}</span>}
          </div>
        </div>
      </div> : <div className={styles.queueEmpty}><Empty description={t(filter === "priority" ? "暂无优先处理事项" : "当前空间没有需要处理的待办")} />{filter !== "all" && <Button type="text" size="small" onClick={() => show("all")}>{t("查看全部待办")}</Button>}</div>}
      </div>
    </ContentTransition>
  </InsightPanel>;
}
