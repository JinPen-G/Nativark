import { TaskReadPolicy } from './TaskReadPolicy';
/** Reauthorized turn locators, original execution preparation and model text.
 * Reading or reopening never starts a Task/model. An explicit start reuses the
 * admitted Task/Run; erased input cannot restore execution or displayed text. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AI_CONVERSATION_DRAFT_VERSION, type AiSceneCode, type AiConversationTurnObservationDraft } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { ActionButton, Alert, ConfirmAction } from '@/components/ui';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp } from './formatters';
import { safeDisplayText } from './safe-display';
import { VisibleObservationHost } from './VisibleObservationHost';
import { useVisibleObservationHost } from './VisibleObservationHost';
import { ConversationResult } from './ConversationResult';
import { ConversationAdmission } from './ConversationAdmission';
import { ConversationOrderExecution } from './ConversationOrderExecution';
import { ConversationOpeningExecution } from './ConversationOpeningExecution';
import { ConversationSceneExecutionSession } from './conversation-opening-execution-session';
import { ConversationQuoteConfirmation } from './ConversationQuoteConfirmation';
import { ConversationQuoteSelection } from './ConversationQuoteSelection';
import type { QuoteAnswerReference, ConfirmedQuoteSource } from './conversation-quote-confirmation-session';
import { ReadinessDiagnosticsCard } from './ReadinessDiagnosticsCard';
import { TaskCancellation } from './TaskCancellation';
import styles from './AiManagement.module.css';

type Detail = Awaited<ReturnType<typeof aiConversationsApi.detail>>;
export function ConversationDetail({ conversationId, capabilityCode, current, identity }: {
  conversationId: string; capabilityCode: AiSceneCode; current: () => boolean; identity: string;
}) {
  const { t } = useAiManagementLocale();
  const [detail, setDetail] = useState<Detail | null>(null), [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const [resultEpochs, setResultEpochs] = useState<Record<string, number>>({});
  const request = useRef<AbortController | null>(null), generation = useRef(0);
  const retainedDetail = useRef<Detail | null>(null);
  const renderGeneration = generation.current;
  const scope = useRef({ identity, conversationId, capabilityCode, current }); scope.current = { identity, conversationId, capabilityCode, current };
  useEffect(() => {
    const clear = () => { generation.current++; request.current?.abort(); request.current = null; retainedDetail.current = null;
      setDetail(null); setBusy(false); setError(false); setResultEpochs({}); };
    clear(); document.addEventListener('visibilitychange', clear);
    return () => { generation.current++; request.current?.abort(); request.current = null; document.removeEventListener('visibilitychange', clear); };
  }, [identity, conversationId, capabilityCode]);
  const read = async (beforeId?: string) => {
    if (request.current || document.hidden || !scope.current.current() || scope.current.identity !== identity || scope.current.conversationId !== conversationId
      || scope.current.capabilityCode !== capabilityCode) throw Error('AI_SCOPE_CHANGED');
    const owner = ++generation.current, controller = new AbortController(); request.current = controller;
    retainedDetail.current = null; setDetail(null); setError(false); setBusy(true);
    const active = () => owner === generation.current && !controller.signal.aborted && !document.hidden && scope.current.identity === identity
      && scope.current.conversationId === conversationId && scope.current.capabilityCode === capabilityCode && scope.current.current();
    try {
      const value = await aiConversationsApi.detail({ draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId, limit: 20,
        ...(beforeId ? { beforeId } : {}) }, capabilityCode, controller.signal);
      if (!active()) throw Error('AI_SCOPE_CHANGED');
      retainedDetail.current = value; setDetail(value);
    } catch (failure) { if (active()) setError(true); throw failure; }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  const detailCurrent = () => renderGeneration === generation.current && retainedDetail.current === detail && detail !== null
    && !document.hidden && scope.current.identity === identity && scope.current.conversationId === conversationId
    && scope.current.capabilityCode === capabilityCode && scope.current.current();
  const deny = () => { generation.current++; request.current?.abort(); request.current = null; retainedDetail.current = null;
    setDetail(null); setBusy(false); setError(true); setResultEpochs({}); };
  return <VisibleObservationHost surface="server_conversation" conversationId={conversationId} scopeKey={generation.current} current={current}><section className={styles.section} aria-label={t('对话原轮次')} aria-busy={busy}>
    <h3>{t('对话原轮次')}</h3>
    <p className={styles.help}>{safeDisplayText(conversationId, 191)}</p>
    <div className={styles.toolbar}>
      <ActionButton label={t(detail ? '重读轮次首页' : '读取原轮次')} disabled={busy} onAction={() => read()} />
      {detail?.turns.nextBeforeId && <ActionButton label={t('更早轮次')} disabled={busy} onAction={() => read(detail.turns.nextBeforeId!)} />}
    </div>
    {['order_explanation', 'opening_diagnosis', 'quote_clarification'].includes(capabilityCode) && <ConversationAdmission conversationId={conversationId} identity={identity} capabilityCode={capabilityCode}
      observation={detail?.conversation ?? null} current={() => !document.hidden && scope.current.conversationId === conversationId
        && scope.current.capabilityCode === capabilityCode && scope.current.current()} onChanged={() => {
          generation.current++; request.current?.abort(); request.current = null; retainedDetail.current = null;
          setDetail(null); setBusy(false); setError(false);
        }} />}
    {error && <Alert type="warning" title={t('对话详情当前不可读取，旧内容已清除，请核对权限与版本。')} />}
    {detail && <>
      <p className={styles.help}>{t('本页为独立复验的原轮次定位，不是完整对话、执行结果或原子快照。')}</p>
      <dl className={styles.facts}>
        <div><dt>{t('对话修订')}</dt><dd>{detail.conversation.revision}</dd></div>
        <div><dt>{t('当前轮次')}</dt><dd>{detail.conversation.currentTurn?.turnId ?? t('无当前轮次，不代表无历史任务。')}</dd></div>
      </dl>
      {detail.conversation.currentTurn?.task && <TaskCancellation
        key={`cancel:${identity}:${detail.conversation.currentTurn.task.taskId}`}
        taskId={detail.conversation.currentTurn.task.taskId} identity={identity}
        current={detailCurrent} onAccessDenied={deny} />}
      {!detail.turns.items.length && <p>{t('本页没有轮次，不推断模型未调用或任务未执行。')}</p>}
      <ol className={styles.timeline}>{detail.turns.items.map(turn => <li key={turn.turnId}>
        <div><strong>{safeDisplayText(turn.turnId, 191)}</strong><p className={styles.help}>{t('原请求')}: {safeDisplayText(turn.original.inputRef, 191)}</p></div>
        <span>{'creation' in turn ? t('原请求创建入口已关闭，未创建任务。') : turn.task ? t('原任务已关联，执行结果另行读取。') : t('原请求已受理，未观察到任务关联。')}
          <p className={styles.help}>{turn.material === 'erased' ? t('原输入已清理，不恢复正文或执行权限。') : t('原输入保留，正文须独立受权读取。')}</p>
          {turn.task && <p className={styles.help}>{t('原任务')}: {safeDisplayText(turn.task.taskId, 191)}</p>}
        </span>
        <time dateTime={turn.createdAt}>{formatTimestamp(turn.createdAt).value}</time>
      </li>)}</ol>
      {detail.turns.items.map(turn => turn.capabilityCode === 'quote_clarification' && turn.material === 'retained' && turn.task && !('creation' in turn)
        ? <ConversationQuoteTurn key={`${identity}:${conversationId}:${capabilityCode}:${turn.turnId}:${resultEpochs[turn.turnId] ?? 0}`}
          identity={identity} conversationId={conversationId} turn={turn} current={detailCurrent} onAccessDenied={deny} />
        : <ConversationResult key={`${identity}:${conversationId}:${capabilityCode}:${turn.turnId}:${resultEpochs[turn.turnId] ?? 0}`}
          identity={identity} conversationId={conversationId} turn={turn} current={detailCurrent} onAccessDenied={deny} />)}
      {detail.turns.items.filter(turn => turn.capabilityCode === capabilityCode
        && ['order_explanation', 'opening_diagnosis', 'quote_clarification'].includes(turn.capabilityCode)
        && turn.material === 'retained' && turn.task && !('creation' in turn))
        .map(turn => <TaskReadPolicy key={`read-policy:${identity}:${turn.turnId}`} query={{ taskId: turn.task!.taskId, runId: turn.task!.runId }} identity={identity}
          onAccessChanged={() => setResultEpochs(previous => ({ ...previous, [turn.turnId]: (previous[turn.turnId] ?? 0) + 1 }))}
          current={detailCurrent} />)}
      {detail.turns.items.filter(turn => capabilityCode === 'opening_diagnosis' && turn.capabilityCode === capabilityCode
        && turn.material === 'retained' && turn.task && !('creation' in turn)).map(turn =>
        <ReadinessDiagnosticsCard key={`diagnostics:${identity}:${turn.turnId}`} conversationId={conversationId} turn={turn}
          current={detailCurrent}
          onUnavailable={() => setResultEpochs(previous => ({ ...previous, [turn.turnId]: (previous[turn.turnId] ?? 0) + 1 }))} />)}
      {detail.turns.items.filter(turn => capabilityCode === 'order_explanation' && turn.capabilityCode === capabilityCode && turn.material === 'retained'
        && turn.task && !('creation' in turn)).map(turn => <ConversationOrderExecution key={`execution:${turn.turnId}`}
        identity={identity} conversationId={conversationId} turn={turn}
        current={detailCurrent} />)}
      {detail.turns.items.filter(turn => capabilityCode === 'opening_diagnosis' && turn.capabilityCode === capabilityCode && turn.material === 'retained'
        && turn.task && !('creation' in turn)).map(turn => <ConversationOpeningExecution key={`opening:${turn.turnId}`}
        identity={identity} conversationId={conversationId} turn={turn} showResult={false}
        current={detailCurrent} />)}
    </>}
  </section></VisibleObservationHost>;
}

/** One answer form serves candidate adoption and the original Core quote flow.
 * Starting, saving a quote and selecting it still use their existing sessions;
 * replacing the displayed model result never creates another admission. */
