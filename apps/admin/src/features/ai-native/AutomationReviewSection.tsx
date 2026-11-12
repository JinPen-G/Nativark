/** Workspace human-review entry, separate from owner TaskCenter permissions.
 * Only explicit controls read or write metadata. Hidden/closed panels release
 * their session; original unknown references remain in its minimal journal. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Accordion } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { useAiManagementLocale } from './management-locale';
import { AutomationReviewWorkbench } from './AutomationReviewWorkbench';
import { createAutomationOriginalNavigation } from './automation-original-navigation';
import { AutomationRefundRecords } from './AutomationRefundRecords';
import type { AutomationReviewOriginalTarget } from './automation-review-session';

export const AUTOMATION_REVIEW_ENTRY_PERMISSIONS = Object.freeze([
  'rental-os:order:view', 'system:integration:manage', 'rental-os:finance:view', 'rental-os:finance:reconcile',
]);

export function AutomationReviewSection({ identity, current }: { identity: string; current(): boolean }) {
  const auth = useAuthStore(), { locale } = useAiManagementLocale(), navigate = useNavigate();
  const [opened, setOpened] = useState<string[]>([]);
  const [refund, setRefund] = useState<AutomationReviewOriginalTarget | null>(null);
  const tenantId = auth.tenant?.tenantId, workspaceId = auth.currentWorkspaceId;
  const permitted = () => useAuthStore.getState().sessionVerified && !!useAuthStore.getState().token && !useAuthStore.getState().user?.isSaasAdmin
    && AUTOMATION_REVIEW_ENTRY_PERMISSIONS.some(useAuthStore.getState().hasPermission) && current();
  const original = useMemo(() => createAutomationOriginalNavigation({
    scope: { tenantId: tenantId ?? '', workspaceId: workspaceId ?? '', actorId: auth.user?.id ?? '', audience: 'operator' },
    current: () => permitted() && !document.hidden,
    hasPermission: code => useAuthStore.getState().hasPermission(code), navigate,
  }), [identity, tenantId, workspaceId, navigate]);
  if (!tenantId || !workspaceId || !permitted()) return null;
  return <><Accordion value={opened} onValueChange={value => { setOpened(value); if (!value.includes('human-automation-review')) setRefund(null); }} items={[{
    key: 'human-automation-review', title: locale === 'en-US' ? 'Business reviews' : '经营待办',
    content: opened.includes('human-automation-review') ? <AutomationReviewWorkbench identity={identity}
      current={() => permitted() && !document.hidden} onOpenOriginal={async (target, signal) => {
        if (signal.aborted || !permitted() || document.hidden) return { state: 'unavailable' };
        if (target.resource.kind === 'refund') {
          const actor = useAuthStore.getState();
          if (target.scope.tenantId !== tenantId || target.scope.workspaceId !== workspaceId || target.scope.actorId !== actor.user?.id
            || target.scope.audience !== 'operator'
            || !target.resource.orderId || !target.resource.paymentIntentId
            || !actor.hasPermission('rental-os:finance:view') && !actor.hasPermission('rental-os:finance:reconcile')) return { state: 'unavailable' };
          setRefund(structuredClone(target)); return { state: 'opened' };
        }
        return original(target, signal);
      }} onAccessDenied={() => { setRefund(null); setOpened([]); }} /> : null,
  }]} />{refund && <AutomationRefundRecords key={JSON.stringify(refund)} target={refund} current={() => permitted()}
    close={() => setRefund(null)} />}</>;
}
