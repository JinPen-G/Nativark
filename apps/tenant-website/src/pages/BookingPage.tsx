import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Store, Truck } from '../components/SiteIcon';
import { Breadcrumbs, PageHeading } from '../components/PageHeader';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';
import { RemoteBooking } from '../components/RemoteBooking';
import { useToast } from '../components/Toast';
import { Img } from '../components/Img';
import { rentalDays, siteRepository } from '../data/siteRepository';
import { nowInput, offsetDaysInput } from '../data/datetime';
import { rentalQuery } from '../data/rentalQuery';
import type { DemoOrder } from '../types';
import { useBookingHandoffHost } from '../features/ai-native/BookingHandoffHost';
import { BookingHandoffPanel } from '../features/ai-native/BookingHandoffPanel';
import { handoffLocalInput } from '../features/ai-native/booking-handoff';

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function BookingPage() {
  const { tenant, tenantCode, href, isRemote, localizeProduct, language, t } = useSite();
  const { isAuthenticated, session, currentWorkspace } = useAuth();
  const handoffHost = useBookingHandoffHost();
  const toast = useToast();
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
    if (remoteNeedsLogin && productId) navigate(href(`/login?redirect=${encodeURIComponent(`/booking/${productId}?${params}`)}`), { replace: true });
  }, [remoteNeedsLogin, productId, params]);

  if (!selectedProduct) return <div className="shell missing-page"><h1>{t('missingProduct')}</h1><Link className="button button-dark" to={href('/products')}>{t('returnProducts')}</Link></div>;
  const product = selectedProduct;
  if (remoteNeedsLogin) return <div className="shell simple-page"><p className="mock-note">{t('loginRequired')}…</p></div>;
  const remoteMode = isRemote && isAuthenticated;
  const days = rentalDays(startDate, endDate);
  const rentalAmount = !remoteMode && product.price !== undefined ? product.price * quantity * days : undefined;
  const depositAmount = !remoteMode && product.deposit !== undefined ? product.deposit * quantity : undefined;
  const priceUnit = product.priceUnit === '天' && language === 'en' ? 'day' : product.priceUnit;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (days < 1 || startDate.slice(0, 10) < today()) { setError(t('invalidDate')); return; }
    if (rentalAmount === undefined || depositAmount === undefined || product.availableQuantity === undefined || quantity < 1 || quantity > product.availableQuantity) { setError(t('invalidQuantity')); return; }
    if (!contactName.trim()) { setError(t('requiredName')); return; }
    if (!/^1\d{10}$/.test(contactPhone.trim())) { setError(t('requiredPhone')); return; }
    const order: DemoOrder = {
      id: `DEMO-${Date.now().toString(36).toUpperCase()}`, tenantId: tenant.id, productId: product.id,
      startDate, endDate, quantity, fulfillment, contactName: contactName.trim(), contactPhone: contactPhone.trim(), note: note.trim(),
      rentalAmount, depositAmount, createdAt: new Date().toISOString(),
    };
    siteRepository.saveOrder(order);
    toast.success(t('bookingSaved'));
    navigate(href(`/orders/${order.id}`));
  }

  const quantityMax = Math.max(1, Math.min(product.availableQuantity ?? 10, 10));
  const productTo = href(`/product/${product.id}?${rentalQuery(params, { start: startDate, end: endDate, quantity, fulfillment })}`);
  const productSection = <section className="booking-card" id="booking-product"><div className="booking-card-heading"><span>01</span><h2>{t('chooseProduct')}</h2></div><div className="booking-product"><Img src={product.cover} alt={product.name} /><div><strong>{product.name}</strong><p>{product.subtitle}</p><span>{product.price === undefined ? (language === 'en' ? 'Select dates for a quote' : '选租期查看报价') : `${product.currency ?? '¥'} ${product.price} /${priceUnit}`}</span></div><Link to={productTo}>{t('details')}</Link></div></section>;
  const termSection = <section className="booking-card" id="booking-term"><div className="booking-card-heading"><span>02</span><h2>{t('chooseTerm')}</h2></div><div className="form-grid"><label>{t('startDate')}<input type="datetime-local" required min={nowInput()} value={startDate} onChange={event => { setStartDate(event.target.value); if (event.target.value > endDate) setEndDate(event.target.value); }} /></label><label>{t('endDate')}<input type="datetime-local" required min={startDate} value={endDate} onChange={event => setEndDate(event.target.value)} /></label></div><div className="form-grid"><label>{t('rentalQuantity')}<select value={quantity} onChange={event => setQuantity(Number(event.target.value))}>{Array.from({ length: quantityMax }, (_, index) => <option value={index + 1} key={index}>{index + 1} {t('itemUnit')}</option>)}</select></label><div className="field-hint">{!remoteMode && <>{t('currentDemoQuantity', { count: product.availableQuantity ?? '' })}<br /></>}{t('termTotal', { days })}</div></div></section>;
  const fulfillmentSection = <section className="booking-card" id="booking-fulfillment"><div className="booking-card-heading"><span>03</span><h2>{t('pickupDelivery')}</h2></div><div className="choice-grid"><label className={fulfillment === 'pickup' ? 'choice-active' : ''}><input type="radio" name="fulfillment" checked={fulfillment === 'pickup'} onChange={() => setFulfillment('pickup')} /><strong><Store />{t('pickup')}</strong><small>{t('pickupDescription')}</small></label><label className={fulfillment === 'delivery' ? 'choice-active' : ''}><input type="radio" name="fulfillment" checked={fulfillment === 'delivery'} onChange={() => setFulfillment('delivery')} /><strong><Truck />{t('deliveryHome')}</strong><small>{t('deliveryFeeDescription')}</small></label></div></section>;

  return <div className="shell booking-page"><Breadcrumbs items={[{ label: t('home'), to: href('/') }, { label: product.name, to: productTo }, { label: t('bookingTitle') }]} />
    <PageHeading title={t('bookingTitle')} description={t('bookingDescription')} />
    <nav className="booking-steps" aria-label={t('chooseRentalPlan')}>
      <a href="#booking-product"><b>01</b>{t('chooseProduct')}</a><a href="#booking-term"><b>02</b>{t('chooseTerm')}</a><a href="#booking-fulfillment"><b>03</b>{t('pickupDelivery')}</a>{!remoteMode && !handoffHost?.enabled && <a href="#booking-contact"><b>04</b>{t('contact')}</a>}<a href="#booking-quote"><b>{remoteMode || handoffHost?.enabled ? '04' : '05'}</b>{t('costConfirm')}</a>
    </nav>
    {remoteMode || handoffHost?.enabled === true
      ? handoffHost?.enabled === true
        ? <BookingHandoffPanel host={handoffHost} sessionIdentity={session} english={language === 'en'}
            context={{ tenantCode, workspaceCode: currentWorkspace?.workspaceCode, customerId: session?.customer.customerId, authenticated: isRemote && isAuthenticated, productId: product.id }}
            onContinue={handoff => {
              setStartDate(handoffLocalInput(handoff.fields.startAt, handoff.fields.timeZone));
              setEndDate(handoffLocalInput(handoff.fields.endAt, handoff.fields.timeZone));
              setQuantity(handoff.fields.lines[0].quantity);
              setFulfillment(handoff.fields.fulfillmentMode === 'delivery' ? 'delivery' : 'pickup');
            }}>
            {handoff => <div className="booking-layout"><fieldset className="booking-form" disabled>
              {productSection}{termSection}{fulfillmentSection}
              <p>{language === 'en' ? 'Original material is read-only. Changes require a new preparation.' : '原材料只读；修改需求须重新准备，不沿用旧确认。'}</p>
              <p style={{ overflowWrap: 'anywhere' }}>{handoff.fields.fulfillmentLocationId}{handoff.fields.deliveryAddressId ? ` / ${handoff.fields.deliveryAddressId}` : ''}</p>
            </fieldset><aside className="booking-aside" id="booking-quote"><RemoteBooking product={product} startDate={startDate} endDate={endDate} quantity={quantity}
              fulfillment={fulfillment} handoff={handoff} /></aside></div>}
          </BookingHandoffPanel>
        : <div className="booking-layout"><div className="booking-form">{productSection}{termSection}{fulfillmentSection}</div><aside className="booking-aside" id="booking-quote"><RemoteBooking product={product} startDate={startDate} endDate={endDate} quantity={quantity} fulfillment={fulfillment} preferredLocationId={pickupStoreId} /></aside></div>
      : <form className="booking-layout" onSubmit={submit}><div className="booking-form">{productSection}{termSection}{fulfillmentSection}
        <section className="booking-card" id="booking-contact"><div className="booking-card-heading"><span>04</span><h2>{t('contact')}</h2></div><div className="form-grid"><label>{t('contactName')}<input required autoComplete="name" value={contactName} onChange={event => setContactName(event.target.value)} placeholder={t('namePlaceholder')} /></label><label>{t('contactPhone')}<input required type="tel" autoComplete="tel" inputMode="tel" maxLength={11} value={contactPhone} onChange={event => setContactPhone(event.target.value)} placeholder={t('phonePlaceholder')} /></label></div><label className="full-field">{t('noteOptional')}<textarea value={note} onChange={event => setNote(event.target.value)} placeholder={t('notePlaceholder')} rows={3} /></label></section>
      </div><aside className="booking-aside" id="booking-quote"><div className="booking-card booking-total"><h2>{t('costConfirm')}</h2><div><span>{t('rentAmount')}</span><strong>¥{product.price} × {days} {language === 'en' ? 'day(s)' : '天'} × {quantity} {t('itemUnit')}</strong></div><div><span>{t('subtotal')}</span><strong>¥{rentalAmount}</strong></div><div><span>{t('referenceDeposit')}</span><strong>¥{depositAmount}</strong></div><div className="booking-grand-total"><span>{t('totalEstimated')}</span><strong>¥{rentalAmount !== undefined && depositAmount !== undefined ? rentalAmount + depositAmount : '—'}</strong></div><p>{t('feeNote')}</p>{error && <p className="form-error" role="alert">{error}</p>}<button type="submit" className="button button-dark button-block">{t('submitDemo')}</button><small className="mock-note">{t('submitNote')}</small></div></aside></form>}
  </div>;
}
