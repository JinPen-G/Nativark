/** The preserved Pro board owns drag, keyboard and swimlanes; business overlays and Core own workflow changes. */
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Clock3, UserRound } from "lucide-react";
import type { RentalWorkOrder, RentalWorkOrderAssignee } from "@rental-os/shared";
import { App, Button, DataTableStatus, Empty, ListFilterBar, Modal } from "@/components/ui";
import { RecordFacts } from "@/components/RecordDetailLayout";
import { useListControls } from "@/components/ui/ListSection";
import { KanbanBoard, type KanbanCard, type KanbanPerson } from "@/components/kanban-board/KanbanBoard";
import { useLocale } from "@/app/locale";
import { mergeWorkOrderDisplayOrder, resolveWorkOrderBoardMove, UNASSIGNED_WORK_ORDER, workOrderColumn, type WorkOrderBoardAction } from "./workOrderBoardPolicy";
import classes from "@/components/kanban-board/archive/classes.json";
import styles from "./WorkOrderBoard.module.css";

const lanes = [{ id: "pending", name: "待处理" }, { id: "in_progress", name: "处理中" }, { id: "pending_review", name: "待验收" }, { id: "closed", name: "已结束" }];
type WorkOrderCard = KanbanCard & { revision: string };

export function WorkOrderBoard({ rows, people, scope, pending, disabled = false, hasFilters = false, onClearFilters, canManage, canReview, statusLabel, typeLabel, actions, onAction, onOpen, onCreate }: {
  rows: RentalWorkOrder[]; people: RentalWorkOrderAssignee[]; scope: string; pending: boolean; disabled?: boolean; hasFilters?: boolean; onClearFilters?: () => void; canManage: boolean; canReview: boolean;
  statusLabel: (status: string) => string; typeLabel: (type: string) => string;
  actions: (row: RentalWorkOrder) => ReactNode;
  onAction: (row: RentalWorkOrder, action: WorkOrderBoardAction) => Promise<unknown>;
  onOpen: (row: RentalWorkOrder) => void; onCreate: (assignee?: string) => void;
}) {
  const { t, locale } = useLocale();
  const { message } = App.useApp();
  const controls = useListControls();
  const committing = useRef(false);
  const [previewId, setPreviewId] = useState<string>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const afterPreview = useRef<(() => void) | undefined>(undefined);
  const preview = rows.find(row => row.id === previewId);
  const storageKey = `rental-work-order-layout:${scope}`;
  const [order, setOrder] = useState<string[]>(() => {
    try { const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]"); return Array.isArray(saved) && saved.every(id => typeof id === "string") ? saved : []; } catch { return []; }
  });
  const columns = useMemo(() => lanes.map(lane => ({ ...lane, name: t(lane.name) })), [t]);
  const assignees = useMemo(() => {
    const directory = new Map<string, KanbanPerson>([[UNASSIGNED_WORK_ORDER, { id: UNASSIGNED_WORK_ORDER, name: t("未派工") }]]);
    people.forEach(person => directory.set(person.id, { id: person.id, name: person.displayName }));
    rows.forEach(row => { if (row.assigneeId && !directory.has(row.assigneeId)) directory.set(row.assigneeId, { id: row.assigneeId, name: row.assigneeName || t("原负责人") }); });
    return [...directory.values()];
  }, [people, rows, t]);
  const cards = useMemo<WorkOrderCard[]>(() => {
    const positions = new Map(order.map((id, index) => [id, index]));
    return rows.map(row => ({ id: row.id, title: row.reason || row.workNo, column: workOrderColumn(row.status), assignee: row.assigneeId ?? UNASSIGNED_WORK_ORDER, label: typeLabel(row.type), revision: row.updatedAt }))
      .sort((left, right) => (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER));
  }, [rows, order, typeLabel]);
  const changeCards = useCallback(async (next: KanbanCard[]) => {
    if (pending || disabled || committing.current) return;
    if (next.length !== rows.length || new Set(next.map(card => card.id)).size !== rows.length || next.some(card => !rows.some(row => row.id === card.id))) return;
    const moved = next.filter(card => { const row = rows.find(item => item.id === card.id)!; return card.column !== workOrderColumn(row.status) || card.assignee !== (row.assigneeId ?? UNASSIGNED_WORK_ORDER); });
    if (moved.length > 1) { message.warning(t("一次只能调整一张工单")); return; }
    if (moved.length) {
      const card = moved[0] as WorkOrderCard;
      const row = rows.find(item => item.id === card.id)!;
      if (card.revision !== row.updatedAt) { message.warning(t("工单已更新，请重新拖动")); return; }
      const action = resolveWorkOrderBoardMove(row, card.column, card.assignee, { manage: canManage, review: canReview });
      if (action.kind === "denied") { message.warning(t(action.reason)); return; }
      if (action.kind !== "reorder") {
        committing.current = true;
        try { await onAction(row, action); } catch { return; } finally { committing.current = false; }
      }
    }
    const nextOrder = mergeWorkOrderDisplayOrder(order, next.map(card => card.id));
    setOrder(nextOrder);
    try { sessionStorage.setItem(storageKey, JSON.stringify(nextOrder)); } catch { /* Layout remains usable when browser storage is unavailable. */ }
  }, [pending, disabled, rows, message, t, canManage, canReview, onAction, order, storageKey]);
  const afterClose = (action: () => void) => { afterPreview.current = action; setPreviewOpen(false); };
  const trigger = (row: RentalWorkOrder, action: WorkOrderBoardAction) => afterClose(() => { void onAction(row, action).catch(() => {}); });
  return <><ListFilterBar>{controls}</ListFilterBar>
    {hasFilters && rows.length === 0 ? <Empty scene="search" description={t("暂无匹配的养护工单")}>
      <Button onClick={onClearFilters}>{t("清除筛选")}</Button>
    </Empty> :
    <KanbanBoard columns={columns} people={assignees} cards={cards} defaultCards={[]} title={t("工单进度")} currentUser={UNASSIGNED_WORK_ORDER} onCardsChange={next => { void changeCards(next); }} bridge={{
      disabled: pending || disabled || previewOpen,
      t,
      cardLabel: card => rows.find(row => row.id === card.id)?.workNo ?? card.id,
      onOpen: id => { setPreviewId(id); setPreviewOpen(true); },
      canCreate: column => canManage && !pending && !disabled && column === "pending",
      onCreate: (_column, assignee) => onCreate(assignee === UNASSIGNED_WORK_ORDER ? undefined : assignee),
      renderCard: (card, person, lifted) => {
        const row = rows.find(item => item.id === card.id);
        if (!row) return null;
        return <div className={classes.cardInner} data-lifted={lifted || undefined}>
          <div className={`${classes.cardTop} ${styles.cardHeader}`}><span className={classes.cardId}>{row.workNo}</span><span className={classes.label}>{typeLabel(row.type)}</span></div>
          <p className={classes.cardTitle}>{row.reason || row.workNo}</p>
          <div className={classes.cardMeta}><span className={classes.metaItem}><UserRound size={13} aria-hidden />{person?.name}</span><span className={classes.metaItem}><Clock3 size={13} aria-hidden />{new Date(row.updatedAt).toLocaleDateString(locale)}</span></div>
          <div className={styles.cardActions} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
            <span className={styles.recordState}>{statusLabel(row.status)}</span>{actions(row)}
          </div>
        </div>;
      }
    }} />}
    <Modal presentation="side" width={640} title={preview?.workNo ?? t("养护工单详情")} open={previewOpen && Boolean(preview)} destroyOnHidden
      onCancel={() => setPreviewOpen(false)} afterClose={() => { const action = afterPreview.current; afterPreview.current = undefined; setPreviewId(undefined); action?.(); }}
      footer={preview ? <div className={styles.detailActions}>
        <Button onClick={() => afterClose(() => onOpen(preview))}>{t("完整详情与历史")}</Button>
        {canManage && ["pending", "in_progress"].includes(preview.status) && <Button disabled={pending} onClick={() => trigger(preview, { kind: "assign", assigneeId: preview.assigneeId })}>{t("派工")}</Button>}
        {canManage && ["pending", "in_progress", "pending_review"].includes(preview.status) && <Button danger disabled={pending} onClick={() => trigger(preview, { kind: "cancel" })}>{t("取消工单")}</Button>}
        {canManage && preview.status === "pending" && <Button type="primary" disabled={pending} onClick={() => trigger(preview, { kind: "start" })}>{t("开始处理")}</Button>}
        {canManage && preview.status === "in_progress" && <Button type="primary" disabled={pending} onClick={() => trigger(preview, { kind: "submit" })}>{t("提交验收")}</Button>}
        {canReview && preview.status === "pending_review" && <Button type="primary" disabled={pending} onClick={() => trigger(preview, { kind: "review", decision: "approved" })}>{t("验收")}</Button>}
      </div> : null}>
      {preview && <div className={styles.detail}>
        <DataTableStatus variant="soft" tone={preview.status === "completed" ? "success" : preview.status === "pending_review" ? "warning" : "neutral"}>{statusLabel(preview.status)}</DataTableStatus>
        <RecordFacts items={[
          { key: "type", label: t("类型"), value: typeLabel(preview.type) },
          { key: "assignee", label: t("负责人"), value: preview.assigneeName || t("未派工") },
          { key: "quantity", label: t("数量"), value: preview.quantity },
          { key: "updated", label: t("更新时间"), value: new Date(preview.updatedAt).toLocaleString(locale, { hour12: false }) }
        ]} />
        <section><h4>{t("处理原因")}</h4><p>{preview.reason || "—"}</p></section>
        <section><h4>{t("处理结果")}</h4><p>{preview.result || t("尚未提交")}</p></section>
        {preview.reviewReason && <section><h4>{t("验收说明")}</h4><p>{preview.reviewReason}</p></section>}
        {!!preview.attachments.length && <section><h4>{t("证据引用")}</h4><p>{preview.attachments.join(" · ")}</p></section>}
      </div>}
    </Modal>
    {rows.length > 0 && <p className={styles.hint}>{pending ? t("正在更新工单…") : t("拖动工单调整状态或负责人；同列排序仅影响当前浏览器视图。")}</p>}
  </>;
}
