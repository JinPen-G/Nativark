import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRightOutlined, CheckCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';
import { sessionApi } from '../data/authClient';
import { siteRepository } from '../data/siteRepository';

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
  return <div className="shell simple-page">{intro}{orders.length ? <div className="order-list">{orders.map(order => { const rawProduct = siteRepository.getProduct(tenant, order.productId); const product = rawProduct && localizeProduct(rawProduct); return <Link to={href(`/orders/${order.id}`)} className="order-row" key={order.id}><img src={product?.cover} alt="" loading="lazy" decoding="async" /><div><strong>{product?.name || t('allProducts')}</strong><span>{order.startDate} – {order.endDate} · {order.quantity} {t('itemUnit')}</span><small>{order.id}</small></div><b>¥{order.rentalAmount}</b><ArrowRightOutlined /></Link>; })}</div> : <div className="empty-state"><h2>{t('noOrders')}</h2><p>{t('noOrdersDescription')}</p><Link className="button button-dark" to={href('/products')}>{t('browseProducts')}</Link></div>}</div>;
}

/** 订单详情：真实租户 + 已登录走 /orders/:id 并支持发起在线支付；否则回退演示记录。 */
export function OrderDetailPage() {
  const { tenant, href, isRemote, localizeProduct, language, t } = useSite();
  const { isAuthenticated } = useAuth();
  const { orderId } = useParams();
  const remote = isRemote && isAuthenticated;
  const [order, setOrder] = useState<any | null>(null);
  const [loading, setLoading] = useState(remote);
  const [error, setError] = useState('');
  const [methods, setMethods] = useState<string[]>([]);
  const [payNote, setPayNote] = useState('');
  const [payUrl, setPayUrl] = useState('');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!remote || !orderId) return;
    let cancelled = false;
    setLoading(true); setError('');
    Promise.all([sessionApi.order(orderId), sessionApi.paymentCapabilities().catch(() => ({ methods: [] as string[] }))])
      .then(([o, caps]) => { if (cancelled) return; setOrder(o); const list = (caps.methods as string[] | undefined) ?? Object.keys(caps).filter(k => (caps as any)[k] === true); setMethods(list.filter(m => m === 'alipay' || m === 'wechat_pay')); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || t('loadFailed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [remote, orderId]);

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
    return <div className="shell simple-page"><div className="page-intro"><h1>{order.orderNo}</h1><p>{t('orderStatus', { status: t(`orderStatus_${order.status}` as any) || order.status })}</p></div>
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
      <Link className="button button-dark" to={href('/products')}>{t('continueExplore')}</Link>
    </div>;
  }

  const demoOrder = siteRepository.getOrders(tenant).find(item => item.id === orderId);
  const rawProduct = demoOrder && siteRepository.getProduct(tenant, demoOrder.productId);
  const product = rawProduct && localizeProduct(rawProduct);
  if (!demoOrder || !product) return <div className="shell missing-page"><h1>{t('missingOrder')}</h1><Link className="button button-dark" to={href('/orders')}>{t('returnOrders')}</Link></div>;
  return <div className="shell simple-page"><div className="page-intro"><h1>{t('savedTitle')}</h1><p>{t('orderNumber')} {demoOrder.id}</p></div><div className="order-confirmation"><CheckCircleOutlined /><h2>{language === 'en' ? 'Saved in this browser' : '记录已保存在当前浏览器'}</h2><p>{t('savedDescription')}</p></div><div className="booking-card order-detail-card"><h2>{t('bookingInfo')}</h2><div className="booking-product"><img src={product.cover} alt={product.name} loading="lazy" decoding="async" /><div><strong>{product.name}</strong><p>{product.subtitle}</p></div></div><dl className="spec-list"><div><dt>{t('rentalDate')}</dt><dd>{demoOrder.startDate} – {demoOrder.endDate}</dd></div><div><dt>{t('rentalQuantity')}</dt><dd>{demoOrder.quantity} {t('itemUnit')}</dd></div><div><dt>{t('pickupDelivery')}</dt><dd>{demoOrder.fulfillment === 'pickup' ? t('pickup') : t('deliveryHome')}</dd></div><div><dt>{t('contactPerson')}</dt><dd>{demoOrder.contactName}</dd></div><div><dt>{t('estimatedRent')}</dt><dd>¥{demoOrder.rentalAmount}</dd></div><div><dt>{t('referenceDeposit')}</dt><dd>¥{demoOrder.depositAmount}</dd></div></dl></div><Link className="button button-dark" to={href('/products')}>{t('continueExplore')}</Link></div>;
}
