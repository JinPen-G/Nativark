/** Explicit original-ID sample consumption. A sample is never a tenant-wide
 * rate; current session, selection and visibility own every displayed result. */
import { useEffect, useRef, useState } from 'react';
import { AI_TASK_STATUSES_DRAFT, AI_TASK_TERMINAL_STATUSES_DRAFT, validateAiTaskLifecycleSampleRatesDraft, type AiTaskOutcomeSampleDraft } from '@rental-os/shared';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { aiTaskCenterApi } from '@/api/aiTaskCenter';
import { ActionButton, Alert } from '@/components/ui';
import { useAiManagementLocale as useLocale } from './management-locale';
import { safeDisplayText } from './safe-display';
import { formatTimestamp } from './formatters';

/** The server validates the shared closed schema. This additional check binds
 * the returned denominator, original IDs and rates to this exact selection. */
export function validateTaskOutcomeObservation(value: AiTaskOutcomeSampleDraft, selected: readonly string[]) {
  const fail = () => { throw Error('AI_RESOURCE_UNAVAILABLE'); };
  if (!value || value.version !== 'task-outcome-sample-1' || selected.length < 1 || selected.length > 50
    || new Set(selected).size !== selected.length || value.sampleSize !== selected.length
    || !Array.isArray(value.taskIds) || value.taskIds.length !== selected.length
    || value.taskIds.some((id, index) => id !== selected[index])
    || value.coverage !== 'requested_authorized_one_owner_workspace_scene_version'
    || value.consistency !== 'revalidated_reads_not_atomic_snapshot' || value.execution !== 'read_only_no_lease_or_model'
    || value.slo !== 'not_evaluated' || !Number.isFinite(Date.parse(value.observedAt))
    || typeof value.sceneCode !== 'string' || !value.sceneCode || value.sceneCode.length > 128
    || typeof value.sceneVersion !== 'string' || !value.sceneVersion || value.sceneVersion.length > 64
    || !value.statusCounts || Object.keys(value.statusCounts).length !== AI_TASK_STATUSES_DRAFT.length) fail();
  let total = 0, terminal = 0;
  for (const status of AI_TASK_STATUSES_DRAFT) {
    const count = value.statusCounts[status];
    if (!Number.isInteger(count) || count < 0 || count > selected.length) fail();
    total += count;
    if (AI_TASK_TERMINAL_STATUSES_DRAFT.includes(status)) terminal += count;
  }
  const success = value.successRate, takeover = value.takeoverRate;
  if (total !== selected.length || !success || !takeover || success.total !== total || success.terminal !== terminal
    || success.succeeded !== value.statusCounts.succeeded
    || success.state !== (terminal === total ? 'recorded' : 'pending')
    || success.percent !== (terminal === total ? (100 * success.succeeded / total).toFixed(2) : null)
    || takeover.total !== total || !Number.isInteger(takeover.tasksWithReceipt)
    || takeover.tasksWithReceipt < 0 || takeover.tasksWithReceipt > total
    || takeover.percent !== (100 * takeover.tasksWithReceipt / total).toFixed(2)
    || takeover.basis !== 'original_same_owner_takeover_receipts') fail();
  if (value.lifecycleRates !== undefined) {
    if (!validateAiTaskLifecycleSampleRatesDraft(value.lifecycleRates)) fail();
    const { cancellation, recovery } = value.lifecycleRates;
    if (cancellation.requested + cancellation.notRecordedTasks !== selected.length
      || cancellation.recorded + cancellation.pending !== cancellation.requested
      || cancellation.state !== (!cancellation.requested ? 'not_recorded' : cancellation.pending ? 'pending' : 'recorded')
      || cancellation.percent !== (cancellation.requested && !cancellation.pending ? (100 * cancellation.recorded / cancellation.requested).toFixed(2) : null)
      || recovery.recorded + recovery.pending !== recovery.attempts || recovery.succeeded > recovery.recorded
      || recovery.notRecordedTasks > selected.length
      || recovery.state !== (!recovery.attempts && !recovery.truncated ? 'not_recorded'
        : recovery.truncated || recovery.pending ? 'pending' : 'recorded')
      || recovery.percent !== (recovery.attempts && !recovery.pending && !recovery.truncated ? (100 * recovery.succeeded / recovery.attempts).toFixed(2) : null)) fail();
  }
  return value;
}

