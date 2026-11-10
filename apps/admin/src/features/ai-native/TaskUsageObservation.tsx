/** Explicit original-ledger page and task summary consumption. Quantities keep
 * their original units/currencies; a page or sample never becomes a bill. */
import { useEffect, useRef, useState } from "react";
import { AI_TASK_STATUSES_DRAFT, type AiTaskBudgetUsagePageDraft, type AiTaskBudgetUsageSummaryDraft,
  type AiTaskPerformanceObservationDraft } from "@rental-os/shared";
import { aiTaskCenterApi } from "@/api/aiTaskCenter";
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { ActionButton, Alert } from "@/components/ui";
import { useAiManagementLocale as useLocale } from './management-locale';
import { safeDisplayText } from "./safe-display";
import { formatTimestamp } from "./formatters";
import { TaskOutcomeObservation } from './TaskOutcomeObservation';

import { formatUsageQuantity as quantity } from './usage-quantity';

export function validateTaskUsageSummary(value: AiTaskBudgetUsageSummaryDraft, taskId: string) {
  if (!value || value.taskId !== taskId || value.invocationLimit !== 50 || !Number.isFinite(Date.parse(value.observedAt))
    || value.consistency !== 'revalidated_reads_not_atomic_snapshot' || value.execution !== 'read_only_no_dispatch_or_release'
    || value.basis !== 'persisted_budget_records_not_provider_invoice' || value.absenceSemantics !== 'no_record_is_not_proof_of_no_consumption'
    || value.businessExecution !== 'not_inferred_from_usage' || value.admission !== 'not_granted') throw Error('AI_RESOURCE_UNAVAILABLE');
  if (value.state === 'limit_exceeded') {
    if (value.coverage !== 'not_computed' || 'groups' in value) throw Error('AI_RESOURCE_UNAVAILABLE');
    return value;
  }
  if (value.state !== 'observed' || value.coverage !== 'all_registered_invocations'
    || !Number.isInteger(value.invocationCount) || value.invocationCount < 0 || value.invocationCount > 50
    || !Number.isInteger(value.recordedCount) || value.recordedCount < 0 || value.recordedCount > 100
    || !Number.isInteger(value.notRecordedCount) || value.notRecordedCount < 0 || value.notRecordedCount > value.invocationCount
    || value.recordedCount + value.notRecordedCount < value.invocationCount || value.recordedCount > 2 * value.invocationCount
    || typeof value.accountingComplete !== 'boolean' || value.accountingComplete && value.notRecordedCount !== 0
    || !Array.isArray(value.groups) || value.groups.length > 100)
    throw Error('AI_RESOURCE_UNAVAILABLE');
  const keys = new Set<string>();
  for (const group of value.groups) {
    if (!group || !['money', 'tokens', 'calls'].includes(group.unit)
      || (group.unit === 'money' ? group.scale !== 6 || typeof group.currency !== 'string' || !/^[A-Z]{3}$/u.test(group.currency)
        : group.scale !== 0 || group.currency !== null)
      || ![group.reservedAtoms, group.pendingAtoms, group.settledAtoms, group.releasedReservationAtoms, group.settledExcessAtoms]
        .every(atoms => typeof atoms === 'string' && /^(0|[1-9][0-9]{0,31})$/u.test(atoms))) throw Error('AI_RESOURCE_UNAVAILABLE');
    const key = `${group.unit}:${group.currency}`;
    if (keys.has(key)) throw Error('AI_RESOURCE_UNAVAILABLE');
    keys.add(key);
    if (value.accountingComplete && (group.pendingAtoms !== '0' || group.reservedAtoms !== '0')) throw Error('AI_RESOURCE_UNAVAILABLE');
  }
  return value;
}
/** Decimal presentation only; never convert currencies, price Tokens or sum a page. */
export function formatTaskCostAtoms(group: { unit: 'money' | 'tokens' | 'calls'; currency: string | null }, atoms: string) {
  if (!/^(0|[1-9][0-9]{0,31})$/u.test(atoms)) throw Error('AI_RESOURCE_UNAVAILABLE');
  if (group.unit !== 'money') return `${atoms} ${group.unit}`;
  const value = atoms.padStart(7, '0');
  return `${value.slice(0, -6)}.${value.slice(-6)} ${group.currency}`;
}
/** Current task and source basis checks complement the server's shared schema;
 * no missing clock becomes zero or a client-visible latency measurement. */
