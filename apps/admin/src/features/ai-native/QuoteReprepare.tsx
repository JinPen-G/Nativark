/** Original approval stays separate from replacing rejected/expired material.
 * Only server-reviewed quotations are compared; uncertainty reads the original
 * receipt, and the replacement still requires its own approval and execution. */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AiApprovalApplicationReferenceDraft, AiQuoteSelectionProofDraft } from '@rental-os/shared';
import { aiQuoteSelectionsApi } from '@/api/aiQuoteSelections';
import { aiTaskCenterApi } from '@/api/aiTaskCenter';
import { ActionButton, Alert, ConfirmAction, Select } from '@/components/ui';
import { QuoteReprepareSession, QuoteRequestReissueSession, readQuoteReprepareOriginal, retainQuoteReprepareOriginal } from './quote-reprepare-session';
import { TaskHumanApproval, TaskOrderMaterialDetails, TaskOrderQuoteAmounts } from './TaskHumanApproval';
import { useAiManagementLocale } from './management-locale';
import { formatTimestamp, formatAmount } from './formatters';
import { safeDisplayText } from './safe-display';
import { QuoteCandidateFields } from './QuoteCandidateFields';
import { useAuthStore } from '@/features/auth/authStore';
import { currentSessionEpoch } from '@/app/queryClient';

