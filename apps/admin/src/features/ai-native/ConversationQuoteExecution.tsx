/** Explicit original quote-model start, followed by original human input and
 * approval readers. Candidate conditions are never Core prices or approval. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AiConversationTurnObservationDraft } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { ActionButton, Alert, ConfirmAction } from '@/components/ui';
import { ConversationSceneExecutionSession } from './conversation-opening-execution-session';
import { ConversationResult } from './ConversationResult';
import { TaskClarification } from './TaskClarification';
import { ConversationQuoteConfirmation } from './ConversationQuoteConfirmation';
import { ConversationQuoteSelection } from './ConversationQuoteSelection';
import type { QuoteAnswerReference, ConfirmedQuoteSource } from './conversation-quote-confirmation-session';
import { useAiManagementLocale } from './management-locale';

export function ConversationQuoteExecution({ identity, conversationId, turn, current, showResult = true, onAccessDenied }: {
  identity: string; conversationId: string; turn: AiConversationTurnObservationDraft; current: () => boolean; showResult?: boolean; onAccessDenied?: () => void;
}) {
  const { t } = useAiManagementLocale(), owner = JSON.stringify([identity, conversationId, turn]);
  const [denied, setDenied] = useState(false), denial = useRef(false);
  const [answer, setAnswer] = useState<QuoteAnswerReference | null>(null);
  const [quoteSource, setQuoteSource] = useState<ConfirmedQuoteSource | null>(null);
  const scope = useRef({ owner, current, onAccessDenied }); scope.current = { owner, current, onAccessDenied };
  const active = () => !denial.current && scope.current.owner === owner && !document.hidden && scope.current.current();
  const session = useMemo(() => {
    let storage: Storage | undefined; try { storage = window.sessionStorage; } catch { /* no reliable original reference means no start */ }
    return new ConversationSceneExecutionSession(conversationId, aiConversationsApi, active, storage,
      `ai-conversation-quote-start:${identity}:${conversationId}:${turn.admissionKey}`, undefined, 'quote_clarification');
  }, [owner]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => { setAnswer(null); setQuoteSource(null); }, [owner]);
  useEffect(() => { const clear = () => session.retract(); document.addEventListener('visibilitychange', clear);
    return () => { session.retract(); document.removeEventListener('visibilitychange', clear); }; }, [session]);
  const deny = () => { denial.current = true; setDenied(true); session.retract(); scope.current.onAccessDenied?.(); };
  return <section aria-label={t('报价任务')} aria-busy={state.busy}>
    <p>{t('模型用于整理和澄清条件，价格及业务动作仍走原 Core 和确认流程。')}</p>
    <ActionButton label={t(state.locked ? '核对原报价执行' : '读取报价准备')} disabled={state.busy}
      onAction={() => state.locked ? session.reconcile() : session.inspect(turn)} />
    {state.ready && <ConfirmAction label={t('启动报价澄清')} disabled={state.busy}
      prompt={t('启动此原报价任务？可能产生模型费用，不批准建单或支付。')} onConfirm={session.start} />}
    {state.feedback === 'unknown' && <Alert type="warning" title={t('原报价执行待核对，请读取原结果；不会自动重新调用模型。')} />}
    {denied && <Alert type="warning" title={t('无权限查看 AI 任务')} />}
    {!denied && showResult && <ConversationResult conversationId={conversationId} turn={turn} current={active} />}
    {!denied && turn.task && <><TaskClarification key={`${identity}:${turn.task.taskId}`} taskId={turn.task.taskId} identity={identity} current={active} onAccessDenied={deny} onReceiptChange={setAnswer} />
      <ConversationQuoteConfirmation identity={identity} conversationId={conversationId} turn={turn} answer={answer} current={active} onAccessDenied={deny} onQuoteSource={setQuoteSource} />
      <ConversationQuoteSelection identity={identity} conversationId={conversationId} turn={turn} source={quoteSource} current={active} onAccessDenied={deny} /></>}
  </section>;
}
