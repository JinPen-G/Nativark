/** Current Task provenance -> original resource Action -> fixed existing page.
 * Results are memory-only; hiding, auth changes and stale resources withdraw
 * them. Clicking navigation never executes allocation, payment or profile edits. */
import { useEffect, useRef, useState } from 'react';
import { generatePath, useNavigate } from 'react-router-dom';
import type { AiTaskOrderHandoffQuery, AiRegisteredEntryActionObservation, AiRegisteredEntryAction } from '@rental-os/shared';
import { APP_ROUTES, canAccessRoute } from '@/app/navigation';
import { currentSessionEpoch } from '@/app/queryClient';
import { ActionButton, Alert } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { aiEntryActionsApi } from '@/api/aiEntryActions';
import { useAiManagementLocale } from './management-locale';
import { safeDisplayText } from './safe-display';

export function RegisteredOrderActions({ query, identity, current }: {
  query: AiTaskOrderHandoffQuery; identity: string; current(): boolean;
}) {
  const auth = useAuthStore(), { t } = useAiManagementLocale(), navigate = useNavigate();
  const epoch = currentSessionEpoch(), key = JSON.stringify([query, identity, auth.user, auth.token, auth.currentWorkspaceId, epoch]);
  const active = useRef({ key, current }); active.current = { key, current };
  const generation = useRef(0), request = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ key: string; rows: AiRegisteredEntryActionObservation[]; error: boolean }>({ key, rows: [], error: false });
  const live = () => active.current.key === key && epoch === currentSessionEpoch() && !document.hidden && active.current.current();
  useEffect(() => {
    const clear = () => { generation.current++; request.current?.abort(); request.current = null; setState({ key, rows: [], error: false }); };
    clear(); document.addEventListener('visibilitychange', clear);
    return () => { generation.current++; request.current?.abort(); request.current = null; document.removeEventListener('visibilitychange', clear); };
  }, [key]);
  useEffect(() => {
    if (state.key !== key || !state.rows.length) return;
    const remaining = Math.min(...state.rows.map(row => Date.parse(row.action.expiresAt))) - Date.now();
    const clear = () => { generation.current++; request.current?.abort(); request.current = null;
      if (active.current.key === key) setState({ key, rows: [], error: true }); };
    if (!(remaining > 0)) { clear(); return; }
    const timer = setTimeout(clear, remaining); return () => clearTimeout(timer);
  }, [key, state]);
  const run = async (work: (signal: AbortSignal, valid: () => boolean) => Promise<void>) => {
    if (!live() || request.current) throw Error('AI_SCOPE_CHANGED');
    const own = ++generation.current, controller = new AbortController(); request.current = controller;
    const valid = () => live() && generation.current === own && !controller.signal.aborted;
    try { await work(controller.signal, valid); }
    catch (error) { if (valid()) setState({ key, rows: [], error: true }); throw error; }
    finally { if (request.current === controller) request.current = null; }
  };
  const destination = (action: AiRegisteredEntryAction) => {
    if (action.actionCode === 'OPEN_ORDER' || action.actionCode === 'OPEN_DISPATCH') {
      if (action.actionCode === 'OPEN_DISPATCH' && !useAuthStore.getState().hasPermission('rental-os:order:operate')) throw Error('AI_ACCESS_DENIED');
      return generatePath(APP_ROUTES.orderDetail.path, { id: encodeURIComponent(action.resource.id) });
    }
    if (action.actionCode === 'OPEN_PAYMENT' && action.associations.orderId) {
      if (!useAuthStore.getState().hasPermission('rental-os:finance:view')
        && !useAuthStore.getState().hasPermission('rental-os:finance:reconcile')) throw Error('AI_ACCESS_DENIED');
      return generatePath(APP_ROUTES.orderDetail.path, { id: encodeURIComponent(action.associations.orderId) });
    }
    if (action.actionCode === 'OPEN_CUSTOMER') {
      const route = action.resource.customerType === 'personal' ? APP_ROUTES.personalMemberDetail
        : action.resource.customerType === 'corporate' ? APP_ROUTES.corporateMemberDetail : null;
      const original = useAuthStore.getState();
      if (!route || !canAccessRoute(route, original.hasPermission, original.hasCapability, undefined,
        original.user?.isSaasAdmin === true, original.hasTenantMembershipPermission)) throw Error('AI_ACCESS_DENIED');
      return generatePath(route.path, { customerId: encodeURIComponent(action.resource.id) });
    }
    if (action.actionCode === 'OPEN_PRODUCT') {
      if (!useAuthStore.getState().hasPermission(APP_ROUTES.itemGroups.permission)) throw Error('AI_ACCESS_DENIED');
      return `${APP_ROUTES.itemGroups.path}?itemGroupId=${encodeURIComponent(action.resource.id)}`;
    }
    throw Error('AI_RESOURCE_UNAVAILABLE');
  };
  const label = (code: AiRegisteredEntryAction['actionCode']) => code === 'OPEN_CUSTOMER' ? t('查看客户')
    : code === 'OPEN_PRODUCT' ? t('查看商品') : code === 'OPEN_DISPATCH' ? t('查看配货')
      : code === 'OPEN_PAYMENT' ? t('查看支付记录') : t('查看订单');
  if (!live()) return null;
  return <section aria-label={t('当前允许的下一步')}>
    <ActionButton label={t('读取当前允许的下一步')} pendingLabel={t('正在核对')} onAction={() => run(async (signal, valid) => {
      setState({ key, rows: [], error: false });
      const result = await aiEntryActionsApi.fromOrder(query, signal);
      if (!valid() || !('taskId' in result.source) || result.source.taskId !== query.taskId || query.runId !== undefined && result.source.runId !== query.runId
        || result.scope.tenantId !== auth.tenant?.tenantId || result.scope.workspaceId !== auth.currentWorkspaceId) throw Error('AI_SCOPE_CHANGED');
      setState({ key, rows: result.actions, error: false });
    })} />
    {state.key === key && state.error && <Alert type="warning" title={t('当前入口不可用，可继续原人工页面。')} />}
    {state.key === key && state.rows.map(row => <ActionButton key={row.action.actionId}
      label={`${label(row.action.actionCode)} · ${safeDisplayText(row.label, 191)}`} pendingLabel={t('正在核对')}
      disabled={Date.parse(row.action.expiresAt) <= Date.now()} onAction={() => run(async (signal, valid) => {
        const result = await aiEntryActionsApi.revalidate(row.action, signal);
        if (!valid() || result.actionId !== row.action.actionId || JSON.stringify(result.resource) !== JSON.stringify(row.action.resource)
          || JSON.stringify(result.scope) !== JSON.stringify(row.action.scope) || Date.parse(row.action.expiresAt) <= Date.now()) throw Error('AI_SCOPE_CHANGED');
        const path = destination(row.action); if (!valid()) throw Error('AI_SCOPE_CHANGED'); navigate(path);
      })} />)}
  </section>;
}
