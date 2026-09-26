import { Link } from 'react-router-dom';
import { StarFilled } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { Img } from './Img';
import type { Product } from '../types';

export function ProductCard({ product, search }: { product: Product; search?: string }) {
  const { href, localizeProduct, language, t } = useSite();
  const displayProduct = localizeProduct(product);
  const unavailable = displayProduct.stockStatus === 'unavailable';
  // 首页搜索选定的门店/时段作为条件贯穿：拼到商品详情链接，详情页据此预填取还时间。
  const detailTo = href(`/product/${displayProduct.id}${search ? `?${search}` : ''}`);
  return <article className="product-card">
    <Link to={detailTo} className="product-image-link" aria-label={`${t('viewNow')} ${displayProduct.name}`}>
      <Img src={displayProduct.cover} alt={displayProduct.name} />
      {displayProduct.badges[0] && <span className="product-badge">{displayProduct.badges[0]}</span>}
    </Link>
    <div className="product-card-body">
      <Link to={detailTo} className="product-name">{displayProduct.name}</Link>
      <p className="product-subtitle">{displayProduct.subtitle}</p>
      <div className="product-metadata"><span className={unavailable ? 'stock-out' : 'stock-ok'}>{unavailable ? t('unavailable') : displayProduct.stockStatus === 'low' ? (language === 'en' ? 'Limited stock' : '余量较少') : (language === 'en' ? 'Available' : '可预约')}</span>{displayProduct.reviewCount > 0 ? <span><StarFilled aria-hidden="true" /> {displayProduct.rating}</span> : null}</div>
      <div className="product-price"><strong>¥{displayProduct.price}</strong><span>/{displayProduct.priceUnit === '天' && language === 'en' ? 'day' : displayProduct.priceUnit}</span></div>
      <Link className={`button button-dark product-rent ${unavailable ? 'is-disabled' : ''}`} to={unavailable ? '#' : detailTo} aria-disabled={unavailable}>{t('bookNow')}</Link>
    </div>
  </article>;
}
