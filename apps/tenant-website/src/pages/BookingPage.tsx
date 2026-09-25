import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRightOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';
import { RemoteBooking } from '../components/RemoteBooking';
import { rentalDays, siteRepository } from '../data/siteRepository';
import { nowInput, offsetDaysInput } from '../data/datetime';
import type { DemoOrder } from '../types';

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function BookingPage() {
  const { tenant, href, isRemote, localizeProduct, language, t } = useSite();
  const { isAuthenticated } = useAuth();
  const { productId } = useParams();
  const [params] = useSearchParams();
  const rawProduct = siteRepository.getProduct(tenant, productId || '');
  const selectedProduct = rawProduct ? localizeProduct(rawProduct) : null;
  const [startDate, setStartDate] = useState(params.get('start') || offsetDaysInput(1));
  const [endDate, setEndDate] = useState(params.get('end') || offsetDaysInput(3));
  const [quantity, setQuantity] = useState(Number(params.get('qty')) || 1);
  const [fulfillment, setFulfillment] = useState<'pickup' | 'delivery'>(params.get('fulfillment') === 'delivery' ? 'delivery' : 'pickup');
  const pickupStoreId = params.get('pickup') || '';
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // 真实租户模式下下单需要登录：未登录先去登录页，登录后回到本页。
  const remoteNeedsLogin = isRemote && !isAuthenticated;
  useEffect(() => {
    if (remoteNeedsLogin && productId) navigate(href(`/login?redirect=${encodeURIComponent(`/booking/${productId}`)}`), { replace: true });
  }, [remoteNeedsLogin, productId]);

  if (!selectedProduct) return <div className="shell missing-page"><h1>{t('missingProduct')}</h1><Link className="button button-dark" to={href('/products')}>{t('returnProducts')}</Link></div>;
  const product = selectedProduct;
  if (remoteNeedsLogin) return <div className="shell simple-page"><p className="mock-note">{t('loginRequired')}…</p></div>;
  const remoteMode = isRemote && isAuthenticated;
  const days = rentalDays(startDate, endDate);
  const rentalAmount = product.price * quantity * days;
  const depositAmount = product.deposit * quantity;
  const priceUnit = product.priceUnit === '天' && language === 'en' ? 'day' : product.priceUnit;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (days < 1 || startDate.slice(0, 10) < today()) { setError(t('invalidDate')); return; }
    if (quantity < 1 || quantity > product.availableQuantity) { setError(t('invalidQuantity')); return; }
    if (!contactName.trim()) { setError(t('requiredName')); return; }
    if (!/^1\d{10}$/.test(contactPhone.trim())) { setError(t('requiredPhone')); return; }
    const order: DemoOrder = {
      id: `DEMO-${Date.now().toString(36).toUpperCase()}`, tenantId: tenant.id, productId: product.id,
      startDate, endDate, quantity, fulfillment, contactName: contactName.trim(), contactPhone: contactPhone.trim(), note: note.trim(),
      rentalAmount, depositAmount, createdAt: new Date().toISOString(),
    };
    siteRepository.saveOrder(order);
    navigate(href(`/orders/${order.id}`));
  }

  const quantityMax = Math.max(1, Math.min(product.availableQuantity || 1, 10));
  const productSection = <section className="booking-card"><div className="booking-card-heading"><span>01</span><h2>{t('chooseProduct')}</h2></div><div className="booking-product"><img src={product.cover} alt={product.name} loading="lazy" decoding="async" /><div><strong>{product.name}</strong><p>{product.subtitle}</p><span>¥{product.price} /{priceUnit}</span></div><Link to={href(`/product/${product.id}`)}>{t('details')}</Link></div></section>;
  const termSection = <section className="booking-card"><div className="booking-card-heading"><span>02</span><h2>{t('chooseTerm')}</h2></div><div className="form-grid"><label>{t('startDate')}<input type="datetime-local" min={nowInput()} value={startDate} onChange={event => { setStartDate(event.target.value); if (event.target.value > endDate) setEndDate(event.target.value); }} /></label><label>{t('endDate')}<input type="datetime-local" min={startDate} value={endDate} onChange={event => setEndDate(event.target.value)} /></label></div><div className="form-grid"><label>{t('rentalQuantity')}<select value={quantity} onChange={event => setQuantity(Number(event.target.value))}>{Array.from({ length: remoteMode ? quantityMax : product.availableQuantity }, (_, index) => <option value={index + 1} key={index}>{index + 1} {t('itemUnit')}</option>)}</select></label><div className="field-hint">{!remoteMode && <>{t('currentDemoQuantity', { count: product.availableQuantity })}<br /></>}{t('termTotal', { days })}</div></div></section>;
  const fulfillmentSection = <section className="booking-card"><div className="booking-card-heading"><span>03</span><h2>{t('pickupDelivery')}</h2></div><div className="choice-grid"><label className={fulfillment === 'pickup' ? 'choice-active' : ''}><input type="radio" name="fulfillment" checked={fulfillment === 'pickup'} onChange={() => setFulfillment('pickup')} /><strong>{t('pickup')}</strong><small>{t('pickupDescription')}</small></label><label className={fulfillment === 'delivery' ? 'choice-active' : ''}><input type="radio" name="fulfillment" checked={fulfillment === 'delivery'} onChange={() => setFulfillment('delivery')} /><strong>{t('deliveryHome')}</strong><small>{t('deliveryFeeDescription')}</small></label></div></section>;

  return <div className="shell booking-page"><div className="breadcrumb"><Link to={href('/')}>{t('home')}</Link><ArrowRightOutlined /><Link to={href(`/product/${product.id}`)}>{product.name}</Link><ArrowRightOutlined /><span>{t('bookingTitle')}</span></div>
    <div className="page-intro booking-intro"><span className="eyebrow">RENTAL BOOKING</span><h1>{t('bookingTitle')}</h1><p>{t('bookingDescription')}</p></div>
    <div className="booking-steps"><span className="active">01 {t('chooseProduct')}</span><span className="active">02 {t('chooseTerm')}</span><span className="active">03 {t('pickupDelivery')}</span><span className={remoteMode ? 'active' : ''}>04 {t('costConfirm')}</span></div>
    {remoteMode
      ? <div className="booking-layout"><div className="booking-form">{productSection}{termSection}{fulfillmentSection}</div><aside className="booking-aside"><RemoteBooking product={product} startDate={startDate} endDate={endDate} quantity={quantity} fulfillment={fulfillment} preferredLocationId={pickupStoreId} /></aside></div>
      : <form className="booking-layout" onSubmit={submit}><div className="booking-form">{productSection}{termSection}{fulfillmentSection}
        <section className="booking-card"><div className="booking-card-heading"><span>04</span><h2>{t('contact')}</h2></div><div className="form-grid"><label>{t('contactName')}<input required value={contactName} onChange={event => setContactName(event.target.value)} placeholder={t('namePlaceholder')} /></label><label>{t('contactPhone')}<input required inputMode="tel" value={contactPhone} onChange={event => setContactPhone(event.target.value)} placeholder={t('phonePlaceholder')} /></label></div><label className="full-field">{t('noteOptional')}<textarea value={note} onChange={event => setNote(event.target.value)} placeholder={t('notePlaceholder')} rows={3} /></label></section>
      </div><aside className="booking-aside"><div className="booking-card booking-total"><h2>{t('costConfirm')}</h2><div><span>{t('rentAmount')}</span><strong>¥{product.price} × {days} {language === 'en' ? 'day(s)' : '天'} × {quantity} {t('itemUnit')}</strong></div><div><span>{t('subtotal')}</span><strong>¥{rentalAmount}</strong></div><div><span>{t('referenceDeposit')}</span><strong>¥{depositAmount}</strong></div><div className="booking-grand-total"><span>{t('totalEstimated')}</span><strong>¥{rentalAmount + depositAmount}</strong></div><p>{t('feeNote')}</p>{error && <p className="form-error" role="alert">{error}</p>}<button type="submit" className="button button-dark button-block">{t('submitDemo')}</button><small className="mock-note"><CheckCircleOutlined /> {t('submitNote')}</small></div></aside></form>}
  </div>;
}
