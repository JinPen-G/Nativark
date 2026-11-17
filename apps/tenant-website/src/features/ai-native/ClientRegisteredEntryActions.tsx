/** Explicit navigation from the currently loaded personal order. Original
 * Actions remain private and are revalidated at the fixed navigation point.
 * The payment subview reads a local record only; it never refreshes a provider. */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatRentalMoney, type AiRegisteredEntryActionObservation } from '@rental-os/shared';
import { useSite } from '../../SiteContext';
import { captureEnterpriseHostSession, subscribeCustomerSession } from '../../data/authClient';
import { captureClientEntryActionContext, createClientEntryActionApi, type ClientOriginalPaymentRecord } from './client-entry-actions-api';

type View = { binding: string; rows: Array<{ actionId: string; title: string; label: string }>; busy: boolean;
  observedAt: string; message: 'failed' | 'expired' | 'empty' | null; payment: ClientOriginalPaymentRecord | null };
const safeText = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, '');

export function ClientRegisteredEntryActions({ orderId, scopeKey, english: en }: { orderId: string; scopeKey: string; english: boolean }) {
  const { tenantCode, href } = useSite(), navigate = useNavigate(), [search] = useSearchParams();
  const paymentIntentId = search.get('paymentIntentId') ?? '', paymentTarget = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(paymentIntentId) ? paymentIntentId : '';
  const binding = JSON.stringify([tenantCode, orderId, scopeKey, paymentIntentId]);
  const [view, setView] = useState<View | null>(null), lifetime = useRef({ binding, epoch: 0, mounted: false }); lifetime.current.binding = binding;
  const owner = useRef<ReturnType<typeof captureClientEntryActionContext> | null>(null), actions = useRef<AiRegisteredEntryActionObservation[]>([]),
    api = useRef<ReturnType<typeof createClientEntryActionApi> | null>(null), pending = useRef<AbortController | null>(null),
    expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const text = (zh: string, english: string) => en ? english : zh;
  const clear = () => {
    lifetime.current.epoch++; pending.current?.abort(); pending.current = null;
    if (expiry.current !== null) clearTimeout(expiry.current); expiry.current = null;
    owner.current = null; actions.current = []; api.current = null; setView(null);
  };
  useEffect(() => {
    lifetime.current.mounted = true; clear();
    const hide = () => { if (document.hidden) clear(); };
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', clear);
    const unsubscribe = tenantCode ? subscribeCustomerSession(tenantCode, clear) : () => undefined;
    return () => { lifetime.current.mounted = false; lifetime.current.epoch++; pending.current?.abort(); pending.current = null;
      if (expiry.current !== null) clearTimeout(expiry.current); expiry.current = null; owner.current = null; actions.current = []; api.current = null;
      unsubscribe(); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', clear); };
  }, [binding]);
  const host = captureEnterpriseHostSession(), eligible = host?.current() && host.tenantCode === tenantCode;
  const shown = view?.binding === binding && owner.current?.current() && !document.hidden ? view : null;
  const title = (code: string) => code === 'OPEN_PROFILE' ? text('查看本人资料', 'View my profile')
    : code === 'OPEN_PRODUCT' ? text('查看原商品', 'View original product') : text('查看原支付记录', 'View original payment record');
  const work = async (mode: 'read' | 'open' | 'payment', actionId?: string) => {
    if (!tenantCode || !lifetime.current.mounted || lifetime.current.binding !== binding || document.hidden || pending.current) return;
    let captured: ReturnType<typeof captureClientEntryActionContext>;
    try { captured = captureClientEntryActionContext(tenantCode); } catch { clear(); return; }
    const selected = mode === 'open' ? actions.current.find(row => row.action.actionId === actionId) : undefined;
    if (mode === 'open' && (!shown || !selected || !owner.current?.current())) return;
    if (mode === 'payment' && !paymentTarget) return;
    const controller = new AbortController(), epoch = ++lifetime.current.epoch; pending.current = controller; owner.current = captured;
    const current = () => lifetime.current.mounted && lifetime.current.binding === binding && lifetime.current.epoch === epoch
      && !controller.signal.aborted && !document.hidden && captured.current();
    const clock = api.current?.now;
    // A transport belongs to this request fence, rather than a prior read's epoch.
    const originalApi = createClientEntryActionApi({ tenantCode, orderId, current }); api.current = originalApi;
    if (expiry.current !== null) clearTimeout(expiry.current); expiry.current = null;
    if (mode !== 'open') actions.current = [];
    setView({ binding, rows: mode === 'open' ? shown?.rows ?? [] : [], busy: true, observedAt: '', message: null, payment: null });
    try {
      if (mode === 'read') {
        const result = await originalApi.fromOrder(controller.signal); if (!current()) return;
        actions.current = result.actions.filter(row => row.action.actionCode !== 'OPEN_ORDER');
        const rows = actions.current.map(row => ({ actionId: row.action.actionId, title: title(row.action.actionCode), label: safeText(row.label) }));
        setView({ binding, rows, busy: false, observedAt: result.observedAt, message: rows.length ? null : 'empty', payment: null });
        if (actions.current.length) expiry.current = setTimeout(() => {
          if (!current()) return; actions.current = []; expiry.current = null;
          setView({ binding, rows: [], busy: false, observedAt: '', message: 'expired', payment: null });
        }, Math.min(120000, Math.max(0, Math.min(...actions.current.map(row => Date.parse(row.action.expiresAt))) - originalApi.now())));
      } else if (mode === 'payment') {
        const payment = await originalApi.readOriginalPayment(paymentTarget, controller.signal); if (!current()) return;
        setView({ binding, rows: [], busy: false, observedAt: '', message: null, payment });
      } else if (selected) {
        const action = selected.action;
        if (Date.parse(action.expiresAt) <= (clock?.() ?? Date.now())) throw Error('original_action_expired');
        await originalApi.revalidate(action, controller.signal);
        if (!current()) return;
        if (!actions.current.includes(selected) || Date.parse(action.expiresAt) <= originalApi.now()) throw Error('original_action_expired');
        const target = action.actionCode === 'OPEN_PROFILE' ? '/account?section=profile'
          : action.actionCode === 'OPEN_PRODUCT' ? `/product/${encodeURIComponent(action.resource.id)}`
            : `/orders/${encodeURIComponent(orderId)}?paymentIntentId=${encodeURIComponent(action.resource.id)}#original-payment-record`;
        navigate(href(target)); clear();
      }
    } catch {
      if (current()) { actions.current = []; setView({ binding, rows: [], busy: false, observedAt: '', message: 'failed', payment: null }); }
    } finally {
      if (pending.current === controller) pending.current = null;
      if (lifetime.current.mounted && lifetime.current.binding === binding && lifetime.current.epoch === epoch) {
        if (!current()) clear();
        else setView(previous => previous?.binding === binding ? { ...previous, busy: false } : previous);
      }
    }
  };
  const payment = shown?.payment, statuses = { pending: text('待处理', 'Pending'), paid: text('原记录已支付', 'Recorded as paid'),
    failed: text('支付失败', 'Failed'), funding_failed: text('入账失败', 'Funding failed'), closed: text('已关闭', 'Closed') };
  return <section className="order-section" aria-label={text('原资料入口', 'Original record links')} aria-busy={!!shown?.busy}>
    <h3>{text('原资料入口', 'Original record links')}</h3>
    <p>{text('核对当前资料后打开原页面，各项办理仍在原页面确认。', 'Check current records before opening their pages. Each page confirms its own business operations.')}</p>
    <button type="button" className="button button-outline" disabled={!eligible || !!shown?.busy || document.hidden}
      onClick={() => void work('read')}>{text('读取当前原入口', 'Read current original links')}</button>
    {shown?.observedAt && <p>{text('查询时间', 'Observed at')}：{shown.observedAt}</p>}
    {!!shown?.rows.length && <div className="spec-list">{shown.rows.map(row => <div key={row.actionId}>
      <span style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{row.label}</span>
      <button type="button" className="button button-outline" disabled={shown.busy} onClick={() => void work('open', row.actionId)}>{row.title}</button>
    </div>)}</div>}
    {shown?.message && <p role="status">{shown.message === 'expired' ? text('入口观察已到期，请重新读取。', 'These links expired. Read them again.')
      : shown.message === 'empty' ? text('当前没有其他可核验的关联入口。', 'No additional linked record is currently available.')
        : text('当前入口无法核对，可继续使用原订单和人工办理入口。', 'These links are unavailable. You can still use the original order and manual workflows.')}</p>}
    {paymentIntentId && <section id="original-payment-record" aria-label={text('原支付记录', 'Original payment record')}>
      <h3>{text('原支付记录', 'Original payment record')}</h3>
      <p>{text('仅核对原本地支付记录，不查询支付渠道或办理支付。', 'Read the stored payment record without contacting the payment provider or starting payment.')}</p>
      <button type="button" className="button button-outline" disabled={!eligible || !paymentTarget || !!shown?.busy || document.hidden}
        onClick={() => void work('payment')}>{text('核对原支付记录', 'Check original payment record')}</button>
      {payment && <dl className="spec-list"><div><dt>{text('支付单', 'Payment record')}</dt><dd>{payment.intentId}</dd></div>
        <div><dt>{text('状态', 'Status')}</dt><dd>{statuses[payment.status]}</dd></div>
        <div><dt>{text('金额', 'Amount')}</dt><dd>{formatRentalMoney(payment.amount, payment.currency)}</dd></div>
        <div><dt>{text('用途', 'Instrument')}</dt><dd>{payment.instrument}</dd></div>
        <div><dt>{text('查询时间', 'Observed at')}</dt><dd>{payment.observedAt ?? text('未提供', 'Not provided')}</dd></div></dl>}
    </section>}
  </section>;
}
