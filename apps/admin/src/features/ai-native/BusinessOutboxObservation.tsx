/** Explicit bounded business-event reads only. The original API and Guard
 * own resource visibility; this panel cannot claim an event, read an automation
 * Task, deliver an alert or infer that an unknown operation may be retried. */
import { useEffect, useRef, useState } from 'react';
import type { AiBusinessOutboxObservationDraft } from '@rental-os/shared';
import { validateAiBusinessOutboxObservationDraft } from '@rental-os/shared';
import { ActionButton, Alert } from '@/components/ui';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { aiAutomationReviewsApi } from '@/api/aiAutomationReviews';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp } from './formatters';
import { safeDisplayText } from './safe-display';
import styles from './AiManagement.module.css';

export function BusinessOutboxObservation({ identity, current, onAccessDenied }: {
  identity: string; current(): boolean; onAccessDenied(): void;
}) {
  const { locale } = useAiManagementLocale(), en = locale === 'en-US';
  const [record, setRecord] = useState<{ identity: string; epoch: number; value: AiBusinessOutboxObservationDraft } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const flight = useRef<AbortController | null>(null), generation = useRef(0), mounted = useRef(false);
  const live = useRef({ identity, current, onAccessDenied }); live.current = { identity, current, onAccessDenied };
  useEffect(() => {
    const clear = () => { generation.current++; flight.current?.abort(); flight.current = null;
      setRecord(null); setBusy(false); setError(false); };
    mounted.current = true; clear();
    const session = currentSessionSignal();
    document.addEventListener('visibilitychange', clear); session.addEventListener('abort', clear);
    return () => { mounted.current = false; clear(); document.removeEventListener('visibilitychange', clear); session.removeEventListener('abort', clear); };
  }, [identity]);
  const read = async (after?: string) => {
    if (!mounted.current || flight.current || document.hidden || live.current.identity !== identity || !live.current.current())
      throw Error('AI_SCOPE_CHANGED');
    const request = new AbortController(), owner = ++generation.current, epoch = currentSessionEpoch();
    const auth = useAuthStore.getState(), tenantId = auth.tenant?.tenantId, workspaceId = auth.currentWorkspaceId;
    const active = () => mounted.current && generation.current === owner && currentSessionEpoch() === epoch
      && !document.hidden && !request.signal.aborted && live.current.identity === identity && live.current.current();
    flight.current = request; setRecord(null); setBusy(true); setError(false);
    try {
      const value = await aiAutomationReviewsApi.outboxObservation({ limit: 20, ...(after ? { after } : {}) }, request.signal);
      if (!active()) return;
      if (!validateAiBusinessOutboxObservationDraft(value) || value.audience !== 'operator'
        || value.scope.tenantId !== tenantId || value.scope.workspaceId !== workspaceId) throw Error('AI_RESOURCE_UNAVAILABLE');
      setRecord({ identity, epoch, value });
    } catch (failure) {
      if (active()) { setError(true); if ([401, 403].includes((failure as { response?: { status?: number } }).response?.status ?? 0))
        live.current.onAccessDenied(); }
      throw failure;
    } finally { if (flight.current === request) { flight.current = null; if (mounted.current) setBusy(false); } }
  };
  const shown = !document.hidden && live.current.current() && record?.identity === identity
    && record.epoch === currentSessionEpoch() ? record.value : null;
  const labels = en ? { pending: 'Pending', claimed: 'Original lease held', retry_scheduled: 'Retry scheduled by the original service', dead_letter: 'Manual handling required' }
    : { pending: '待投递', claimed: '原租约持有中', retry_scheduled: '原服务已登记重试', dead_letter: '需人工处理' };
  return <section className={styles.stack} aria-label={en ? 'Business event delivery' : '经营事件投递'} aria-busy={busy}>
    <p>{en ? 'Read only this authorized event window. Lease expiry, queue age and missing evidence do not authorize retry or prove completion.'
      : '只读取当前受权事件窗口。租约到期、积压时间或缺少证据不授重发权限，也不证明处理完成。'}</p>
    <div className={styles.toolbar}>
      <ActionButton label={en ? 'Read event observation' : '读取事件观察'} disabled={busy} onAction={() => read()} />
      {shown?.query.nextAfter && <ActionButton label={en ? 'Read next window' : '读取下一窗口'} disabled={busy}
        onAction={() => read(shown.query.nextAfter!)} />}
    </div>
    {error && <Alert type="warning" title={en ? 'This event window could not be verified. Check current resource access.' : '本次事件窗口未能核验，请核对当前资源读取权限。'} />}
    {shown && <>
      <p>{en ? 'Observed at' : '观察时间'}: {formatTimestamp(shown.observedAt).value}</p>
      {shown.window.state === 'not_recorded' ? <p>{en ? 'No authorized event was observed in this window. A zero backlog is not established.'
        : '本窗口未观察到可核验事件，不能据此判定积压为零。'}</p> : <>
        <p>{en ? 'Pending in this window' : '本窗口待投递'}: {shown.window.pendingInWindow} · {en ? 'Manual handling' : '需人工处理'}: {shown.window.deadLettersInWindow}
          {' · '}{en ? 'Oldest pending age' : '最早待投递已等待'}: {shown.window.oldestPendingAgeMs === null ? en ? 'Not recorded' : '未记录' : `${shown.window.oldestPendingAgeMs} ms`}</p>
        <dl className={styles.facts}>{shown.window.items.map(row => <div key={row.eventId}>
          <dt>{safeDisplayText(row.eventId, 36)}</dt><dd>{labels[row.status]} · {safeDisplayText(row.type, 64)}
            {' · '}{en ? 'Attempts' : '原尝试次数'}: {row.attempts}
            {' · '}{en ? 'Resource revision' : '资源修订'}: {row.resource.version}
            {' · '}{en ? 'Recorded at' : '登记时间'}: {formatTimestamp(row.createdAt).value}
            {row.pendingAgeMs !== null && <> · {row.pendingAgeMs} ms</>}
          </dd>
        </div>)}</dl>
        {shown.query.truncated && <p>{en ? 'The window is truncated; the figures do not cover the workspace total.' : '窗口已截断，数字不代表整个空间的总量。'}</p>}
      </>}
      {shown.alerts.state === 'not_evaluated' ? <p>{en ? 'No current trusted alert policy was evaluated.' : '未按当前可信告警政策评估。'}</p>
        : shown.alerts.items.length ? <Alert type="warning" title={en ? 'Pending events exceeded the recorded threshold.' : '待投递事件已超过登记阈值。'}
          description={en ? 'Diagnostic only. Continue through the original business review; no notification or retry was requested.'
            : '仅为诊断。请在原经营待办继续处理；本次未发送通知或请求重试。'} />
          : <p>{en ? 'No configured threshold was exceeded in the authorized window; service health is not inferred.' : '本次受权窗口未超过配置阈值，不据此推断服务健康。'}</p>}
    </>}
  </section>;
}
