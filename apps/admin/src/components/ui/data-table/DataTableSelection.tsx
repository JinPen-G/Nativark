/** Reusable Tablecn selection column. The host owns selected IDs across server pages.
 * Header selection affects only loaded rows, never an unqueried global result set.
 */
import type { ColumnDef, OnChangeFn, RowSelectionState, Table } from "@tanstack/react-table";
import { useCallback, useEffect, useState } from "react";
import { Checkbox } from "@/registry/components/checkbox/checkbox";
import { useLocale } from "@/app/locale";
import { Button } from "../Button";
import styles from "./DataTable.module.css";

export function useDataTableSelection(scope: string): [RowSelectionState, OnChangeFn<RowSelectionState>] {
  const [state, setState] = useState<{ scope: string; rows: RowSelectionState }>({ scope, rows: {} });
  // Never expose another identity/workspace's IDs, even for the frame before the effect.
  useEffect(() => setState(current => current.scope === scope ? current : { scope, rows: {} }), [scope]);
  const update = useCallback<OnChangeFn<RowSelectionState>>(updater => setState(current => {
    const previous = current.scope === scope ? current.rows : {};
    return { scope, rows: typeof updater === "function" ? updater(previous) : updater };
  }), [scope]);
  return [state.scope === scope ? state.rows : {}, update];
}

export function dataTableSelectionColumn<T>({ label, disabled = false }: { label: (row: T) => string; disabled?: boolean }): ColumnDef<T, unknown> {
  return {
    id: "select", size: 52, minSize: 52, maxSize: 52,
    enableSorting: false, enableHiding: false,
    header: ({ table }) => <SelectionHeader table={table} disabled={disabled} />,
    cell: ({ row }) => <Checkbox aria-label={label(row.original)} checked={row.getIsSelected()}
      disabled={disabled || !row.getCanSelect()} onCheckedChange={checked => row.toggleSelected(checked === true)} />,
  };
}

function SelectionHeader<T>({ table, disabled }: { table: Table<T>; disabled: boolean }) {
  const { t } = useLocale();
  return <Checkbox aria-label={t("选择当前页")} checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false}
    disabled={disabled || !table.getRowModel().rows.some(row => row.getCanSelect())}
    onCheckedChange={checked => table.toggleAllPageRowsSelected(checked === true)} />;
}

/** Counts the controlled ID map, not getSelectedRowModel (which only knows this page). */
export function DataTableSelectionSummary<T>({ table }: { table: Table<T> }) {
  const { t } = useLocale();
  const selected = Object.values(table.getState().rowSelection ?? {}).filter(Boolean).length;
  const visible = table.getRowModel().rows.filter(row => row.getIsSelected()).length;
  if (!selected) return null;
  return <div className={styles.selectionSummary}>
    <span role="status" aria-live="polite">{t("已选择")} {selected} {t("条记录")} · {t("当前页已选")} {visible}
      {selected > visible && <span className={styles.selectionNote}> · {t("包含其他页或筛选外的选择")}</span>}</span>
    <Button type="text" size="small" onClick={() => table.resetRowSelection(true)}>{t("清除选择")}</Button>
  </div>;
}
