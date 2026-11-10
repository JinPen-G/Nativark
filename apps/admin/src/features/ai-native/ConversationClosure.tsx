/** Explicit original closing fence or terminal-turn release. The server alone
 * proves no Task/unknown effect is left; a local receipt then needs a fresh
 * empty-head read before journal rotation. Never auto-retry or cancel Tasks. */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AI_CONVERSATION_DRAFT_VERSION, validateAiConversationObservationDraft, type AiConversationObservationDraft } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { ActionButton, Alert, ConfirmAction } from '@/components/ui';
import { ConversationLifecycleSession } from './conversation-lifecycle-session';
import { useAiManagementLocale } from './management-locale';

export function ConversationClosure({ identity, conversationId, observation, current, onChanged, onRotate, canClose, beforeClose }: {
  identity: string; conversationId: string; observation: AiConversationObservationDraft | null; current: () => boolean; onChanged: () => void;
  canClose: boolean; beforeClose: (observation: AiConversationObservationDraft) => void;
  onRotate: (proof: { operationKey: string; expectedRevision: number; turnId: string; originalInputRef: string }, acknowledge: () => void) => Promise<void>;
}) {
  const { t } = useAiManagementLocale();
  const scope = useRef({ identity, conversationId, observation, current, onChanged, onRotate });
  scope.current = { identity, conversationId, observation, current, onChanged, onRotate };
  const session = useMemo(() => {
    let storage: Storage | undefined; try { storage = window.sessionStorage; } catch { /* fail closed */ }
    return new ConversationLifecycleSession(aiConversationsApi, () => scope.current.identity === identity
      && scope.current.conversationId === conversationId && !document.hidden && scope.current.current(), storage,
    `ai-conversation-closure:${identity}:${conversationId}`, undefined, true);
  }, [identity, conversationId]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => { const clear = () => session.retract(); document.addEventListener('visibilitychange', clear);
    return () => { session.retract(); document.removeEventListener('visibilitychange', clear); }; }, [session]);
  const run = async (action: 'close' | 'receipt' | 'rotate') => {
    if (scope.current.identity !== identity || scope.current.conversationId !== conversationId || document.hidden || !scope.current.current()) throw Error('AI_SCOPE_CHANGED');
    const target = observation, latest = scope.current.observation;
    if (action === 'close' && !canClose) throw Error('AI_RESULT_UNKNOWN');
    if (action === 'close' && (!target || !latest || target.revision !== latest.revision || target.currentTurn?.turnId !== latest.currentTurn?.turnId
      || !validateAiConversationObservationDraft(target, { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId })
      || target.status !== 'active' || !target.currentTurn)) throw Error('AI_SCOPE_CHANGED');
    if (action === 'close') {
      if (typeof beforeClose !== 'function') throw Error('AI_RESULT_UNKNOWN');
      beforeClose(target!);
    }
    scope.current.onChanged();
    if (action === 'receipt') await session.reconcile();
    else if (action === 'rotate') await session.completeClosure(async (proof, acknowledge) => {
      if (scope.current.identity !== identity || scope.current.conversationId !== conversationId || document.hidden || !scope.current.current()) throw Error('AI_SCOPE_CHANGED');
      await scope.current.onRotate(proof, acknowledge);
    });
    else {
      const turn = target!.currentTurn!;
      await session.close(turn.task ? 'release' : 'closeUnstarted', conversationId, target!.revision, turn.turnId, turn.original.inputRef);
    }
    if (scope.current.identity === identity && scope.current.conversationId === conversationId && !document.hidden && scope.current.current()) scope.current.onChanged();
  };
  return <section aria-label={t('原轮次关闭与释放')} aria-busy={state.busy}>
    <p>{t('关闭未创建请求或释放已终结轮次由服务端核验；不取消任务，不释放未知费用。')}</p>
    {observation?.currentTurn && <ConfirmAction label={t(observation.currentTurn.task ? '核验并释放原轮次' : '关闭原请求创建入口')}
      disabled={state.busy || state.locked || !canClose || observation.status !== 'active'} prompt={t('按原轮次与修订提交关闭或释放？未知副作用仍会拒绝。')}
      onConfirm={() => run('close')} />}
    {observation?.currentTurn && !state.locked && !canClose && <p>{t('缺少匹配的原受理定位，不能在此关闭轮次；不会发送关闭请求。')}</p>}
    {state.locked && <ActionButton label={t('核对原轮次关闭收据')} disabled={state.busy} onAction={() => run('receipt')} />}
    {state.receipt?.status === 'observed' && <ActionButton label={t('复验空闲对话并准备下一轮')} disabled={state.busy} onAction={() => run('rotate')} />}
    {state.locked && <Alert type="warning" title={t('原关闭定位已保留；仅核对原收据，空闲复验前不换轮次。')} />}
  </section>;
}
