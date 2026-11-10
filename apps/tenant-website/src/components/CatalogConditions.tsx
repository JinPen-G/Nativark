import { useEffect, useState, type FormEvent } from 'react';
import { useSite } from '../SiteContext';
import { nowInput } from '../data/datetime';
import { Calendar, ChevronDown, MapPin } from './SiteIcon';

/** Edits the existing listing query; stock and prices stay in the original data layer. */
export function CatalogConditions({ params, onApply, note }: { params: URLSearchParams; onApply: (params: URLSearchParams) => void; note: string }) {
  const { tenant, language, t } = useSite();
  const en = language === 'en';
  const [open, setOpen] = useState(false);
  const [pickup, setPickup] = useState(params.get('pickup') || '');
  const [start, setStart] = useState(params.get('start') || '');
  const [end, setEnd] = useState(params.get('end') || '');
  const [error, setError] = useState('');
  const stores = (tenant.stores ?? []).filter(store => !store.capabilities || store.capabilities.includes('pickup'));
  const currentStore = stores.find(store => store.id === params.get('pickup'));
  const returnStore = tenant.stores?.find(store => store.id === params.get('return'));
  useEffect(() => { setPickup(params.get('pickup') || ''); setStart(params.get('start') || ''); setEnd(params.get('end') || ''); }, [params]);

  function apply(event: FormEvent) {
    event.preventDefault();
    if (!start || !end || end <= start || start < nowInput()) { setError(en ? 'Choose a future pickup and a later return time.' : '请选择未来的取货时间，且归还时间须晚于取货时间。'); return; }
    const next = new URLSearchParams(params);
    next.set('start', start); next.set('end', end);
    const store = stores.find(item => item.id === pickup);
    if (store) {
      next.set('pickup', store.id);
      // Retain an existing different-return agreement unless pickup changed.
      if (store.id !== params.get('pickup') || !params.get('return')) next.set('return', store.id);
    }
    else { next.delete('pickup'); next.delete('return'); }
    if (store?.city) next.set('city', store.city); else next.delete('city');
    onApply(next); setError(''); setOpen(false);
  }
  return <section className={`catalog-conditions${open ? ' is-editing' : ''}`} aria-label={en ? 'Rental conditions' : '租赁查询条件'}>
    <div className="condition-bar">
      <span className="condition-item"><MapPin />{currentStore ? [en ? currentStore.cityEn || currentStore.city : currentStore.city, currentStore.name].filter(Boolean).join(' · ') : en ? 'Choose pickup store' : '选择取还门店'}{returnStore && returnStore.id !== currentStore?.id && ` → ${returnStore.name}`}</span>
      <span className="condition-item"><Calendar />{params.get('start') && params.get('end') ? `${params.get('start')!.replace('T', ' ')} – ${params.get('end')!.replace('T', ' ')}` : en ? 'Choose rental dates' : '选择租赁时间'}</span>
      <button className="condition-edit" type="button" aria-expanded={open} aria-controls="catalog-condition-fields" onClick={() => { setError(''); setOpen(!open); }}>{open ? en ? 'Close' : '收起' : t('conditionEdit')}<ChevronDown /></button>
    </div>
    {open && <form className="condition-fields" id="catalog-condition-fields" onSubmit={apply}>
      <label>{en ? 'Pickup & return store' : '取还门店'}<select value={pickup} onChange={event => setPickup(event.target.value)} required={stores.length > 0} disabled={!stores.length}><option value="">{stores.length ? en ? 'Choose a store' : '选择门店' : en ? 'Confirm when booking' : '预约时确认'}</option>{stores.map(store => <option value={store.id} key={store.id}>{store.name}</option>)}</select></label>
      <label>{t('startDate')}<input type="datetime-local" value={start} min={nowInput()} required onChange={event => setStart(event.target.value)} /></label>
      <label>{t('endDate')}<input type="datetime-local" value={end} min={start || nowInput()} required onChange={event => setEnd(event.target.value)} /></label>
      <div className="condition-form-actions"><button className="button button-dark" type="submit">{en ? 'Update search' : '更新查询'}</button><button className="text-button" type="button" onClick={() => { setOpen(false); setError(''); setPickup(params.get('pickup') || ''); setStart(params.get('start') || ''); setEnd(params.get('end') || ''); }}>{en ? 'Cancel' : '取消'}</button></div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>}
    <p className="condition-note" role="status">{note}</p>
  </section>;
}
