/** Explicit conversation metadata commands. Journal identity is account/scope,
 * never a token or epoch; reopening the panel can recover the original key.
 * Archived/deleted conversations do not cancel Tasks or delete business records. */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { AiConversationListResponseDraft, AiSceneCode } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { ActionButton, Alert, ConfirmAction } from '@/components/ui';
import { ConversationLifecycleSession } from './conversation-lifecycle-session';
import { useAiManagementLocale } from './management-locale';
import { safeDisplayText } from './safe-display';

type Target = AiConversationListResponseDraft['items'][number];
export function ConversationLifecycle({ identity, enabled, capability, target, current, onCommitted }: {
  identity: string; enabled: boolean; capability: AiSceneCode | 'all'; target: Target | null;
  current: () => boolean; onCommitted: () => void;
}) {
  const { t } = useAiManagementLocale();
  const scope = useRef({ identity, enabled, current, onCommitted, capability, target });
  scope.current = { identity, enabled, current, onCommitted, capability, target };
  const session = useMemo(() => {
    let storage: Storage | undefined; try { storage = window.sessionStorage; } catch { /* refuse writes without durable receipt lookup */ }
    return new ConversationLifecycleSession(aiConversationsApi, () => scope.current.identity === identity && scope.current.enabled
      && !document.hidden && scope.current.current(), storage, `ai-conversation-operation:${identity}`);
  }, [identity]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => {
    const change = () => session.retract(); document.addEventListener('visibilitychange', change);
    if (!enabled) session.retract();
    return () => { session.retract(); document.removeEventListener('visibilitychange', change); };
  }, [session, enabled]);
  const committed = async (operation: () => Promise<unknown>) => {
    if (scope.current.identity !== identity || !scope.current.enabled || !scope.current.current() || document.hidden) throw Error('AI_SCOPE_CHANGED');
    scope.current.onCommitted(); // Retract old history before a write or receipt read can fail.
    const value = await operation();
    if (scope.current.identity === identity && scope.current.enabled && scope.current.current() && !document.hidden) scope.current.onCommitted();
    return value;
  };
  const mutate = (action: 'archive' | 'delete') => {
    const latest = scope.current.target;
    if (!target || !latest || target.conversationId !== latest.conversationId || target.revision !== latest.revision) throw Error('AI_SCOPE_CHANGED');
    return committed(() => session.mutate(action, target.conversationId, target.revision));
  };
  return <section aria-label={t('对话生命周期')} aria-busy={state.busy}>
    <p>{t('新建只保存对话记录；归档或删除不取消任务，不删除审批、订单或账务。')}</p>
    <ActionButton label={t('新建当前能力对话')} disabled={!enabled || state.busy || state.locked || capability === 'all'} onAction={() => {
      if (capability === 'all' || scope.current.capability !== capability) throw Error('AI_SCOPE_CHANGED');
      return committed(() => session.create(capability));
    }} />
    {target && <>
      {target.status === 'active' && <ConfirmAction label={t('归档所选对话')} disabled={!enabled || state.busy || state.locked}
        prompt={t('归档此对话？原任务仍独立继续或等待。')} onConfirm={() => mutate('archive')} />}
      <ConfirmAction label={t('删除所选对话')} disabled={!enabled || state.busy || state.locked}
        prompt={t('删除普通对话历史展示？业务收据保留，正文按原保留政策清理，不保证立即物理删除。')} onConfirm={() => mutate('delete')} />
    </>}
    {state.locked && <ActionButton label={t('核对原对话操作')} disabled={!enabled || state.busy} onAction={() => committed(session.reconcile)} />}
    {state.feedback === 'unknown' && <Alert type="warning" title={t('原对话操作待核对，已禁止新写入；未观察到收据也不能换键重发。')} />}
    {state.feedback === 'unavailable' && <Alert type="warning" title={t('对话操作当前不可用，未视为成功。')} />}
    {state.feedback === 'conflict' && <Alert type="warning" title={t('原修订已冲突或输入被拒绝，请重新读取并审阅对话。')} />}
    {state.receipt?.status === 'observed' && <p role="status">{t('原对话操作已记录；请显式重读历史，不代表任务或业务已完成。')}
      {' '}{safeDisplayText(state.receipt.conversationId, 191)}</p>}
  </section>;
}
