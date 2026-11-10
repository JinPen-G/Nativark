/**
 * Business columns bridge to the order list's Tablecn renderer and tools.
 * Only complete datasets sort/page locally. Readers remain owned by each page.
 * Unsupported Ant contracts retain an explicit fallback, never silently drop data.
 */
import { isValidElement, useEffect, useMemo, useState, type Key, type ReactNode } from "react";
import { Table as AntTable, type TableProps, type TablePaginationConfig } from "antd";
import type { ColumnType, SorterResult } from "antd/es/table/interface";
import { getCoreRowModel, getExpandedRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type CellContext, type ColumnDef, type ExpandedState, type HeaderContext, type RowData, type SortingState, type VisibilityState } from "@tanstack/react-table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useLocale } from "@/app/locale";
import { ADMIN_TABLE_METRICS } from "@/app/designTokens";
import { useTableRefresh } from "./data-table/TableRefreshContext";
import { ListControlsContext, ListHeadingContext, ListSectionTitle, useListControls, useListHeading, type ListToolbarHeading } from "./ListSection";
import { DataTable, DataTableColumnHeader } from "./data-table/DataTable";
import { DataTableToolbar } from "./data-table/DataTableToolbar";
import { Pagination } from "./Pagination";
import styles from "./data-table/DataTable.module.css";
import { Checkbox as ArcCheckbox } from "@/registry/components/checkbox/checkbox";
import { useAuthStore } from "@/features/auth/authStore";
import { useDataTableSelection } from "./data-table/DataTableSelection";
import { ListCards, ListSelectionBar, ListTransferTools, ListViewSwitch, type ListBatchAction, type ListCard } from "./data-table/ListCapabilities";
import type { ListExport, ListImport } from "./data-table/listTransfer";
import capabilityStyles from "./data-table/ListCapabilities.module.css";
import { ContentTransition } from "../workspace/ContentTransition";
import type { EmptySceneKind } from './EmptyScene';
import { ListFilterBar } from "./ListFilterBar";

export type BusinessTableProps<T extends object> = TableProps<T> & {
  /** Same-query revalidation keeps rows and local drafts mounted and visible. */
  refreshing?: boolean;
  /** Refetch this table's real source; omit for local form/snapshot previews. */
  onRefresh?: (() => unknown) | null;
  caption?: string;
  sortValue?: (row: T, column: number) => unknown;
  sorting?: boolean;
  /** Search/filters share one responsive row with the standard table tools. */
  toolbar?: ReactNode;
  toolbarNote?: ReactNode;
  emptyScene?: EmptySceneKind;
  exportConfig?: ListExport<T>;
  importConfig?: ListImport<unknown>;
  cardView?: ListCard<T> & { defaultView?: "list" | "cards" };
  batchActions?: ListBatchAction<T>[];
  selectionEnabled?: boolean;
};

export function readTableValue(record: unknown, field: unknown): unknown {
  if (field == null || field === "") return record;
  return (Array.isArray(field) ? field : [field]).reduce<unknown>((value, key) => value == null ? undefined : (value as Record<string, unknown>)[String(key)], record);
}

/** An explicit total denotes a remote result, even when the first page is short. */
export function isRemoteTablePage(pagination: TableProps<object>["pagination"]) {
  return Boolean(pagination && pagination.total != null);
}

function titleText(title: ReactNode): string {
  if (typeof title === "string" || typeof title === "number") return String(title);
  if (Array.isArray(title)) return title.map(titleText).join("");
  if (isValidElement<{ children?: ReactNode }>(title)) return titleText(title.props.children);
  return "";
}

/** Action access must survive horizontal scrolling in both renderers. Keep an
 * explicit pinning choice, and descend into the Ant grouped-column fallback. */
function pinActionColumns<T extends object>(columns: TableProps<T>["columns"], actionLabel: string): TableProps<T>["columns"] {
  return columns?.map(column => "children" in column
    ? { ...column, children: pinActionColumns<T>(column.children, actionLabel)! }
    : column.fixed == null && (column.key === "actions" || column.key === "action" || titleText(typeof column.title === "function" ? column.title({}) : column.title) === actionLabel)
      ? { ...column, fixed: "right" as const } : column);
}

