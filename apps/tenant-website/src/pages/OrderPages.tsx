import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRightOutlined, CheckCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';
import { sessionApi } from '../data/authClient';
import { siteRepository } from '../data/siteRepository';
import { Img } from '../components/Img';
import { customerOrderFacts } from '../features/ai-native/customer-order-facts';
import { EnterpriseExtensionApproval } from '../components/EnterpriseExtensionApproval';
import { EnterpriseExchangeProgress } from '../components/EnterpriseExchangeProgress';
import { EnterpriseExchangeRequest } from '../components/EnterpriseExchangeRequest';

const money = (amount: unknown, currency = 'CNY') => `${currency === 'CNY' ? '¥' : ''}${Number(amount ?? 0)}`;

/** 我的订单：真实租户 + 已登录走 /my/orders；否则回退到浏览器内的演示预约。 */
export function OrdersPage() {
  const { tenant, href, isRemote, localizeProduct, t } = useSite();
  const { isAuthenticated } = useAuth();
  const remote = isRemote && isAuthenticated;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(remote);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    setLoading(true); setError('');
    sessionApi.myOrders({ page: 1, pageSize: 50 })
      .then(r => { if (!cancelled) setRows(r.items ?? []); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || t('loadFailed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [remote]);

  const intro = <div className="page-intro"><h1>{t('orders')}</h1><p>{remote ? t('myRentalsRemoteDesc') : t('myRentalsDescription')}</p></div>;

  if (remote) {
    if (!isAuthenticated) return null;
    return <div className="shell simple-page">{intro}
      {loading ? <p className="mock-note"><LoadingOutlined /> {t('loading')}</p>
        : error ? <p className="form-error">{error}</p>
        : rows.length ? <div className="order-list">{rows.map(o => <Link to={href(`/orders/${o.orderId}`)} className="order-row" key={o.orderId}><div className="order-row-badge">{o.categoryCode}</div><div><strong>{o.orderNo}</strong><span>{(o.startAt || '').slice(0, 10)} – {(o.endAt || '').slice(0, 10)} · {o.workspaceName}</span><small>{t('orderStatus', { status: t(`orderStatus_${o.status}` as any) || o.status })}</small></div><b>{money(o.finalPayableAmount, o.currency)}</b><ArrowRightOutlined /></Link>)}</div>
        : <div className="empty-state"><h2>{t('noOrders')}</h2><p>{t('noOrdersDescription')}</p><Link className="button button-dark" to={href('/products')}>{t('browseProducts')}</Link></div>}
    </div>;
  }

  const orders = siteRepository.getOrders(tenant);
  return <div className="shell simple-page">{intro}{orders.length ? <div className="order-list">{orders.map(order => { const rawProduct = siteRepository.getProduct(tenant, order.productId); const product = rawProduct && localizeProduct(rawProduct); return <Link to={href(`/orders/${order.id}`)} className="order-row" key={order.id}><Img src={product?.cover ?? ''} alt="" /><div><strong>{product?.name || t('allProducts')}</strong><span>{order.startDate} – {order.endDate} · {order.quantity} {t('itemUnit')}</span><small>{order.id}</small></div><b>¥{order.rentalAmount}</b><ArrowRightOutlined /></Link>; })}</div> : <div className="empty-state"><h2>{t('noOrders')}</h2><p>{t('noOrdersDescription')}</p><Link className="button button-dark" to={href('/products')}>{t('browseProducts')}</Link></div>}</div>;
}

/** 订单详情：真实租户 + 已登录走 /orders/:id 并支持发起在线支付；否则回退演示记录。 */
export function OrderDetailPage() {
  const { tenant, tenantCode, href, isRemote, localizeProduct, language, t } = useSite();
  const { isAuthenticated, session, currentWorkspace } = useAuth();
  const { orderId } = useParams();
  const remote = isRemote && isAuthenticated;
  const owner = useMemo(() => ({}), [remote, tenantCode, orderId, session, currentWorkspace?.workspaceCode]);
  const [orderRecord, setOrderRecord] = useState<{ owner: object; order: any } | null>(null);
  const order = orderRecord?.owner === owner ? orderRecord.order : null;
  const [loading, setLoading] = useState(remote);
  const [error, setError] = useState('');
  const [methods, setMethods] = useState<string[]>([]);
  const [payNote, setPayNote] = useState('');
  const [payUrl, setPayUrl] = useState('');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!remote || !orderId) return;
    let cancelled = false;
    setOrderRecord(null);
    setLoading(true); setError('');
    Promise.all([sessionApi.order(orderId), sessionApi.paymentCapabilities().catch(() => ({ methods: [] as string[] }))])
      .then(([o, caps]) => { if (cancelled) return; setOrderRecord({ owner, order: o }); const list = (caps.methods as string[] | undefined) ?? Object.keys(caps).filter(k => (caps as any)[k] === true); setMethods(list.filter(m => m === 'alipay' || m === 'wechat_pay')); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || t('loadFailed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [owner]);

  const pay = useCallback(async (method: string) => {
    if (!orderId) return;
    setPaying(true); setPayNote(''); setPayUrl('');
    try {
      const intent = await sessionApi.createPaymentIntent(orderId, { instrument: 'rental', method }, `pay-${orderId}-${method}`);
      const url = intent.checkoutUrl || intent.payUrl || intent.codeUrl;
      if (url) { setPayUrl(url); setPayNote(t('paymentCreated')); }
      else setPayNote(t('paymentCreated'));
    } catch (e: any) { setPayNote(e?.message || t('paymentFailed')); }
    finally { setPaying(false); }
  }, [orderId]);

  if (remote) {
    if (loading) return <div className="shell simple-page"><p className="mock-note"><LoadingOutlined /> {t('loading')}</p></div>;
    if (error || !order) return <div className="shell missing-page"><h1>{t('missingOrder')}</h1><Link className="button button-dark" to={href('/orders')}>{t('returnOrders')}</Link></div>;
    const cur = order.currency || 'CNY';
    const lines: any[] = Array.isArray(order.lines) ? order.lines : [];
    const chargeLines: any[] = Array.isArray(order.chargeLines) ? order.chargeLines : [];
    const facts = customerOrderFacts(order, orderId ?? '');
    return <div className="shell simple-page"><div className="page-intro"><h1>{order.orderNo}</h1><p>{t('orderStatus', { status: t(`orderStatus_${order.status}` as any) || order.status })}</p></div>
      {facts && <details className="booking-card">
        <summary>{language === 'en' ? 'Original order facts (not an AI answer)' : '原订单事实（非AI回答）'}</summary>
        <dl className="spec-list">
          <div><dt>应收 / Receivable</dt><dd>{facts.receivable}</dd></div>
          <div><dt>实收 / Received</dt><dd>{facts.paid}</dd></div>
          <div><dt>押金要求 / Deposit requirement</dt><dd>{facts.deposit}</dd></div>
          <div><dt>预授权要求 / Preauthorization requirement</dt><dd>{facts.preAuth}</dd></div>
          <div><dt>退款 / Refund</dt><dd>{facts.refundStatus}</dd></div>
          <div><dt>原状态码 / Original status code</dt><dd>{facts.status}</dd></div>
          <div><dt>来源 / Source</dt><dd>{facts.sourceId} / {facts.updatedAt}</dd></div>
        </dl><p>{facts.note}</p>
      </details>}
      <div className="booking-card order-detail-card"><h2>{t('bookingInfo')}</h2>
        {lines.length > 0 && <div className="order-lines">{lines.map((line, i) => <div className="order-line" key={line.id ?? i}><span>{line.itemGroupName || line.itemGroupId} × {line.quantity ?? 1}</span><b>{money(line.amount ?? (line.unitPrice ?? 0) * (line.quantity ?? 1), cur)}</b></div>)}</div>}
        <dl className="spec-list">
          <div><dt>{t('rentalDate')}</dt><dd>{(order.startAt || '').slice(0, 10)} – {(order.endAt || '').slice(0, 10)}</dd></div>
          <div><dt>{t('pickupDelivery')}</dt><dd>{order.fulfillmentLocationName || order.fulfillmentMode}</dd></div>
          {chargeLines.length > 0
            ? chargeLines.map((charge, i) => <div key={i}><dt>{charge.name || charge.type}</dt><dd>{money(charge.amount, cur)}</dd></div>)
            : <div><dt>{t('rentAmount')}</dt><dd>{money(order.rentalAmount, cur)}</dd></div>}
          {order.depositAmount ? <div><dt>{t('deposit')}</dt><dd>{money(order.depositAmount, cur)}</dd></div> : null}
          {order.preAuthAmount ? <div><dt>{t('preAuth')}</dt><dd>{money(order.preAuthAmount, cur)}</dd></div> : null}
          <div><dt>{t('payable')}</dt><dd>{money(order.finalPayableAmount ?? order.payableAmount, cur)}</dd></div>
        </dl>
      </div>
      <div className="booking-card"><h2>{t('payTitle')}</h2>
        {methods.length ? <div className="booking-remote-actions">{methods.map(m => <button key={m} type="button" className="button button-dark" disabled={paying} onClick={() => pay(m)}>{m === 'alipay' ? t('payAlipay') : t('payWechat')}</button>)}</div>
          : <p className="mock-note">{t('payUnavailable')}</p>}
        {payNote && <p className="mock-note"><CheckCircleOutlined /> {payNote}</p>}
        {payUrl && <a className="button button-dark button-block" href={payUrl} target="_blank" rel="noreferrer">{t('payGo')}</a>}
        <p className="mock-note">{t('paySettleNote')}</p>
      </div>
      {orderId && <EnterpriseExtensionApproval key={JSON.stringify([tenantCode, orderId, session?.customer.customerId, currentWorkspace?.workspaceCode])} orderId={orderId} identity={JSON.stringify([tenantCode, orderId, session?.customer.customerId, currentWorkspace?.workspaceCode])} english={language === 'en'} />}
      {orderId && <EnterpriseExchangeRequest key={JSON.stringify([tenantCode, orderId, session?.customer.customerId, currentWorkspace?.workspaceCode])} orderId={orderId} allowNewRequest={order.status === 'renting'} identity={JSON.stringify([tenantCode, orderId, session?.customer.customerId, currentWorkspace?.workspaceCode])} english={language === 'en'} />}
      {orderId && <EnterpriseExchangeProgress key={JSON.stringify([tenantCode, orderId, session?.customer.customerId, currentWorkspace?.workspaceCode])} orderId={orderId} identity={JSON.stringify([tenantCode, orderId, session?.customer.customerId, currentWorkspace?.workspaceCode])} english={language === 'en'} />}
      <Link className="button button-dark" to={href('/products')}>{t('continueExplore')}</Link>
    </div>;
  }

  const demoOrder = siteRepository.getOrders(tenant).find(item => item.id === orderId);
  const rawProduct = demoOrder && siteRepository.getProduct(tenant, demoOrder.productId);
  const product = rawProduct && localizeProduct(rawProduct);
  if (!demoOrder || !product) return <div className="shell missing-page"><h1>{t('missingOrder')}</h1><Link className="button button-dark" to={href('/orders')}>{t('returnOrders')}</Link></div>;
  return <div className="shell simple-page"><div className="page-intro"><h1>{t('savedTitle')}</h1><p>{t('orderNumber')} {demoOrder.id}</p></div><div className="order-confirmation"><CheckCircleOutlined /><h2>{language === 'en' ? 'Saved in this browser' : '记录已保存在当前浏览器'}</h2><p>{t('savedDescription')}</p></div><div className="booking-card order-detail-card"><h2>{t('bookingInfo')}</h2><div className="booking-product"><Img src={product.cover} alt={product.name} /><div><strong>{product.name}</strong><p>{product.subtitle}</p></div></div><dl className="spec-list"><div><dt>{t('rentalDate')}</dt><dd>{demoOrder.startDate} – {demoOrder.endDate}</dd></div><div><dt>{t('rentalQuantity')}</dt><dd>{demoOrder.quantity} {t('itemUnit')}</dd></div><div><dt>{t('pickupDelivery')}</dt><dd>{demoOrder.fulfillment === 'pickup' ? t('pickup') : t('deliveryHome')}</dd></div><div><dt>{t('contactPerson')}</dt><dd>{demoOrder.contactName}</dd></div><div><dt>{t('estimatedRent')}</dt><dd>¥{demoOrder.rentalAmount}</dd></div><div><dt>{t('referenceDeposit')}</dt><dd>¥{demoOrder.depositAmount}</dd></div></dl></div><Link className="button button-dark" to={href('/products')}>{t('continueExplore')}</Link></div>;
}
