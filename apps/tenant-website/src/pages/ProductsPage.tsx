import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRightOutlined, SearchOutlined } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { ProductCard } from '../components/ProductCard';
import { siteRepository } from '../data/siteRepository';

export function ProductsPage() {
  const { tenant, tenantKey, isRemote, productsReady, href, language, localizeProduct, t } = useSite();
  const { categoryId } = useParams();
  const [params, setParams] = useSearchParams();
  const category = tenant.categories.find(item => item.id === categoryId);
  const selectedCategory = category?.id || params.get('category') || 'all';
  const selectedSub = params.get('sub') || 'all';
  const search = params.get('search') || '';
  const [searchInput, setSearchInput] = useState(search);
  const [sort, setSort] = useState('recommended');
  const filtered = useMemo(() => {
    const result = siteRepository.getProducts(tenant).map(localizeProduct).filter(product => {
      const matchesCategory = selectedCategory === 'all' || product.categoryId === selectedCategory;
      const matchesSub = selectedSub === 'all' || product.subCategoryId === selectedSub;
      const q = search.trim().toLocaleLowerCase();
      const matchesSearch = !q || `${product.name} ${product.subtitle} ${product.tags.join(' ')}`.toLocaleLowerCase().includes(q);
      return matchesCategory && matchesSub && matchesSearch;
    });
    if (sort === 'price-low') result.sort((a, b) => a.price - b.price);
    if (sort === 'price-high') result.sort((a, b) => b.price - a.price);
    if (sort === 'rating') result.sort((a, b) => b.rating - a.rating);
    return result;
  }, [tenant, localizeProduct, selectedCategory, selectedSub, search, sort]);
  const activeCategory = tenant.categories.find(item => item.id === selectedCategory);
  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === 'all' || !value) next.delete(key); else next.set(key, value);
    // 保留当前租户识别参数：演示带 tenant，显式指定带 tenantCode；域名/环境变量识别的无需带。
    const code = params.get('tenantCode');
    if (isRemote && code) next.set('tenantCode', code); else if (!isRemote) next.set('tenant', tenantKey);
    setParams(next);
  }
  const categoryTitle = category ? `${category.name} ${language === 'en' ? 'rentals' : '租赁'}` : t('discoveryTitle');
  const categoryDescription = category ? category.description : t('discoveryDescription');
  return <div className="shell listing-page">
    <div className="breadcrumb"><Link to={href('/')}>{t('home')}</Link><ArrowRightOutlined /> <span>{category?.name || t('allProducts')}</span></div>
    <div className="page-intro"><span className="eyebrow">{t('exploreCollection')}</span><h1>{categoryTitle}</h1><p>{categoryDescription}</p></div>
    <div className="catalog-layout"><aside className="catalog-sidebar"><h2>{t('productCategory')}</h2><nav aria-label={t('productCategory')}><Link className={selectedCategory === 'all' ? 'active' : ''} to={href('/products')}>{t('allProducts')} <span>{siteRepository.getProducts(tenant).length}</span></Link>{tenant.categories.map(item => <Link className={selectedCategory === item.id ? 'active' : ''} key={item.id} to={href(`/category/${item.id}`)}>{item.name}<span>{siteRepository.getProducts(tenant).filter(product => product.categoryId === item.id).length}</span></Link>)}</nav></aside>
      <div className="catalog-main"><div className="catalog-toolbar"><form onSubmit={event => { event.preventDefault(); updateParam('search', searchInput.trim()); }}><SearchOutlined /><input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder={t('searchProducts')} aria-label={t('searchAria')} /><button type="submit">{t('search')}</button></form><span>{t('itemCount', { count: filtered.length })}</span><select value={sort} onChange={event => setSort(event.target.value)} aria-label={t('sortLabel')}><option value="recommended">{t('recommendedSort')}</option><option value="price-low">{t('priceLow')}</option><option value="price-high">{t('priceHigh')}</option><option value="rating">{t('ratingSort')}</option></select></div>
        {activeCategory && activeCategory.children.length > 1 && <div className="filter-chips" aria-label={t('subcategory')}><button className={selectedSub === 'all' ? 'active' : ''} onClick={() => updateParam('sub', 'all')}>{t('categoryAll')}</button>{activeCategory.children.map(child => <button key={child.id} className={selectedSub === child.id ? 'active' : ''} onClick={() => updateParam('sub', child.id)}>{child.name}</button>)}</div>}
        {filtered.length ? <div className="product-grid catalog-grid">{filtered.map(product => <ProductCard product={product} key={product.id} />)}</div> : (isRemote && !productsReady) ? <div className="product-grid catalog-grid product-grid-loading" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div className="product-card-skeleton" key={i} />)}</div> : <div className="empty-state"><SearchOutlined /><h2>{t('noProducts')}</h2><p>{t('tryOther')}</p><Link className="button button-dark" to={href('/products')}>{t('viewAll')} {t('allProducts')}</Link></div>}
      </div>
    </div>
  </div>;
}
