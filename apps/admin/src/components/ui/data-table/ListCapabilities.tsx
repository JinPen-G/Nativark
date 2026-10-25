/** Optional list capabilities. Domain pages choose fields and legal actions; this layer never invents writes. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Grid2X2, Rows3, X } from "lucide-react";
import { AnimatedIcon } from "../AnimatedIcon";
import { useLocale } from "@/app/locale";
import { useAuthStore } from "@/features/auth/authStore";
import { Button } from "../Button";
import { Modal } from "../Modal";
import { Input } from "../Input";
import { Checkbox } from "../Checkbox";
import { Segmented } from "../Segmented";
import { CSV_LIMITS, ListPreflightError, downloadCsv, exportRows, importRecords, type ListExport, type ListImport } from "./listTransfer";
import styles from "./ListCapabilities.module.css";
import { RecordCard, type RecordCardConfig } from "./RecordCard";

export function listIdentity() {
  const state = useAuthStore.getState();
  return JSON.stringify([state.tenant?.tenantId, state.currentWorkspaceId, state.user?.id]);
}
export type ListCard<T> = RecordCardConfig<T>;
export interface ListBatchAction<T> {
  key: string; label: string; danger?: boolean; reason?: boolean;
  eligible: (row: T) => boolean;
  /** Must read current authorization, including after every await. */
  allowed: () => boolean;
  run: (row: T, reason: string) => Promise<unknown>;
  onComplete: () => Promise<unknown>;
}
type Outcome = { row: number; name: string; status: "ready" | "duplicate" | "invalid" | "success" | "failed" | "unknown" | "stopped"; error?: string };
const labels: Record<Outcome["status"], string> = { ready: "待导入", duplicate: "重复，已跳过", invalid: "校验失败", success: "已完成", failed: "操作失败", unknown: "结果待核实", stopped: "未执行" };
function requestError(error: unknown) {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return { unknown: !(error instanceof ListPreflightError) && (!status || status >= 500 || status === 408), message: error instanceof Error ? error.message : "操作失败" };
}

export function ListTransferTools<T>({ config, rows, busy, importConfig }: { config?: ListExport<T>; rows: T[]; busy?: boolean; importConfig?: ListImport<unknown> }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  if (!config && !importConfig) return null;
  return <div className={styles.tools}>
    {importConfig && <Button size="small" disabled={busy || !importConfig.allowed()} aria-label={t("导入")} title={t("导入")} icon={<AnimatedIcon name="upload" />} onClick={() => setOpen(true)}><span className={styles.transferLabel}>{t("导入")}</span></Button>}
    {config && <Button size="small" disabled={busy || !rows.length} aria-label={t(config.scope === "page" ? "导出本页" : "导出")} title={t(config.scope === "page" ? "导出当前页" : "导出筛选结果")} icon={<AnimatedIcon name="download" />} onClick={() => exportRows(config, rows)}><span className={styles.transferLabel}>{t(config.scope === "page" ? "导出本页" : "导出")}</span></Button>}
    {importConfig && open && <ListImportDialog key={listIdentity()} config={importConfig} onClose={() => setOpen(false)} />}
  </div>;
}

export function ListViewSwitch({ value, onChange, disabled }: { value: "list" | "cards"; onChange: (value: "list" | "cards") => void; disabled?: boolean }) {
  const { t } = useLocale();
  return <div className={styles.switch}><Segmented<"list" | "cards"> iconOnly aria-label={t("显示方式")} value={value} disabled={disabled} onChange={onChange} options={[
    { value: "list", label: <span className={styles.viewIcon} title={t("列表视图")}><Rows3 size={16} aria-hidden="true" /><span className={styles.srOnly}>{t("列表视图")}</span></span> },
    { value: "cards", label: <span className={styles.viewIcon} title={t("卡片视图")}><Grid2X2 size={16} aria-hidden="true" /><span className={styles.srOnly}>{t("卡片视图")}</span></span> },
  ]} /></div>;
}
export function ListCards<T>({ rows, config, getKey, selected, onSelect, busy, canSelect }: { rows: T[]; config: ListCard<T>; getKey: (row: T) => string; selected?: Set<string>; onSelect?: (row: T, checked: boolean) => void; busy?: boolean; canSelect?: (row: T) => boolean }) {
  return <div className={styles.grid} aria-busy={busy || undefined}>{rows.map(row => <RecordCard key={getKey(row)} row={row} rowKey={getKey(row)} config={config}
    selected={selected?.has(getKey(row)) ?? false} disabled={busy || canSelect?.(row) === false} onSelect={onSelect ? checked => onSelect(row, checked) : undefined} />)}</div>;
}

