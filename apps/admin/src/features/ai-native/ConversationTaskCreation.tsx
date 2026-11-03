/** One explicit original-turn metadata action. Mounting and recovery never start
 * a Task or model; hidden/scope-changed reads retract their displayed result. */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { AiConversationTurnObservationDraft } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { ActionButton, Alert, ConfirmAction } from '@/components/ui';
import { ConversationTaskCreationSession } from './conversation-task-creation-session';
import { ConversationOrderExecution } from './ConversationOrderExecution';
import { useAiManagementLocale } from './management-locale';
import { safeDisplayText } from './safe-display';

export function ConversationTaskCreation({ identity, conversationId, turn, current, onChanged }: {
  identity: string; conversationId: string; turn: AiConversationTurnObservationDraft; current: () => boolean; onChanged: () => void;
}) {
  const { t } = useAiManagementLocale();
  const scope = useRef({ identity, conversationId, turn, current, onChanged }); scope.current = { identity, conversationId, turn, current, onChanged };
  const session = useMemo(() => {
    let storage: Storage | undefined; try { storage = window.sessionStorage; } catch { /* no durable locator, no create */ }
    return new ConversationTaskCreationSession(conversationId, aiConversationsApi, () => scope.current.identity === identity
      && scope.current.conversationId === conversationId && scope.current.turn.admissionKey === turn.admissionKey
      && scope.current.turn.capabilityCode === turn.capabilityCode && scope.current.turn.capabilityVersion === turn.capabilityVersion
      && !document.hidden && scope.current.current(), storage,
    `ai-conversation-task-creation:${identity}:${conversationId}:${turn.admissionKey}`);
  }, [identity, conversationId, turn.admissionKey, turn.capabilityCode, turn.capabilityVersion]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => { const clear = () => session.retract(); document.addEventListener('visibilitychange', clear);
    return () => { session.retract(); document.removeEventListener('visibilitychange', clear); }; }, [session]);
  const run = async (create: boolean) => {
    if (scope.current.identity !== identity || scope.current.conversationId !== conversationId
      || scope.current.turn.admissionKey !== turn.admissionKey || scope.current.turn.capabilityCode !== turn.capabilityCode
      || scope.current.turn.capabilityVersion !== turn.capabilityVersion || document.hidden || !scope.current.current()) throw Error('AI_SCOPE_CHANGED');
    const value = await (create ? session.create(scope.current.turn) : session.reconcile());
    if (scope.current.identity === identity && scope.current.conversationId === conversationId
      && scope.current.turn.admissionKey === turn.admissionKey && scope.current.turn.capabilityCode === turn.capabilityCode
      && scope.current.turn.capabilityVersion === turn.capabilityVersion && !document.hidden && scope.current.current()) scope.current.onChanged();
    return value;
  };
  const canCreate = ['order_explanation', 'opening_diagnosis'].includes(turn.capabilityCode) && turn.material === 'retained' && !turn.task && !('creation' in turn);
  return <section aria-label={t('原轮次任务创建')} aria-busy={state.busy}>
    <p>{t('只创建原请求的任务元数据，不启动计划、模型或业务；后续执行须另行明确操作。')}</p>
    {!state.locked && <ConfirmAction label={t('明确创建原任务')} disabled={state.busy || !canCreate}
      prompt={t('为此原轮次创建任务元数据？本次不会调用模型或执行业务。')} onConfirm={() => run(true)} />}
    {state.locked && <ActionButton label={t('核对原任务创建')} disabled={state.busy} onAction={() => run(false)} />}
    {state.feedback === 'unknown' && <Alert type="warning" title={t('原任务创建待核对；未观察到任务不证明未创建，不重发创建请求。')} />}
    {turn.capabilityCode === 'order_explanation' && state.recovery?.task.state === 'observed' && <ConversationOrderExecution identity={identity} conversationId={conversationId}
      turn={{ ...turn, task: { taskId: state.recovery.task.taskId, runId: state.recovery.task.runId } }} current={current} />}
    {state.recovery?.task.state === 'observed' && <p role="status">{t('已观察原任务元数据，不代表模型或业务已执行。')}
      {' '}{safeDisplayText(state.recovery.task.taskId, 191)}</p>}
  </section>;
}
