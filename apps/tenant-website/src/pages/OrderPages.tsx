import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Calendar, Receipt, Store, Payment } from '../components/SiteIcon';
import { MemberLayout } from '../components/MemberLayout';
import { Breadcrumbs, PageHeading } from '../components/PageHeader';
import { LoadingState, PageState } from '../components/PageState';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';
import { sessionApi } from '../data/authClient';
import { siteRepository } from '../data/siteRepository';
import { Img } from '../components/Img';
import { customerOrderFacts } from '../features/ai-native/customer-order-facts';

function money(amount: unknown, currency = 'CNY') {
  if (amount == null || amount === '') return '—';
  return (currency === 'CNY' ? '¥' : currency + ' ') + String(amount);
}
const date = (value: unknown) => typeof value === 'string' ? value.slice(0, 16).replace('T', ' ') : '—';

/** Preserve remote order reads; demos are only the current browser's stored records. */
export function OrdersPage() {
  const { tenant, href, isRemote, localizeProduct, language, t } = useSite();
  const { isAuthenticated } = useAuth();
  const remote = isRemote && isAuthenticated;
  const en = language === 'en';
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(remote);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (!remote) { setRows([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setError('');
    sessionApi.myOrders({ page: 1, pageSize: 50 }).then(response => { if (!cancelled) setRows(response.items ?? []); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || t('loadFailed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [remote, tenant.id, revision]);
  const demos = siteRepository.getOrders(tenant);
  const records = remote ? rows.map(order => ({
    id: String(order.orderId), title: order.orderNo || order.orderId, cover: '', subtitle: order.workspaceName || '',
    start: order.startAt, end: order.endAt, amount: order.finalPayableAmount, currency: order.currency || 'CNY',
    status: t('orderStatus', { status: t(('orderStatus_' + order.status) as any) || order.status }),
  })) : demos.map(order => {
    const raw = siteRepository.getProduct(tenant, order.productId);
    const product = raw && localizeProduct(raw);
    return { id: order.id, title: product?.name || t('allProducts'), cover: product?.cover || '', subtitle: order.id, start: order.startDate, end: order.endDate, amount: order.rentalAmount, currency: 'CNY', status: en ? 'Browser record' : '浏览器记录' };
  });
  const filtered = records.filter(order => (order.title + ' ' + order.subtitle).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <MemberLayout active="orders" title={t('orders')} description={remote ? t('myRentalsRemoteDesc') : t('myRentalsDescription')}>
    {isRemote && !isAuthenticated ? <PageState icon={<Receipt />} title={t('loginRequired')}><Link className="button button-dark" to={href('/login?redirect=/orders')}>{t('loginCta')}</Link></PageState>
      : loading ? <LoadingState label={t('loading')} />
      : error ? <PageState error title={t('loadFailed')} description={error}><button type="button" className="button button-outline" onClick={() => setRevision(revision + 1)}>{en ? 'Try again' : '重新加载'}</button></PageState>
      : <><div className="member-section-toolbar"><label className="member-search"><span className="sr-only">{en ? 'Search your bookings' : '搜索订单'}</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={en ? 'Booking number or product' : '输入预约编号或商品名称'} /></label><span>{filtered.length} {en ? 'record(s)' : '条记录'}</span></div>
        {filtered.length ? <div className="reservation-list">{filtered.map(order => <article className="reservation-card" key={order.id}>
          <div className="reservation-card-top"><span>{order.subtitle}</span><span className="quiet-tag">{order.status}</span></div>
          <div className="reservation-card-main">{order.cover ? <Img src={order.cover} alt="" /> : <div className="reservation-symbol"><Receipt /></div>}<div><h2><Link to={href('/orders/' + order.id)}>{order.title}</Link></h2><p><Calendar />{date(order.start)} – {date(order.end)}</p></div><div className="reservation-amount"><span>{remote ? t('payable') : t('estimatedRent')}</span><strong>{money(order.amount, order.currency)}</strong></div></div>
          <div className="reservation-card-actions"><Link className="button button-outline" to={href('/orders/' + order.id)}>{t('details')}</Link></div>
        </article>)}</div> : <PageState icon={<Receipt />} title={search ? en ? 'No matching bookings' : '未找到匹配的记录' : t('noOrders')} description={search ? en ? 'Try another product or booking number.' : '试试其他商品名称或预约编号。' : t('noOrdersDescription')}>{search ? <button type="button" className="button button-outline" onClick={() => setSearch('')}>{en ? 'Clear search' : '清空搜索'}</button> : <Link className="button button-dark" to={href('/products')}>{t('browseProducts')}</Link>}</PageState>}
      </>}
  </MemberLayout>;
}

/** Existing payment intents and original Core facts remain the source of truth. */
export function OrderDetailPage() {
  const { tenant, tenantCode, href, isRemote, localizeProduct, language, t } = useSite();
  const { isAuthenticated, session, currentWorkspace } = useAuth();
  const { orderId } = useParams();
  const remote = isRemote && isAuthenticated;
  const en = language === 'en';
  const [revision, setRevision] = useState(0);
  const owner = useMemo(() => ({}), [remote, tenantCode, orderId, session, currentWorkspace?.workspaceCode, revision]);
  const [orderRecord, setOrderRecord] = useState<{ owner: object; order: any } | null>(null);
  const order = orderRecord?.owner === owner ? orderRecord.order : null;
  const [loading, setLoading] = useState(remote);
  const [error, setError] = useState('');
  const [methods, setMethods] = useState<string[]>([]);
  const [payNote, setPayNote] = useState('');
  const [payError, setPayError] = useState(false);
  const [payUrl, setPayUrl] = useState('');
  const [paying, setPaying] = useState(false);
  useEffect(() => {
    if (!remote || !orderId) return;
    let cancelled = false;
    setOrderRecord(null); setLoading(true); setError(''); setPayNote(''); setPayUrl(''); setPayError(false);
    Promise.all([sessionApi.order(orderId), sessionApi.paymentCapabilities().catch(() => ({ methods: [] as string[] }))])
      .then(([record, caps]) => { if (cancelled) return; setOrderRecord({ owner, order: record }); const list = (caps.methods as string[] | undefined) ?? Object.keys(caps).filter(key => (caps as any)[key] === true); setMethods(list.filter(method => method === 'alipay' || method === 'wechat_pay')); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || t('loadFailed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [owner]);
  const pay = useCallback(async (method: string) => {
    if (!orderId) return;
    setPaying(true); setPayNote(''); setPayUrl(''); setPayError(false);
    try {
      const intent = await sessionApi.createPaymentIntent(orderId, { instrument: 'rental', method }, 'pay-' + orderId + '-' + method);
      const url = intent.checkoutUrl || intent.payUrl || intent.codeUrl;
      if (url) setPayUrl(url);
      setPayNote(t('paymentCreated'));
    } catch (e: any) { setPayError(true); setPayNote(e?.message || t('paymentFailed')); }
    finally { setPaying(false); }
  }, [orderId, t]);
  const demoOrder = !isRemote ? siteRepository.getOrders(tenant).find(item => item.id === orderId) : undefined;
  const rawProduct = demoOrder && siteRepository.getProduct(tenant, demoOrder.productId);
  const product = rawProduct && localizeProduct(rawProduct);
  const facts = remote && order ? customerOrderFacts(order, orderId ?? '') : null;
  const lines: any[] = Array.isArray(order?.lines) ? order.lines : [];
  const charges: any[] = Array.isArray(order?.chargeLines) ? order.chargeLines : [];
  const currency = order?.currency || 'CNY';
  const title = remote ? order?.orderNo || t('orderNumber') : t('savedTitle');
  return <div className="shell order-page">
    <Breadcrumbs items={[{ label: t('home'), to: href('/') }, { label: t('orders'), to: href('/orders') }, { label: title }]} />
    {isRemote && !isAuthenticated ? <PageState icon={<Receipt />} title={t('loginRequired')}><Link className="button button-dark" to={href('/login?redirect=' + encodeURIComponent('/orders/' + orderId))}>{t('loginCta')}</Link></PageState>
      : loading ? <LoadingState label={t('loading')} />
      : error ? <PageState error title={t('loadFailed')} description={error}><button type="button" className="button button-outline" onClick={() => setRevision(revision + 1)}>{en ? 'Try again' : '重试'}</button></PageState>
      : (!remote && (!demoOrder || !product)) || (remote && !order) ? <PageState icon={<Receipt />} title={t('missingOrder')}><Link className="button button-dark" to={href('/orders')}>{t('returnOrders')}</Link></PageState>
      : <><PageHeading title={title} description={remote ? t('orderStatus', { status: t(('orderStatus_' + order.status) as any) || order.status }) : t('orderNumber') + ' ' + demoOrder!.id} />
        {!remote && <p className="preview-notice">{t('savedDescription')}</p>}
        <div className="order-detail-layout"><div>
          <section className="order-section"><h2><Receipt />{t('bookingInfo')}</h2>
            {remote ? <div className="order-item-list">{lines.map((line, index) => <div key={line.id ?? index}><span>{line.itemGroupName || line.itemGroupId} × {line.quantity ?? 1}</span><strong>{money(line.amount, currency)}</strong></div>)}</div> : <div className="booking-product"><Img src={product!.cover} alt={product!.name} /><div><strong>{product!.name}</strong><p>{product!.subtitle}</p></div></div>}
          </section>
          <section className="order-section"><h2><Calendar />{t('rentalDate')}</h2><dl className="spec-list"><div><dt>{t('startDate')}</dt><dd>{date(remote ? order.startAt : demoOrder!.startDate)}</dd></div><div><dt>{t('endDate')}</dt><dd>{date(remote ? order.endAt : demoOrder!.endDate)}</dd></div>{!remote && <div><dt>{t('rentalQuantity')}</dt><dd>{demoOrder!.quantity} {t('itemUnit')}</dd></div>}</dl></section>
          <section className="order-section"><h2><Store />{t('pickupDelivery')}</h2><dl className="spec-list"><div><dt>{t('pickupDelivery')}</dt><dd>{remote ? order.fulfillmentLocationName || order.fulfillmentMode || '—' : demoOrder!.fulfillment === 'pickup' ? t('pickup') : t('deliveryHome')}</dd></div>{!remote && <div><dt>{t('contactPerson')}</dt><dd>{demoOrder!.contactName}</dd></div>}</dl></section>
          {facts && <details className="original-order-facts"><summary>{en ? 'Original order facts (not an AI answer)' : '原订单事实（非AI回答）'}</summary><dl className="spec-list"><div><dt>应收 / Receivable</dt><dd>{facts.receivable}</dd></div><div><dt>实收 / Received</dt><dd>{facts.paid}</dd></div><div><dt>押金要求 / Deposit requirement</dt><dd>{facts.deposit}</dd></div><div><dt>预授权要求 / Preauthorization requirement</dt><dd>{facts.preAuth}</dd></div><div><dt>退款 / Refund</dt><dd>{facts.refundStatus}</dd></div><div><dt>原状态码 / Original status code</dt><dd>{facts.status}</dd></div><div><dt>来源 / Source</dt><dd>{facts.sourceId} / {facts.updatedAt}</dd></div></dl><p>{facts.note}</p></details>}
        </div><aside className="order-cost"><h2><Payment />{remote ? t('payable') : t('costConfirm')}</h2><dl>
          {remote ? <>{charges.length ? charges.map((charge, index) => <div key={index}><dt>{charge.name || charge.type}</dt><dd>{money(charge.amount, currency)}</dd></div>) : <div><dt>{t('rentAmount')}</dt><dd>{money(order.rentalAmount, currency)}</dd></div>}{order.depositAmount != null && <div><dt>{t('deposit')}</dt><dd>{money(order.depositAmount, currency)}</dd></div>}{order.preAuthAmount != null && <div><dt>{t('preAuth')}</dt><dd>{money(order.preAuthAmount, currency)}</dd></div>}<div className="order-cost-total"><dt>{t('payable')}</dt><dd>{money(order.finalPayableAmount ?? order.payableAmount, currency)}</dd></div></>
            : <><div><dt>{t('estimatedRent')}</dt><dd>{money(demoOrder!.rentalAmount)}</dd></div><div><dt>{t('referenceDeposit')}</dt><dd>{money(demoOrder!.depositAmount)}</dd></div></>}
        </dl>{remote ? <><h3>{t('payTitle')}</h3>{methods.length ? <div className="payment-actions">{methods.map(method => <button key={method} type="button" className="button button-dark" disabled={paying} onClick={() => { void pay(method); }}>{method === 'alipay' ? t('payAlipay') : t('payWechat')}</button>)}</div> : <p>{t('payUnavailable')}</p>}{payNote && <p className={payError ? 'form-error' : 'field-note'} role={payError ? 'alert' : 'status'}>{payNote}</p>}{payUrl && <a className="button button-dark button-block" href={payUrl} target="_blank" rel="noreferrer">{t('payGo')}</a>}<p>{t('paySettleNote')}</p></> : <p>{t('feeNote')}</p>}</aside></div>
        <div className="order-bottom-actions"><Link className="button button-outline" to={href('/orders')}>{t('returnOrders')}</Link><Link className="button button-dark" to={href('/products')}>{t('continueExplore')}</Link></div>
      </>}
  </div>;
}
