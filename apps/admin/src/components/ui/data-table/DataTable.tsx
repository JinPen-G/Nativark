/**
 * Tablecn (MIT) integration for flat, server-paged business lists.
 * Rendering/header/view interactions follow the pinned upstream source in packages/ui-tablecn.
 * CSS Modules replace Tailwind; locale, UIArc controls and transport remain platform-owned.
 * No local sorting/pagination of a server page and no implicit business mutations.
 */
import { flexRender, type Cell, type Column, type Row, type RowData, type Table as TanstackTable } from "@tanstack/react-table";
import * as Menu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronDown, ChevronsUpDown, ChevronUp, EyeOff, Search, Settings2, X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type TdHTMLAttributes, type ReactNode } from "react";
import { useLocale } from "@/app/locale";
import { Button } from "../Button";
import { ADMIN_LOADING_METRICS } from "@/app/designTokens";
import { TableSkeletonCell } from "../../loading/LoadingSkeleton";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { DataTableAnnouncements, DataTableCellMotion, MOTIQ_TABLE_MOTION } from "./DataTableMotion";
import styles from "./DataTable.module.css";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Opt in per column/record; multi-line cells keep the existing top alignment. */
    cellAlign?: "top" | "middle" | ((row: TData) => "top" | "middle");
  }
}

export function DataTableColumnHeader<T>({ column, label, disabled }: { column: Column<T, unknown>; label: string; disabled?: boolean }) {
  const { t } = useLocale();
  const sorted = column.getIsSorted();
  if (!column.getCanSort() && !column.getCanHide()) return <span className={styles.headerLabel} title={label}>{label}</span>;
  const indicator = <Menu.ItemIndicator className={styles.indicator}><Check size={14} /></Menu.ItemIndicator>;
  return <Menu.Root>
    <Menu.Trigger type="button" className={styles.headerTrigger} disabled={disabled} aria-label={`${label} · ${t("列选项")}`}>
      <span className={styles.headerLabel} title={label}>{label}</span>{column.getCanSort() && (sorted === "desc" ? <ChevronDown /> : sorted === "asc" ? <ChevronUp /> : <ChevronsUpDown />)}
    </Menu.Trigger>
    <Menu.Portal><Menu.Content className={styles.menu} align="start" sideOffset={4} collisionPadding={12}>
      {column.getCanSort() && <>
        <Menu.CheckboxItem className={styles.menuItem} checked={sorted === "asc"} onSelect={() => column.toggleSorting(false, true)}><ChevronUp />{t("升序")}{indicator}</Menu.CheckboxItem>
        <Menu.CheckboxItem className={styles.menuItem} checked={sorted === "desc"} onSelect={() => column.toggleSorting(true, true)}><ChevronDown />{t("降序")}{indicator}</Menu.CheckboxItem>
        {sorted && <Menu.Item className={styles.menuItem} onSelect={() => column.clearSorting()}><X />{t("取消排序")}</Menu.Item>}
      </>}
      {column.getCanHide() && <Menu.CheckboxItem className={styles.menuItem} checked={!column.getIsVisible()} onSelect={() => column.toggleVisibility(false)}><EyeOff />{t("隐藏此列")}{indicator}</Menu.CheckboxItem>}
    </Menu.Content></Menu.Portal>
  </Menu.Root>;
}

