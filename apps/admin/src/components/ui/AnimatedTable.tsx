import { useMemo, type ReactNode } from "react";
import type { TableProps } from "antd";
import { SortableDataTable, type DataColumn } from "@/registry/components/sortable-data-table/sortable-data-table";
import { useLocale } from "@/app/locale";
import { ArcLocale } from "./ArcLocale";
import { Pagination } from "./Pagination";

/** Opt-in original Arc table for flat server-paged lists. Sorting is page-local. */
export function AnimatedTable<T extends object>({ sortValue, sorting = true, ...props }: TableProps<T> & { sortValue: (row: T, column: number) => unknown; sorting?: boolean }) {
  const { t } = useLocale();
  type ViewRow = Record<string, unknown> & { record: T; id: string };
  const columns = props.columns ?? [];
  const rows = useMemo<ViewRow[]>(() => (props.dataSource ?? []).map((record, index) => {
    const key = typeof props.rowKey === "function" ? props.rowKey(record, index) : (record as Record<string, unknown>)[String(props.rowKey ?? "key")];
    return { record, id: String(key), ...Object.fromEntries(columns.map((_, column) => [`column${column}`, sortValue(record, column)])) };
  }), [props.dataSource, props.rowKey, columns, sortValue]);
  const arcColumns: DataColumn<ViewRow>[] = columns.map((column, index) => ({
    key: `column${index}`, label: String(column.title ?? ""), width: column.width,
    sortable: sorting && rows.some(row => row[`column${index}`] != null), numeric: column.align === "right" || rows.some(row => typeof row[`column${index}`] === "number"),
    render: (_, row) => {
      const field = "dataIndex" in column ? column.dataIndex : undefined;
      const value = field == null ? undefined : (Array.isArray(field) ? field : [field]).reduce<unknown>((object, key) => object == null ? undefined : (object as Record<string, unknown>)[String(key)], row.record);
      return column.render ? column.render(value, row.record, (props.dataSource ?? []).indexOf(row.record)) as ReactNode : value as ReactNode;
    },
  }));
  const pagination = typeof props.pagination === "object" ? props.pagination : undefined;
  return <div className="arc-animated-order-table" aria-busy={Boolean(props.loading)}>
    {(sorting || props.loading) && <div className="muted arc-table-scope">{sorting ? t("当前页排序") : ""}{props.loading ? `${sorting ? " · " : ""}${t("加载中")}` : ""}</div>}
    <ArcLocale><SortableDataTable key={sorting ? "sortable" : "server-order"} rows={rows} columns={arcColumns} rowKey="id" caption={t("租赁订单")} emptyMessage={t("暂无数据")} /></ArcLocale>
    {pagination && <Pagination {...pagination} disabled={Boolean(props.loading)} />}
  </div>;
}