function ConversationQuoteTurn({ identity, conversationId, turn, current, onAccessDenied }: {
  identity: string; conversationId: string; turn: AiConversationTurnObservationDraft; current(): boolean; onAccessDenied(): void;
}) {
  const { t } = useAiManagementLocale(), visible = useVisibleObservationHost();
  const owner = JSON.stringify([identity, conversationId, turn]);
  const scope = useRef({ owner, current, onAccessDenied }); scope.current = { owner, current, onAccessDenied };
  const [answer, setAnswer] = useState<QuoteAnswerReference | null>(null);
  const [quoteSource, setQuoteSource] = useState<ConfirmedQuoteSource | null>(null);
  const active = () => scope.current.owner === owner && !document.hidden && scope.current.current();
  const session = useMemo(() => {
    let storage: Storage | undefined; try { storage = window.sessionStorage; } catch { /* No journal means no first start. */ }
    return new ConversationSceneExecutionSession(conversationId, aiConversationsApi, active, storage,
      `ai-conversation-quote-start:${identity}:${conversationId}:${turn.admissionKey}`, undefined, 'quote_clarification');
  }, [owner]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => { setAnswer(null); setQuoteSource(null); }, [owner]);
  useEffect(() => {
    const clear = () => { session.retract(); setAnswer(null); setQuoteSource(null); };
    document.addEventListener('visibilitychange', clear);
    return () => { session.retract(); document.removeEventListener('visibilitychange', clear); };
  }, [session]);
  const deny = () => { session.retract(); setAnswer(null); setQuoteSource(null); scope.current.onAccessDenied(); };
  const run = async (operation: () => Promise<unknown>) => {
    if (!active()) throw Error('AI_SCOPE_CHANGED');
    try { return await operation(); } catch (error) {
      if ([401, 403].includes((error as { response?: { status?: number } }).response?.status ?? 0) && active()) deny();
      throw error;
    }
  };
  if (!active()) return null;
  return <section aria-label={t('报价任务')} aria-busy={state.busy}>
    <ActionButton label={t(state.locked ? '核对原报价执行' : '读取报价准备')} disabled={state.busy}
      onAction={() => run(state.locked ? session.reconcile : () => session.inspect(turn))} />
    {state.ready && <ConfirmAction label={t('启动报价澄清')} disabled={state.busy}
      prompt={t('启动此原报价任务？可能产生模型费用，不批准建单或支付。')} onConfirm={() => run(async () => {
        const key = turn.task ? visible?.begin({ taskId: turn.task.taskId, runId: turn.task.runId,
          trigger: 'original_model_start', originKey: turn.original.inputRef, conversationId, turnId: turn.turnId }) ?? null : null;
        try { await session.start(); if (!session.snapshot().acknowledgement || session.snapshot().feedback === 'unknown') visible?.cancel(key); }
        catch (error) { visible?.cancel(key); throw error; }
      })} />}
    {state.feedback === 'unknown' && <Alert type="warning" title={t('原报价执行待核对，请读取原结果；不会自动重新调用模型。')} />}
    <ConversationResult identity={identity} conversationId={conversationId} turn={turn} current={active}
      onAccessDenied={deny} onAnswerReceipt={setAnswer} />
    <ConversationQuoteConfirmation identity={identity} conversationId={conversationId} turn={turn} answer={answer}
      current={active} onAccessDenied={deny} onQuoteSource={setQuoteSource} />
    <ConversationQuoteSelection identity={identity} conversationId={conversationId} turn={turn} source={quoteSource}
      current={active} onAccessDenied={deny} />
  </section>;
}
