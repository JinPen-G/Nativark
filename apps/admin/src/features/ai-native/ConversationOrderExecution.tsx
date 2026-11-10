/** Explicit preparation/read versus first model start. The original host owns
 * permissions, budget and dispatch; unknown starts are observed without replay. */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { AiConversationTurnObservationDraft } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { ActionButton, Alert, ConfirmAction } from '@/components/ui';
import { ConversationOrderExecutionSession } from './conversation-order-execution-session';
import { ConversationOrderResults } from './ConversationOrderResults';
import { useVisibleObservationHost } from './VisibleObservationHost';
import { useAiManagementLocale } from './management-locale';

export function ConversationOrderExecution({ identity, conversationId, turn, current }: {
  identity: string; conversationId: string; turn: AiConversationTurnObservationDraft; current: () => boolean;
}) {
  const visible = useVisibleObservationHost();
  const { t } = useAiManagementLocale();
  const scope = useRef({ identity, conversationId, turn, current }); scope.current = { identity, conversationId, turn, current };
  const session = useMemo(() => {
    let storage: Storage | undefined; try { storage = window.sessionStorage; } catch { /* no durable lookup, no start */ }
    return new ConversationOrderExecutionSession(conversationId, aiConversationsApi, () => scope.current.identity === identity
      && scope.current.conversationId === conversationId && scope.current.turn.admissionKey === turn.admissionKey
      && scope.current.turn.task?.taskId === turn.task?.taskId && scope.current.turn.task?.runId === turn.task?.runId
      && !document.hidden && scope.current.current(), storage,
    `ai-conversation-order-start:${identity}:${conversationId}:${turn.admissionKey}`);
  }, [identity, conversationId, turn.admissionKey, turn.task?.taskId, turn.task?.runId]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => { const clear = () => session.retract(); document.addEventListener('visibilitychange', clear);
    return () => { session.retract(); document.removeEventListener('visibilitychange', clear); }; }, [session]);
  const check = () => { if (scope.current.identity !== identity || scope.current.conversationId !== conversationId
    || scope.current.turn.admissionKey !== turn.admissionKey || document.hidden || !scope.current.current()) throw Error('AI_SCOPE_CHANGED'); };
  return <section aria-label={t('原订单解读执行')} aria-busy={state.busy}>
    <p>{t('读取准备不执行。明确启动会调用模型并产生用量，仍由原权限、能力、预算和任务资源限制核验。')}</p>
    <ActionButton label={t(state.locked ? '只读核对原执行' : '读取原执行准备')} disabled={state.busy} onAction={() => {
      check(); return state.locked ? session.reconcile() : session.inspect(scope.current.turn);
    }} />
    {state.ready && <ConfirmAction label={t('明确启动订单解读')} disabled={state.busy}
      prompt={t('启动此原轮次的订单解读模型？可能产生费用，不执行订单或资金写入。')}
      onConfirm={async () => { check(); const key = turn.task ? visible?.begin({ taskId: turn.task.taskId, runId: turn.task.runId,
        trigger: 'original_model_start', originKey: turn.original.inputRef, conversationId, turnId: turn.turnId }) ?? null : null;
        try { await session.start(); if (!session.snapshot().acknowledgement || session.snapshot().feedback === 'unknown') visible?.cancel(key); }
        catch (error) { visible?.cancel(key); throw error; } }} />}
    {state.observation && <p>{t(state.ready ? '已读取待执行的原准备，启动时仍会重新核验。' : '当前原准备不能用于首次启动，不自动恢复或重做。')}</p>}
    {state.acknowledgement && <p role="status">{t('原启动应答已返回；任务、模型与业务结果须独立核对。')}</p>}
    <ConversationOrderResults conversationId={conversationId} turn={turn} current={current} />
    {(state.locked || state.feedback === 'unknown') && <Alert type="warning"
      title={t('原执行待核对或不可用；断线和未观察不证明未消耗，不重新启动。')} />}
  </section>;
}
