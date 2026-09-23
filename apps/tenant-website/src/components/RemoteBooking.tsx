import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightOutlined, CheckCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';
import { sessionApi } from '../data/authClient';
import { rentalDays } from '../data/siteRepository';
import type { Product } from '../types';

function toIso(date: string) { return new Date(`${date}T09:00:00`).toISOString(); }

interface QuoteView {
  id: string;
  rentalAmount?: number; depositAmount?: number; preAuthAmount?: number;
  payableAmount?: number; discountAmount?: number; currency?: string;
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
  const [ready, setReady] = useState(false);
  const [availabilityText, setAvailabilityText] = useState('');
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const days = rentalDays(startDate, endDate);

  // 确保会话切到该商品所属经营空间，再取该空间的履约地点。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setReady(false); setError(''); setQuote(null);
      try {
        if (!currentWorkspace || currentWorkspace.workspaceCode !== product.categoryId) {
          await switchWorkspace(product.categoryId);
        }
        const cat = await sessionApi.catalog();
        if (cancelled) return;
        const loc = (cat.locations || [])[0];
        setLocationId(loc?.id ?? null);
        setEnabledModes(cat.fulfillment?.enabledModes ?? []);
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

  const checkAvailability = useCallback(async () => {
    if (!locationId || days < 1) return;
    setBusy(true); setError(''); setAvailabilityText('');
    try {
      const r = await sessionApi.availability({ locationId, startAt: toIso(startDate), endAt: toIso(endDate), lines: [{ itemGroupId: product.id, quantity }] });
      setAvailabilityText(r.available ? t('availabilityOk') : t('availabilityNo'));
    } catch (e: any) { setError(e?.message || t('loadFailed')); }
    finally { setBusy(false); }
  }, [locationId, startDate, endDate, quantity, product.id, days]);

  const getQuote = useCallback(async () => {
    if (!locationId || days < 1) { setError(t('invalidDate')); return; }
    setBusy(true); setError(''); setQuote(null);
    try {
      const q = await sessionApi.createQuote({ fulfillmentMode, fulfillmentLocationId: locationId, startAt: toIso(startDate), endAt: toIso(endDate), lines: [{ itemGroupId: product.id, quantity }] });
      setQuote(q as unknown as QuoteView);
    } catch (e: any) { setError(e?.message || t('quoteFailed')); }
    finally { setBusy(false); }
  }, [locationId, fulfillmentMode, startDate, endDate, quantity, product.id, days]);

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
  return <div className="booking-card booking-total">
    <h2>{t('costConfirm')}</h2>
    <div className="booking-remote-actions">
      <button type="button" className="button button-outline" disabled={busy} onClick={checkAvailability}>{t('checkAvailability')}</button>
      <button type="button" className="button button-outline" disabled={busy} onClick={getQuote}>{t('getQuote')}</button>
    </div>
    {availabilityText && <p className="mock-note"><CheckCircleOutlined /> {availabilityText}</p>}
    {quote && <>
      <div><span>{t('rentAmount')}</span><strong>¥{quote.rentalAmount ?? 0}</strong></div>
      {quote.discountAmount ? <div><span>{t('discount')}</span><strong>-¥{quote.discountAmount}</strong></div> : null}
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
