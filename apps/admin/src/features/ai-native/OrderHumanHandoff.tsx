/** Current order evidence is separate from the original model answer. Only
 * the existing registered order page owns human business operations. */
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { generatePath, useNavigate } from 'react-router-dom';
import type { AiTaskOrderHandoffQuery, AiTaskOrderHandoffResponse, AiOrderSceneTaskMaterialV2 } from '@rental-os/shared';
import { formatRentalMoney } from '@rental-os/shared';
import { APP_ROUTES } from '@/app/navigation';
import { currentSessionEpoch } from '@/app/queryClient';
import { ActionButton, Alert, Button } from '@/components/ui';
import { aiTaskOrderHandoffApi } from '@/api/aiTaskOrderHandoff';
import { useAuthStore } from '@/features/auth/authStore';
import { useAiManagementLocale } from './management-locale';
import { createOrderHumanHandoffSession } from './order-human-handoff-session';
import { formatTimestamp } from './formatters';
import { safeDisplayText } from './safe-display';
import { orderStatusLabels } from '@/features/rental-core/rentalOrderColumns';
import styles from './AiManagement.module.css';
export function OrderHumanHandoff({ query, identity, current, verify, validate, onAccessDenied, onUnavailable, onObserved }: {
  query: AiTaskOrderHandoffQuery; identity: string; current(): boolean;
  verify?(signal: AbortSignal): Promise<void>; validate?(value: AiTaskOrderHandoffResponse): void; onAccessDenied?(): void;
  onUnavailable?(): void; onObserved?(value: AiTaskOrderHandoffResponse): void;
}) {
  const auth = useAuthStore(), { t } = useAiManagementLocale(), navigate = useNavigate(), [, changed] = useReducer(n => n + 1, 0);
  const epoch = currentSessionEpoch();
  const key = JSON.stringify([query, auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user, auth.token, epoch]);
  const owner = useRef({ key, identity, current, verify, validate }); owner.current = { key, identity, current, verify, validate };
  const session = useMemo(() => createOrderHumanHandoffSession({ query,
    scope: { kind: 'workspace', tenantId: auth.tenant?.tenantId ?? '', workspaceId: auth.currentWorkspaceId ?? '' },
    api: aiTaskOrderHandoffApi, current: () => owner.current.key === key && owner.current.identity === identity
      && epoch === currentSessionEpoch() && !document.hidden && owner.current.current(), verify: signal => owner.current.verify?.(signal) ?? Promise.resolve(),
    validate: value => owner.current.validate?.(value), changed }), [key, identity]);
  useEffect(() => {
    session.activate(); const clear = () => session.clear(); document.addEventListener('visibilitychange', clear);
    return () => { document.removeEventListener('visibilitychange', clear); session.dispose(); };
  }, [session]);
  if (!auth.hasPermission(APP_ROUTES.orderDetail.permission) || !session.isCurrent()) return null;
  const data = session.view, frame = session.isCurrent() ? data.frame : null;
  const action = (work: () => Promise<void>) => async () => { try { await work(); } catch (error) {
    if (session.isCurrent()) {
      if ((error as Error).message !== 'AI_RECONFIRM_CURRENT_ORDER') onUnavailable?.();
      if ([401,403].includes((error as { response?: { status?: number } }).response?.status ?? 0)) onAccessDenied?.();
    }
    throw error;
  } };
  return <section className={styles.stack} aria-label={t('订单人工办理')} aria-busy={!!data.busy}>
    <div className={styles.toolbar}>
      <ActionButton label={t('读取当前办理提示')} pendingLabel={t('正在核对')} successLabel={t('已核对')} disabled={!!data.busy}
        onAction={action(async () => { await session.read(); if (session.view.frame) onObserved?.(session.view.frame); })} />
      <Button onClick={() => {
        if (session.isCurrent() && useAuthStore.getState().hasPermission(APP_ROUTES.orders.permission)) navigate(APP_ROUTES.orders.path);
      }}>{t('查看订单')}</Button>
    </div>
    {data.changedOrder && <Alert type="warning" title={t('原订单已变化，请核对新事实后再次选择打开。')} />}
    {!!data.error && <Alert type="warning" title={t('当前订单提示不可用，旧事实已撤回。')} />}
    {data.evidenceError && <Alert type="warning" title={t('订单事实与来源未能核验，旧事实已撤回；可继续原订单人工流程。')} />}
    {frame && <section className={styles.section}>
      <p>{t('以下来自当前订单读取，与原模型回答分别核对。')}</p>
      <p>{frame.order.orderNo} · {t(orderStatusLabels[frame.order.status] ?? frame.order.status)}</p>
      <p>{t('查询时点')}：{formatTimestamp(frame.order.observedAt).value} · {t('订单版本')}：{frame.order.version}</p>
      <p>{t('可继续在原订单页核对和办理。具体动作仍由该页当前权限与业务状态决定。')}</p>
      <ActionButton label={t('读取订单事实与来源')} pendingLabel={t('正在核对')} disabled={!!data.busy}
        onAction={action(() => session.evidence())} />
      {data.evidence && session.isCurrent() && <OrderEvidence material={data.evidence.material} />}
      <ActionButton label={t('打开原订单')} pendingLabel={t('正在核对')} successLabel={t('已打开原订单')} disabled={!!data.busy}
        onAction={action(async () => { const opened = await session.open(value => {
          onObserved?.(value);
          navigate(generatePath(APP_ROUTES.orderDetail.path, { id: encodeURIComponent(value.order.id) }));
        }); if (!opened) { if (session.view.frame) onObserved?.(session.view.frame); throw Error('AI_RECONFIRM_CURRENT_ORDER'); } })} />
    </section>}
  </section>;
}

