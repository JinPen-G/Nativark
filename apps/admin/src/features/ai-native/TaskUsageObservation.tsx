/** Manual original-ledger observation; this component has no reserve, release,
 * reconcile or model port. A page is never presented as a whole-task total. */
import { useEffect, useRef, useState } from "react";
import { type AiTaskBudgetUsagePageDraft } from "@rental-os/shared";
import { aiTaskCenterApi } from "@/api/aiTaskCenter";
import { ActionButton, Alert } from "@/components/ui";
import { useAiManagementLocale as useLocale } from './management-locale';
import { safeDisplayText } from "./safe-display";
import { formatTimestamp } from "./formatters";

import { formatUsageQuantity as quantity } from './usage-quantity';
export function TaskUsageObservation({ taskId, current, onAccessDenied }: { taskId: string; current: () => boolean; onAccessDenied: () => void }) {
  const { t } = useLocale();
  const [page, setPage] = useState<AiTaskBudgetUsagePageDraft | null>(null);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const active = useRef({ current, onAccessDenied }); active.current = { current, onAccessDenied };
  useEffect(() => () => { request.current?.abort(); }, []);
  const read = async (after?: string) => {
    if (request.current || !active.current.current()) throw Error("AI_RESOURCE_UNAVAILABLE");
    const controller = new AbortController(); request.current = controller;
    setPage(null); setError(false);
    try {
      const result = await aiTaskCenterApi.usage(taskId, controller.signal, after);
      if (!active.current.current() || controller.signal.aborted) return;
      if (result.taskId !== taskId || !Array.isArray(result.items) || result.items.length > 20
        || result.coverage !== "page_not_total" || result.totals !== "not_computed"
        || result.businessExecution !== "not_inferred_from_usage" || result.admission !== "not_granted"
        || result.nextAfter !== null && (typeof result.nextAfter !== "string" || result.nextAfter.length > 36)
        || new Set(result.items.map(row => row.invocationId)).size !== result.items.length
        || result.items.some(row => row.accounting !== "not_recorded" && (row.accounting !== "recorded"
          || !["reserved", "settled", "released", "pending_reconciliation"].includes(row.status)))) throw Error("AI_RESOURCE_UNAVAILABLE");
      setPage(result);
    } catch (failure) {
      if (active.current.current() && !controller.signal.aborted) {
        setError(true);
        if ([401, 403].includes((failure as { response?: { status?: number } }).response?.status ?? 0)) active.current.onAccessDenied();
      }
      throw failure;
    }
    finally { if (request.current === controller) request.current = null; }
  };
  return <section aria-label={t("原AI用量账本")}>
    <p className="muted">{t("仅显示本页用量，不代表任务总费用或供应商账单。")}</p>
    <div className="panel-toolbar">
      <ActionButton label={t(page ? "重读首页" : "读取原用量")} pendingLabel={t("读取中…")} onAction={() => read()} />
      {page?.nextAfter && <ActionButton label={t("下一页原记录")} pendingLabel={t("读取中…")} onAction={() => read(page.nextAfter!)} />}
    </div>
    {error && <Alert type="warning" title={t("原用量当前不可读取，旧内容已清除，请核对当前权限。")}/>}
    {page && <div aria-live="polite">
      <p>{t("观察时间")}: {formatTimestamp(page.observedAt).value}</p>
      {!page.items.length && <p>{t("本页未观察到调用记录，不能据此判定未派发或费用为零。")}</p>}
      <dl>{page.items.map(row => <div key={row.invocationId}>
        <dt>{safeDisplayText(row.callId, 128)}</dt>
        <dd style={{ overflowWrap: "anywhere" }}>{row.accounting === "not_recorded" ? t("账务记录未确认，需按原操作核对。") : <>
          {t(row.status === "settled" ? "已结算" : row.status === "released" ? "原占用已释放" : row.status === "pending_reconciliation" ? "待核对，保留占用" : "已预留，尚未结算")}
          {" · "}{t("预留")}: {quantity(row.reserved)}{" · "}{t("实耗")}: {quantity(row.actual)}
        </>}</dd>
      </div>)}</dl>
    </div>}
  </section>;
}
