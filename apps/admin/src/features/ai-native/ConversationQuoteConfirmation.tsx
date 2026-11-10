/** Human review of the current guarded Core parameters, then one explicit quote
 * request. All amounts/versions come from the original Core receipt. */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { AiConversationTurnObservationDraft } from '@rental-os/shared';
import { aiConversationsApi } from '@/api/aiConversations';
import { ActionButton, Alert, ConfirmAction } from '@/components/ui';
import { ConversationQuoteConfirmationSession, type QuoteAnswerReference, type ConfirmedQuoteSource } from './conversation-quote-confirmation-session';
import { useAiManagementLocale } from './management-locale';
import { safeDisplayText } from './safe-display';
import { formatAmount, formatTimestamp } from './formatters';

export function ConversationQuoteConfirmation({ identity, conversationId, turn, answer, current, onAccessDenied, onQuoteSource }: {
  identity: string; conversationId: string; turn: AiConversationTurnObservationDraft; answer: QuoteAnswerReference | null;
  current: () => boolean; onAccessDenied: () => void; onQuoteSource?: (source: ConfirmedQuoteSource | null) => void;
}) {
  const { t } = useAiManagementLocale(), owner = JSON.stringify([identity, conversationId, turn]);
  const scope = useRef({ owner, answer, current }); scope.current = { owner, answer, current };
  const session = useMemo(() => {
    let storage: Storage | undefined; try { storage = window.sessionStorage; } catch { /* no original journal means no execution */ }
    return new ConversationQuoteConfirmationSession(conversationId, turn, aiConversationsApi,
      () => scope.current.owner === owner && !document.hidden && scope.current.current(), () => scope.current.answer, storage,
      `ai-conversation-core-quote:${identity}:${conversationId}:${turn.admissionKey}`);
  }, [owner]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { onQuoteSource?.(state.source); return () => onQuoteSource?.(null); }, [state.source, onQuoteSource]);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  useEffect(() => { session.retract(); }, [session, JSON.stringify(answer)]);
  useEffect(() => { const clear = () => session.retract(); document.addEventListener('visibilitychange', clear);
    return () => { document.removeEventListener('visibilitychange', clear); session.retract(); }; }, [session]);
  const run = async (action: () => Promise<unknown>) => {
    try { return await action(); } catch (error) {
      if ([401, 403].includes((error as { response?: { status?: number } }).response?.status ?? 0)) { session.retract(); onAccessDenied(); }
      throw error;
    }
  };
  const p = state.preparation?.preparation, result = state.result, quote = result?.quote;
  return <section aria-label={t('Core 报价确认')} style={{ overflowWrap: 'anywhere' }} aria-busy={state.busy}>
    <div className="panel-toolbar">
      <ActionButton label={t(state.locked ? '核对原 Core 报价收据' : '读取当前报价条件')} disabled={state.busy || !state.locked && !answer}
        onAction={() => run(state.locked ? session.reconcile : session.inspect)} />
      {state.ready && <ConfirmAction label={t('核价并保存报价')} disabled={state.busy}
        prompt={t('确认下面的客户、商品、数量、租期及履约条件，并请求 Core 核价保存报价？价格随后由 Core 返回。')}
        onConfirm={() => run(session.confirm)} />}
    </div>
    {!answer && !state.locked && <p className="muted">{t('请先提交补充信息或核对原回答收据，再读取报价条件。')}</p>}
    {p && <>
      <p>{t('当前准备状态')}: {safeDisplayText(p.status, 80)}</p>
      {'request' in p && <>
        <dl>
          <dt>{t('客户编号')}</dt><dd>{safeDisplayText(p.request.customerId, 191)}</dd>
          <dt>{t('下单身份')}</dt><dd>{safeDisplayText(p.request.bookingIdentity?.bookingIdentity, 80)}</dd>
          {p.request.bookingIdentity?.bookingIdentity === 'enterprise_employee' && <>
            <dt>{t('企业编号')}</dt><dd>{safeDisplayText(p.request.bookingIdentity.corporateCustomerId, 191)}</dd></>}
          <dt>{t('租期')}</dt><dd>{formatTimestamp(p.request.startAt).value} → {formatTimestamp(p.request.endAt).value}</dd>
          <dt>{t('时区')}</dt><dd>{safeDisplayText(p.timeZone, 100)}</dd>
          <dt>{t('履约方式')}</dt><dd>{safeDisplayText(p.request.fulfillmentMode, 80)}</dd>
          <dt>{t('履约门店编号')}</dt><dd>{safeDisplayText(p.request.fulfillmentLocationId, 191)}</dd>
          {p.request.returnLocationId && <><dt>{t('归还门店编号')}</dt><dd>{safeDisplayText(p.request.returnLocationId, 191)}</dd></>}
          {p.request.deliveryAddressId && <><dt>{t('送货地址编号')}</dt><dd>{safeDisplayText(p.request.deliveryAddressId, 191)}</dd></>}
          <dt>{t('配置版本')}</dt><dd>{safeDisplayText(p.configVersion, 191)}</dd>
          <dt>{t('库存观察时间')}</dt><dd>{formatTimestamp(p.availability.observedAt).value}</dd>
        </dl>
        <ul>{p.request.lines.map((line, index) => <li key={index}>
          {safeDisplayText(line.itemGroupId, 191)} · {t('数量')}: {line.quantity} · {t('计价单位')}: {safeDisplayText(line.pricingUnit, 80)}
          {line.usageQuantity !== undefined && <> · {t('使用量')}: {line.usageQuantity}</>}
        </li>)}</ul>
        <ul>{p.availability.result.lines.map((line, index) => <li key={index}>
          {safeDisplayText(line.itemGroupName, 191)} ({safeDisplayText(line.itemGroupId, 191)}) · {t('当前可用数量')}: {line.availableQuantity}
        </li>)}</ul>
        <p className="muted">{t('当前读取不锁定库存；核价前会重新核对。保存报价不批准建单或支付。')}</p>
      </>}
      {p.status !== 'ready' && <Alert type="warning" title={t('报价条件尚未齐备，请补充原任务信息或按业务流程处理。')} />}
    </>}
    {result && <>
      <p>{t('原 Core 结果')}: {safeDisplayText(result.status, 80)}</p>
      {quote ? <>
        <dl><dt>{t('报价单号')}</dt><dd>{safeDisplayText(quote.quoteNo, 191)}</dd>
          <dt>{t('应付金额')}</dt><dd>{formatAmount(quote.payableAmount, quote.currency).value} {safeDisplayText(quote.currency, 3)}</dd>
          <dt>{t('应收金额')}</dt><dd>{formatAmount(quote.receivableAmount, quote.currency).value} {safeDisplayText(quote.currency, 3)}</dd>
          <dt>{t('押金')}</dt><dd>{formatAmount(quote.depositAmount, quote.currency).value} {safeDisplayText(quote.currency, 3)}</dd>
          <dt>{t('报价有效期')}</dt><dd>{formatTimestamp(quote.expiresAt).value}</dd>
          <dt>{t('规则版本')}</dt><dd>{safeDisplayText(quote.ruleVersion, 191)}</dd>
          <dt>{t('价格版本')}</dt><dd>{safeDisplayText(quote.priceVersion ?? quote.pricingPlanVersion, 191)}</dd>
          <dt>{t('日历版本')}</dt><dd>{safeDisplayText(quote.calendarVersion, 4096)}</dd></dl>
        <ul>{quote.chargeLines.map((line, index) => <li key={index}>{safeDisplayText(line.name, 500)}: {String(line.amount)} {safeDisplayText(quote.currency, 3)}</li>)}</ul>
        <p className="muted">{t('金额和分项来自这张原报价；报价不代表库存锁定、订单批准或付款完成。')}</p>
      </> : <Alert type="warning" title={t('Core 尚未返回完整报价；只能核对原操作，不补造金额或重发。')} />}
    </>}
    {state.feedback === 'unknown' && <Alert type="warning" title={t('原报价操作或当前条件待核对。条件变化须重新读取；已发送操作只读取原收据。')} />}
  </section>;
}
