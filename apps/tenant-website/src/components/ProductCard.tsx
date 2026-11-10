import { Link } from 'react-router-dom';
import { Star as StarFilled } from './SiteIcon';
import { useSite } from '../SiteContext';
import { Img } from './Img';
import type { Product } from '../types';

export function ProductCard({ product, search, compact = false }: { product: Product; search?: string; compact?: boolean }) {
  const { href, localizeProduct, language, t } = useSite();
  const displayProduct = localizeProduct(product);
  const unavailable = displayProduct.stockStatus === 'unavailable';
  // 首页搜索选定的门店/时段作为条件贯穿：拼到商品详情链接，详情页据此预填取还时间。
  const detailTo = href(`/product/${displayProduct.id}${search ? `?${search}` : ''}`);
  return <article className={`product-card${compact ? ' product-card-compact' : ''}`}>
    <Link to={detailTo} className="product-image-link" aria-label={`${t('viewNow')} ${displayProduct.name}`}>
      <Img src={displayProduct.cover} alt={displayProduct.name} />
      {displayProduct.badges[0] && <span className="product-badge">{displayProduct.badges[0]}</span>}
    </Link>
    <div className="product-card-body">
      <Link to={detailTo} className="product-name">{displayProduct.name}</Link>
      <p className="product-subtitle">{displayProduct.subtitle}</p>
      {!compact && <div className="product-metadata"><span className={unavailable ? 'stock-out' : 'stock-ok'}>{unavailable ? t('unavailable') : displayProduct.stockStatus === 'low' ? (language === 'en' ? 'Limited stock' : '余量较少') : displayProduct.stockStatus === 'unknown' ? (language === 'en' ? 'Check availability for your dates' : '选择租期确认库存') : (language === 'en' ? 'Available' : '可预约')}</span>{(displayProduct.reviewCount ?? 0) > 0 ? <span><StarFilled aria-hidden="true" /> {displayProduct.rating}</span> : null}</div>}
      <div className="product-card-bottom"><div className="product-price"><strong>{displayProduct.price === undefined ? (language === 'en' ? 'Select dates for a quote' : '选租期查看报价') : `${displayProduct.currency ?? '¥'} ${displayProduct.price}`}</strong>{displayProduct.price !== undefined && <span>/{displayProduct.priceUnit === '天' && language === 'en' ? 'day' : displayProduct.priceUnit}</span>}</div>
      {unavailable ? <span className="product-rent is-disabled">{t('unavailable')}</span> : <Link className="button product-rent" to={detailTo} aria-label={`${t('viewNow')} ${displayProduct.name}`}>{t('viewNow')}</Link>}
      </div>
    </div>
  </article>;
}