export function QuoteReprepare({ selection, identity, current, onAccessDenied }: {
  selection: AiQuoteSelectionProofDraft; identity: string; current: () => boolean; onAccessDenied: () => void;
}) {
  const { t } = useAiManagementLocale(), labelId = useId(), auth = useAuthStore();
  const epoch = currentSessionEpoch(), owner = JSON.stringify([identity, selection, auth.user, auth.currentWorkspaceId, epoch]);
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
  const active = () => scope.current.owner === owner && epoch === currentSessionEpoch() && !document.hidden && scope.current.current();
  const session = useMemo(() => new QuoteReprepareSession(selection,
    { ...aiQuoteSelectionsApi, list: aiTaskCenterApi.list }, active, () => scope.current.reference, storage, key), [owner]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const materials = useMemo(() => new QuoteRequestReissueSession(selection, aiQuoteSelectionsApi, active,
    () => scope.current.reference, { tenantId: auth.tenant?.tenantId ?? '', workspaceId: auth.currentWorkspaceId ?? '' }, storage,
    `ai-quote-linked-request:${JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id, selection.selectionId])}`), [owner]);
  const materialState = useSyncExternalStore(materials.subscribe, materials.snapshot, materials.snapshot);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => { materials.activate(); return () => materials.dispose(); }, [materials]);
  useEffect(() => {
    const retract = () => { session.retract(); materials.retract(); setSelected(null); setMessage(null); };
    document.addEventListener('visibilitychange', retract);
    return () => { document.removeEventListener('visibilitychange', retract); session.retract(); materials.retract(); };
  }, [session, materials]);
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
  const conditions = materialState.preparation?.preparation, quoteConditions = materialState.quoteReview?.facts;
  const quote = materialState.quote?.result.quote, newSelection = materials.selectionProof();
  const canCreate = auth.hasPermission('rental-os:order:create'), busy = state.busy || materialState.busy;
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
      <section aria-label={t('按新条件准备报价')} aria-busy={materialState.busy}>
        <div className="panel-toolbar">
          {materialState.phase ? <ActionButton label={t('核对原新材料操作')} disabled={busy || materialState.invalid}
            onAction={() => run(materials.reconcile)} /> : <ActionButton label={t('输入新的租赁条件')}
            disabled={busy || state.locked || !reference || !canCreate || materialState.invalid} onAction={() => run(materials.prepareConditions)} />}
        </div>
        {materialState.invalid && <Alert type="warning" title={t('原新材料定位不可读取，不能重新发起。')} />}
        {materialState.candidate && !materialState.phase && <>
          <QuoteCandidateFields value={materialState.candidate} preparation={conditions} disabled={busy || state.locked || !canCreate}
            onChange={value => materials.editConditions(value)} />
          <ActionButton label={t('核对新租赁条件')} disabled={busy || state.locked || !canCreate} onAction={() => run(materials.inspectConditions)} />
        </>}
        {conditions && !materialState.phase && <>
          {'request' in conditions && <p>{formatTimestamp(conditions.request.startAt).value} → {formatTimestamp(conditions.request.endAt).value}
            {' · '}{t(conditions.request.fulfillmentMode)}{' · '}{t('商品行数')}: {conditions.request.lines.length}</p>}
          {conditions.status === 'ready' ? <ConfirmAction label={t('保存关联的新请求')} disabled={busy || state.locked || !canCreate}
            prompt={t('按已核对的客户、商品、租期和履约条件保存关联的新请求？Core 报价、选单和新批准仍需分别确认。')}
            onConfirm={() => run(materials.createRequest)} /> : <Alert type="warning" title={t('新条件尚未齐备，请完成当前 Core 候选选择或补充信息。')} />}
        </>}
        {materialState.operation?.status === 'linked_request_recorded' && materialState.phase === 'request' && <>
          <p role="status">{t('关联新请求已记录，继续核对这份请求的 Core 报价。')}</p>
          <ActionButton label={t('读取新请求的报价条件')} disabled={busy || state.locked || materialState.unknown}
            onAction={() => run(materials.inspectQuote)} />
          {quoteConditions && <>
            {'request' in quoteConditions && <p>{formatTimestamp(quoteConditions.request.startAt).value} → {formatTimestamp(quoteConditions.request.endAt).value}
              {' · '}{t(quoteConditions.request.fulfillmentMode)}{' · '}{t('商品行数')}: {quoteConditions.request.lines.length}</p>}
            {quoteConditions.status === 'ready' ? <ConfirmAction label={t('核价并保存新报价')} disabled={busy || state.locked || !canCreate}
              prompt={t('确认当前租赁条件，请求 Core 核价并保存这张新报价？此步不批准或创建订单。')}
              onConfirm={() => run(materials.confirmQuote)} /> : <Alert type="warning" title={t('当前新请求的报价条件已变化或未齐备，请按原业务流程处理。')} />}
          </>}
        </>}
        {quote && <dl>
          <dt>{t('新报价单号')}</dt><dd>{safeDisplayText(quote.quoteNo, 191)}</dd>
          <dt>{t('应付金额')}</dt><dd>{formatAmount(quote.payableAmount, quote.currency).value} {safeDisplayText(quote.currency, 3)}</dd>
          <dt>{t('应收金额')}</dt><dd>{formatAmount(quote.receivableAmount, quote.currency).value} {safeDisplayText(quote.currency, 3)}</dd>
          <dt>{t('报价有效期')}</dt><dd>{formatTimestamp(quote.expiresAt).value}</dd>
        </dl>}
        {materialState.phase === 'quote' && quote && <ActionButton label={t('读取新报价选单')}
          disabled={busy || state.locked || materialState.unknown || materialState.quote?.result.status !== 'quoted'} onAction={() => run(materials.inspectSelection)} />}
        {materialState.selectionPreparation && <>
          <TaskOrderMaterialDetails order={materialState.selectionPreparation.material} />
          <ConfirmAction label={t('明确选择新报价')} disabled={busy || state.locked || !canCreate || materialState.unknown}
            prompt={t('确认这张新报价的客户、商品、租期、履约和金额，保存原选单？仍需对比新旧材料并取得新批准。')}
            onConfirm={() => run(materials.selectQuote)} />
        </>}
        {materialState.phase === 'selection' && newSelection && <ConfirmAction label={t('准备新报价提案')}
          disabled={busy || state.locked || !canCreate || materialState.unknown || materialState.operation?.status !== 'linked_request_recorded'
            || materialState.operation.admission !== 'current_policies_available'}
          prompt={t('启动这份新选单的原提案准备？随后核对新旧材料并重新批准，不沿用旧批准。')}
          onConfirm={() => run(materials.startSelection)} />}
        {materialState.phase === 'start' && newSelection && <ActionButton label={t('核对这份新旧报价')} disabled={busy || state.locked}
          onAction={() => run(async () => { await session.inspectLinked(newSelection);
            const compared = session.snapshot().preparation?.replacement; if (compared) materials.acknowledgePrepared(compared); })} />}
        {materialState.unknown && <Alert type="warning" title={t('原新材料操作待核对，只读取原收据；不重新发起请求、报价或选单。')} />}
        {materialState.operation?.status === 'not_observed' && <p>{t('未观察到原新请求，不证明没有提交；保留原定位继续核对。')}</p>}
        {materialState.operation?.status === 'linked_request_recorded' && materialState.operation.admission === 'unavailable'
          && <p>{t('当前新任务尚不可启动，仍可核对已记录的原操作。')}</p>}
      </section>
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
      {state.listed && !state.items.length && <p>{t('当前没有可选的新报价，可在上方输入并准备新的租赁条件。')}</p>}
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
