import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Calendar, CheckCircle, ShieldCheck, Star, Store, ClipboardCheck } from '../components/SiteIcon';
import { useSite } from '../SiteContext';
import { ProductCard } from '../components/ProductCard';
import { Breadcrumbs } from '../components/PageHeader';
import { Img } from '../components/Img';
import { rentalDays, siteRepository } from '../data/siteRepository';
import { nowInput, offsetDaysInput } from '../data/datetime';
import { rentalQuery } from '../data/rentalQuery';
import { useActiveRail } from '../hooks/useActiveRail';

export function ProductDetailPage() {
  const { tenant, href, isRemote, productsReady, localizeProduct, language, t } = useSite();
  const { productId } = useParams();
  const [params] = useSearchParams();
  const rawProduct = siteRepository.getProduct(tenant, productId || '');
  const selectedProduct = rawProduct ? localizeProduct(rawProduct) : null;
  const [startDate, setStartDate] = useState(params.get('start') || offsetDaysInput(1));
  const [endDate, setEndDate] = useState(params.get('end') || offsetDaysInput(3));
  const queryQuantity = Number(params.get('qty'));
  const requestedQuantity = Number.isInteger(queryQuantity) && queryQuantity > 0 ? queryQuantity : 1;
  const quantityLimit = Math.max(1, Math.min(rawProduct?.availableQuantity ?? 10, 10));
  const [quantity, setQuantity] = useState(Math.max(1, Math.min(requestedQuantity, quantityLimit)));
  const [fulfillment, setFulfillment] = useState<'pickup' | 'delivery'>(params.get('fulfillment') === 'delivery' ? 'delivery' : 'pickup');
  const [tab, setTab] = useState('intro');
  const tabRail = useActiveRail<HTMLDivElement>(`${tab}:${language}`);
  useEffect(() => {
    setStartDate(params.get('start') || offsetDaysInput(1));
    setEndDate(params.get('end') || offsetDaysInput(3));
    setQuantity(Math.min(requestedQuantity, quantityLimit));
    setFulfillment(params.get('fulfillment') === 'delivery' ? 'delivery' : 'pickup');
    setTab('intro');
  }, [productId, params, quantityLimit, requestedQuantity]);
  const pickupStoreId = params.get('pickup') || '';
  const pickupStore = tenant.stores?.find(store => store.id === pickupStoreId);
  const navigate = useNavigate();
  const en = language === 'en';

  if (!selectedProduct && isRemote && !productsReady) return <div className="shell detail-page" role="status" aria-label={t('loading')}>
    <div className="detail-grid"><div className="detail-gallery"><div className="detail-main-image sk-block" /></div><div className="detail-summary"><div className="sk-line sk-line-md" /><div className="sk-line sk-line-lg" /><div className="sk-line" /></div></div>
  </div>;
  if (!selectedProduct) return <div className="shell missing-page"><h1>{t('missingProduct')}</h1><Link className="button button-dark" to={href('/products')}>{t('returnProducts')}</Link></div>;

  const product = selectedProduct;
  const category = tenant.categories.find(item => item.id === product.categoryId);
  const days = rentalDays(startDate, endDate);
  const available = product.stockStatus !== 'unavailable';
  const validTerm = Boolean(startDate && endDate && endDate > startDate);
  const validQuantity = quantity >= 1 && (product.availableQuantity === undefined || quantity <= product.availableQuantity);
  const related = siteRepository.getProducts(tenant).filter(item => item.categoryId === product.categoryId && item.id !== product.id).slice(0, 4);
  const priceUnit = product.priceUnit === '天' && en ? 'day' : product.priceUnit;
  const contextQuery = rentalQuery(params, { start: startDate, end: endDate, quantity, fulfillment });
  const tabs = [
    { id: 'intro', label: t('intro') }, { id: 'specs', label: t('specs') }, { id: 'rules', label: t('rentalRules') },
    { id: 'deposit', label: t('depositRules') }, { id: 'fulfillment', label: t('fulfillment') }, { id: 'reviews', label: t('reviews') },
  ];

  function book(event: FormEvent) {
    event.preventDefault();
    if (!available || !validTerm || !validQuantity || days < 1) return;
    const query = new URLSearchParams(contextQuery);
    query.set('start', startDate); query.set('end', endDate); query.set('qty', String(quantity)); query.set('fulfillment', fulfillment);
    navigate(href('/booking/' + product.id + '?' + query));
  }
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); setTab(tabs[next].id);
    document.getElementById('detail-tab-' + tabs[next].id)?.focus({ preventScroll: true });
  }

  return <div className="shell detail-page">
    <Breadcrumbs items={[{ label: t('home'), to: href('/') }, { label: category?.name || t('allProducts'), to: href('/category/' + product.categoryId + '?' + contextQuery) }, { label: product.name }]} />
    <div className="detail-grid">
      <div className="detail-gallery"><div className="detail-main-image"><Img src={product.cover} alt={product.name} loading="eager" /></div><div className="detail-image-note"><CheckCircle />{t('detailImageNote')}</div></div>
      <div className="detail-summary">
        <h1>{product.name}</h1><p className="detail-subtitle">{product.subtitle}</p>
        <div className="detail-rating">{(product.reviewCount ?? 0) > 0 && <><Star />{product.rating}<span>· {t('reviewsCount', { count: product.reviewCount ?? '' })}</span></>}<span className="detail-availability">{product.stockStatus === 'unknown' ? (en ? 'Check availability for your dates' : '选择租期确认库存') : available ? t('available', { count: product.availableQuantity ?? '' }) : t('unavailable')}</span></div>
        <div className="detail-price"><strong>{product.price === undefined ? (en ? 'Select dates for a quote' : '选租期查看报价') : `${product.currency ?? '¥'} ${product.price}`}</strong>{product.price !== undefined && <span>/{priceUnit}</span>}<small>{product.deposit === undefined ? (en ? 'Deposit confirmed in quote' : '押金以报价为准') : t('depositConfirm', { amount: product.deposit })}</small></div>
        <form className="rental-panel" onSubmit={book}>
          <h2><Calendar />{t('chooseRentalPlan')}</h2>
          {pickupStore && <p className="selected-pickup">{fulfillment === 'delivery' ? en ? 'Service store' : '服务门店' : en ? 'Pickup & return' : '取还门店'} · {pickupStore.name}</p>}
          <div className="form-grid">
            <label>{t('startDate')}<input type="datetime-local" min={nowInput()} required value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
            <label>{t('endDate')}<input type="datetime-local" min={startDate} required value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
          </div>
          <div className="form-grid">
            <label>{t('rentalQuantity')}<select value={quantity} disabled={!available} onChange={event => setQuantity(Number(event.target.value))}>{Array.from({ length: Math.min(product.availableQuantity ?? 10, 10) }, (_, index) => <option value={index + 1} key={index}>{index + 1} {t('itemUnit')}</option>)}</select></label>
            <label>{t('pickupDelivery')}<select value={fulfillment} onChange={event => setFulfillment(event.target.value as 'pickup' | 'delivery')}><option value="pickup">{t('pickup')}</option><option value="delivery">{t('deliveryHome')}</option></select></label>
          </div>
          {!validTerm && <p className="form-error" role="alert">{en ? 'Return must be later than pickup. Please adjust your dates.' : '归还时间需晚于取货时间，请调整租期。'}</p>}
          <div className="rental-estimate"><span>{t('rentalDays')} <strong>{validTerm ? days : '—'} {en ? 'day(s)' : '天'}</strong></span><span>{t('rentalEstimate')} <strong>{isRemote || product.price === undefined ? (en ? 'Calculated in quote' : '以服务端报价为准') : validTerm ? '¥' + days * quantity * product.price : '—'}</strong></span></div>
          <button className="button button-dark button-block" type="submit" disabled={!available || !validTerm || !validQuantity || days < 1}>{t('bookingTitle')}</button>
          <p className="mock-note">{isRemote ? t('detailEstimateNote') : t('demoBookingNote')}</p>
        </form>
        <div className="detail-service"><span><ShieldCheck />{t('authenticEquipment')}</span><span><Store />{t('flexibleReturn')}</span><span><ClipboardCheck />{t('professionalCheck')}</span></div>
      </div>
    </div>
    <section className="detail-content">
      <div ref={tabRail} className="detail-tabs" role="tablist" aria-label={t('detailTabs')}>{tabs.map((item, index) => <button key={item.id} type="button" id={'detail-tab-' + item.id} role="tab" aria-selected={tab === item.id} aria-controls="detail-tab-panel" tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} onKeyDown={event => moveTab(event, index)}>{item.label}</button>)}</div>
      <div className="detail-tab-content" id="detail-tab-panel" role="tabpanel" aria-labelledby={'detail-tab-' + tab} tabIndex={0}>
        {tab === 'intro' && <><h2>{t('aboutProduct')}</h2><p>{product.description}</p><p>{t('detailIntroExtra')}</p></>}
        {tab === 'specs' && <><h2>{t('specs')}</h2><dl className="spec-list">{Object.entries(product.specs).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></>}
        {tab === 'rules' && <><h2>{t('rentalRules')}</h2><ul><li>{t('ruleOne')}</li><li>{t('ruleTwo')}</li><li>{t('ruleThree')}</li></ul></>}
        {tab === 'deposit' && <><h2>{t('depositRules')}</h2><p>{product.deposit === undefined ? (en ? 'Deposit confirmed in quote' : '押金以服务端报价为准') : t('depositText', { amount: product.deposit })}</p></>}
        {tab === 'fulfillment' && <><h2>{t('fulfillment')}</h2><p>{t('fulfillmentText')}</p></>}
        {tab === 'reviews' && <><h2>{t('reviews')}</h2><p>{t('reviewsText')}</p></>}
      </div>
    </section>
    {related.length > 0 && <section className="section related-section"><div className="section-heading"><div><h2>{t('related')}</h2><p>{t('relatedSubtitle')}</p></div></div><div className="product-grid compact-product-grid">{related.map(item => <ProductCard product={item} compact search={contextQuery.toString()} key={item.id} />)}</div></section>}
  </div>;
}