/** Tablecn's searchable View popover. Column state stays in TanStack, not a second mirror. */
export function DataTableViewOptions<T>({ table, label, disabled }: { table: TanstackTable<T>; label: (id: string) => string; disabled?: boolean }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><Button size="small" className={styles.viewTrigger} disabled={disabled} role="combobox" title={t("显示列")} aria-label={t("显示或隐藏列")}><Settings2 size={16} /><span className={styles.toolLabel}>{t("显示列")}</span></Button></Popover.Trigger>
    <Popover.Portal><Popover.Content className={styles.columnViewMenu} align="center" sideOffset={4} collisionPadding={12} aria-label={t("显示或隐藏列")} data-slot="popover-content">
      <Command className={styles.columnCommand} data-slot="command">
        <div className={styles.columnSearchWrapper} data-slot="command-input-wrapper">
          <div className={styles.columnSearch} data-slot="input-group" role="group">
            <Command.Input data-slot="command-input" placeholder={t("搜索列…")} aria-label={t("搜索列…")} />
            <span className={styles.columnSearchAddon} data-slot="input-group-addon" data-align="inline-start" onClick={event => event.currentTarget.parentElement?.querySelector("input")?.focus()}><Search size={16} aria-hidden="true" /></span>
          </div>
        </div>
        <Command.List className={styles.columnList} data-slot="command-list">
          <Command.Empty className={styles.columnEmpty} data-slot="command-empty">{t("没有匹配的列")}</Command.Empty>
          <Command.Group className={styles.columnGroup} data-slot="command-group">
            {table.getAllLeafColumns().filter(column => column.getCanHide()).map(column => <Command.Item key={column.id} value={column.id} keywords={[label(column.id)]} className={styles.columnItem} data-slot="command-item" data-checked={column.getIsVisible()} onSelect={() => column.toggleVisibility(!column.getIsVisible())}>
              <span className={styles.columnLabel}>{label(column.id)}</span><Check size={16} className={styles.columnViewCheck} aria-hidden="true" />
            </Command.Item>)}
          </Command.Group>
        </Command.List>
      </Command>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

function pinningStyle<T>(column: Column<T>): CSSProperties {
  const pinned = column.getIsPinned();
  return { width: column.getSize(), ...(pinned ? { position: "sticky", left: pinned === "left" ? column.getStart("left") : undefined, right: pinned === "right" ? column.getAfter("right") : undefined, zIndex: 1 } : {}) };
}

/** Internal leading slot; whole-cell alignment is separately controlled by column metadata. */
export function DataTableLeading({ children }: { children: ReactNode }) {
  return <span className={styles.leading}>{children}</span>;
}

function cellAlignment<T>(cell: Cell<T, unknown>) {
  const alignment = cell.column.columnDef.meta?.cellAlign;
  return typeof alignment === "function" ? alignment(cell.row.original) : alignment;
}

function CellContent<T>({ cell, animated, paused }: { cell: Cell<T, unknown>; animated?: boolean; paused?: boolean }) {
  const content = flexRender(cell.column.columnDef.cell, cell.getContext());
  const config = cell.column.columnDef.meta?.motion;
  if (!animated || !config) return content;
  const row = cell.row.original;
  return <DataTableCellMotion key={config.context?.(row)} value={config.value(row)} status={config.status}
    format={config.format ? value => config.format!(value, row) : undefined}
    renderNumber={config.renderNumber ? formatted => config.renderNumber!(formatted, row) : undefined} paused={paused}>{content}</DataTableCellMotion>;
}

export function DataTable<T>({ table, caption, busy, loading, empty, footer, animated = false, motionScope = "", compactHeader = false, rowProps, cellProps, renderExpanded, maxHeight, minWidth, showHeader = true }: {
  table: TanstackTable<T>; caption: string; busy?: boolean; loading?: boolean;
  empty: ReactNode; footer?: ReactNode; animated?: boolean;
  /** Reset motion history on page/filter/scope changes; placeholder data is paused by busy. */
  motionScope?: string;
  compactHeader?: boolean;
  rowProps?: (row: Row<T>) => HTMLAttributes<HTMLTableRowElement>;
  cellProps?: (cell: Cell<T, unknown>) => TdHTMLAttributes<HTMLTableCellElement>;
  renderExpanded?: (row: Row<T>) => ReactNode;
  maxHeight?: CSSProperties["maxHeight"]; minWidth?: CSSProperties["minWidth"]; showHeader?: boolean;
}) {
  const { t } = useLocale();
  const reduced = useReducedMotion();
  const suppress = !animated || Boolean(reduced);
  const rows = table.getRowModel().rows;
  const columns = table.getVisibleLeafColumns();
  const headerRef = useRef<HTMLTableSectionElement>(null);
  const refreshRef = useRef<HTMLDivElement>(null);
  // Font loading, zoom or grouped headers can make the real header taller than
  // its minimum token. Never let the data placeholder cover that real header.
  useLayoutEffect(() => {
    const header = headerRef.current, overlay = refreshRef.current;
    if (!busy || loading || !header || !overlay) return;
    const measure = () => { overlay.style.top = `${header.getBoundingClientRect().height}px`; };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [busy, loading]);
  const skeletonRows = (count: number) => Array.from({ length: count }, (_, index) => <tr key={`skeleton-${index}`} className={styles.skeletonRow} aria-hidden="true">
    {columns.map(column => <td key={column.id} style={pinningStyle(column)} data-pinned={column.getIsPinned() || undefined}>
      <TableSkeletonCell columnId={column.id} />
    </td>)}
  </tr>);
  return <div className={styles.root} data-compact-header={compactHeader || undefined} aria-busy={busy || loading || undefined}>
    {animated && <DataTableAnnouncements table={table} scope={JSON.stringify([motionScope, table.getState().sorting])} paused={Boolean(busy)} />}
    <div className={styles.viewport}>
    <div className={styles.scroll} style={{ maxHeight }} data-scroll-y={maxHeight != null || undefined} tabIndex={0} role="region" aria-label={caption}>
      <table className={styles.table} style={{ minWidth: minWidth ?? table.getTotalSize() }}>
        <caption className={styles.srOnly}>{caption}</caption>
        {showHeader && <thead ref={headerRef}>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id} scope="col" colSpan={header.colSpan} style={pinningStyle(header.column)} data-column-id={header.column.id} data-pinned={header.column.getIsPinned() || undefined} aria-sort={header.column.getCanSort() ? (header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : "none") : undefined}>
          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
        </th>)}</tr>)}</thead>}
        <LayoutGroup><tbody key={motionScope} inert={busy || loading || undefined} aria-hidden={busy || loading || undefined} className={busy && !loading ? styles.refreshingBody : undefined}>
          {loading ? skeletonRows(ADMIN_LOADING_METRICS.rows) : <AnimatePresence initial={false} mode="popLayout">
            {rows.length ? rows.flatMap(row => [<motion.tr key={row.id} {...rowProps?.(row) as HTMLMotionProps<"tr">} layout={suppress ? false : "position"}
              initial={suppress ? false : MOTIQ_TABLE_MOTION.initial} animate={MOTIQ_TABLE_MOTION.animate}
              exit={suppress ? { opacity: 0 } : MOTIQ_TABLE_MOTION.exit}
              transition={suppress ? { duration: 0 } : MOTIQ_TABLE_MOTION.transition}
              data-state={row.getIsSelected() ? "selected" : undefined} data-row-id={row.id} aria-selected={table.options.enableRowSelection ? row.getIsSelected() : undefined}>
              {row.getVisibleCells().map(cell => { const attributes = cellProps?.(cell); return attributes?.colSpan === 0 || attributes?.rowSpan === 0 ? null : <td {...attributes} key={cell.id} style={{ ...pinningStyle(cell.column), ...attributes?.style }} data-pinned={cell.column.getIsPinned() || undefined} data-column-id={cell.column.id} data-cell-align={cellAlignment(cell)}>
                <CellContent cell={cell} animated={animated} paused={busy} />
              </td>; })}
            </motion.tr>, row.getIsExpanded() && renderExpanded ? <tr key={`${row.id}-detail`} className={styles.expandedRow}><td colSpan={Math.max(1, columns.length)}>{renderExpanded(row)}</td></tr> : null]) : <tr key="empty"><td colSpan={Math.max(1, columns.length)} className={styles.empty}>{empty}</td></tr>}
          </AnimatePresence>}
        </tbody></LayoutGroup>
      </table>
    {busy && !loading && <div ref={refreshRef} className={styles.refreshOverlay} role="status" aria-label={t("加载中")} style={{ minWidth: minWidth ?? table.getTotalSize(), top: showHeader ? `calc(var(--table-header-height) * ${table.getHeaderGroups().length})` : 0 }}>
      <table className={styles.table} aria-hidden="true"><tbody>{skeletonRows(rows.length || ADMIN_LOADING_METRICS.rows)}</tbody></table>
    </div>}
    {loading && <span className={styles.srOnly} role="status">{t("加载中")}</span>}
    </div>
    </div>
    {footer}
  </div>;
}
