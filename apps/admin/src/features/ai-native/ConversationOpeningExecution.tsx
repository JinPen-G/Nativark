/** Opening diagnosis uses the original model host and read-only task results.
 * Starting is explicit; it cannot save/publish configuration or grant approval.
 * A retained start marker permits observation, never a second dispatch. */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { AiConversationTurnObservationDraft } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { ActionButton, Alert, ConfirmAction } from '@/components/ui';
import { ConversationOpeningExecutionSession } from './conversation-opening-execution-session';
import { ConversationResult } from './ConversationResult';
import { useVisibleObservationHost } from './VisibleObservationHost';
import { useAiManagementLocale } from './management-locale';

export function ConversationOpeningExecution({ identity, conversationId, turn, current, showResult = true }: {
  identity: string; conversationId: string; turn: AiConversationTurnObservationDraft; current: () => boolean; showResult?: boolean;
}) {
  const visible = useVisibleObservationHost();
  const { t } = useAiManagementLocale();
  const owner = JSON.stringify([identity, conversationId, turn]), scope = useRef({ owner, current }); scope.current = { owner, current };
  const session = useMemo(() => {
    let storage: Storage | undefined; try { storage = window.sessionStorage; } catch { /* no durable original reference means no start */ }
    return new ConversationOpeningExecutionSession(conversationId, aiConversationsApi,
      () => scope.current.owner === owner && !document.hidden && scope.current.current(), storage,
      `ai-conversation-opening-start:${identity}:${conversationId}:${turn.admissionKey}`);
  }, [owner]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => {
    const clear = () => session.retract(); document.addEventListener('visibilitychange', clear);
    return () => { session.retract(); document.removeEventListener('visibilitychange', clear); };
  }, [session]);
  return <section aria-label={t('开业诊断执行')} aria-busy={state.busy}>
    <p>{t('诊断读取所选分区并调用模型，产生用量；保存或发布配置须另行确认。')}</p>
    <ActionButton label={t(state.locked ? '核对原开业诊断' : '读取开业诊断准备')} disabled={state.busy}
      onAction={() => state.locked ? session.reconcile() : session.inspect(turn)} />
    {state.ready && <ConfirmAction label={t('启动开业诊断')} disabled={state.busy}
      prompt={t('启动此原任务的开业诊断？可能产生模型费用，不修改或发布配置。')} onConfirm={async () => { const key = turn.task ? visible?.begin({ taskId: turn.task.taskId, runId: turn.task.runId,
        trigger: 'original_model_start', originKey: turn.original.inputRef, conversationId, turnId: turn.turnId }) ?? null : null;
        try { await session.start(); if (!session.snapshot().acknowledgement || session.snapshot().feedback === 'unknown') visible?.cancel(key); }
        catch (error) { visible?.cancel(key); throw error; } }} />}
    {state.acknowledgement && <p role="status">{t('诊断启动已返回，结果请从原任务读取。')}</p>}
    {state.feedback === 'unknown' && <Alert type="warning" title={t('开业诊断待核对，请读取原结果；不会自动重新调用模型。')} />}
    {showResult && <ConversationResult conversationId={conversationId} turn={turn} current={() => scope.current.owner === owner && scope.current.current()} />}
  </section>;
}