function ListImportDialog({ config, onClose }: { config: ListImport<unknown>; onClose: () => void }) {
  const { t } = useLocale();
  const [identity] = useState(listIdentity);
  const [items, setItems] = useState<Array<Outcome & { value?: unknown }>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [finished, setFinished] = useState(false);
  const locked = useRef(false), generation = useRef(0);
  const allowed = () => identity === listIdentity() && config.allowed();
  async function load(file?: File) {
    if (!file || locked.current) return;
    const version = ++generation.current;
    setItems([]); setError(""); setFinished(false);
    if (file.size > CSV_LIMITS.bytes) { setError(t("文件不能超过 2MB")); return; }
    setBusy(true);
    try {
      const records = importRecords(await file.text(), config.fields);
      const keys = new Set(await config.existingKeys());
      if (version !== generation.current || !allowed()) return;
      setItems(records.map((record, index) => {
        try {
          const value = config.parse(record), key = config.key(value);
          if (!key) throw new Error(t("唯一编号不能为空"));
          const duplicate = keys.has(key); keys.add(key);
          return { row: index + 2, name: key, value, status: duplicate ? "duplicate" : "ready" };
        } catch (issue) { return { row: index + 2, name: "", status: "invalid", error: issue instanceof Error ? issue.message : t("格式错误") }; }
      }));
    } catch (issue) { if (version === generation.current) setError(t(issue instanceof Error ? issue.message : "读取失败")); }
    finally { if (version === generation.current) setBusy(false); }
  }
  async function submit() {
    if (locked.current || busy || finished || !allowed() || items.some(item => item.status === "invalid")) return;
    locked.current = true; setBusy(true);
    const next = items.map(item => ({ ...item }));
    try {
      const keys = new Set(await config.existingKeys());
      for (const item of next) {
        if (item.status !== "ready") continue;
        if (!allowed()) { item.status = "stopped"; continue; }
        if (keys.has(item.name)) { item.status = "duplicate"; continue; }
        try { const result = await config.create(item.value); item.status = result && typeof result === "object" && "skipped" in result && result.skipped === true ? "duplicate" : "success"; keys.add(item.name); }
        catch (issue) {
          const failure = requestError(issue); item.status = failure.unknown ? "unknown" : "failed"; item.error = failure.message;
          // No automatic retry after an unknown outcome or changed permissions.
          for (const pending of next) if (pending.status === "ready") pending.status = "stopped";
          break;
        }
        setItems(next.map(item => ({ ...item })));
      }
      setItems(next); setFinished(true);
      if (allowed()) await config.onComplete();
    } catch (issue) { setError(t(issue instanceof Error ? issue.message : "操作失败")); }
    finally { locked.current = false; setBusy(false); }
  }
  return <Modal open title={t("导入资料")} onCancel={() => { if (!busy) onClose(); }} closable={!busy} maskClosable={!busy} keyboard={!busy} footer={<>
    <Button disabled={busy} onClick={onClose}>{t("关闭")}</Button>
    {finished ? <Button onClick={() => downloadCsv(`${config.filename}-${t("导入结果")}`, [["row", "key", "status", "error"], ...items.map(item => [item.row, item.name, t(labels[item.status]), item.error ?? ""])])}>{t("下载结果")}</Button>
      : <Button type="primary" loading={busy} disabled={!allowed() || !items.some(item => item.status === "ready") || items.some(item => item.status === "invalid")} onClick={() => void submit()}>{t("确认导入")}</Button>}
  </>}>
    <div className={styles.importBody}>
      <div><Button disabled={busy} onClick={() => downloadCsv(config.filename, [config.fields.map(field => field.key)])}>{t("下载模板")}</Button></div>
      <div className={styles.meta}>{t("仅新增，重复项跳过。CSV，最多 500 条、2MB。")}</div>
      <div className={styles.meta}>{t("重复项以提交时核验为准。")}</div>
      <div className={styles.meta}>{config.fields.map(field => `${field.key}: ${t(field.label)}${field.required ? " *" : ""}${field.example ? ` (${field.example})` : ""}`).join(" · ")}</div>
      <input className={styles.file} aria-label={t("选择 CSV 文件")} type="file" accept=".csv,text/csv" disabled={busy || finished} onChange={event => void load(event.target.files?.[0])} />
      {error && <div role="alert" className={styles.error}>{error}</div>}
      {!!items.length && <><div role="status">{t("可导入")} {items.filter(item => item.status === "ready").length} · {t("已完成")} {items.filter(item => item.status === "success").length} · {t("跳过")} {items.filter(item => item.status === "duplicate").length}</div>
        <div className={styles.preview}><table><thead><tr><th>{t("行号")}</th><th>{t("编号")}</th><th>{t("结果")}</th></tr></thead><tbody>{items.map(item => <tr key={item.row}><td>{item.row}</td><td>{item.name || "—"}</td><td>{t(labels[item.status])}{item.error && ` · ${t(item.error)}`}</td></tr>)}</tbody></table></div></>}
    </div>
  </Modal>;
}

