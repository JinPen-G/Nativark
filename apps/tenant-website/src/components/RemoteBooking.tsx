import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LoadingOutlined } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';
import { useToast } from './Toast';
import { sessionApi } from '../data/authClient';
import { rentalDays } from '../data/siteRepository';
import { toIsoDateTime } from '../data/datetime';
import type { Product } from '../types';
import type { AiBookingHandoff } from '@rental-os/shared';
import { readOriginalBookingQuote, type OriginalBookingQuoteFacts } from '../features/ai-native/booking-handoff';

interface QuoteView {
  id: string;
  rentalAmount?: number; depositAmount?: number; preAuthAmount?: number;
  payableAmount?: number; discountAmount?: number; couponAmount?: number; currency?: string;
}

/** 真实租户 + 已登录：走后端 可用性 → 报价 → 下单。金额与库存全部以服务端为准。 */
interface RemoteBookingProps {
  product: Product; startDate: string; endDate: string; quantity: number; fulfillment: 'pickup' | 'delivery'; preferredLocationId?: string;
  handoff?: AiBookingHandoff;
}

export function RemoteBooking(props: RemoteBookingProps) {
  // Never mount the automatic quote/create-order lifecycle for an original handoff.
  return props.handoff ? <OriginalHandoffBooking handoff={props.handoff} /> : <ManualRemoteBooking {...props} />;
}

function OriginalHandoffBooking({ handoff }: { handoff: AiBookingHandoff }) {
  const { language } = useSite();
  const { session, currentWorkspace } = useAuth();
  const quoteOwner = useMemo(() => ({}), [handoff, session, currentWorkspace?.workspaceCode]);
  const [quoteRead, setQuoteRead] = useState<{ owner: object; facts: OriginalBookingQuoteFacts | null } | null>(null);
  const originalQuote = quoteRead?.owner === quoteOwner ? quoteRead.facts : null;
  useEffect(() => {
    let disposed = false;
    setQuoteRead(null);
    // Read only after the user's explicit continue. Never create/recalculate a quote.
    void readOriginalBookingQuote(handoff, session?.customer.id, sessionApi.getQuote).then(quote => {
      if (disposed) return;
      setQuoteRead({ owner: quoteOwner, facts: quote });
    }).catch(() => { if (!disposed) setQuoteRead(null); });
    return () => { disposed = true; };
  }, [handoff, session, quoteOwner]);
  const en = language === 'en';
  return <section className="booking-card booking-total">
    <h2>{en ? 'Original booking material' : '原预约材料'}</h2>
    <p style={{ overflowWrap: 'anywhere' }}>{en ? 'Quote reference' : '报价引用'}：{handoff.fields.quoteId}</p>
    {originalQuote ? <dl>
      <dt>{en ? 'Original payable' : '原应付'}</dt><dd>{originalQuote.payableAmount} {originalQuote.currency}</dd>
      <dt>{en ? 'Deposit' : '押金'}</dt><dd>{originalQuote.depositAmount} {originalQuote.currency}</dd>
      <dt>{en ? 'Preauthorization' : '预授权'}</dt><dd>{originalQuote.preAuthAmount} {originalQuote.currency}</dd>
      <dt>{en ? 'Original rules / pricing version' : '原规则 / 计价版本'}</dt><dd>{originalQuote.ruleVersion} / {originalQuote.pricingPlanVersion}</dd>
    </dl> : <p>{en ? 'Original amounts are not loaded or unavailable; no recalculation.' : '原金额未加载或不可用，不重算、不覆盖原报价。'}</p>}
    <p>{en ? 'Not submitted / not reserved' : '尚未提交 / 资源未预占'}</p>
    <p role="status">{en ? 'Use the explicit acceptance and submission controls above when the server host provides them. No new quote is created here.' : '宿主提供正式能力时，使用上方受理与明确提交入口；这里不创建新报价。'}</p>
  </section>;
}

