import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Search as SearchOutlined } from '../components/SiteIcon';
import { useSite } from '../SiteContext';
import { ProductCard } from '../components/ProductCard';
import { siteRepository } from '../data/siteRepository';
import { clientApi } from '../data/apiClient';
import { toIsoDateTime } from '../data/datetime';
import { Breadcrumbs, PageHeading } from '../components/PageHeader';
import { CatalogConditions } from '../components/CatalogConditions';
import { useActiveRail } from '../hooks/useActiveRail';

export function ProductsPage() {
  const { tenant, tenantKey, tenantCode, isRemote, productsReady, href, language, localizeProduct, t } = useSite();
  const { categoryId } = useParams();
  const [params, setParams] = useSearchParams();
  const category = tenant.categories.find(item => item.id === categoryId);
  const selectedCategory = category?.id || params.get('category') || 'all';
  const categoryRail = useActiveRail<HTMLElement>(`${selectedCategory}:${language}`);
  const selectedSub = params.get('sub') || 'all';
  const search = params.get('search') || '';
  const pickup = params.get('pickup') || '';
  const returnStore = params.get('return') || '';
  const start = params.get('start') || '';
  const end = params.get('end') || '';
  const [searchInput, setSearchInput] = useState(search);
  const [sort, setSort] = useState('recommended');
  useEffect(() => { setSearchInput(search); }, [search]);

  // 条件贯穿：把门店/时段拼成 query，向后带入商品详情（详情页据此预填取还时间）。
  const conditionQuery = useMemo(() => {
    const query = new URLSearchParams();
    if (pickup) query.set('pickup', pickup);
    if (returnStore) query.set('return', returnStore);
    if (start) query.set('start', start);
    if (end) query.set('end', end);
    if (params.get('city')) query.set('city', params.get('city')!);
    return query.toString();
  }, [pickup, returnStore, start, end, params]);

  const baseFiltered = useMemo(() => {
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
  // 真实按时段/门店过滤：仅真实模式 + 选定单一品类 + 有时段时，调公开可用性检索过滤到真正可租的型号。
  // 演示模式或接口未就绪/响应形状不符：不过滤，标注「时段可用性下单时校验」，绝不误伤展示。
  const canRealFilter = isRemote && Boolean(tenantCode) && selectedCategory !== 'all' && Boolean(start && end);
  const [availableIds, setAvailableIds] = useState<Set<string> | null>(null);
  const [availabilityChecking, setAvailabilityChecking] = useState(false);
  const candidateKey = baseFiltered.map(product => product.id).join(',');
  useEffect(() => {
    if (!canRealFilter || !tenantCode || baseFiltered.length === 0) { setAvailableIds(null); setAvailabilityChecking(false); return; }
    let cancelled = false;
    setAvailabilityChecking(true);
    clientApi.publicAvailability(tenantCode, selectedCategory, {
      locationId: pickup || undefined,
      startAt: toIsoDateTime(start),
      endAt: toIsoDateTime(end),
      lines: baseFiltered.map(product => ({ itemGroupId: product.id, quantity: 1 })),
    }).then(response => {
      if (cancelled) return;
      const lines = Array.isArray(response.lines) ? response.lines : null;
      if (!lines) { setAvailableIds(null); return; }
      setAvailableIds(new Set(lines.filter(line => line.available !== false && (line.availableQuantity ?? 1) > 0).map(line => line.itemGroupId)));
    }).catch(() => { if (!cancelled) setAvailableIds(null); })
      .finally(() => { if (!cancelled) setAvailabilityChecking(false); });
    return () => { cancelled = true; };
  }, [canRealFilter, tenantCode, selectedCategory, pickup, start, end, candidateKey]);

  const filtered = useMemo(
    () => (availableIds ? baseFiltered.filter(product => availableIds.has(product.id)) : baseFiltered),
    [baseFiltered, availableIds],
  );
  const activeCategory = tenant.categories.find(item => item.id === selectedCategory);
  const conditionNote = availabilityChecking ? t('checkingAvailability') : availableIds ? t('filteredByCondition') : t('availabilityAtOrder');
  const allProducts = siteRepository.getProducts(tenant);

  function categoryTo(id?: string) {
    const next = new URLSearchParams(params);
    next.delete('category'); next.delete('sub');
    return href(`${id ? `/category/${id}` : '/products'}?${next.toString()}`);
  }

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
    <Breadcrumbs items={[{ label: t('home'), to: href('/') }, { label: category?.name || t('allProducts') }]} />
    <PageHeading title={categoryTitle} description={categoryDescription} />
    <CatalogConditions params={params} onApply={setParams} note={conditionNote} />
    <div className="catalog-layout"><aside className="catalog-sidebar"><h2>{t('productCategory')}</h2><nav ref={categoryRail} aria-label={t('productCategory')}><Link className={selectedCategory === 'all' ? 'active' : ''} aria-current={selectedCategory === 'all' ? 'page' : undefined} to={categoryTo()}>{t('allProducts')} <span>{allProducts.length}</span></Link>{tenant.categories.map(item => <Link className={selectedCategory === item.id ? 'active' : ''} aria-current={selectedCategory === item.id ? 'page' : undefined} key={item.id} to={categoryTo(item.id)}>{item.name}<span>{allProducts.filter(product => product.categoryId === item.id).length}</span></Link>)}</nav></aside>
      <div className="catalog-main"><div className="catalog-toolbar"><form onSubmit={event => { event.preventDefault(); updateParam('search', searchInput.trim()); }}><SearchOutlined /><input value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder={t('searchProducts')} aria-label={t('searchAria')} /><button type="submit">{t('search')}</button></form><span>{t('itemCount', { count: filtered.length })}</span><select value={sort} onChange={event => setSort(event.target.value)} aria-label={t('sortLabel')}><option value="recommended">{t('recommendedSort')}</option><option value="price-low">{t('priceLow')}</option><option value="price-high">{t('priceHigh')}</option><option value="rating">{t('ratingSort')}</option></select></div>
        {activeCategory && activeCategory.children.length > 1 && <div className="filter-chips" aria-label={t('subcategory')}><button className={selectedSub === 'all' ? 'active' : ''} onClick={() => updateParam('sub', 'all')}>{t('categoryAll')}</button>{activeCategory.children.map(child => <button key={child.id} className={selectedSub === child.id ? 'active' : ''} onClick={() => updateParam('sub', child.id)}>{child.name}</button>)}</div>}
        {((isRemote && !productsReady) || availabilityChecking)
          ? <div className="product-grid catalog-grid product-grid-loading" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div className="product-card-skeleton" key={i} />)}</div>
          : filtered.length
            ? <div className="product-grid catalog-grid">{filtered.map(product => <ProductCard product={product} search={conditionQuery} key={product.id} />)}</div>
            : <div className="empty-state"><SearchOutlined /><h2>{t('noProducts')}</h2><p>{t('tryOther')}</p><div className="empty-state-actions">{search && <button type="button" className="button button-dark" onClick={() => updateParam('search', '')}>{language === 'en' ? 'Clear search' : '清除搜索'}</button>}{selectedSub !== 'all' && <button type="button" className="button button-outline" onClick={() => updateParam('sub', 'all')}>{language === 'en' ? 'Clear subcategory' : '查看全部二级分类'}</button>}{selectedCategory !== 'all' && <Link className="button button-outline" to={categoryTo()}>{t('allProducts')}</Link>}</div></div>}
      </div>
    </div>
  </div>;
}