export function validateTaskRuntimeObservation(value: AiTaskPerformanceObservationDraft, taskId: string) {
  const count = (item: unknown) => typeof item === 'string' && /^(0|[1-9][0-9]{0,19})$/u.test(item);
  if (!value || value.version !== 'task-performance-1' || value.task?.taskId !== taskId || value.financial?.taskId !== taskId
    || !AI_TASK_STATUSES_DRAFT.includes(value.task.status as typeof AI_TASK_STATUSES_DRAFT[number])
    || !Number.isFinite(Date.parse(value.observedAt)) || !value.timing || !count(value.timing.ageMs)
    || value.timing.endToEndMs !== null && !count(value.timing.endToEndMs)
    || value.consistency !== 'revalidated_reads_not_atomic_snapshot' || value.execution !== 'read_only_no_dispatch_or_release'
    || !['not_recorded', 'client_reported'].includes(value.measurements?.firstToken)
    || !['not_recorded', 'client_reported'].includes(value.measurements.firstCard)
    || value.measurements.rates !== 'not_computed' || value.measurements.slo !== 'not_evaluated'
    || value.runs?.coverage !== 'bounded_window' || !Array.isArray(value.runs.items) || value.runs.items.length > 50
    || value.steps?.coverage !== 'bounded_window' || !Array.isArray(value.steps.items) || value.steps.items.length > 200
    || value.modelDelivery?.coverage !== 'completed_gateway_observations_only' || !Array.isArray(value.modelDelivery.items)
    || value.modelDelivery.items.length > 50 || !Number.isInteger(value.modelDelivery.unobservedInWindow)
    || value.modelDelivery.unobservedInWindow < 0 || value.modelDelivery.unobservedInWindow > 50) throw Error('AI_RESOURCE_UNAVAILABLE');
  for (const run of value.runs.items) if (run.elapsedMs !== null && !count(run.elapsedMs)) throw Error('AI_RESOURCE_UNAVAILABLE');
  for (const item of value.modelDelivery.items) if (item.basis !== 'gateway_transport_including_usage_and_consumer_wait'
    || !count(item.transportWallMs) || item.firstValidatedTextMs !== null && !count(item.firstValidatedTextMs)) throw Error('AI_RESOURCE_UNAVAILABLE');
  for (const step of value.steps.items) if (step.activeTime.state === 'recorded'
    && (step.activeTime.basis !== 'persistent_resource_not_provider_latency'
      || step.activeTime.recordedMs !== null && !count(step.activeTime.recordedMs)
      || !count(step.activeTime.reservedMs) || !count(step.activeTime.unknownMs))) throw Error('AI_RESOURCE_UNAVAILABLE');
  if (value.taskFinancial) validateTaskUsageSummary(value.taskFinancial, taskId);
  const client = value.clientVisible;
  if (client?.state === 'client_reported') {
    if (client.coverage !== 'original_host_reports_not_task_or_tenant_rate' || client.evaluation !== 'not_slo_evidence'
      || client.currentDisplay !== 'not_asserted' || !Array.isArray(client.observations) || !client.observations.length
      || client.observations.length > 20 || client.observations.some(row => row.taskId !== taskId || row.sampleSize !== 1
        || row.provenance !== 'client_reported_not_business_fact' || row.basis !== 'viewport_intersection_after_two_frames'
        || !Number.isSafeInteger(row.elapsedMs) || row.elapsedMs < 0 || row.elapsedMs > 600000
        || !['compact_viewport', 'wide_viewport'].includes(row.viewport))) throw Error('AI_RESOURCE_UNAVAILABLE');
  } else if (client !== undefined && client.state !== 'not_recorded') throw Error('AI_RESOURCE_UNAVAILABLE');
  if ((value.measurements.firstToken === 'client_reported') !== (client?.state === 'client_reported' && client.observations.some(row => row.kind === 'text'))
    || (value.measurements.firstCard === 'client_reported') !== (client?.state === 'client_reported' && client.observations.some(row => row.kind === 'card')))
    throw Error('AI_RESOURCE_UNAVAILABLE');
  if (value.budgetAdmission && (value.budgetAdmission.coverage !== 'recorded_rejections_only'
    || !Array.isArray(value.budgetAdmission.denials) || value.budgetAdmission.denials.length > 50
    || value.budgetAdmission.denials.some(row => row.code !== 'budget_unavailable' || row.observation !== 'gate_rejected_not_release_evidence')))
    throw Error('AI_RESOURCE_UNAVAILABLE');
  return value;
}
export function TaskUsageObservation({ taskId, current, onAccessDenied }: { taskId: string; current: () => boolean; onAccessDenied: () => void }) {
  const { t } = useLocale();
  const binding = JSON.stringify([taskId, currentSessionEpoch()]);
  const [page, setPage] = useState<{ binding: string; value: AiTaskBudgetUsagePageDraft } | null>(null);
  const [summary, setSummary] = useState<{ binding: string; value: AiTaskBudgetUsageSummaryDraft } | null>(null);
  const [runtime, setRuntime] = useState<{ binding: string; value: AiTaskPerformanceObservationDraft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null), generation = useRef(0), mounted = useRef(false);
  const active = useRef({ binding, current, onAccessDenied }); active.current = { binding, current, onAccessDenied };
  useEffect(() => {
    const clear = () => { generation.current++; request.current?.abort(); request.current = null;
      setPage(null); setSummary(null); setRuntime(null); setError(false); setBusy(false); };
    clear(); mounted.current = true;
    const session = currentSessionSignal(); document.addEventListener('visibilitychange', clear); session.addEventListener('abort', clear);
    return () => { mounted.current = false; generation.current++; request.current?.abort(); request.current = null;
      document.removeEventListener('visibilitychange', clear); session.removeEventListener('abort', clear); };
  }, [binding]);
  const read = async (after?: string, wholeTask = false, includeRuntime = false) => {
    if (!mounted.current || request.current || document.hidden || active.current.binding !== binding || !active.current.current()) throw Error("AI_RESOURCE_UNAVAILABLE");
    const epoch = currentSessionEpoch(), owner = ++generation.current;
    const controller = new AbortController(); request.current = controller;
    const same = () => mounted.current && owner === generation.current && currentSessionEpoch() === epoch
      && !controller.signal.aborted && !document.hidden && active.current.binding === binding && active.current.current();
    setPage(null); setSummary(null); setRuntime(null); setError(false); setBusy(true);
    try {
      if (includeRuntime) {
        const result = validateTaskRuntimeObservation(await aiTaskCenterApi.performance(taskId, controller.signal), taskId);
        if (same()) setRuntime({ binding, value: result });
        return;
      }
      if (wholeTask) {
        const result = validateTaskUsageSummary(await aiTaskCenterApi.usageSummary(taskId, controller.signal), taskId);
        if (same()) setSummary({ binding, value: result });
        return;
      }
      const result = await aiTaskCenterApi.usage(taskId, controller.signal, after);
      if (!same()) return;
      if (result.taskId !== taskId || !Array.isArray(result.items) || result.items.length > 20
        || result.coverage !== "page_not_total" || result.totals !== "not_computed"
        || result.businessExecution !== "not_inferred_from_usage" || result.admission !== "not_granted"
        || result.nextAfter !== null && (typeof result.nextAfter !== "string" || result.nextAfter.length > 36)
        || new Set(result.items.map(row => row.invocationId)).size !== result.items.length
        || result.items.some(row => row.accounting !== "not_recorded" && (row.accounting !== "recorded"
          || !["reserved", "settled", "released", "pending_reconciliation"].includes(row.status)))) throw Error("AI_RESOURCE_UNAVAILABLE");
      setPage({ binding, value: result });
    } catch (failure) {
      if (same()) {
        setError(true);
        if ([401, 403].includes((failure as { response?: { status?: number } }).response?.status ?? 0)) active.current.onAccessDenied();
      }
      throw failure;
    }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  const shownPage = !document.hidden && active.current.current() && page?.binding === binding ? page.value : null;
  const shownSummary = !document.hidden && active.current.current() && summary?.binding === binding ? summary.value : null;
  const shownRuntime = !document.hidden && active.current.current() && runtime?.binding === binding ? runtime.value : null;
  return <section aria-label={t("原AI用量账本")} aria-busy={busy}>
    <p className="muted">{t("仅显示本页用量，不代表任务总费用或供应商账单。")}</p>
    <div className="panel-toolbar">
      <ActionButton label={t(shownPage ? "重读首页" : "读取原用量")} pendingLabel={t("读取中…")} disabled={busy} onAction={() => read()} />
      {shownPage?.nextAfter && <ActionButton label={t("下一页原记录")} pendingLabel={t("读取中…")} disabled={busy} onAction={() => read(shownPage.nextAfter!)} />}
      <ActionButton label={t(shownSummary ? '重读任务成本' : '读取任务成本')} pendingLabel={t('读取中…')} disabled={busy} onAction={() => read(undefined, true)} />
      <ActionButton label={t(shownRuntime ? '重读运行观察' : '读取运行观察')} pendingLabel={t('读取中…')} disabled={busy} onAction={() => read(undefined, false, true)} />
    </div>
    {error && <Alert type="warning" title={t("原用量当前不可读取，旧内容已清除，请核对当前权限。")}/>}
    {shownRuntime && <div aria-live="polite">
      <p>{t('任务完整耗时')}: {shownRuntime.timing.endToEndMs === null ? t('尚未核实') : `${shownRuntime.timing.endToEndMs} ms`}
        {' · '}{t('观察时间')}: {formatTimestamp(shownRuntime.observedAt).value}</p>
      {shownRuntime.task.cancelRequestedAt && <p>{t('取消请求时间')}: {formatTimestamp(shownRuntime.task.cancelRequestedAt).value}
        {' · '}{t('取消请求不证明已回滚或退额。')}</p>}
      <dl>{shownRuntime.runs.items.map(run => <div key={run.runId}>
        <dt>{t('原运行')}: {safeDisplayText(run.runId, 36)}</dt><dd>{t('运行耗时')}: {run.elapsedMs === null ? t('尚未核实') : `${run.elapsedMs} ms`}</dd>
      </div>)}</dl>
      <dl>{shownRuntime.modelDelivery.items.map(item => <div key={item.invocationId}>
        <dt>{t('模型调用窗口')}: {safeDisplayText(item.callId, 128)}</dt><dd>{`${item.transportWallMs} ms`}</dd>
      </div>)}</dl>
      <dl>{shownRuntime.steps.items.filter(step => step.activeTime.state === 'recorded').map(step => <div key={step.stepId}>
        <dt>{t('原步骤计时')}: {safeDisplayText(step.toolCode, 191)}</dt>
        <dd>{step.activeTime.state === 'recorded' && <>{t('已记录耗时')}: {step.activeTime.recordedMs === null ? t('尚未核实') : `${step.activeTime.recordedMs} ms`}
          {' · '}{t('待核对耗时')}: {`${step.activeTime.unknownMs} ms`}</>}</dd>
      </div>)}</dl>
      {shownRuntime.budgetAdmission && <p>{t('预算拒绝记录')}: {shownRuntime.budgetAdmission.denials.length}
        {' · '}{t('仅为原窗口记录，不证明已释放额度。')}</p>}
      <p className="muted">{t('模型耗时包含用量与交付等待；步骤计时仅为已登记资源时间。')}</p>
      {shownRuntime.clientVisible?.state === 'client_reported' ? <>
        <dl>{shownRuntime.clientVisible.observations.map(row => <div key={row.observationId}>
          <dt>{t(row.kind === 'text' ? '客户端可见文字报告' : '客户端可见审批卡片报告')}</dt>
          <dd>{`${row.elapsedMs} ms`} · {t('样本数')}: {row.sampleSize} · {t(row.viewport === 'compact_viewport' ? '紧凑视口' : '宽视口')}</dd>
        </div>)}</dl>
        <p className="muted">{t('以上为客户端报告，不是经营事实或 SLO 判定；不证明当前内容仍可见。')}</p>
      </> : <p className="muted">{t('首字、首卡尚未记录，真实 SLO 未评估；运行记录不证明恢复或业务已完成。')}</p>}
      {(shownRuntime.runs.truncated || shownRuntime.steps.truncated || shownRuntime.modelDelivery.truncated
        || shownRuntime.modelDelivery.unobservedInWindow > 0 || shownRuntime.budgetAdmission?.truncated)
        && <p>{t('记录窗口不完整，不推算全部调用或步骤。')}</p>}
    </div>}
    {shownSummary && <div aria-live="polite">
      <p>{t('任务成本观察')} · {t('观察时间')}: {formatTimestamp(shownSummary.observedAt).value}</p>
      {shownSummary.state === 'limit_exceeded' ? <p>{t('任务调用超过观察上限，成本未计算。')}</p> : <>
        <p>{t('已登记调用')}: {shownSummary.invocationCount} · {t('账务未确认调用')}: {shownSummary.notRecordedCount}</p>
        {!shownSummary.invocationCount && <p>{t('未观察到登记调用，不能据此判定费用为零。')}</p>}
        {!shownSummary.accountingComplete && <p>{t('账务记录尚未齐全，以下仅为已确认记录。')}</p>}
        <dl>{shownSummary.groups.map(group => <div key={`${group.unit}:${group.currency}`}>
          <dt>{group.unit === 'money' ? t('平台金额') : t('登记用量')} · {group.currency ?? group.unit}</dt>
          <dd>{t('已结算')}: {formatTaskCostAtoms(group, group.settledAtoms)}{' · '}{t('待核对占用')}: {formatTaskCostAtoms(group, group.pendingAtoms)}
            {' · '}{t('已预留')}: {formatTaskCostAtoms(group, group.reservedAtoms)}</dd>
        </div>)}</dl>
      </>}
      <p className="muted">{t('金额与用量按原账分别显示，不代表供应商账单。')}</p>
    </div>}
    {shownPage && <div aria-live="polite">
      <p>{t("观察时间")}: {formatTimestamp(shownPage.observedAt).value}</p>
      {!shownPage.items.length && <p>{t("本页未观察到调用记录，不能据此判定未派发或费用为零。")}</p>}
      <dl>{shownPage.items.map(row => <div key={row.invocationId}>
        <dt>{safeDisplayText(row.callId, 128)}</dt>
        <dd style={{ overflowWrap: "anywhere" }}>{row.accounting === "not_recorded" ? t("账务记录未确认，需按原操作核对。") : <>
          {t(row.status === "settled" ? "已结算" : row.status === "released" ? "原占用已释放" : row.status === "pending_reconciliation" ? "待核对，保留占用" : "已预留，尚未结算")}
          {" · "}{t("预留")}: {quantity(row.reserved)}{" · "}{t("实耗")}: {quantity(row.actual)}
        </>}</dd>
      </div>)}</dl>
    </div>}
    <TaskOutcomeObservation taskIds={[taskId]} current={current} onAccessDenied={onAccessDenied} />
  </section>;
}
