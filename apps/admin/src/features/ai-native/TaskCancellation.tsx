/** Explicit original-task stop intent; no automatic retry, rollback, lease or
 * budget release. Session storage retains only the original receipt lookup. */
import { useEffect, useRef, useState } from 'react';
import type { AiTaskStopQueryDraft, AiTaskStopObservationDraft } from '@rental-os/shared';
import { aiTaskCenterApi } from '@/api/aiTaskCenter';
import { useAiManagementLocale as useLocale } from './management-locale';
import { ActionButton, Alert, ConfirmAction } from '@/components/ui';
import { validateTaskCenterSnapshot } from './task-center-reader';

function savedReference(key: string, taskId: string): AiTaskStopQueryDraft | 'invalid' | null {
  try {
    const raw = sessionStorage.getItem(key); if (!raw) return null;
    if (raw.length > 512) return 'invalid';
    const value = JSON.parse(raw);
    return value && Object.keys(value).length === 2 && value.taskId === taskId && Number.isInteger(value.expectedRevision)
      && value.expectedRevision >= 1 && value.expectedRevision <= 4294967294 ? value : 'invalid';
  } catch { return 'invalid'; }
}
export function TaskCancellation({ taskId, identity, current, onAccessDenied }: {
  taskId: string; identity: string; current: () => boolean; onAccessDenied: () => void;
}) {
  const { t } = useLocale(), key = `ai-task-stop:${identity}:${taskId}`;
  const [original, setOriginal] = useState(() => savedReference(key, taskId));
  const [target, setTarget] = useState<AiTaskStopQueryDraft | null>(null);
  const [receipt, setReceipt] = useState<AiTaskStopObservationDraft | null>(null);
  const [error, setError] = useState(false), [pending, setPending] = useState(false);
  const request = useRef<AbortController | null>(null), mounted = useRef(true);
  const active = useRef({ taskId, identity, current, onAccessDenied }); active.current = { taskId, identity, current, onAccessDenied };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const run = async (operation: 'prepare' | 'stop' | 'receipt') => {
    const same = () => mounted.current && !document.hidden && active.current.taskId === taskId && active.current.identity === identity && active.current.current();
    if (!same() || request.current) throw Error('AI_RESOURCE_UNAVAILABLE');
    const controller = new AbortController(); request.current = controller; setPending(true); setError(false); setReceipt(null);
    try {
      if (operation === 'prepare') {
        if (original || savedReference(key, taskId)) throw Error('AI_RESULT_UNKNOWN');
        setTarget(null);
        const value = validateTaskCenterSnapshot(await aiTaskCenterApi.snapshot(taskId, controller.signal), taskId);
        if (!same() || controller.signal.aborted) return;
        if (!['queued', 'running', 'waiting_input', 'waiting_confirmation', 'waiting_external'].includes(value.status))
          throw Error('AI_RESOURCE_UNAVAILABLE');
        setTarget({ taskId, expectedRevision: value.revision });
        return;
      }
      const reference = operation === 'stop' ? target : original;
      if (!reference || reference === 'invalid' || operation === 'stop' && original) throw Error('AI_RESOURCE_UNAVAILABLE');
      if (operation === 'stop') {
        if (savedReference(key, taskId)) throw Error('AI_RESULT_UNKNOWN');
        const serialized = JSON.stringify(reference);
        sessionStorage.setItem(key, serialized);
        if (sessionStorage.getItem(key) !== serialized) throw Error('AI_RESOURCE_UNAVAILABLE');
        setOriginal(reference); setTarget(null);
      }
      let value: AiTaskStopObservationDraft;
      try { value = await aiTaskCenterApi[operation === 'stop' ? 'stop' : 'stopReceipt'](reference, controller.signal); }
      catch (failure) {
        // Only a definite pre-write revision conflict permits a new review.
        // Access loss, network errors and unknown keep the original reference.
        if (operation === 'stop' && (failure as { response?: { data?: { code?: string } } }).response?.data?.code === 'AI_REVISION_CONFLICT') {
          sessionStorage.removeItem(key); if (same()) setOriginal(null);
        }
        throw failure;
      }
      if (!same() || controller.signal.aborted) return;
      if (!value || value.taskId !== taskId || value.expectedRevision !== reference.expectedRevision
        || !['observed', 'not_observed'].includes(value.status) || value.cancellation !== 'request_not_rollback'
        || value.automaticRetry !== false || value.remoteCancellation !== 'not_attested' || value.budgetRelease !== 'not_attempted')
        throw Error('AI_RESOURCE_UNAVAILABLE');
      setReceipt(value);
      if (operation === 'stop' && value.status !== 'observed') throw Error('AI_RESULT_UNKNOWN');
    } catch (failure) {
      if (same() && !controller.signal.aborted) {
        setError(true); setTarget(null);
        if ([401, 403].includes((failure as { response?: { status?: number } }).response?.status ?? 0)) active.current.onAccessDenied();
      }
      throw failure;
    } finally { if (request.current === controller) request.current = null; if (same()) setPending(false); }
  };
  if (!current() || document.hidden) return null;
  return <section aria-label={t('原任务停止请求')}>
    <p className="muted">{t('取消请求被接受后不再启动新步骤；已发生的操作不会自动撤销或退款。')}</p>
    <div className="panel-toolbar">
      <ActionButton label={t('读取停止目标')} pendingLabel={t('读取中…')} disabled={pending || !!original} onAction={() => run('prepare')} />
      {target && <ConfirmAction label={t('请求取消任务')} prompt={t('确认请求停止？已派发或已提交的业务不会因此回滚。')}
        doneLabel={t('请求已观察，未证明取消完成')} disabled={pending || !!original} onConfirm={() => run('stop')} />}
      {original && original !== 'invalid' && <ActionButton label={t('核对原停止收据')} pendingLabel={t('核对中…')} disabled={pending} onAction={() => run('receipt')} />}
    </div>
    {original === 'invalid' && <Alert type="warning" title={t('原停止引用不可读取，不允许再次提交；请通过原任务和人工业务流程核对。')} />}
    {error && <Alert type="warning" title={t('本次未获得可靠结果，请核对权限或原停止收据；不自动重复提交。')} />}
    {receipt && <p role="status" aria-live="polite">{t(receipt.status === 'observed'
      ? '原停止请求已记录；不表示任务已取消、远端已停止或费用已释放。'
      : '尚未观察到这份原停止收据，不能据此判定未提交或重新发送。')}</p>}
  </section>;
}
