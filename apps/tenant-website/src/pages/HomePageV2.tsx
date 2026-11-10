import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, SearchCheck, Store, CategoryIcon } from '../components/SiteIcon';
import { useSite } from '../SiteContext';
import { Img } from '../components/Img';
import { RentalFinder } from '../components/RentalFinder';
import { ProductCard } from '../components/ProductCard';
import { siteRepository } from '../data/siteRepository';

/** Brand discovery and rental intent; selected-stock results live on ProductsPage. */
export function HomePageV2() {
  const { tenant, mode, language, isRemote, productsReady, href, localizeProduct, t } = useSite();
  const en = language === 'en';
  const all = siteRepository.getProducts(tenant);
  const featured = useMemo(() => {
    const groups = tenant.categories.map(category => all.filter(item => item.categoryId === category.id));
    const mixed = [];
    for (let index = 0; index < Math.max(0, ...groups.map(group => group.length)); index++) {
      for (const group of groups) if (group[index]) mixed.push(group[index]);
    }
    return mixed.slice(0, 6).map(localizeProduct);
  }, [tenant, all, localizeProduct]);
  const title = tenant.heroTitle;
  const description = tenant.heroDescription;
  const heroImage = isRemote ? tenant.heroImage : '/assets/brand-journey.webp';
  const discovery = mode === 'single' ? tenant.categories[0]?.children ?? [] : tenant.categories;
  const campaigns = tenant.campaigns ?? [];
  const steps = [
    { Icon: Calendar, title: en ? 'Pick a time and place' : '先定时间与门店', text: en ? 'Choose your dates, rental category and pickup store.' : '选好租期、品类和方便的取还门店。' },
    { Icon: SearchCheck, title: en ? 'Choose your gear' : '挑到这次需要的', text: en ? 'See the options and compare rental prices.' : '查看商品和价格，再选合适的设备。' },
    { Icon: Store, title: en ? 'Confirm the details' : '确认预约与取还', text: en ? 'Confirm your booking and collection arrangements.' : '核对费用，按确认的时间与方式取用。' },
  ];
  return <div className={`brand-home brand-home-${mode}`}>
    {(tenant.announcement || !isRemote) && <div className="brand-announcement"><span>{en ? tenant.announcementEn || tenant.announcement : tenant.announcement}</span><a href="#rental-finder">{en ? 'Plan your rental' : '开启租赁'}</a></div>}
    <section className="brand-campaign" aria-label={en ? 'Your next plan' : '你的下一次计划'}>
      <Img src={heroImage} alt="" loading="eager" fetchPriority="high" />
      <div className="campaign-shade" aria-hidden="true" />
      <div className="shell campaign-content"><h1>{title}</h1><p>{description}</p><a href="#rental-finder" className="campaign-link">{en ? 'See what you can rent' : '看看这次能租什么'}</a></div>
    </section>
    <div className="shell finder-shell"><RentalFinder /></div>
    <section className="shell brand-discovery">
      <div className="discovery-label"><h2>{en ? 'What do you have in mind?' : '这次，想租什么？'}</h2><Link to={href('/products')}>{en ? 'Explore all' : '探索全部'}</Link></div>
      <nav className={`discovery-rail discovery-rail-${mode}`} aria-label={t('productCategory')}>
        {discovery.map(item => <Link key={item.id} to={href(mode === 'single' ? `/category/${tenant.categories[0].id}?sub=${item.id}` : `/category/${item.id}`)}>{mode === 'single' ? <Img className="discovery-thumb" src={item.image} alt="" /> : <CategoryIcon name={'icon' in item ? String(item.icon) : ''} />}<span>{item.name}</span></Link>)}
      </nav>
    </section>
    <section className="shell brand-popular">
      <div className="brand-section-title"><div><h2>{en ? 'Worth a try.' : '值得试试的几件。'}</h2><p>{en ? 'A starting point for your next plan.' : '先看看设备，也许就有了下一步的想法。'}</p></div><Link to={href('/products')}>{en ? 'All rentals' : '浏览全部商品'}</Link></div>
      {isRemote && !productsReady ? <p className="brand-loading" role="status">{t('loading')}</p> : featured.length ? <div className="brand-product-grid">{featured.map(product => <ProductCard product={product} compact key={product.id} />)}</div> : <p className="brand-loading">{t('noProducts')}</p>}
      <p className="brand-catalog-note">{isRemote ? en ? 'Starting prices shown. Check your dates and store for availability and final pricing.' : '此处为推荐商品与起价，实际库存和费用请按租期与门店查询。' : en ? 'Demo selections and starting prices. This section is not a live availability result.' : '演示精选与参考起价，此处不是所选租期的实时库存结果。'}</p>
    </section>
    {campaigns.length > 0 && <section className="brand-offers"><div className="shell"><div className="brand-section-title"><h2>{en ? 'Make a little time for something new.' : '留点时间，试点新的。'}</h2><span>{en ? 'Ideas for your next rental' : '租赁灵感'}</span></div><div className="brand-offer-grid">{campaigns.map(campaign => <article className="brand-offer" key={campaign.id}>
      <div className="offer-copy">{campaign.demo && <span className="offer-demo">{en ? 'Demo campaign' : '演示活动'}</span>}<h3>{en ? campaign.titleEn || campaign.title : campaign.title}</h3><p>{en ? campaign.descriptionEn || campaign.description : campaign.description}</p><Link to={href(campaign.categoryId ? `/category/${campaign.categoryId}` : '/products')}>{en ? 'Explore rentals' : '探索租赁'}</Link></div>
    </article>)}</div></div></section>}
    <section className="shell brand-how"><div className="brand-section-title"><h2>{en ? 'From choosing to using.' : '从选到用，三步了解。'}</h2><Link to={href('/guide')}>{en ? 'Your rental guide' : '查看租赁指南'}</Link></div><div className="brand-step-grid">{steps.map((step, index) => <article key={step.title}><step.Icon /><span className="brand-step-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></article>)}</div></section>
    <section className="brand-store-strip"><div className="shell"><div><Store /><h2>{en ? 'Find a place that fits your plans.' : '选个方便的地方。'}</h2></div><a href="#rental-finder">{en ? 'Choose a city & store' : '选择城市与门店'}</a></div></section>
  </div>;
}
