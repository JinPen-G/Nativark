import { Link, useParams } from 'react-router-dom';
import { ArrowRightOutlined, CheckCircleOutlined, CustomerServiceOutlined, SafetyCertificateOutlined, TruckOutlined } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { siteRepository } from '../data/siteRepository';

export function OrdersPage() {
  const { tenant, href, localizeProduct, t } = useSite();
  const orders = siteRepository.getOrders(tenant);
  return <div className="shell simple-page"><div className="page-intro"><span className="eyebrow">MY RENTALS</span><h1>{t('orders')}</h1><p>{t('myRentalsDescription')}</p></div>{orders.length ? <div className="order-list">{orders.map(order => { const rawProduct = siteRepository.getProduct(tenant, order.productId); const product = rawProduct && localizeProduct(rawProduct); return <Link to={href(`/orders/${order.id}`)} className="order-row" key={order.id}><img src={product?.cover} alt="" /><div><strong>{product?.name || t('allProducts')}</strong><span>{order.startDate} – {order.endDate} · {order.quantity} {t('itemUnit')}</span><small>{order.id}</small></div><b>¥{order.rentalAmount}</b><ArrowRightOutlined /></Link>; })}</div> : <div className="empty-state"><h2>{t('noOrders')}</h2><p>{t('noOrdersDescription')}</p><Link className="button button-dark" to={href('/products')}>{t('browseProducts')} <ArrowRightOutlined /></Link></div>}</div>;
}

export function OrderDetailPage() {
  const { tenant, href, localizeProduct, language, t } = useSite();
  const { orderId } = useParams();
  const order = siteRepository.getOrders(tenant).find(item => item.id === orderId);
  const rawProduct = order && siteRepository.getProduct(tenant, order.productId);
  const product = rawProduct && localizeProduct(rawProduct);
  if (!order || !product) return <div className="shell missing-page"><h1>{t('missingOrder')}</h1><Link className="button button-dark" to={href('/orders')}>{t('returnOrders')}</Link></div>;
  return <div className="shell simple-page"><div className="page-intro"><span className="eyebrow">BOOKING DETAILS</span><h1>{t('savedTitle')}</h1><p>{t('orderNumber')} {order.id}</p></div><div className="order-confirmation"><CheckCircleOutlined /><h2>{language === 'en' ? 'Saved in this browser' : '记录已保存在当前浏览器'}</h2><p>{t('savedDescription')}</p></div><div className="booking-card order-detail-card"><h2>{t('bookingInfo')}</h2><div className="booking-product"><img src={product.cover} alt={product.name} /><div><strong>{product.name}</strong><p>{product.subtitle}</p></div></div><dl className="spec-list"><div><dt>{t('rentalDate')}</dt><dd>{order.startDate} – {order.endDate}</dd></div><div><dt>{t('rentalQuantity')}</dt><dd>{order.quantity} {t('itemUnit')}</dd></div><div><dt>{t('pickupDelivery')}</dt><dd>{order.fulfillment === 'pickup' ? t('pickup') : t('deliveryHome')}</dd></div><div><dt>{t('contactPerson')}</dt><dd>{order.contactName}</dd></div><div><dt>{t('contactPhone')}</dt><dd>{order.contactPhone}</dd></div><div><dt>{t('estimatedRent')}</dt><dd>¥{order.rentalAmount}</dd></div><div><dt>{t('referenceDeposit')}</dt><dd>¥{order.depositAmount}</dd></div></dl></div><Link className="button button-dark" to={href('/products')}>{t('continueExplore')} <ArrowRightOutlined /></Link></div>;
}

export function AboutPage() {
  const { tenant, href, t } = useSite();
  return <div className="shell simple-page"><div className="page-intro"><span className="eyebrow">ABOUT US</span><h1>{t('aboutTitle', { name: tenant.name })}</h1><p>{tenant.footerText}</p></div><div className="info-grid"><article><SafetyCertificateOutlined /><h2>{t('aboutSelected')}</h2><p>{t('aboutSelectedText')}</p></article><article><TruckOutlined /><h2>{t('aboutFlexible')}</h2><p>{t('aboutFlexibleText')}</p></article><article><CustomerServiceOutlined /><h2>{t('aboutService')}</h2><p>{t('aboutServiceText')}</p></article></div><Link className="button button-dark" to={href('/products')}>{t('exploreAllProducts')} <ArrowRightOutlined /></Link></div>;
}

export function GuidePage() {
  const { href, t } = useSite();
  const steps = [[t('guideChoose'), t('guideChooseText')], [t('guideTerm'), t('guideTermText')], [t('guideSubmit'), t('guideSubmitText')], [t('guideConfirm'), t('guideConfirmText')]];
  return <div className="shell simple-page"><div className="page-intro"><span className="eyebrow">RENTAL GUIDE</span><h1>{t('guideTitle')}</h1><p>{t('guideDescription')}</p></div><div className="guide-list">{steps.map(([title, text], index) => <article key={title}><span>{String(index + 1).padStart(2, '0')}</span><div><h2>{title}</h2><p>{text}</p></div></article>)}</div><Link className="button button-dark" to={href('/products')}>{t('startChoosing')} <ArrowRightOutlined /></Link></div>;
}

export function HelpPage() {
  const { tenant, t } = useSite();
  return <div className="shell simple-page"><div className="page-intro"><span className="eyebrow">HELP CENTER</span><h1>{t('helpTitle')}</h1><p>{t('helpDescription')}</p></div><div className="faq-list"><details><summary>{t('faqTerm')}</summary><p>{t('faqTermText')}</p></details><details><summary>{t('faqDeposit')}</summary><p>{t('faqDepositText')}</p></details><details><summary>{t('faqDelivery')}</summary><p>{t('faqDeliveryText')}</p></details><details><summary>{t('faqContact')}</summary><p>{t('faqContactText', { phone: tenant.phone, service: tenant.customerService })}</p></details></div></div>;
}
