import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRightOutlined, CheckCircleOutlined, StarFilled, TruckOutlined } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { ProductCard } from '../components/ProductCard';
import { Img } from '../components/Img';
import { SectionHeading } from '../components/HomeSections';
import { rentalDays, siteRepository } from '../data/siteRepository';
import { nowInput, offsetDaysInput } from '../data/datetime';

export function ProductDetailPage() {
  const { tenant, href, isRemote, productsReady, localizeProduct, language, t } = useSite();
  const { productId } = useParams();
  const [params] = useSearchParams();
  const rawProduct = siteRepository.getProduct(tenant, productId || '');
  const selectedProduct = rawProduct ? localizeProduct(rawProduct) : null;
  // 取还时间：优先用首页搜索带来的条件（datetime-local），否则默认明后天。
  const [startDate, setStartDate] = useState(params.get('start') || offsetDaysInput(1));
  const [endDate, setEndDate] = useState(params.get('end') || offsetDaysInput(3));
  const [quantity, setQuantity] = useState(1);
  const [fulfillment, setFulfillment] = useState<'pickup' | 'delivery'>('pickup');
  const pickupStoreId = params.get('pickup') || '';
  const [tab, setTab] = useState('intro');
  const navigate = useNavigate();
  // 真实租户模式下商品目录第二阶段才到位；未就绪时先按详情布局展示骨架，避免误报“商品不存在”与整块空白突现。
  if (!selectedProduct && isRemote && !productsReady) return <div className="shell detail-page" aria-label={t('loading')}>
    <div className="detail-grid">
      <div className="detail-gallery"><div className="detail-main-image" /></div>
      <div className="detail-summary"><div className="sk-line sk-line-md" /><div className="sk-line sk-line-lg" /><div className="sk-line" /><div className="sk-block" style={{ height: 150, marginTop: 16 }} /></div>
    </div>
  </div>;
  if (!selectedProduct) return <div className="shell missing-page"><h1>{t('missingProduct')}</h1><Link className="button button-dark" to={href('/products')}>{t('returnProducts')}</Link></div>;
  const product = selectedProduct;
  const category = tenant.categories.find(item => item.id === product.categoryId);
  const days = rentalDays(startDate, endDate);
  const available = product.stockStatus !== 'unavailable';
  const related = siteRepository.getProducts(tenant).filter(item => item.categoryId === product.categoryId && item.id !== product.id).slice(0, 4);
  const priceUnit = product.priceUnit === '天' && language === 'en' ? 'day' : product.priceUnit;
  function book() {
    if (!available || days < 1 || quantity < 1 || quantity > product.availableQuantity) return;
    const query = new URLSearchParams({ start: startDate, end: endDate, qty: String(quantity), fulfillment });
    if (pickupStoreId) query.set('pickup', pickupStoreId);
    navigate(href(`/booking/${product.id}?${query.toString()}`));
  }
  return <div className="shell detail-page"><div className="breadcrumb"><Link to={href('/')}>{t('home')}</Link><ArrowRightOutlined /><Link to={href(`/category/${product.categoryId}`)}>{category?.name}</Link><ArrowRightOutlined /><span>{product.name}</span></div>
    <div className="detail-grid"><div className="detail-gallery"><div className="detail-main-image"><Img src={product.cover} alt={product.name} loading="eager" /></div><div className="detail-image-note"><CheckCircleOutlined /> {t('detailImageNote')}</div></div>
      <div className="detail-summary"><span className="eyebrow">{category?.name}</span><h1>{product.name}</h1><p className="detail-subtitle">{product.subtitle}</p><div className="detail-rating">{product.reviewCount > 0 ? <><StarFilled /> {product.rating} <span>· {t('reviewsCount', { count: product.reviewCount })}</span></> : null}<span className="detail-availability">{available ? t('available', { count: product.availableQuantity }) : t('unavailable')}</span></div>
        <div className="detail-price"><strong>¥{product.price}</strong><span>/{priceUnit}</span><small>{t('depositConfirm', { amount: product.deposit })}</small></div>
        <div className="rental-panel"><h2>{t('chooseRentalPlan')}</h2><div className="form-grid"><label>{t('startDate')}<input type="datetime-local" min={nowInput()} value={startDate} onChange={event => { setStartDate(event.target.value); if (event.target.value > endDate) setEndDate(event.target.value); }} /></label><label>{t('endDate')}<input type="datetime-local" min={startDate} value={endDate} onChange={event => setEndDate(event.target.value)} /></label></div><div className="form-grid"><label>{t('rentalQuantity')}<select value={quantity} onChange={event => setQuantity(Number(event.target.value))}>{Array.from({ length: Math.min(product.availableQuantity, 10) }, (_, index) => <option value={index + 1} key={index}>{index + 1} {t('itemUnit')}</option>)}</select></label><label>{t('pickupDelivery')}<select value={fulfillment} onChange={event => setFulfillment(event.target.value as 'pickup' | 'delivery')}><option value="pickup">{t('pickup')}</option><option value="delivery">{t('deliveryHome')}</option></select></label></div><div className="rental-estimate"><span>{t('rentalDays')} <strong>{days} {language === 'en' ? 'day(s)' : '天'}</strong></span><span>{t('rentalEstimate')} <strong>¥{days * quantity * product.price}</strong></span></div><button className="button button-dark button-block" type="button" disabled={!available || days < 1} onClick={book}>{t('bookingTitle')}</button><p className="mock-note">{isRemote ? t('detailEstimateNote') : t('demoBookingNote')}</p></div>
        <div className="detail-service"><span><CheckCircleOutlined /> {t('authenticEquipment')}</span><span><TruckOutlined /> {t('flexibleReturn')}</span><span><CheckCircleOutlined /> {t('professionalCheck')}</span></div>
      </div>
    </div>
    <section className="detail-content"><div className="detail-tabs" role="tablist" aria-label={t('detailTabs')}><button className={tab === 'intro' ? 'active' : ''} onClick={() => setTab('intro')}>{t('intro')}</button><button className={tab === 'specs' ? 'active' : ''} onClick={() => setTab('specs')}>{t('specs')}</button><button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}>{t('rentalRules')}</button><button className={tab === 'deposit' ? 'active' : ''} onClick={() => setTab('deposit')}>{t('depositRules')}</button><button className={tab === 'fulfillment' ? 'active' : ''} onClick={() => setTab('fulfillment')}>{t('fulfillment')}</button><button className={tab === 'reviews' ? 'active' : ''} onClick={() => setTab('reviews')}>{t('reviews')}</button></div>
      {tab === 'intro' && <div className="detail-tab-content"><h2>{t('aboutProduct')}</h2><p>{product.description}</p><p>{t('detailIntroExtra')}</p></div>}
      {tab === 'specs' && <div className="detail-tab-content"><h2>{t('specs')}</h2><dl className="spec-list">{Object.entries(product.specs).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></div>}
      {tab === 'rules' && <div className="detail-tab-content"><h2>{t('rentalRules')}</h2><ul><li>{t('ruleOne')}</li><li>{t('ruleTwo')}</li><li>{t('ruleThree')}</li></ul></div>}
      {tab === 'deposit' && <div className="detail-tab-content"><h2>{t('depositRules')}</h2><p>{t('depositText', { amount: product.deposit })}</p></div>}
      {tab === 'fulfillment' && <div className="detail-tab-content"><h2>{t('fulfillment')}</h2><p>{t('fulfillmentText')}</p></div>}
      {tab === 'reviews' && <div className="detail-tab-content"><h2>{t('reviews')}</h2><p>{t('reviewsText')}</p></div>}
    </section>
    {related.length > 0 && <section className="section related-section"><SectionHeading title={t('related')} subtitle={t('relatedSubtitle')} /><div className="product-grid">{related.map(item => <ProductCard product={item} key={item.id} />)}</div></section>}
  </div>;
}
