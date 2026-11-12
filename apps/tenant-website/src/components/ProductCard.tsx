import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSite } from '../SiteContext';
import { Img } from './Img';
import type { Product } from '../types';

export function ProductCard({ product, search = '' }: { product: Product; search?: string }) {
  const { href, language, isRemote } = useSite();
  const en = language === 'en';
  const unavailable = product.stockStatus === 'unavailable';
  return <article className="product-card">
    <Link className="product-image-link" to={href(`/product/${encodeURIComponent(product.id)}${search ? '?' + search : ''}`)} aria-label={en ? `View ${product.name}` : `查看${product.name}`}>
      <Img src={product.cover} alt={product.name} width="640" height="640" />
      <span className="product-open"><ArrowUpRight /></span>
      {unavailable && <span className="product-unavailable">{en ? 'Currently unavailable' : '暂时不可租'}</span>}
    </Link>
    <div className="product-card-content"><h3><Link to={href(`/product/${encodeURIComponent(product.id)}${search ? '?' + search : ''}`)}>{product.name}</Link></h3><p>{product.subtitle}</p><div className="product-card-price"><strong>{product.price !== undefined && product.currency ? `${product.currency === 'CNY' ? '¥' : product.currency + ' '}${product.price}` : en ? 'Request a quote' : '查看报价'}</strong>{product.price !== undefined && product.currency && <span>/ {product.priceUnit === '天' && en ? 'day' : product.priceUnit}</span>}<small>{isRemote ? en ? 'Reference price' : '参考价格' : en ? 'Demo rate' : '演示日租'}</small></div></div>
  </article>;
}
