import { Link } from 'react-router-dom';
import { useSite } from '../SiteContext';
import { Clock, MapPin, Store } from './SiteIcon';

/** Only configured pickup locations; no guessed geography or service promises. */
export function StoreDirectory() {
  const { tenant, language, isRemote, href } = useSite();
  const en = language === 'en';
  const stores = (tenant.stores ?? []).filter(store => !store.capabilities || store.capabilities.includes('pickup'));
  if (!stores.length) return null;
  return <section className="store-directory" aria-labelledby="store-directory-title">
    <div className="reading-section-heading"><h2 id="store-directory-title">{en ? 'A place to pick up your plans.' : '选一家顺路的门店。'}</h2><p>{en ? 'Choose a store, then check the rental dates.' : '先选门店，再按你的行程查询。'}{!isRemote && <span className="inline-demo-label">{en ? 'Demo locations' : '演示门店'}</span>}</p></div>
    <div className="store-directory-list">{stores.map(store => {
      const query = new URLSearchParams({ pickup: store.id, return: store.id });
      if (store.city) query.set('city', store.city);
      return <article key={store.id}><Store /><div><h3>{store.name}</h3><p><MapPin />{store.address}</p>{store.businessHours && <p><Clock />{store.businessHours}</p>}</div><Link to={href('/products?' + query)}>{en ? 'Browse rentals' : '查看可租商品'}<span className="sr-only"> · {store.name}</span></Link></article>;
    })}</div>
  </section>;
}
