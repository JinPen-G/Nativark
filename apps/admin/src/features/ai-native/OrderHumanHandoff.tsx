/** Current order evidence is separate from the original model answer. Only
 * the existing registered order page owns human business operations. */
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { generatePath, useNavigate } from 'react-router-dom';
import type { AiTaskOrderHandoffQuery, AiTaskOrderHandoffResponse } from '@rental-os/shared';
import { APP_ROUTES } from '@/app/navigation';
import { ActionButton, Alert } from '@/components/ui';
import { aiTaskOrderHandoffApi } from '@/api/aiTaskOrderHandoff';
import { useAuthStore } from '@/features/auth/authStore';
import { useAiManagementLocale } from './management-locale';
import { createOrderHumanHandoffSession } from './order-human-handoff-session';
import { formatTimestamp } from './formatters';
import styles from './AiManagement.module.css';
export function OrderHumanHandoff({ query, identity, current, verify, validate, onAccessDenied, onUnavailable, onObserved }: {
  query: AiTaskOrderHandoffQuery; identity: string; current(): boolean;
  verify?(signal: AbortSignal): Promise<void>; validate?(value: AiTaskOrderHandoffResponse): void; onAccessDenied?(): void;
  onUnavailable?(): void; onObserved?(value: AiTaskOrderHandoffResponse): void;
}) {
  const auth = useAuthStore(), { t } = useAiManagementLocale(), navigate = useNavigate(), [, changed] = useReducer(n => n + 1, 0);
  const key = JSON.stringify([query, auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user, auth.token]);
  const owner = useRef({ key, identity, current, verify, validate }); owner.current = { key, identity, current, verify, validate };
  const session = useMemo(() => createOrderHumanHandoffSession({ query,
    scope: { kind: 'workspace', tenantId: auth.tenant?.tenantId ?? '', workspaceId: auth.currentWorkspaceId ?? '' },
    api: aiTaskOrderHandoffApi, current: () => owner.current.key === key && owner.current.identity === identity
      && !document.hidden && owner.current.current(), verify: signal => owner.current.verify?.(signal) ?? Promise.resolve(),
    validate: value => owner.current.validate?.(value), changed }), [key, identity]);
  useEffect(() => {
    session.activate(); const clear = () => session.clear(); document.addEventListener('visibilitychange', clear);
    return () => { document.removeEventListener('visibilitychange', clear); session.dispose(); };
  }, [session]);
  if (!auth.hasPermission(APP_ROUTES.orderDetail.permission)) return null;
  const data = session.view, frame = session.isCurrent() ? data.frame : null;
  const action = (work: () => Promise<void>) => async () => { try { await work(); } catch (error) {
    if (session.isCurrent() && (error as Error).message !== 'AI_RECONFIRM_CURRENT_ORDER') onUnavailable?.();
    if ([401,403].includes((error as { response?: { status?: number } }).response?.status ?? 0)) onAccessDenied?.(); throw error;
  } };
  return <section className={styles.stack} aria-label={t('订单人工办理')} aria-busy={!!data.busy}>
    <ActionButton label={t('读取当前办理提示')} pendingLabel={t('正在核对')} successLabel={t('已核对')} disabled={!!data.busy}
      onAction={action(async () => { await session.read(); if (session.view.frame) onObserved?.(session.view.frame); })} />
    {data.changedOrder && <Alert type="warning" title={t('原订单已变化，请核对新事实后再次选择打开。')} />}
    {!!data.error && <Alert type="warning" title={t('当前订单提示不可用，旧事实已撤回。')} />}
    {frame && <section className={styles.section}>
      <p>{t('以下来自当前订单读取，与原模型回答分别核对。')}</p>
      <p>{frame.order.orderNo} · {frame.order.status}</p>
      <p>{t('查询时点')}：{formatTimestamp(frame.order.observedAt).value} · {t('订单版本')}：{frame.order.version}</p>
      <p>{t('业务动作资格未提供，目录候选不代表可执行。')}</p>
      {frame.next.candidates.length > 0 && <p>{t('当前只验证了订单读取入口。')}</p>}
      <p>{t('可继续在原订单页核对和办理。具体动作仍由该页当前权限与业务状态决定。')}</p>
      <ActionButton label={t('打开原订单')} pendingLabel={t('正在核对')} successLabel={t('已打开原订单')} disabled={!!data.busy}
        onAction={action(async () => { const opened = await session.open(value => {
          onObserved?.(value);
          navigate(generatePath(APP_ROUTES.orderDetail.path, { id: encodeURIComponent(value.order.id) }));
        }); if (!opened) { if (session.view.frame) onObserved?.(session.view.frame); throw Error('AI_RECONFIRM_CURRENT_ORDER'); } })} />
    </section>}
  </section>;
}
