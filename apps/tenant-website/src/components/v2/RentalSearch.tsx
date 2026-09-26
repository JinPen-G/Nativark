import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSite } from '../../SiteContext';
import { useHeroSearch } from '../../hooks/useHeroSearch';
import type { Category, Store } from '../../types';

// 首屏预约搜索：品类（随选择器）+ 取货/归还门店 + 取还时间（date+time）→「查看可租商品」。
// 统一在提交时生成条件并跳转 /category/:id?pickup&return&start&end（经 href 保留租户参数）。
export function RentalSearch({ category, stores }: { category?: Category; stores: Store[] }) {
  const { href, t } = useSite();
  const navigate = useNavigate();
  const search = useHeroSearch();
  const [submitting, setSubmitting] = useState(false);
  const hasStores = stores.length > 0;
  const pickupStores = stores.filter(store => !store.capabilities || store.capabilities.includes('pickup'));
  const returnStores = stores.filter(store => !store.capabilities || store.capabilities.includes('return'));
  // 安全兜底：正常点「查看可租商品」会跳转到另一路径、本组件随首页卸载；
  // 万一被复用于同路径场景（不卸载），800ms 后自动解除 pending，避免按钮永久禁用。
  useEffect(() => {
    if (!submitting) return;
    const timer = window.setTimeout(() => setSubmitting(false), 800);
    return () => window.clearTimeout(timer);
  }, [submitting]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (search.invalidRange) return;
    setSubmitting(true);
    const query = search.toQuery();
    const base = category ? `/category/${category.id}` : '/products';
    navigate(href(query ? `${base}?${query}` : base));
  }

  return (
    <form className="v2-search" onSubmit={submit} aria-label={t('heroViewAvailable')}>
      <div className="v2-search-fields">
        {hasStores && (
          <label className="v2-field">
            <span className="v2-field-label">{t('searchPickup')}</span>
            <select value={search.pickupStoreId} onChange={event => search.setPickup(event.target.value)}>
              <option value="">{t('searchSelectStore')}</option>
              {pickupStores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </label>
        )}
        {hasStores && !search.sameStore && (
          <label className="v2-field">
            <span className="v2-field-label">{t('searchReturn')}</span>
            <select value={search.returnStoreId} onChange={event => search.setReturn(event.target.value)}>
              <option value="">{t('searchSelectStore')}</option>
              {returnStores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </label>
        )}
        <label className="v2-field">
          <span className="v2-field-label">{t('searchStart')}</span>
          <input type="datetime-local" value={search.startAt} min={search.minStart} onChange={event => search.setStartAt(event.target.value)} />
        </label>
        <label className="v2-field">
          <span className="v2-field-label">{t('searchEnd')}</span>
          <input type="datetime-local" value={search.endAt} min={search.startAt || search.minStart} onChange={event => search.setEndAt(event.target.value)} />
        </label>
        <button type="submit" className="v2-search-go" disabled={submitting}>{submitting ? t('searching') : t('heroViewAvailable')}</button>
      </div>
      <div className="v2-search-meta">
        {hasStores && (
          <label className="v2-samestore">
            <input type="checkbox" checked={search.sameStore} onChange={event => search.setSameStore(event.target.checked)} />
            <span>{t('searchSameStore')}</span>
          </label>
        )}
        {search.invalidRange && <span className="v2-search-error" role="alert">{t('searchInvalidRange')}</span>}
      </div>
    </form>
  );
}
