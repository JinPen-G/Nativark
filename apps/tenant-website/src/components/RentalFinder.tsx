import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, MapPin as EnvironmentOutlined, Store, Calendar, CategoryIcon } from './SiteIcon';
import { useSite } from '../SiteContext';
import { useHeroSearch } from '../hooks/useHeroSearch';
import { useActiveRail } from '../hooks/useActiveRail';

/** Collects rental intent only. Availability and result rendering belong to the list route. */
export function RentalFinder() {
  const { tenant, href, language } = useSite();
  const en = language === 'en';
  const navigate = useNavigate();
  const rental = useHeroSearch();
  const [selected, setSelected] = useState('');
  const [city, setCity] = useState('');
  const category = tenant.categories.find(item => item.id === selected) ?? tenant.categories[0];
  const categoryRail = useActiveRail<HTMLDivElement>(`${category?.id ?? ''}:${language}`);
  const stores = (tenant.stores ?? []).filter(store => !store.capabilities || store.capabilities.includes('pickup'));
  const cities = [...new Set(stores.flatMap(store => store.city ? [store.city] : []))];
  const visibleStores = stores.filter(store => !city || store.city === city);
  const activeStore = visibleStores.find(store => store.id === rental.pickupStoreId);
  // Tenant switches may replace the entire location catalog.
  useEffect(() => { setCity(''); rental.setPickup(''); }, [tenant.id]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!category || rental.invalidRange || (stores.length > 0 && !activeStore)) return;
    const query = new URLSearchParams(rental.toQuery());
    if (city) query.set('city', city);
    navigate(href(`/category/${category.id}?${query.toString()}`));
  }

  return <form className="rental-finder" id="rental-finder" onSubmit={submit} aria-label={en ? 'Find your rental' : '查找租赁商品'}>
    <div className="finder-top">
      <div ref={categoryRail} className="finder-categories" aria-label={en ? 'Rental category' : '租赁品类'}>
        {tenant.categories.map(item => <button key={item.id} type="button" aria-pressed={category?.id === item.id} onClick={() => setSelected(item.id)}><CategoryIcon name={item.icon} />{item.name}</button>)}
      </div>
      <span className="finder-price-note">{en ? 'Dates, place, and a plan of your own.' : '先选好时间与门店，看看有哪些选择。'}</span>
    </div>
    <div className="finder-fields">
      <label className="finder-city"><span><EnvironmentOutlined aria-hidden="true" /> {en ? 'City' : '取还城市'}</span>
        <select aria-label={en ? 'City' : '取还城市'} value={city} required={cities.length > 0} disabled={cities.length === 0} onChange={event => { setCity(event.target.value); rental.setPickup(''); }}>
          <option value="">{cities.length ? en ? 'Choose a city' : '选择城市' : en ? 'Select a store below' : '请直接选择门店'}</option>
          {cities.map(value => <option key={value} value={value}>{en ? stores.find(store => store.city === value)?.cityEn || value : value}</option>)}
        </select>
      </label>
      <label className="finder-store"><span><Store />{en ? 'Pickup & return store' : '取还门店'}</span>
        <select aria-label={en ? 'Pickup & return store' : '取还门店'} value={activeStore?.id ?? ''} required={stores.length > 0} onChange={event => rental.setPickup(event.target.value)} disabled={!stores.length}>
          <option value="">{stores.length ? en ? 'Choose a store' : '选择门店' : en ? 'Confirm with the store' : '地点预约时确认'}</option>
          {visibleStores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select>
      </label>
      <label><span><Calendar />{en ? 'Pickup date & time' : '取货时间'}</span><input aria-label={en ? 'Pickup date & time' : '取货时间'} type="datetime-local" value={rental.startAt} min={rental.minStart} required onChange={event => rental.setStartAt(event.target.value)} /></label>
      <label><span><Calendar />{en ? 'Return date & time' : '归还时间'}</span><input aria-label={en ? 'Return date & time' : '归还时间'} type="datetime-local" value={rental.endAt} min={rental.startAt} required onChange={event => rental.setEndAt(event.target.value)} /></label>
      <button className="finder-submit" type="submit" disabled={!category}><Search />{en ? 'Find my rental' : '查询可租商品'}</button>
    </div>
    {rental.invalidRange && <p className="finder-error" role="alert">{en ? 'Return must be later than pickup. Please adjust the dates.' : '归还时间需晚于取货时间，请调整租期。'}</p>}
  </form>;
}
