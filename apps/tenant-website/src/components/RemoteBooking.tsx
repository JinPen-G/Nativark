import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRightOutlined, LoadingOutlined } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';
import { sessionApi } from '../data/authClient';
import { rentalDays } from '../data/siteRepository';
import type { Product } from '../types';

function toIso(date: string) { return new Date(`${date}T09:00:00`).toISOString(); }

interface QuoteView {
  id: string;
  rentalAmount?: number; depositAmount?: number; preAuthAmount?: number;
  payableAmount?: number; discountAmount?: number; couponAmount?: number; currency?: string;
}

/** 真实租户 + 已登录：走后端 可用性 → 报价 → 下单。金额与库存全部以服务端为准。 */
export function RemoteBooking({ product, startDate, endDate, quantity, fulfillment }: {
  product: Product; startDate: string; endDate: string; quantity: number; fulfillment: 'pickup' | 'delivery';
}) {
  const { href, t, language } = useSite();
  const { currentWorkspace, switchWorkspace } = useAuth();
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
        setLocationId((cat.locations || [])[0]?.id ?? null);
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
  }, [product.categoryId]);

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
        fulfillmentMode, fulfillmentLocationId: locationId, startAt: toIso(startDate), endAt: toIso(endDate),
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
      if (order?.id) navigate(href(`/orders/${order.id}`));
      else setError(t('orderFailed'));
    } catch (e: any) { setError(e?.message || t('orderFailed')); }
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
    <button type="button" className="button button-dark button-block" disabled={busy || !quote} onClick={submitOrder}>{t('submitOrder')} <ArrowRightOutlined /></button>
    <p className="mock-note">{language === 'en' ? 'Rental term' : '租期'}: {days} {language === 'en' ? 'day(s)' : '天'}</p>
  </div>;
}
