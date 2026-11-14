/** Human-selected original Core quotation. Separate original host start,
 * frozen approval and business-result reads retain their server boundaries. */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { validateAiQuoteSelectionHttpValue, type AiConversationTurnObservationDraft } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { aiQuoteSelectionsApi } from '@/api/aiQuoteSelections';
import { ActionButton, Alert, ConfirmAction } from '@/components/ui';
import { ConversationQuoteSelectionSession } from './conversation-quote-selection-session';
import type { ConfirmedQuoteSource } from './conversation-quote-confirmation-session';
import { TaskOrderMaterialDetails } from './TaskHumanApproval';
import { QuoteReprepare } from './QuoteReprepare';
import { OriginalOrderReceiptLink } from './OriginalOrderReceiptLink';
import { useAiManagementLocale } from './management-locale';
import { safeDisplayText } from './safe-display';
import { formatTimestamp } from './formatters';

export function ConversationQuoteSelection({ identity, conversationId, turn, source, current, onAccessDenied }: {
  identity: string; conversationId: string; turn: AiConversationTurnObservationDraft; source: ConfirmedQuoteSource | null;
  current: () => boolean; onAccessDenied: () => void;
}) {
  const { t } = useAiManagementLocale(), owner = JSON.stringify([identity, conversationId, turn]);
  const scope = useRef({ owner, source, current }); scope.current = { owner, source, current };
  const active = () => scope.current.owner === owner && !document.hidden && scope.current.current();
  const session = useMemo(() => {
    let storage: Storage | undefined; try { storage = window.sessionStorage; } catch { /* original locator must survive dispatch */ }
    return new ConversationQuoteSelectionSession(conversationId, turn,
      { ...aiQuoteSelectionsApi, admission: aiConversationsApi.admission }, active, () => scope.current.source, storage,
      `ai-conversation-quote-selection:${identity}:${conversationId}:${turn.admissionKey}`);
  }, [owner]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => { session.retract(); }, [session, JSON.stringify(source)]);
  useEffect(() => { const retract = () => session.retract(); document.addEventListener('visibilitychange', retract);
    return () => { document.removeEventListener('visibilitychange', retract); session.retract(); }; }, [session]);
  const run = async <T,>(action: () => Promise<T>): Promise<T> => {
    try { return await action(); } catch (error) {
      if ([401, 403].includes((error as { response?: { status?: number } }).response?.status ?? 0)) { session.retract(); onAccessDenied(); }
      throw error;
    }
  };
  const receipt = state.receipt, result = state.result;
  const stateLabels = { selected_not_approved: '已保存，待审核', expired: '已过期', superseded: '已被后续选单替代' } as const;
  return <section aria-label={t('原报价选单与开单')} aria-busy={state.busy}>
    <div className="panel-toolbar">
      <ActionButton label={t(state.locked ? '核对原选单收据' : '读取当前选单材料')} disabled={state.busy || !state.locked && !source}
        onAction={() => run(state.locked ? session.reconcile : session.inspect)} />
      {state.ready && <ConfirmAction label={t('选择这张原报价')} disabled={state.busy}
        prompt={t('确认下面的客户、租赁对象、租期、履约和服务，保存这张原报价的选单？此步不批准或创建订单。')}
        onConfirm={() => run(session.select)} />}
    </div>
    {!source && !state.locked && <p className="muted">{t('请先核对原 Core 报价收据，再读取选单材料。')}</p>}
    {state.preparation && <TaskOrderMaterialDetails order={state.preparation.material} />}
    {receipt && <>
      <p>{t('原选单状态')}: {t(stateLabels[receipt.state])} · {t('报价单号')}: {safeDisplayText(receipt.quoteId, 191)}</p>
      <p>{t('报价有效期')}: {formatTimestamp(receipt.expiresAt).value}</p>
      {!state.startRequested && receipt.state === 'selected_not_approved' && <ConfirmAction label={t('启动原选单审核')}
        prompt={t('启动这份已保存选单的原审核任务？仍需核对原提案、明确批准并继续 Core 执行。')}
        disabled={state.busy} onConfirm={() => run(session.start)} />}
      <ActionButton label={t('核对原订单结果')} disabled={state.busy} onAction={() => run(session.readResult)} />
      {state.startRequested && <QuoteReprepare key={`${owner}:${receipt.runId}`} selection={{ draftVersion: receipt.draftVersion,
        originalInputRef: receipt.originalInputRef, selectionId: receipt.selectionId, taskId: receipt.taskId,
        runId: receipt.runId, inputHash: receipt.inputHash }}
        identity={identity} current={active} onAccessDenied={onAccessDenied} />}
    </>}
    {state.run?.kind === 'not_started' && <Alert type="warning" title={t('原宿主未启动本次选单审核，请核对原任务；不自动再次启动。')} />}
    {result && (result.status === 'committed'
      ? <Alert type="success" title={t('原 Core 订单已确认提交')}
          description={`${safeDisplayText(result.order.id, 191)} · ${safeDisplayText(result.order.status, 80)}`} />
      : <Alert type="warning" title={t('原订单结果待核对，未观察到不代表未创建；不会重新开单。')} />)}
    {result?.status === 'committed' && <>
      <p className="muted">{t('订单收据不代表付款或履约已完成。')}</p>
      <OriginalOrderReceiptLink key={`${owner}:${result.order.id}`} orderId={result.order.id} identity={identity}
        current={active} onAccessDenied={onAccessDenied} readOriginal={async signal => {
          if (!receipt || signal.aborted || !active()) return null;
          const selection = { draftVersion: receipt.draftVersion, originalInputRef: receipt.originalInputRef,
            selectionId: receipt.selectionId, taskId: receipt.taskId, runId: receipt.runId, inputHash: receipt.inputHash };
          // Read without clearing the displayed result: clearing it would
          // unmount this navigation request before the same receipt returns.
          const original = await run(() => aiQuoteSelectionsApi.result({ selection }, signal));
          if (!validateAiQuoteSelectionHttpValue('AiSelectedQuoteTaskResultDraft', original)
            || original.status === 'committed' && (original.order.quoteId !== receipt.quoteId
              || original.source.resourceId !== original.order.id)) throw Error('AI_RESULT_UNKNOWN');
          return !signal.aborted && active() && original.status === 'committed' ? original.order.id : null;
        }} />
    </>}
    {state.feedback === 'unknown' && <Alert type="warning" title={t('原选单或执行应答待核对。保留原定位，只读取原收据，不换键重发。')} />}
  </section>;
}