/** Legacy widths are sizing hints, not minimums in a responsive list. Preserve
 * explicitly declared minima, editable controls and fallback business contracts. */
function naturalColumns<T extends object>(columns: TableProps<T>["columns"]): TableProps<T>["columns"] {
  return columns?.map(column => "children" in column
    ? { ...column, children: naturalColumns<T>(column.children)! }
    : { ...column, width: undefined, minWidth: column.minWidth ?? ADMIN_TABLE_METRICS.columnMinWidth });
}

const SHORT_COLUMN_FIELD = /(?:status|state|amount|price|balance|total|count|quantity|capacity|version|currency|enabled|active|phone|date|time|At$)/i;

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    business?: { label: string; render: (row: TData, index: number) => ReactNode };
  }
}
// Stable component types keep editable cells/focus intact when a page recreates
// its column array. Only metadata changes, never the rendered component identity.
function BusinessHeader<T>({ column }: HeaderContext<T, unknown>) {
  return <DataTableColumnHeader column={column} label={column.columnDef.meta?.business?.label ?? column.id} />;
}
function BusinessCell<T>({ column, row }: CellContext<T, unknown>) {
  return column.columnDef.meta?.business?.render(row.original, row.index);
}
function ExpansionCell<T>({ row }: CellContext<T, unknown>) {
  const { t } = useLocale();
  return row.getCanExpand() ? <button type="button" className={styles.expandControl} aria-label={t(row.getIsExpanded() ? "收起详情" : "展开详情")}
    aria-expanded={row.getIsExpanded()} onClick={event => { event.stopPropagation(); row.toggleExpanded(); }}>{row.getIsExpanded() ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button> : null;
}

export function Table<T extends object>(props: BusinessTableProps<T>) {
  const { t } = useLocale();
  const columns = useMemo(() => pinActionColumns(props.columns, t("操作")), [props.columns, t]);
  const reader = useTableRefresh();
  const controls = useListControls();
  const toolbarHeading = useListHeading();
  const inherited = props.onRefresh === undefined;
  const resolved = { ...props, columns, toolbarHeading, toolbar: props.toolbar ?? controls, onRefresh: (inherited ? reader.onRefresh : props.onRefresh) ?? undefined,
    refreshing: props.refreshing ?? (inherited ? reader.busy : false) };
  const selection = props.rowSelection;
  const incompatibleSelection = selection && (selection.type === "radio" || selection.onSelect || selection.onSelectAll || selection.onSelectInvert || selection.onSelectNone || selection.selections || selection.renderCell || selection.columnTitle || selection.onCell || selection.checkStrictly === false);
  const incompatible = incompatibleSelection || props.components || props.summary || props.children ||
    props.columns?.some(column => "children" in column || column.filters || column.filterDropdown) ||
    props.dataSource?.some(row => Array.isArray((row as Record<string, unknown>).children));
  const { refreshing: _refreshing, selectionEnabled, ...fallbackProps } = props;
  if (selectionEnabled === false) fallbackProps.rowSelection = undefined;
  return incompatible ? <>{toolbarHeading && <div className={styles.sectionHeader}><ListSectionTitle {...toolbarHeading} />{toolbarHeading.extra && <div className={styles.sectionActions}>{toolbarHeading.extra}</div>}</div>}<ListHeadingContext.Provider value={null}>
    {(resolved.toolbar || props.toolbarNote) && <div className={styles.toolbar}>{resolved.toolbar && <div className={styles.toolbarFilters}><ListFilterBar>{resolved.toolbar}</ListFilterBar></div>}{props.toolbarNote && <span className={styles.toolbarNote}>{props.toolbarNote}</span>}</div>}
    <div className={styles.legacyContent}><AntTable<T> {...fallbackProps} pagination={props.pagination === false ? false : { ...props.pagination, showTotal: props.pagination?.showTotal ?? ((total, range) => `${range[0]}–${range[1]} / ${total}`) }} tableLayout={props.tableLayout ?? "auto"} columns={props.tableLayout === "fixed" ? columns : naturalColumns(columns)} scroll={props.scroll ? { ...props.scroll, x: props.tableLayout === "fixed" ? props.scroll.x : "100%" } : undefined} /></div></ListHeadingContext.Provider></> : <BusinessTable {...resolved} />;
}
Table.listToolbarHost = true;

function BusinessTable<T extends object>(props: BusinessTableProps<T> & { toolbarHeading?: ListToolbarHeading | null }) {
  const { t } = useLocale();
  const identity = useAuthStore(state => JSON.stringify([state.tenant?.tenantId, state.currentWorkspaceId, state.user?.id]));
  const [selection, setSelection] = useDataTableSelection(`${identity}:${window.location.pathname}`);
  const viewKey = `rental-list-view:${identity}:${window.location.pathname}:${props.cardView?.kind ?? props.caption ?? "table"}`;
  const [savedView, setSavedView] = useState<{key:string; value:"list"|"cards"}>(() => {
    let value: string | null = null;
    try { value = sessionStorage.getItem(viewKey); } catch { /* Restricted storage keeps the component usable. */ }
    return {key:viewKey,value:value==="cards"||value==="list"?value:props.cardView?.defaultView??"list"};
  });
  const view = savedView.key === viewKey ? savedView.value : props.cardView?.defaultView ?? "list";
  const setView = (value:"list"|"cards") => {
    setSavedView({key:viewKey,value});
    try { sessionStorage.setItem(viewKey,value); } catch { /* View preferences are optional. */ }
  };
  const config: TablePaginationConfig = props.pagination && typeof props.pagination === "object" ? props.pagination : {};
  const remote = isRemoteTablePage(props.pagination), paged = props.pagination !== false;
  const [page, setPage] = useState(config.defaultCurrent ?? 1);
  const [size, setSize] = useState(config.defaultPageSize ?? config.pageSize ?? 20);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [expanded, setExpanded] = useState<ExpandedState>(() => Object.fromEntries((props.expandable?.defaultExpandedRowKeys ?? []).map(key => [String(key), true])));
  const source = useMemo(() => [...(props.dataSource ?? [])], [props.dataSource]);
  const sourceColumns = (props.columns ?? []) as ColumnType<T>[];
  const pageSize = remote ? config.pageSize ?? size : size;
  const total = config.total ?? source.length;
  const current = Math.max(1, Math.min(config.current ?? page, Math.max(1, Math.ceil(total / pageSize))));
  useEffect(() => { if (page !== current) setPage(current); }, [current, page]);
  useEffect(() => { if (config.pageSize != null) setSize(config.pageSize); }, [config.pageSize]);
  const loading = typeof props.loading === "object" ? Boolean(props.loading.spinning) : Boolean(props.loading);
  const getKey = (record: T, index: number) => typeof props.rowKey === "function" ? props.rowKey(record, index)
    : (record as Record<string, Key>)[String(props.rowKey ?? "key")] ?? index;
  const selectionConfig = props.rowSelection || undefined;
  const selectable = props.selectionEnabled !== false && Boolean(selectionConfig || props.batchActions?.length || props.exportConfig);
  const selectedState = !selectable ? {} : selectionConfig?.selectedRowKeys ? Object.fromEntries(selectionConfig.selectedRowKeys.map(key => [String(key), true])) : selection;
  const updateSelection = (next: typeof selectedState) => {
    setSelection(next);
    const keys = Object.keys(next).filter(key => next[key]);
    const records = source.filter((row, index) => next[String(getKey(row, index))]);
    selectionConfig?.onChange?.(keys.map(key => { const index = source.findIndex((row, i) => String(getKey(row, i)) === key); return index < 0 ? key : getKey(source[index], index); }), records, { type: "multiple" });
  };
  const selectedRows = source.filter((row, index) => selectedState[String(getKey(row, index))]);
  // Auto selection is bounded to the currently filtered dataset. Never silently select unseen server pages.
  useEffect(() => {
    if (selectionConfig?.selectedRowKeys) return;
    const keys = new Set(source.map((row, index) => String(getKey(row, index))));
    setSelection(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => keys.has(key))));
  }, [props.dataSource, identity]);
  const controlledExpanded = props.expandable?.expandedRowKeys;
  const expansion = controlledExpanded ? Object.fromEntries(controlledExpanded.map(key => [String(key), true])) : expanded;
  const labels: Record<string, string> = {};
  const columnSources = new Map<string, ColumnType<T>>();
  const compactLabels = new Set(["状态", "账号状态", "会员状态", "数量", "金额", "价格", "版本", "类型", "日期", "时间", "手机", "加入时间", "更新时间", "创建时间"].map(label => t(label)));
  const ids = new Set<string>();
  const columns: ColumnDef<T, unknown>[] = sourceColumns.map((column, index) => {
    const title = typeof column.title === "function" ? column.title({}) : column.title;
    const label = titleText(title) || t("列 {index}", { index: index + 1 });
    const action = label === t("操作") || column.key === "actions" || column.key === "action";
    let id = action ? "actions" : String(column.key ?? (Array.isArray(column.dataIndex) ? column.dataIndex.join(".") : column.dataIndex) ?? `column_${index}`);
    if (ids.has(id)) id = `${id}_${index}`;
    ids.add(id); labels[id] = label; columnSources.set(id, column);
    const canSort = props.sorting !== false && !action && (remote ? Boolean(props.onChange && column.sorter) : column.sorter !== false && (column.dataIndex != null || Boolean(props.sortValue) || Boolean(column.sorter)));
    const compare = typeof column.sorter === "function" ? column.sorter : typeof column.sorter === "object" ? column.sorter.compare : undefined;
    let sample: unknown;
    if (column.dataIndex != null) {
      for (const row of source) {
        sample = readTableValue(row, column.dataIndex);
        if (sample != null) break;
      }
    }
    const compact = action || compactLabels.has(label) || SHORT_COLUMN_FIELD.test(id) || column.align === "right" ||
      (typeof column.width === "number" && column.width <= ADMIN_TABLE_METRICS.columnMinWidth * 2) || typeof sample === "number" || typeof sample === "boolean";
    return {
      id, accessorFn: row => props.sortValue ? props.sortValue(row, index) : readTableValue(row, column.dataIndex),
      size: typeof column.width === "number" ? column.width : column.width ? parseFloat(String(column.width)) || ADMIN_TABLE_METRICS.columnWidth : action ? ADMIN_TABLE_METRICS.actionsWidth : ADMIN_TABLE_METRICS.columnWidth,
      minSize: column.minWidth ?? ADMIN_TABLE_METRICS.columnMinWidth, enableSorting: canSort, enableHiding: index !== 0 && !action,
      sortUndefined: "last", sortingFn: compare ? (a, b) => compare(a.original, b.original, "ascend") : "auto",
      header: BusinessHeader, cell: BusinessCell,
      meta: { cellAlign: "middle", contentSizing: { compact, minWidth: column.minWidth ?? (compact ? ADMIN_TABLE_METRICS.columnMinWidth : ADMIN_TABLE_METRICS.contentMinWidth) }, motion: !action && column.dataIndex != null ? { value: row => {
        // Track explicit scalar facts, never rendered nodes, clocks or whole row objects.
        const value = readTableValue(row, column.dataIndex);
        return value == null || typeof value === "string" || typeof value === "number" ? value : undefined;
      } } : undefined, business: { label, render: (row, rowIndex) => {
        const value = readTableValue(row, column.dataIndex);
        const rendered = column.render ? column.render(value, row, rowIndex) : value;
        return rendered && typeof rendered === "object" && !isValidElement(rendered) && !Array.isArray(rendered) && "children" in rendered
          ? rendered.children as ReactNode : rendered as ReactNode;
      } } },
    };
  });
  if (props.expandable?.expandedRowRender && props.expandable.showExpandColumn !== false) columns.unshift({
    id: "expand", size: ADMIN_TABLE_METRICS.expandWidth, enableSorting: false, enableHiding: false,
    header: () => <span className={styles.srOnly}>{t("展开详情")}</span>,
    cell: ExpansionCell,
  });
  if (selectable) columns.unshift({ id: "select", size: ADMIN_TABLE_METRICS.expandWidth, minSize: ADMIN_TABLE_METRICS.expandWidth, enableSorting: false, enableHiding: false,
    header: ({ table }) => selectionConfig?.hideSelectAll ? null : <ArcCheckbox aria-label={t("选择当前页")} disabled={loading || !table.getRowModel().rows.some(row => row.getCanSelect())} checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false} onCheckedChange={checked => table.toggleAllPageRowsSelected(checked === true)} />,
    cell: ({ row }) => <ArcCheckbox aria-label={`${t("选择")} ${row.id}`} disabled={!row.getCanSelect()} checked={row.getIsSelected()} onClick={event => event.stopPropagation()} onCheckedChange={checked => row.toggleSelected(checked === true)} />,
  });
  const sortResults = (next: SortingState): SorterResult<T>[] => next.map(item => {
    const column = columnSources.get(item.id);
    const field = column?.dataIndex;
    return { column, columnKey: column?.key ?? item.id, field: Array.isArray(field) ? field.map(String) : field == null ? undefined : String(field), order: item.desc ? "descend" : "ascend" };
  });
  const table = useReactTable({
    data: source, columns, getRowId: (row, index) => String(getKey(row, index)),
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(), getExpandedRowModel: getExpandedRowModel(),
    manualPagination: remote || !paged, manualSorting: remote,
    enableRowSelection: row => selectable && !loading && !selectionConfig?.getCheckboxProps?.(row.original)?.disabled, enableMultiSort: true, autoResetPageIndex: false, autoResetExpanded: false,
    getRowCanExpand: row => Boolean(props.expandable?.expandedRowRender && (props.expandable.rowExpandable?.(row.original) ?? true)),
    state: { sorting, columnVisibility: visibility, expanded: expansion, rowSelection: selectedState, pagination: { pageIndex: current - 1, pageSize },
      columnPinning: { left: [...(selectable ? ["select"] : []), ...sourceColumns.flatMap((c, i) => c.fixed === "left" || c.fixed === true ? [columns.find(col => columnSources.get(col.id!) === c)?.id ?? `column_${i}`] : [])],
        right: sourceColumns.flatMap(c => c.fixed === "right" ? [columns.find(col => columnSources.get(col.id!) === c)!.id!] : []) } },
    onColumnVisibilityChange: setVisibility,
    onRowSelectionChange: updater => updateSelection(typeof updater === "function" ? updater(selectedState) : updater),
    onSortingChange: updater => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      setSorting(next); setPage(1);
      if (remote) config.onChange?.(1, pageSize);
      const results = sortResults(next);
      props.onChange?.({ ...config, current: 1, pageSize, total }, {}, results.length === 1 ? results[0] : results, { currentDataSource: source, action: "sort" });
    },
    onExpandedChange: updater => {
      const next = typeof updater === "function" ? updater(expansion) : updater;
      setExpanded(next);
      const keys = source.filter((record, index) => next === true || next[String(getKey(record, index))]).map(getKey);
      props.expandable?.onExpandedRowsChange?.(keys);
      source.forEach((record, index) => {
        const id = String(getKey(record, index));
        const wasOpen = expansion === true || Boolean(expansion[id]), isOpen = next === true || Boolean(next[id]);
        if (wasOpen !== isOpen) props.expandable?.onExpand?.(isOpen, record);
      });
    },
  });
  const changePage = (next: number, nextSize: number) => {
    const changedSize = nextSize !== pageSize, nextPage = changedSize ? 1 : next;
    setPage(nextPage); setSize(nextSize);
    if (changedSize) config.onShowSizeChange?.(nextPage, nextSize);
    config.onChange?.(nextPage, nextSize);
    const results = sortResults(sorting);
    props.onChange?.({ ...config, current: nextPage, pageSize: nextSize, total }, {}, results.length === 1 ? results[0] : results, { currentDataSource: source, action: "paginate" });
  };
  const pageRows = table.getRowModel().rows.map(row => row.original);
  const exportConfig = props.exportConfig ? { ...props.exportConfig, scope: remote ? "page" as const : "filtered" as const } : undefined;
  const pager = paged && total > 0 ? <Pagination {...config} showSizeChanger={config.showSizeChanger ?? true} hideOnSinglePage={config.hideOnSinglePage ?? false}
    disabled={loading || config.disabled} current={current} pageSize={pageSize} total={total} onShowSizeChange={undefined} onChange={changePage} /> : undefined;
  return <div data-copilot-list="" data-copilot-source={props.caption} className={`${styles.root} ${selectedRows.length ? capabilityStyles.reserved : ""} ${props.className ?? ""}`} style={props.style}>
    {props.title?.(pageRows)}
    <DataTableToolbar table={table} label={id => labels[id] ?? id} onRefresh={props.onRefresh ?? undefined} busy={loading} controls={props.toolbar} heading={props.toolbarHeading}
      sortDisabled={!table.getAllLeafColumns().some(column => column.getCanSort())}
      sortHint={remote && !props.onChange ? t("排序沿用服务端默认顺序") : undefined} note={props.toolbarNote}
      hideColumns={Boolean(props.cardView && view === "cards")} extra={<>
        <ListTransferTools config={exportConfig} rows={remote ? pageRows : table.getPrePaginationRowModel().rows.map(row => row.original)} busy={loading} importConfig={props.importConfig} />
      </>} trailingExtra={props.cardView && <ListViewSwitch value={view} onChange={setView} />} />
    <ContentTransition value={view}>{props.cardView && view === "cards" && source.length > 0 ? <><ListCards key={identity} rows={pageRows} config={props.cardView} busy={loading} canSelect={row => !selectionConfig?.getCheckboxProps?.(row)?.disabled} getKey={row => String(getKey(row, source.indexOf(row)))} selected={new Set(Object.keys(selectedState).filter(key => selectedState[key]))}
      onSelect={selectable ? (row, checked) => { const id = String(getKey(row, source.indexOf(row))); if (!selectionConfig?.getCheckboxProps?.(row)?.disabled) updateSelection({ ...selectedState, [id]: checked }); } : undefined} />{pager}</> :
    <ListHeadingContext.Provider value={null}><ListControlsContext.Provider value={null}><DataTable table={table} compactHeader contentLayout={props.tableLayout === "fixed" ? false : undefined} caption={props.caption ?? t("数据表格")} busy={loading && source.length > 0} loading={loading && source.length === 0} refreshing={props.refreshing}
      emptyScene={props.emptyScene} empty={(typeof props.locale?.emptyText === "function" ? props.locale.emptyText() : props.locale?.emptyText) ?? t("暂无数据")} maxHeight={props.scroll?.y} minWidth={props.tableLayout === "fixed" && props.scroll?.x !== true ? props.scroll?.x : undefined}
      showHeader={props.showHeader} animated motionScope=""
      rowProps={row => {
        const attributes = props.onRow?.(row.original, row.index) ?? {};
        const rowClass = typeof props.rowClassName === "function" ? props.rowClassName(row.original, row.index, 0) : props.rowClassName;
        return { ...attributes, "aria-selected": selectable ? row.getIsSelected() : undefined, className: [attributes.className, rowClass, row.getIsSelected() ? capabilityStyles.selected : ""].filter(Boolean).join(" "),
          onClick: event => { attributes.onClick?.(event); if (props.expandable?.expandRowByClick && row.getCanExpand()) row.toggleExpanded(); } };
      }}
      cellProps={cell => {
        const column = columnSources.get(cell.column.id), attributes = column?.onCell?.(cell.row.original, cell.row.index) ?? {};
        return { ...attributes, style: { textAlign: column?.align, ...attributes.style }, className: [column?.className, attributes.className].filter(Boolean).join(" ") };
      }}
      renderExpanded={props.expandable?.expandedRowRender ? row => props.expandable!.expandedRowRender!(row.original, row.index, 0, row.getIsExpanded()) : undefined}
      footer={pager} /></ListControlsContext.Provider></ListHeadingContext.Provider>}</ContentTransition>
    <ListSelectionBar key={identity} rows={selectedRows} clear={() => updateSelection({})} onSelectPage={() => table.toggleAllPageRowsSelected(true)} config={exportConfig} actions={props.batchActions} busy={loading} />
    {props.footer?.(pageRows)}
  </div>;
}
