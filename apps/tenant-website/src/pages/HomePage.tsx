import { ArrowRight, ArrowUpRight, Check, PackageCheck, CalendarDays, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSite } from '../SiteContext';
import { RentalFinder } from '../components/RentalFinder';
import { ProductCard } from '../components/ProductCard';
import { Img } from '../components/Img';
import { siteRepository } from '../data/siteRepository';

export function HomePage() {
  const { tenant, href, localizeProduct, language, isRemote, productsReady } = useSite();
  const en = language === 'en';
  const featured = siteRepository.getProducts(tenant).slice(0, 4).map(localizeProduct);
  const steps = [
    { icon: <CalendarDays />, title: en ? 'Choose what you need' : '选好商品与租期', description: en ? 'Find your equipment and pick the dates that fit your plan.' : '找到适合的商品，选择这次需要使用的时间。' },
    { icon: <PackageCheck />, title: en ? 'Confirm your rental' : '核对预约与费用', description: en ? 'Review the quote and collection details before you reserve.' : '查看报价，确认取还安排，再提交预约。' },
    { icon: <MapPin />, title: en ? 'Collect, use, return' : '取走、使用、归还', description: en ? 'Follow your confirmed booking for collection and return.' : '按预约约定取货，使用结束后归还。' },
  ];
  return <>
    <section className="shell home-opening">
      <div className="home-intro"><h1>{tenant.heroTitle}</h1><div><p>{tenant.heroDescription}</p><Link className="text-link" to={href('/guide')}>{en ? 'Your first rental, explained' : '第一次租？先看看流程'}<ArrowUpRight /></Link></div></div>
      <div className="hero-scene"><Img src={tenant.heroImage} alt={en ? 'Equipment for a coastal camping trip' : '海边旅行中的租赁装备'} loading="eager" fetchPriority="high" width="1536" height="1024" /><div className="hero-caption"><span>{en ? 'A little more room for your plans.' : '带上装备，把周末交给海风。'}</span><span>{en ? 'Rental, made simple' : '按需租赁'}</span></div></div>
      <RentalFinder />
    </section>
    <section className="shell home-categories" aria-labelledby="categories-title"><div className="section-heading"><h2 id="categories-title">{tenant.categories.length === 1 ? en ? 'Explore your kit' : '为拍摄挑选器材' : en ? 'What’s on your list?' : '你的计划，需要什么？'}</h2><Link className="text-link" to={href('/products')}>{en ? 'Browse all rentals' : '浏览全部商品'}<ArrowUpRight /></Link></div><div className="category-tiles">{tenant.categories.map(category => <Link key={category.id} to={href('/category/' + category.id)}><Img src={category.image} alt="" width="480" height="480" /><div><h3>{category.name}</h3><span>{category.description}</span></div><ArrowUpRight /></Link>)}</div></section>
    <section className="shell home-featured"><div className="section-heading"><div><h2>{en ? 'A few places to start' : '从这几件开始'}</h2><p>{en ? 'Explore the selection. Availability is confirmed for your dates.' : '先看看商品，具体档期在选择租期后确认。'}</p></div><Link className="text-link" to={href('/products')}>{en ? 'See the selection' : '查看全部'}<ArrowUpRight /></Link></div>{productsReady ? <div className="product-grid featured-grid">{featured.map(product => <ProductCard key={product.id} product={product} />)}</div> : <div className="product-grid featured-grid" aria-busy="true">{Array.from({ length: 4 }, (_, index) => <div className="product-card-skeleton" key={index} />)}</div>}</section>
    <section className="rental-story"><div className="shell story-inner"><div className="story-heading"><h2>{en ? 'A plan,\nsome equipment,\nand you’re ready.' : '从选好装备，\n到准备出发。'}</h2><Link className="button button-outline" to={href('/guide')}>{en ? 'Read the rental guide' : '查看租赁指南'}<ArrowRight /></Link></div><ol className="rental-steps">{steps.map((step, index) => <li key={step.title}><span className="step-number">{index + 1}</span><div>{step.icon}<h3>{step.title}</h3><p>{step.description}</p></div></li>)}</ol></div></section>
    <section className="shell home-store-callout"><div><h2>{en ? 'Pick up close to your plans.' : '找到方便取还的门店。'}</h2><p>{isRemote ? tenant.address : en ? 'Choose a collection point and check its opening hours before you reserve.' : '查看门店地址与营业时间，为这次取还提前安排。'}</p><Link className="text-link" to={href('/about#stores')}>{en ? 'Find a store' : '查找门店'}<ArrowUpRight /></Link></div><div className="store-callout-note"><Check /><p>{en ? 'Keep your pickup details, dates and quote together in your booking.' : '门店、租期与费用，\n都在预约中逐项核对。'}</p></div></section>
  </>;
}
