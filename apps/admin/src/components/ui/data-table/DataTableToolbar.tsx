/** Shared list tools. Refresh only invokes the reader supplied by the owning page. */
import { useState, type ReactNode } from "react";
import type { Table } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";
import { useLocale } from "@/app/locale";
import { Button } from "../Button";
import { ListFilterBar, splitListControls } from "../ListFilterBar";
import { ListSectionTitle, type ListToolbarHeading } from "../ListSection";
import { DataTableViewOptions } from "./DataTable";
import { DataTableSortList } from "./DataTableSortList";
import styles from "./DataTable.module.css";

export function DataTableToolbar<T>({ table, label, onRefresh, busy, note, controls, heading, sortDisabled, sortHint, keyboardShortcut = false, extra, trailingExtra, hideColumns = false }: {
  table: Table<T>; label: (id: string) => string; onRefresh?: () => unknown;
  busy?: boolean; note?: ReactNode; controls?: ReactNode; sortDisabled?: boolean; sortHint?: string; keyboardShortcut?: boolean;
  heading?: ListToolbarHeading | null;
  extra?: ReactNode; trailingExtra?: ReactNode; hideColumns?: boolean;
}) {
  const { t } = useLocale();
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const { navigation, filters } = splitListControls(controls);
  const refresh = async () => {
    if (!onRefresh || refreshing || busy) return;
    setRefreshing(true); setFailed(false);
    try {
      const result = await onRefresh();
      // Query.refetch resolves an error result unless throwOnError was requested.
      if (result && typeof result === "object" && "isError" in result && result.isError) setFailed(true);
    } catch { setFailed(true); }
    finally { setRefreshing(false); }
  };
  return <>
    {navigation.length > 0 && <div className={styles.viewNavigation} data-list-view-navigation="">{navigation}</div>}
    <div className={styles.toolbar} data-table-tools="" data-has-filters={filters.length ? "" : undefined} data-has-section-actions={heading?.extra ? "" : undefined}>
    {heading && <ListSectionTitle {...heading} className={styles.toolbarHeading} />}
    {filters.length > 0 && <div className={styles.toolbarFilters} data-table-filters=""><ListFilterBar>{filters}</ListFilterBar></div>}
    {note && <span className={styles.toolbarNote}>{note}</span>}
    {failed && <span className={styles.refreshError} role="alert">{t("刷新失败，请重试")}</span>}
    <div className={styles.toolbarControls}>
      {heading?.extra}
      {extra}
      <span title={t(onRefresh ? "刷新表格" : "本地预览随源数据更新")}><Button size="small" type="text" className={styles.refreshControl}
        aria-label={t("刷新表格")} disabled={!onRefresh || busy || refreshing} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" /></Button></span>
      <DataTableSortList table={table} label={label} disabled={sortDisabled} hint={sortHint} keyboardShortcut={keyboardShortcut} />
      {!hideColumns && <DataTableViewOptions table={table} label={label} />}
      {trailingExtra}
    </div>
  </div></>;
}