function ManualRemoteBooking({ product, startDate, endDate, quantity, fulfillment, preferredLocationId }: RemoteBookingProps) {
  const { href, t, language } = useSite();
  const { currentWorkspace, switchWorkspace } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [locationId, setLocationId] = useState<string | null>(null);
  const [enabledModes, setEnabledModes] = useState<string[]>([]);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [addressId, setAddressId] = useState<string>('');
  const [coupons, setCoupons] = useState<any[]>([]);
  const [couponId, setCouponId] = useState<string>('');
  const [ready, setReady] = useState(false);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const days = rentalDays(startDate, endDate);

  // 确保会话切到该商品所属经营空间，再取该空间的履约地点、本人地址簿与可用优惠券。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setReady(false); setError(''); setQuote(null);
      try {
        if (!currentWorkspace || currentWorkspace.workspaceCode !== product.categoryId) {
          await switchWorkspace(product.categoryId);
        }
        const [cat, addressRes, couponRes] = await Promise.all([
          sessionApi.catalog(),
          sessionApi.addresses().catch(() => ({ items: [] })),
          sessionApi.coupons().catch(() => []),
        ]);
        if (cancelled) return;
        // 优先用首页搜索选定的取货门店（若该门店在本空间履约地点内），否则取第一个。
        const locs = (cat.locations || []) as Array<{ id: string }>;
        const preferred = preferredLocationId && locs.some(loc => loc.id === preferredLocationId) ? preferredLocationId : null;
        setLocationId(preferred ?? locs[0]?.id ?? null);
        setEnabledModes(cat.fulfillment?.enabledModes ?? []);
        const list = ((addressRes as any).items as any[]) ?? [];
        setAddresses(list);
        setAddressId(list.find((a) => a.isDefault)?.id ?? list[0]?.id ?? '');
        setCoupons(Array.isArray(couponRes) ? couponRes : ((couponRes as any).items ?? []));
        setReady(true);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || t('loadFailed'));
      }
    })();
    return () => { cancelled = true; };
  }, [product.categoryId, preferredLocationId]);

  const fulfillmentMode = useMemo(() => {
    if (fulfillment === 'delivery' && enabledModes.includes('delivery')) return 'delivery';
    return enabledModes.find(m => m.endsWith('pickup_return')) || enabledModes[0] || 'store_pickup_return';
  }, [fulfillment, enabledModes]);
  const isDelivery = fulfillmentMode === 'delivery';

  const getQuote = useCallback(async () => {
    if (!locationId || days < 1) { setError(t('invalidDate')); return; }
    if (isDelivery && !addressId) { setError(t('deliveryNeedsAddress')); return; }
    setBusy(true); setError(''); setQuote(null);
    try {
      const q = await sessionApi.createQuote({
        fulfillmentMode, fulfillmentLocationId: locationId, startAt: toIsoDateTime(startDate), endAt: toIsoDateTime(endDate),
        lines: [{ itemGroupId: product.id, quantity }],
        ...(isDelivery && addressId ? { deliveryAddressId: addressId } : {}),
        ...(couponId ? { customerCouponId: couponId } : {}),
      });
      setQuote(q as unknown as QuoteView);
    } catch (e: any) { setError(e?.message || t('quoteFailed')); }
    finally { setBusy(false); }
  }, [locationId, fulfillmentMode, isDelivery, addressId, couponId, startDate, endDate, quantity, product.id, days]);

  // 自动报价：就绪且参数有效时，输入变化后自动重新计价（防抖），无需手动点按钮。
  useEffect(() => {
    if (!ready || !locationId || days < 1) return;
    if (isDelivery && !addressId) return;
    const timer = window.setTimeout(() => { getQuote(); }, 450);
    return () => window.clearTimeout(timer);
  }, [ready, locationId, days, isDelivery, addressId, couponId, quantity, startDate, endDate, getQuote]);

  const submitOrder = useCallback(async () => {
    if (!quote?.id) return;
    setBusy(true); setError('');
    try {
      // 幂等键按报价固定：一份报价对应一次下单，网络重试可安全重放，不会重复建单。
      const res = await sessionApi.createOrder({ quoteId: quote.id }, `order-${quote.id}`);
      const order = (res.order ?? res) as { id?: string };
      if (order?.id) { toast.success(t('orderSubmitted')); navigate(href(`/orders/${order.id}`)); }
      else { setError(t('orderFailed')); toast.error(t('orderFailed')); }
    } catch (e: any) { const msg = e?.message || t('orderFailed'); setError(msg); toast.error(msg); }
    finally { setBusy(false); }
  }, [quote, href]);

  if (!ready) {
    return <div className="booking-card"><p className="mock-note">{error ? error : <><LoadingOutlined /> {t('loading')}</>}</p></div>;
  }

  const cur = quote?.currency || 'CNY';
  const addrLabel = (a: any) => `${a.recipient} ${a.phoneMasked || a.phone || ''} · ${[a.province, a.city, a.district, a.detail].filter(Boolean).join('')}`.trim();
  return <div className="booking-card booking-total">
    <h2>{t('costConfirm')}</h2>
    {isDelivery && (addresses.length
      ? <label className="booking-field">{t('selectAddress')}<select value={addressId} onChange={e => { setAddressId(e.target.value); setQuote(null); }}>{addresses.map(a => <option key={a.id} value={a.id}>{addrLabel(a)}</option>)}</select></label>
      : <p className="mock-note">{t('noAddress')} <Link to={href('/account')}>{t('addAddress')}</Link></p>)}
    {coupons.length > 0 && <label className="booking-field">{t('useCoupon')}<select value={couponId} onChange={e => { setCouponId(e.target.value); setQuote(null); }}><option value="">{t('couponNone')}</option>{coupons.map((c, i) => <option key={c.id ?? i} value={c.id}>{c.name || c.templateName || c.title || t('coupon')}</option>)}</select></label>}
    {busy && !quote ? <p className="mock-note"><LoadingOutlined /> {t('quoting')}</p> : null}
    {quote && <>
      <div><span>{t('rentAmount')}</span><strong>¥{quote.rentalAmount ?? 0}</strong></div>
      {quote.discountAmount ? <div><span>{t('discount')}</span><strong>-¥{quote.discountAmount}</strong></div> : null}
      {quote.couponAmount ? <div><span>{t('couponDeducted')}</span><strong>-¥{quote.couponAmount}</strong></div> : null}
      <div><span>{t('deposit')}</span><strong>¥{quote.depositAmount ?? 0}</strong></div>
      {quote.preAuthAmount ? <div><span>{t('preAuth')}</span><strong>¥{quote.preAuthAmount}</strong></div> : null}
      <div className="booking-grand-total"><span>{t('payable')}</span><strong>{cur === 'CNY' ? '¥' : ''}{quote.payableAmount ?? quote.rentalAmount ?? 0}</strong></div>
      <p className="mock-note">{t('quoteServerNote')}</p>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button type="button" className="button button-dark button-block" disabled={busy || !quote} onClick={submitOrder}>{busy ? t('submitting') : t('submitOrder')}</button>
    <p className="mock-note">{language === 'en' ? 'Rental term' : '租期'}: {days} {language === 'en' ? 'day(s)' : '天'}</p>
  </div>;
}
