/** Tablecn's multi-sort popover integration; upstream snapshot and MIT license: packages/ui-tablecn. */
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import type { ColumnSort, Table } from "@tanstack/react-table";
import { Command } from "cmdk";
import { ArrowDownUp, Check, ChevronsUpDown, GripVertical, Search, Trash2 } from "lucide-react";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { useLocale } from "@/app/locale";
import { Button } from "../Button";
import styles from "./DataTable.module.css";

export function DataTableSortList<T>({ table, label, disabled = false, hint, keyboardShortcut = true }: { table: Table<T>; label: (id: string) => string; disabled?: boolean; hint?: string; keyboardShortcut?: boolean }) {
  const { t } = useLocale();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const sorting = table.getState().sorting;
  const columns = table.getAllLeafColumns().filter(column => column.getCanSort());
  const available = columns.filter(column => !sorting.some(sort => sort.id === column.id));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  useEffect(() => {
    if (!keyboardShortcut || disabled) return;
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.matches("input, textarea, select") || event.target.isContentEditable)) return;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "s") { event.preventDefault(); setOpen(value => !value); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [keyboardShortcut, disabled]);
  const update = (id: string, patch: Partial<ColumnSort>) => table.setSorting(current => current.map(sort => sort.id === id ? { ...sort, ...patch } : sort));
  const remove = (id: string) => table.setSorting(current => current.filter(sort => sort.id !== id));
  const reset = () => table.setSorting([]);
  const dragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (over && active.id !== over.id) table.setSorting(current => arrayMove(current, current.findIndex(sort => sort.id === active.id), current.findIndex(sort => sort.id === over.id)));
  };
  return <DndContext sensors={sensors} modifiers={[restrictToVerticalAxis]} collisionDetection={closestCenter} onDragStart={({ active }) => setDragging(String(active.id))} onDragEnd={dragEnd} onDragCancel={() => setDragging(null)}>
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild><Button size="small" className={styles.viewTrigger} disabled={disabled} title={hint ?? t("排序")} aria-description={hint} aria-label={t("排序管理")} onKeyDown={event => { if (["Backspace", "Delete"].includes(event.key) && sorting.length) { event.preventDefault(); reset(); } }}><ArrowDownUp size={16} /><span className={styles.toolLabel}>{t("排序")}</span>{sorting.length > 0 && <span className={styles.sortCount}>{sorting.length}</span>}</Button></Popover.Trigger>
      <Popover.Portal><Popover.Content className={`${styles.menu} ${styles.sortMenu}`} align="end" sideOffset={4} collisionPadding={12} aria-labelledby={titleId}>
        <div className={styles.sortHeading}><h4 id={titleId}>{t(sorting.length ? "排序依据" : "尚未设置排序")}</h4>{!sorting.length && <p>{t("添加排序条件来整理数据。")}</p>}</div>
        <SortableContext items={sorting.map(sort => sort.id)} strategy={verticalListSortingStrategy}>
          <div role="list" className={styles.sortItems}>{sorting.map(sort => <SortItem key={sort.id} sort={sort} label={label} columns={columns.filter(column => column.id === sort.id || !sorting.some(other => other.id === column.id)).map(column => column.id)} onUpdate={update} onRemove={remove} />)}</div>
        </SortableContext>
        <div className={styles.sortFooter}><Button size="small" type="primary" disabled={!available.length} onClick={() => { const first = available[0]; if (first) table.setSorting(current => [...current, { id: first.id, desc: false }]); }}>{t("添加排序")}</Button>{sorting.length > 0 && <Button size="small" onClick={reset}>{t("清除排序")}</Button>}</div>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    <DragOverlay>{dragging && <div className={styles.sortOverlay}>{label(dragging)}</div>}</DragOverlay>
  </DndContext>;
}

function SortItem({ sort, columns, label, onUpdate, onRemove }: { sort: ColumnSort; columns: string[]; label: (id: string) => string; onUpdate: (id: string, patch: Partial<ColumnSort>) => void; onRemove: (id: string) => void }) {
  const { t } = useLocale();
  const [fieldOpen, setFieldOpen] = useState(false);
  const [directionOpen, setDirectionOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sort.id });
  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (fieldOpen || directionOpen || (event.target instanceof HTMLElement && event.target.matches("input, textarea"))) return;
    if (["Backspace", "Delete"].includes(event.key)) { event.preventDefault(); onRemove(sort.id); }
  };
  return <div ref={setNodeRef} role="listitem" className={styles.sortItem} onKeyDown={keydown} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .4 : 1 }}>
    <Popover.Root open={fieldOpen} onOpenChange={setFieldOpen}>
      <Popover.Trigger asChild><Button className={styles.sortField} size="small" aria-label={t("排序字段")}><span>{label(sort.id)}</span><ChevronsUpDown size={14} /></Button></Popover.Trigger>
      <Popover.Portal><Popover.Content className={`${styles.menu} ${styles.viewMenu}`} align="start" sideOffset={4} collisionPadding={12}>
        <Command><div className={styles.commandSearch}><Search size={16} /><Command.Input placeholder={t("搜索列…")} aria-label={t("搜索列…")} /></div><Command.List className={styles.commandList}><Command.Empty className={styles.commandEmpty}>{t("没有匹配的列")}</Command.Empty><Command.Group>{columns.map(id => <Command.Item key={id} value={label(id)} className={styles.commandItem} onSelect={() => { onUpdate(sort.id, { id }); setFieldOpen(false); }}>{label(id)}</Command.Item>)}</Command.Group></Command.List></Command>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    <Select.Root value={sort.desc ? "desc" : "asc"} open={directionOpen} onOpenChange={setDirectionOpen} onValueChange={value => onUpdate(sort.id, { desc: value === "desc" })}>
      <Select.Trigger className={styles.directionTrigger} aria-label={t("排序方向")}><Select.Value /><Select.Icon><ChevronsUpDown size={14} /></Select.Icon></Select.Trigger>
      <Select.Portal><Select.Content className={styles.menu} position="popper" sideOffset={4}><Select.Viewport>{["asc", "desc"].map(value => <Select.Item key={value} value={value} className={styles.menuItem}><Select.ItemText>{t(value === "asc" ? "升序" : "降序")}</Select.ItemText><Select.ItemIndicator className={styles.indicator}><Check size={14} /></Select.ItemIndicator></Select.Item>)}</Select.Viewport></Select.Content></Select.Portal>
    </Select.Root>
    <Button size="small" className={styles.iconButton} aria-label={`${t("移除排序")} · ${label(sort.id)}`} onClick={() => onRemove(sort.id)} icon={<Trash2 size={14} />} />
    <button type="button" className={styles.dragHandle} {...attributes} {...listeners} aria-label={`${t("调整排序优先级")} · ${label(sort.id)}`}><GripVertical size={16} /></button>
  </div>;
}
