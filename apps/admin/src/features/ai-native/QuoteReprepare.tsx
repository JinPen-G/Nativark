/** Original approval stays separate from replacing rejected/expired material.
 * Only server-reviewed quotations are compared; uncertainty reads the original
 * receipt, and the replacement still requires its own approval and execution. */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AiApprovalApplicationReferenceDraft, AiQuoteSelectionProofDraft } from '@rental-os/shared';
import { aiQuoteSelectionsApi } from '@/api/aiQuoteSelections';
import { aiTaskCenterApi } from '@/api/aiTaskCenter';
import { ActionButton, Alert, ConfirmAction, Select } from '@/components/ui';
import { QuoteReprepareSession, readQuoteReprepareOriginal, retainQuoteReprepareOriginal } from './quote-reprepare-session';
import { TaskHumanApproval, TaskOrderMaterialDetails, TaskOrderQuoteAmounts } from './TaskHumanApproval';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp } from './formatters';
import { safeDisplayText } from './safe-display';

export function QuoteReprepare({ selection, identity, current, onAccessDenied }: {
  selection: AiQuoteSelectionProofDraft; identity: string; current: () => boolean; onAccessDenied: () => void;
}) {
  const { t } = useAiManagementLocale(), labelId = useId();
  const owner = JSON.stringify([identity, selection]);
  const key = `ai-quote-reprepare:${identity}:${selection.selectionId}`;
  const storage = useMemo(() => {
    try { return window.sessionStorage; } catch { return undefined; }
  }, [owner]);
  const [reference, setReference] = useState<AiApprovalApplicationReferenceDraft | null>(() => {
    try { return readQuoteReprepareOriginal(storage, `${key}:source`, selection); } catch { return null; }
  });
  const [selected, setSelected] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const scope = useRef({ owner, reference, current, onAccessDenied });
  scope.current = { owner, reference, current, onAccessDenied };
  const active = () => scope.current.owner === owner && !document.hidden && scope.current.current();
  const session = useMemo(() => new QuoteReprepareSession(selection,
    { ...aiQuoteSelectionsApi, list: aiTaskCenterApi.list }, active, () => scope.current.reference, storage, key), [owner]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => {
    const retract = () => { session.retract(); setSelected(null); setMessage(null); };
    document.addEventListener('visibilitychange', retract);
    return () => { document.removeEventListener('visibilitychange', retract); session.retract(); };
  }, [session]);
  const run = async (action: () => Promise<unknown>) => {
    setMessage(null);
    try { return await action(); } catch (error) {
      if (active()) {
        if ([401, 403].includes((error as { response?: { status?: number } }).response?.status ?? 0)) {
          session.retract(); scope.current.onAccessDenied();
        } else setMessage(t(session.snapshot().locked
          ? '重新准备结果待核对，请读取原收据。'
          : '暂时无法重新准备，请核对旧提案状态及新报价。'));
      }
      throw error;
    }
  };
  const preparation = state.preparation, replacement = state.response?.receipt.state === 'prepared' ? state.response.replacement : null;
  return <>
    <TaskHumanApproval taskId={selection.taskId} runId={selection.runId} identity={identity} current={active}
      onAccessDenied={onAccessDenied} onOrderReviewed={value => {
        if (!active() || value.taskId !== selection.taskId || value.runId !== selection.runId) return;
        try {
          const saved = retainQuoteReprepareOriginal(storage, `${key}:source`, selection, value.original);
          scope.current.reference = saved; setReference(saved);
        } catch {
          session.retract(); scope.current.reference = null; setReference(null);
          setMessage(t('原提案定位未能保留，不能重新准备。'));
        }
      }} />
    <section aria-label={t('重新准备报价')} aria-busy={state.busy}>
      <h4>{t('重新准备报价')}</h4>
      <p className="muted">{t('旧提案拒绝或失效后，可选择已准备的新报价重新提交审批。')}</p>
      <div className="panel-toolbar">
        <ActionButton label={t(state.locked ? '核对原重新准备结果' : '读取待审批的新报价')}
          disabled={state.busy || !state.locked && !reference}
          onAction={() => run(state.locked ? session.reconcile : async () => { setSelected(null); await session.list(); })} />
        {!state.locked && state.items.length > 0 && <>
          <label id={labelId}>{t('新报价任务')}</label>
          <Select aria-labelledby={labelId} value={selected} disabled={state.busy}
            options={state.items.map(row => ({ value: row.taskId,
              label: `${formatTimestamp(row.createdAt).value} · ${safeDisplayText(row.taskId, 36)}` }))}
            onChange={(value: unknown) => { setSelected(typeof value === 'string' ? value : null); session.clearPreparation(); }} />
          <ActionButton label={t('核对新旧报价')} disabled={state.busy || !selected}
            onAction={() => run(() => selected ? session.inspect(selected) : Promise.reject(Error('AI_INVALID_INPUT')))} />
        </>}
        {!state.locked && state.nextCursor && <ActionButton label={t('读取下一页新报价')} disabled={state.busy}
          onAction={() => run(async () => { setSelected(null); await session.list(state.nextCursor ?? undefined); })} />}
      </div>
      {!reference && !state.locked && <p className="muted">{t('请先审阅原等待提案，保留这次报价的审批定位。')}</p>}
      {state.listed && !state.items.length && <p>{t('当前没有可选的新报价；请先完成新条件的报价准备。')}</p>}
      {preparation && <>
        <section aria-label={t('旧报价材料')}><h4>{t('旧报价材料')}</h4>
          <TaskOrderMaterialDetails order={preparation.originalReview.deterministic.order} />
          <TaskOrderQuoteAmounts review={preparation.originalReview} /></section>
        <section aria-label={t('新报价材料')}><h4>{t('新报价材料')}</h4>
          <TaskOrderMaterialDetails order={preparation.replacementReview.deterministic.order} />
          <TaskOrderQuoteAmounts review={preparation.replacementReview} /></section>
        <ConfirmAction label={t('按新报价重新准备审批')} disabled={state.busy || !state.ready || state.locked}
          prompt={t('确认客户、租期、履约、服务和金额的变化？原提案保留，新提案仍须重新批准，此步不创建订单。')}
          onConfirm={() => run(session.confirm)} />
      </>}
      {replacement && <>
        <Alert type="success" title={t('新报价已准备，等待重新批准。')}
          description={t('旧批准不会沿用，订单仍需明确批准并继续执行。')} />
        <TaskHumanApproval key={`${owner}:${replacement.selection.runId}`} taskId={replacement.selection.taskId}
          runId={replacement.selection.runId} identity={identity} current={active} onAccessDenied={onAccessDenied} />
      </>}
      {message && <Alert type="warning" title={message} />}
      {state.feedback === 'unknown' && state.locked && <Alert type="warning"
        title={t('原重新准备结果未确认，保留原定位，只读取原收据。')} />}
    </section>
  </>;
}