export function TaskOutcomeObservation({ taskIds, current, onAccessDenied }: {
  taskIds: readonly string[]; current: () => boolean; onAccessDenied: () => void;
}) {
  const { t } = useLocale();
  const binding = JSON.stringify([taskIds, currentSessionEpoch()]);
  const [observation, setObservation] = useState<{ binding: string; value: AiTaskOutcomeSampleDraft } | null>(null);
  const [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null), generation = useRef(0), mounted = useRef(false);
  const scope = useRef({ binding, current, onAccessDenied }); scope.current = { binding, current, onAccessDenied };
  useEffect(() => {
    const clear = () => { generation.current++; request.current?.abort(); request.current = null;
      setObservation(null); setError(false); setBusy(false); };
    clear(); mounted.current = true;
    const session = currentSessionSignal();
    document.addEventListener('visibilitychange', clear); session.addEventListener('abort', clear);
    return () => { mounted.current = false; generation.current++; request.current?.abort(); request.current = null;
      document.removeEventListener('visibilitychange', clear); session.removeEventListener('abort', clear); };
  }, [binding]);
  const read = async () => {
    if (!mounted.current || request.current || document.hidden || scope.current.binding !== binding || !scope.current.current())
      throw Error('AI_SCOPE_CHANGED');
    const selected = [...taskIds], epoch = currentSessionEpoch(), owner = ++generation.current;
    const controller = new AbortController(); request.current = controller;
    const active = () => mounted.current && owner === generation.current && !controller.signal.aborted
      && currentSessionEpoch() === epoch && !document.hidden && scope.current.binding === binding && scope.current.current();
    setObservation(null); setError(false); setBusy(true);
    try {
      const value = validateTaskOutcomeObservation(await aiTaskCenterApi.outcomes(selected, controller.signal), selected);
      if (!active()) return;
      setObservation({ binding, value });
    } catch (failure) {
      if (active()) { setError(true);
        if ([401, 403].includes((failure as { response?: { status?: number } }).response?.status ?? 0)) scope.current.onAccessDenied(); }
      throw failure;
    } finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  const value = !document.hidden && scope.current.current() && observation?.binding === binding ? observation.value : null;
  return <section aria-label={t('任务样本观察')} aria-busy={busy}>
    <p>{t('样本数')}: {taskIds.length} · {t('仅统计明确选择的原任务，不代表全租户成功率。')}</p>
    <ActionButton label={t(value ? '重读任务样本' : '读取任务样本')} pendingLabel={t('读取中…')} disabled={busy} onAction={read} />
    {error && <Alert type="warning" title={t('任务样本当前不可读取，旧内容已清除，请核对当前权限。')} />}
    {value && <div aria-live="polite">
      <p>{t('场景')}: {safeDisplayText(value.sceneCode, 128)} · {t('版本')}: {safeDisplayText(value.sceneVersion, 64)}</p>
      <p>{t('观察时间')}: {formatTimestamp(value.observedAt).value}</p>
      <dl>
        <div><dt>{t('样本成功率')}</dt><dd>{value.successRate.percent === null ? t('尚未计算') : `${value.successRate.percent}%`}
          {' · '}{value.successRate.succeeded}/{value.sampleSize}</dd></div>
        <div><dt>{t('原接管收据比例')}</dt><dd>{value.takeoverRate.percent}% · {value.takeoverRate.tasksWithReceipt}/{value.sampleSize}</dd></div>
        {value.lifecycleRates && <>
          <div><dt>{t('取消善后收据比例')}</dt><dd>{value.lifecycleRates.cancellation.percent === null ? t('证据未齐，未计算') : `${value.lifecycleRates.cancellation.percent}%`}
            {' · '}{value.lifecycleRates.cancellation.recorded}/{value.lifecycleRates.cancellation.requested}</dd></div>
          <div><dt>{t('原恢复完整成功比例')}</dt><dd>{value.lifecycleRates.recovery.percent === null ? t('证据未齐，未计算') : `${value.lifecycleRates.recovery.percent}%`}
            {' · '}{value.lifecycleRates.recovery.succeeded}/{value.lifecycleRates.recovery.attempts}</dd></div>
        </>}
      </dl>
      {value.successRate.state === 'pending' && <p>{t('任务尚未全部结束，最终成功率未计算。')}</p>}
      {value.lifecycleRates && <p className="muted">{t('取消善后不表示业务回滚；恢复比例仅包含已核对的原恢复运行，不代表全租户或 SLO。')}</p>}
      <p className="muted">{t('接管仅指原人工恢复收据；真实 SLO 未评估。')}</p>
    </div>}
  </section>;
}
