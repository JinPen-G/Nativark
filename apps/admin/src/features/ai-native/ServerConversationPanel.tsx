/** Shared opt-in conversation host for AI Workspace and Copilot. It supplies
 * current Auth scope to the existing readers, never demo data or credentials.
 * A registered order-page locator only supplies the original admission form.
 * Hidden/closed/changed bindings destroy display; journals keep original keys. */
import { useEffect, useRef, useState } from 'react';
import { AI_TASK_CENTER_ENTRY_PERMISSIONS } from '@rental-os/shared';
import { currentSessionEpoch } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { Alert } from '@/components/ui';
import { ConversationHistory } from './ConversationHistory';
import { useAiManagementLocale } from './management-locale';
import type { ConversationSelection } from './conversation-navigation';

export function ServerConversationPanel({ visible, initialConversation, onOpenConversation, orderId, current: currentSource }: {
  visible: boolean; initialConversation?: ConversationSelection;
  onOpenConversation?: (selection: ConversationSelection) => void;
  orderId?: string; current?: () => boolean;
}) {
  const auth = useAuthStore(), { t } = useAiManagementLocale();
  const identity = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id]);
  const epoch = currentSessionEpoch(), owner = JSON.stringify([identity, auth.user, epoch,
    initialConversation?.conversationId, initialConversation?.capabilityCode, orderId]);
  const source = useRef(currentSource); source.current = currentSource;
  const validOrder = orderId === undefined || /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(orderId);
  const allowed = !!auth.token && auth.sessionVerified && !!auth.tenant?.tenantId && !!auth.currentWorkspaceId
    && !!auth.user && !auth.user.isSaasAdmin && validOrder && AI_TASK_CENTER_ENTRY_PERMISSIONS.some(auth.hasPermission);
  const [documentVisible, setDocumentVisible] = useState(() => !document.hidden);
  const mounted = useRef(false), lease = useRef({ owner, visible, allowed, documentVisible, generation: 0 });
  if (lease.current.owner !== owner || lease.current.visible !== visible || lease.current.allowed !== allowed
    || lease.current.documentVisible !== documentVisible) {
    lease.current = { owner, visible, allowed, documentVisible, generation: lease.current.generation + 1 };
  }
  const generation = lease.current.generation;
  useEffect(() => {
    mounted.current = true;
    const change = () => {
      const next = !document.hidden;
      if (next !== lease.current.documentVisible) { lease.current.generation++; setDocumentVisible(next); }
    };
    document.addEventListener('visibilitychange', change);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', change); };
  }, []);
  const current = () => {
    const now = useAuthStore.getState();
    return mounted.current && lease.current.generation === generation && lease.current.owner === owner
      && lease.current.visible && lease.current.allowed && (!source.current || source.current()) && !document.hidden && !!now.token && now.sessionVerified
      && !!now.user && !now.user.isSaasAdmin && AI_TASK_CENTER_ENTRY_PERMISSIONS.some(now.hasPermission)
      && owner === JSON.stringify([JSON.stringify([now.tenant?.tenantId, now.currentWorkspaceId, now.user?.id]), now.user, currentSessionEpoch(),
        initialConversation?.conversationId, initialConversation?.capabilityCode, orderId]);
  };
  if (!visible || !documentVisible) return null;
  if (!allowed) return <Alert type="warning" title={t('无权限查看 AI 任务')} />;
  return <ConversationHistory key={`${owner}:${generation}`} identity={identity} enabled current={current}
    initialConversation={initialConversation} orderId={orderId} onOpenConversation={onOpenConversation ? selection => {
      if (current()) onOpenConversation?.(selection);
    } : undefined} />;
}
