import { Link } from 'react-router-dom';
import { ArrowRightOutlined, StarFilled } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import type { Product } from '../types';

export function ProductCard({ product }: { product: Product }) {
  const { href, localizeProduct, language, t } = useSite();
  const displayProduct = localizeProduct(product);
  const unavailable = displayProduct.stockStatus === 'unavailable';
  return <article className="product-card">
    <Link to={href(`/product/${displayProduct.id}`)} className="product-image-link" aria-label={`${t('viewNow')} ${displayProduct.name}`}>
      <img src={displayProduct.cover} alt={displayProduct.name} loading="lazy" />
      {displayProduct.badges[0] && <span className="product-badge">{displayProduct.badges[0]}</span>}
    </Link>
    <div className="product-card-body">
      <Link to={href(`/product/${displayProduct.id}`)} className="product-name">{displayProduct.name}</Link>
      <p className="product-subtitle">{displayProduct.subtitle}</p>
      <div className="product-metadata"><span className={unavailable ? 'stock-out' : 'stock-ok'}>{unavailable ? t('unavailable') : displayProduct.stockStatus === 'low' ? (language === 'en' ? 'Limited stock' : '余量较少') : (language === 'en' ? 'Available' : '可预约')}</span><span><StarFilled aria-hidden="true" /> {displayProduct.rating}</span></div>
      <div className="product-price"><strong>¥{displayProduct.price}</strong><span>/{displayProduct.priceUnit === '天' && language === 'en' ? 'day' : displayProduct.priceUnit}</span></div>
      <Link className={`button button-dark product-rent ${unavailable ? 'is-disabled' : ''}`} to={unavailable ? '#' : href(`/product/${displayProduct.id}`)} aria-disabled={unavailable}>{t('bookNow')} <ArrowRightOutlined aria-hidden="true" /></Link>
    </div>
  </article>;
}