/** Render only the original Core publication. Ledger amounts are copied from
 * its verified entries, never inferred from paid labels, mock events or prose. */
function OrderEvidence({ material }: { material: AiOrderSceneTaskMaterialV2['material'] }) {
  const { t } = useAiManagementLocale(), payload = material.payload, facts = payload.facts;
  const amount = (value: unknown, currency: string) => {
    // The Core formatter supports signed refund/net amounts, but its generic
    // non-finite fallback is not evidence of zero. Reject missing values first.
    if (typeof value !== 'number' || !Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) return t('未加载');
    const formatted = formatRentalMoney(value, currency);
    return formatted.startsWith(`${currency} `) ? formatted : `${formatted} ${safeDisplayText(currency, 3)}`;
  };
  const history = 'history' in facts && facts.history.coverage === 'partial' ? facts.history.value : null;
  const payments = 'payments' in facts && facts.payments.coverage === 'partial' ? facts.payments.value : null;
  const funding = 'fundingLedger' in facts && facts.fundingLedger.coverage === 'partial' ? facts.fundingLedger.value : null;
  const lifecycle = 'lifecycle' in facts && facts.lifecycle.coverage === 'partial' ? facts.lifecycle.value : null;
  const inspections = 'inspections' in facts && facts.inspections.coverage === 'partial' ? facts.inspections.value : null;
  const moneyLabels = { rental: '租金', service: '服务费', discount: '折扣', coupon: '优惠券', deposit: '押金', preAuthorization: '预授权', finalPayable: '应付' } as const;
  const paymentLabels = { pending: '待处理', paid: '原记录已完成', failed: '失败', funding_failed: '付款入账失败', closed: '已关闭' } as const;
  const refundLabels = { pending: '退款待处理', accepted: '退款已受理', funding_pending: '退款资金待核对', succeeded: '原退款记录成功', failed: '退款失败', closed: '已关闭' } as const;
  const instruments = { rental: '租金', deposit: '押金', preauthorization: '预授权' } as const;
  return <section className={styles.stack} aria-label={t('订单事实与来源')}>
    <p>{t('查询时点')}：{formatTimestamp(payload.observedAt).value} · {t('来源版本')}：{safeDisplayText(payload.orderVersion, 40)}</p>
    <p>{safeDisplayText(payload.explanation.text, 131072)}</p>
    {Array.from(payload.explanation.text).length > 20000 && <p className={styles.help}>{t('说明文字已截短，请按以下原字段核对金额、状态和依据。')}</p>}
    {'amounts' in facts && <>
      <dl className={styles.facts}>{(Object.keys(moneyLabels) as Array<keyof typeof moneyLabels>).map(key => <div key={key}>
        <dt>{t(moneyLabels[key])}</dt><dd>{amount(facts.amounts.value[key], facts.amounts.currency)}</dd>
      </div>)}</dl>
      <p className={styles.help}>{t('订单金额不是实收；押金和预授权分别核对，不从付款标签计算余额。')}</p>
    </>}
    {history && <section aria-label={t('历史费用依据')}>
      <p>{t('历史费用依据')}：{t(history.savedQuote.status === 'available' ? '原订单关联报价' : history.savedQuote.status === 'unavailable' ? '不可读取' : '未加载')}</p>
      {history.savedQuote.status === 'available' && <p>{safeDisplayText(history.savedQuote.quoteId, 191)} · {t('规则版本')}：{safeDisplayText(history.savedQuote.ruleVersion, 191)}
        {' · '}{t('价格版本')}：{safeDisplayText(history.savedQuote.priceVersion ?? history.savedQuote.pricingPlanVersion, 191)}</p>}
      <p>{t('原规则')}：{history.rule.status === 'available' ? safeDisplayText(history.rule.version, 191) : t('未加载')}</p>
      <p>{t('检查模板')}：{history.inspection.status === 'available' ? history.inspection.templates.map(row => `${safeDisplayText(row.code, 191)} · ${safeDisplayText(row.version, 191)}`).join('、') : t('未加载')}</p>
      {history.savedQuote.status === 'available' && (history.savedQuote.ratesStatus === 'missing' || history.savedQuote.contextStatus === 'missing')
        && <p>{t('原报价明细或上下文缺失，版本引用不代表完整计价依据。')}</p>}
      {history.price.status === 'references_only' && <p>{t('原价格仅有历史引用，明细未加载。')}</p>}
      {history.calendar.status !== 'available' && <p>{t('原日计价依据缺失或不可读取，不使用当前日历替代。')}</p>}
    </section>}
    {'history' in facts && !history && <p>{t('历史依据未加载或不可读取，不使用当前规则补齐。')}</p>}
    {payments && <section aria-label={t('付款与退款记录')}>
      <dl className={styles.facts}>{payments.intents.map(row => <div key={row.intentId}>
        <dt>{t(instruments[row.instrument])} · {safeDisplayText(row.intentId, 191)}</dt>
        <dd>{t(paymentLabels[row.status])} · {amount(row.amount, row.currency)}</dd>
      </div>)}{payments.refunds.map(row => <div key={row.refundId}>
        <dt>{t('退款记录')} · {safeDisplayText(row.refundId, 191)}</dt>
        <dd>{t(refundLabels[row.status])} · {amount(row.amount, row.currency)}</dd>
      </div>)}</dl>
      <p className={styles.help}>{t('以上为原付款与退款记录，不刷新渠道状态，也不据此计算实收。')}</p>
      {payments.truncated && <p>{t('仅显示部分记录，请回原订单页核对完整范围。')}</p>}
    </section>}
    {'payments' in facts && !payments && <p>{t('付款和退款记录未加载或不可读取，不代表未付款。')}</p>}
    {funding && <section aria-label={t('原资金账')}>
      <dl className={styles.facts}>
        {funding.rentalCash.coverage === 'available' ? <>
          <div><dt>{t('已核验租金入账')}</dt><dd>{amount(funding.rentalCash.collected, funding.currency)}</dd></div>
          <div><dt>{t('已核验租金退款')}</dt><dd>{amount(funding.rentalCash.refunded, funding.currency)}</dd></div>
          <div><dt>{t('原账租金净实收')}</dt><dd>{amount(funding.rentalCash.netReceived, funding.currency)}</dd></div>
        </> : <div><dt>{t('租金入账')}</dt><dd>{t('未加载')}</dd></div>}
        {funding.deposit.coverage === 'available' ? <>
          <div><dt>{t('已核验押金入账')}</dt><dd>{amount(funding.deposit.collected, funding.currency)}</dd></div>
          <div><dt>{t('已核验押金扣取')}</dt><dd>{amount(funding.deposit.captured, funding.currency)}</dd></div>
          <div><dt>{t('已核验押金退款')}</dt><dd>{amount(funding.deposit.refunded, funding.currency)}</dd></div>
          <div><dt>{t('原账押金余额')}</dt><dd>{amount(funding.deposit.balance, funding.currency)}</dd></div>
        </> : <div><dt>{t('押金入账')}</dt><dd>{t('未加载')}</dd></div>}
        <div><dt>{t('实际预授权状态')}</dt><dd>{t('未核验')}</dd></div>
      </dl>
      {funding.legacySecurity.unverified && <p>{t('历史保证金记录未核验')}：{amount(funding.legacySecurity.unverifiedAmount, funding.currency)}</p>}
      {funding.events.some(row => row.accounting === 'simulation_or_unverified_not_real_funds') && <p>{t('含模拟或未核验资金记录，不能作为实收。')}</p>}
      {funding.offlineRegistrations.some(row => row.status === 'pending') && <p>{t('存在待确认的线下收款，不计入已核验入账。')}</p>}
      <p className={styles.help}>{t('资金来自原账记录；企业分摊、结算余额和实时渠道状态未加载。')}</p>
    </section>}
    {'fundingLedger' in facts && !funding && <p>{t('实收和押金余额未加载或不可读取，不补零。')}</p>}
    {lifecycle && <section aria-label={t('原履约与变更记录')}>
      <p>{t('原履约与变更记录')}</p>
      <ul>{lifecycle.allocations.map(row => <li key={row.id}>{safeDisplayText(row.id, 191)} · {safeDisplayText(row.status, 40)} · {t('数量')} {row.quantity}</li>)}
        {lifecycle.changes.map(row => <li key={row.id}>{safeDisplayText(row.type, 191)} · {safeDisplayText(row.status, 191)}</li>)}
        {lifecycle.extensions.map(row => <li key={row.id}>{safeDisplayText(row.status, 40)} · {formatTimestamp(row.newEndAt).value}</li>)}</ul>
      {(lifecycle.truncated.changes || lifecycle.truncated.extensions) && <p>{t('仅显示部分记录，请回原订单页核对完整范围。')}</p>}
    </section>}
    {inspections && <section aria-label={t('原检查与争议记录')}>
      <p>{t('原检查与争议记录')}</p>
      <ul>{inspections.records.map(row => <li key={row.id}>{safeDisplayText(row.templateCode, 191)} · {safeDisplayText(row.templateVersion, 191)}
        {row.exceptions.map((item, index) => <p key={index}>{safeDisplayText(item.description, 1000)} · {safeDisplayText(item.reviewStatus, 40)}
          {item.customerResponseStatus && ` · ${safeDisplayText(item.customerResponseStatus, 40)}`}</p>)}</li>)}</ul>
      <p className={styles.help}>{t('检查与争议记录不代替责任裁定、收费或结算结果。')}</p>
    </section>}
  </section>;
}