export function ListSelectionBar<T>({ rows, clear, config, actions = [], busy, onSelectPage }: { rows: T[]; clear: () => void; config?: ListExport<T>; actions?: ListBatchAction<T>[]; busy?: boolean; onSelectPage?: () => void }) {
  const { t } = useLocale();
  const [action, setAction] = useState<ListBatchAction<T>>(), [reason, setReason] = useState("");
  const [actionRows, setActionRows] = useState<T[]>([]);
  const [running, setRunning] = useState(false), [results, setResults] = useState<Outcome[]>([]);
  const locked = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = barRef.current, host = bar?.parentElement;
    if (!bar || !host) return;
    const measure = () => host.style.setProperty("--rental-list-bulk-bar-height", `${bar.getBoundingClientRect().height}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(bar);
    return () => { observer?.disconnect(); host.style.removeProperty("--rental-list-bulk-bar-height"); };
  }, [rows.length]);
  const owner = useId(), latestClear = useRef(clear);
  latestClear.current = clear;
  useEffect(() => {
    const changed = (event: Event) => { if ((event as CustomEvent<string>).detail !== owner) latestClear.current(); };
    window.addEventListener("rental-list-selection-owner", changed);
    return () => window.removeEventListener("rental-list-selection-owner", changed);
  }, [owner]);
  useEffect(() => { if (rows.length) window.dispatchEvent(new CustomEvent("rental-list-selection-owner", { detail: owner })); }, [rows.length, owner]);
  async function execute() {
    if (!action || locked.current || !action.allowed() || action.reason && !reason.trim()) return;
    const identity = listIdentity();
    locked.current = true; setRunning(true);
    const outcomes: Outcome[] = [];
    try {
      for (const [index, row] of actionRows.entries()) {
        if (listIdentity() !== identity || !action.allowed()) break;
        if (!action.eligible(row)) continue;
        const name = String(config?.fields[0]?.value(row) ?? index + 1);
        try { await action.run(row, reason.trim()); outcomes.push({ row: index + 1, name, status: "success" }); }
        catch (issue) { const failure = requestError(issue); outcomes.push({ row: index + 1, name, status: failure.unknown ? "unknown" : "failed", error: failure.message }); break; }
      }
      for (const [index, row] of actionRows.entries()) if (action.eligible(row) && !outcomes.some(item => item.row === index + 1)) outcomes.push({ row: index + 1, name: String(config?.fields[0]?.value(row) ?? index + 1), status: "stopped" });
      setResults(outcomes);
      if (identity === listIdentity() && action.allowed()) await action.onComplete();
    } finally { locked.current = false; setRunning(false); }
  }
  if (!rows.length && !action) return null;
  return <>
    {!!rows.length && <div ref={barRef} data-list-selection-bar="" className={styles.bar} role="region" aria-label={t("批量操作")}><span role="status">{t("已选择")} {rows.length}</span>
      {onSelectPage && <Button type="text" size="small" disabled={busy || running} onClick={onSelectPage}>{t("选择当前页")}</Button>}
      {config && <Button size="small" disabled={busy || running} icon={<AnimatedIcon name="download" />} onClick={() => exportRows(config, rows)}>{t("导出所选")}</Button>}
      {actions.filter(item => item.allowed()).map(item => <Button key={item.key} size="small" danger={item.danger} disabled={busy || running || !rows.some(item.eligible)} onClick={() => { setAction(item); setActionRows([...rows]); setReason(""); setResults([]); }}>{t(item.label)}</Button>)}
      <Button type="text" size="small" disabled={running} aria-label={t("清除选择")} icon={<X size={16} aria-hidden="true" />} onClick={clear} />
    </div>}
    {action && <Modal open title={t(action.label)} closable={!running} maskClosable={!running} keyboard={!running} onCancel={() => { if (!running) setAction(undefined); }} footer={<>
      <Button disabled={running} onClick={() => setAction(undefined)}>{t("关闭")}</Button>
      {!!results.length && <Button disabled={running} onClick={() => downloadCsv(t("批量操作结果"), [["row", "key", "status", "error"], ...results.map(item => [item.row, item.name, t(labels[item.status]), item.error ?? ""])])}>{t("下载结果")}</Button>}
      {!results.length && <Button type="primary" danger={action.danger} loading={running} disabled={!action.allowed() || !actionRows.some(action.eligible) || action.reason && !reason.trim()} onClick={() => void execute().catch(() => setResults([{ row: 0, name: "", status: "failed", error: t("刷新失败，请重试") }]))}>{t("确认")}</Button>}
    </>}><div className={styles.importBody}><div>{t("符合条件")} {actionRows.filter(action.eligible).length} / {actionRows.length}</div>
      {action.reason && <Input.TextArea aria-label={t("操作原因")} placeholder={t("操作原因")} value={reason} disabled={running || !!results.length} maxLength={500} onChange={event => setReason(event.target.value)} />}
      {!!results.length && <div role="status">{t("已完成")} {results.filter(item => item.status === "success").length} / {actionRows.filter(action.eligible).length}{results.filter(item => item.status !== "success").map(item => <div key={item.row} role="alert">{item.name || t("第 {index} 条", { index: item.row })} · {t(labels[item.status])}{item.error && ` · ${item.error}`}</div>)}</div>}
    </div></Modal>}
  </>;
}
