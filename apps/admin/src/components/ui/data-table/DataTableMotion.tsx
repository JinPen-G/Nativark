/**
 * Motiq Streaming Data Rows (MIT) motion port for the existing Tablecn renderer.
 * Original source/notice: packages/ui-motiq. These parameters are upstream's;
 * host adapters provide semantic tokens, exact business formatting and query identity.
 * No simulated feed, polling, business mutation or extra animation of UIArc controls.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { RowData, Table } from "@tanstack/react-table";
import { useAnimatedNumber } from "../../../../../../packages/ui-motiq/runtime/use-animated-number";
import { useLocale } from "@/app/locale";
import styles from "./DataTable.module.css";

export interface DataTableMotionValue<T> {
  value: (row: T) => string | number | null | undefined;
  /** Numeric morph is visual only; the exact formatted fact stays available to assistive tech. */
  format?: (value: number, row: T) => string;
  /** Optional visual structure; `format` remains the exact monetary/text fact. */
  renderNumber?: (formatted: string, row: T) => ReactNode;
  context?: (row: T) => string;
  status?: boolean;
}
declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    motion?: DataTableMotionValue<TData>;
  }
}

export const MOTIQ_TABLE_MOTION = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 6 },
  transition: { layout: { duration: 0.32, ease: [0.2, 0, 0, 1] }, duration: 0.24, ease: [0.2, 0, 0, 1] },
  highlightDuration: 1400,
} as const;

export function cellChangeDirection(previous: unknown, next: unknown): number | undefined {
  if (Object.is(previous, next)) return undefined;
  return typeof previous === "number" && typeof next === "number" ? Math.sign(next - previous) : 0;
}

export type TableMotionSnapshot = Map<string, Map<string, string | number | null | undefined>>;
export function compareTableSnapshots(previous: TableMotionSnapshot, next: TableMotionSnapshot) {
  let added = 0, updated = 0, removed = 0;
  for (const [id, values] of next) {
    const before = previous.get(id);
    if (!before) added++;
    else if ([...values].some(([key, value]) => before.has(key) && cellChangeDirection(before.get(key), value) !== undefined)) updated++;
  }
  for (const id of previous.keys()) if (!next.has(id)) removed++;
  return { added, updated, removed };
}

/** Upstream's 1600ms coalesced announcer, reset for queries rather than announcing paging as edits. */
export function DataTableAnnouncements<T>({ table, scope, paused }: { table: Table<T>; scope: string; paused: boolean }) {
  const { t } = useLocale();
  const reduced = useReducedMotion();
  const previous = useRef<{ scope: string; rows: TableMotionSnapshot } | undefined>(undefined);
  const pending = useRef({ added: 0, updated: 0, removed: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");
  const rows = table.getRowModel().rows;
  const columns = table.options.columns;
  useEffect(() => {
    if (previous.current?.scope !== scope) {
      previous.current = undefined;
      pending.current = { added: 0, updated: 0, removed: 0 };
      clearTimeout(timer.current); timer.current = undefined;
      setAnnouncement("");
    }
    if (paused) return;
    const next: TableMotionSnapshot = new Map(rows.map(row => [row.id, new Map(row.getAllCells().flatMap(cell => {
      const config = cell.column.columnDef.meta?.motion;
      return config ? [[cell.column.id, config.value(row.original)] as const] : [];
    }))]));
    const change = previous.current ? compareTableSnapshots(previous.current.rows, next) : { added: 0, updated: 0, removed: 0 };
    previous.current = { scope, rows: next };
    if (reduced || !Object.values(change).some(Boolean)) return;
    pending.current.added += change.added; pending.current.updated += change.updated; pending.current.removed += change.removed;
    if (timer.current !== undefined) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      const { added, updated, removed } = pending.current;
      pending.current = { added: 0, updated: 0, removed: 0 };
      setAnnouncement([added && `${t("新增行")} ${added}`, updated && `${t("更新行")} ${updated}`, removed && `${t("移出当前结果")} ${removed}`].filter(Boolean).join(" · "));
    }, 1600);
  }, [scope, paused, rows, columns, reduced, t]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <span role="status" aria-live="polite" className={styles.srOnly}>{announcement}</span>;
}

function MorphNumber({ value, format, renderNumber, disabled }: { value: number; format: (value: number) => string; renderNumber?: (formatted: string) => ReactNode; disabled: boolean }) {
  const display = useAnimatedNumber(value, { disabled });
  const formatted = format(disabled ? value : display);
  return <>{renderNumber ? renderNumber(formatted) : formatted}</>;
}

function ChangePulse({ id, dir }: { id: number; dir: number }) {
  const duration = MOTIQ_TABLE_MOTION.highlightDuration;
  // Upstream statusVars formula, mapped to existing semantic tokens (not a new palette).
  const color = dir > 0 ? "var(--success)" : dir < 0 ? "var(--warning)" : "var(--accent)";
  return <>
    <motion.span key={`bg-${id}`} aria-hidden="true" className={styles.changeWash}
      initial={{ opacity: 0.85 }} animate={{ opacity: 0 }}
      transition={{ duration: duration / 1000, ease: "easeOut" }}
      style={{ background: `color-mix(in oklab, ${color} 14%, transparent)` }} />
    {dir !== 0 && <motion.span key={`dir-${id}`} aria-hidden="true" className={styles.changeDirection}
      style={{ color }} initial={{ opacity: 1 }} animate={{ opacity: 0 }}
      transition={{ duration: duration / 1000, ease: "easeOut", delay: duration / 4000 }}>{dir > 0 ? "▲" : "▼"}</motion.span>}
  </>;
}

export function DataTableCellMotion({ value, format, renderNumber, status, paused, children }: {
  value: string | number | null | undefined; format?: (value: number) => string;
  renderNumber?: (formatted: string) => ReactNode;
  status?: boolean; paused?: boolean; children: ReactNode;
}) {
  const { t } = useLocale();
  const reduced = useReducedMotion();
  const suppress = Boolean(reduced || paused);
  const previous = useRef(value);
  const sequence = useRef(0);
  const [pulse, setPulse] = useState<{ id: number; dir: number }>();
  useEffect(() => {
    const dir = cellChangeDirection(previous.current, value);
    previous.current = value;
    if (suppress || dir === undefined) { if (suppress) setPulse(undefined); return; }
    setPulse({ id: ++sequence.current, dir });
    // Include upstream direction glyph's delayed fade; stale indicators do not accumulate.
    const timer = window.setTimeout(() => setPulse(undefined), MOTIQ_TABLE_MOTION.highlightDuration * 1.25);
    return () => window.clearTimeout(timer);
  }, [value, suppress]);
  const numeric = typeof value === "number" && Number.isFinite(value) && format;
  return <div className={styles.motionCell} data-numeric={numeric ? true : undefined}>
    {numeric ? <><span className={styles.leading} aria-hidden="true"><MorphNumber value={value} format={format} renderNumber={renderNumber} disabled={suppress} /></span><span className={styles.srOnly}>{children}</span></>
      : status ? <motion.div key={String(value)} initial={suppress ? false : { opacity: 0 }} animate={{ opacity: 1 }}
        transition={suppress ? { duration: 0 } : { duration: 0.24, ease: [0.2, 0, 0, 1] }}>{children}</motion.div>
      : children}
    {pulse && !suppress && <><ChangePulse id={pulse.id} dir={pulse.dir} /><span className={styles.srOnly}>{t("数据已更新")}</span></>}
  </div>;
}
