/** Human navigation from an independently read Core order receipt. Re-read the
 * same original before opening the registered page; this grants no payment,
 * order operation or authority from a model URL or cached identifier. */
import { useEffect, useRef, useState } from 'react';
import { generatePath, useNavigate } from 'react-router-dom';
import { APP_ROUTES, canAccessRoute } from '@/app/navigation';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { ActionButton } from '@/components/ui';
import { useAiManagementLocale } from './management-locale';

const orderIdValid = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const sessionBinding = () => {
  const auth = useAuthStore.getState();
  return JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user, auth.token, currentSessionEpoch()]);
};
const mayOpenOrder = () => {
  const auth = useAuthStore.getState();
  return !!auth.token && !!auth.sessionVerified && !!auth.tenant?.tenantId && !!auth.currentWorkspaceId && !!auth.user
    && canAccessRoute(APP_ROUTES.orderDetail, auth.hasPermission, auth.hasCapability,
      auth.tenant.categoryCode, Boolean(auth.user.isSaasAdmin), auth.hasTenantMembershipPermission);
};

export function OriginalOrderReceiptLink({ orderId, identity, current, readOriginal, onAccessDenied }: {
  orderId: string; identity: string; current(): boolean;
  readOriginal(signal: AbortSignal): Promise<string | null>; onAccessDenied?(): void;
}) {
  useAuthStore();
  const { t } = useAiManagementLocale(), navigate = useNavigate();
  const [origin] = useState(() => ({ orderId, identity, session: sessionBinding() }));
  const [visible, setVisible] = useState(() => !document.hidden);
  const live = useRef({ orderId, identity, current, readOriginal, onAccessDenied });
  live.current = { orderId, identity, current, readOriginal, onAccessDenied };
  const mounted = useRef(false), retracted = useRef(false), flight = useRef<AbortController | null>(null);
  const active = () => mounted.current && !retracted.current && live.current.orderId === origin.orderId && live.current.identity === origin.identity
    && sessionBinding() === origin.session && !document.hidden && live.current.current() && mayOpenOrder();
  useEffect(() => {
    mounted.current = true;
    // Revealing a hidden page does not restore its old receipt observation.
    const retract = () => { if (document.hidden) { retracted.current = true; flight.current?.abort(); setVisible(false); } };
    document.addEventListener('visibilitychange', retract);
    return () => { mounted.current = false; flight.current?.abort(); document.removeEventListener('visibilitychange', retract); };
  }, []);
  if (!visible || orderId !== origin.orderId || identity !== origin.identity || !orderIdValid(orderId)
    || sessionBinding() !== origin.session || !current() || !mayOpenOrder()) return null;
  return <ActionButton label={t('打开原订单')} pendingLabel={t('正在核对')} successLabel={t('已打开原订单')}
    onAction={async () => {
      if (flight.current || !active()) throw Error('AI_SCOPE_CHANGED');
      const controller = new AbortController(); flight.current = controller;
      try {
        const originalId = await live.current.readOriginal(controller.signal);
        if (controller.signal.aborted || !active()) throw Error('AI_SCOPE_CHANGED');
        if (!orderIdValid(originalId) || originalId !== origin.orderId) throw Error('AI_REVISION_CONFLICT');
        navigate(generatePath(APP_ROUTES.orderDetail.path, { id: encodeURIComponent(originalId) }));
      } catch (error) {
        if (active() && [401, 403].includes((error as { response?: { status?: number } }).response?.status ?? 0)) live.current.onAccessDenied?.();
        retracted.current = true;
        if (mounted.current) setVisible(false);
        throw error;
      } finally { if (flight.current === controller) flight.current = null; }
    }} />;
}
