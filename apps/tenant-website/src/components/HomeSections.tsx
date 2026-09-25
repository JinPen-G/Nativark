import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRightOutlined, CameraOutlined, CarOutlined, CheckCircleOutlined, ClockCircleOutlined, CompassOutlined,
  CustomerServiceOutlined, EnvironmentOutlined, GiftOutlined, HeartOutlined, HomeOutlined, LaptopOutlined,
  PhoneOutlined, SafetyCertificateOutlined, ShoppingCartOutlined, StarFilled,
  ToolOutlined, TruckOutlined, TrophyOutlined, FileTextOutlined, InboxOutlined,
} from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { siteRepository } from '../data/siteRepository';
import type { Category, CategoryMode } from '../types';
import { ProductCard } from './ProductCard';

const icons: Record<string, ReactNode> = {
  camera: <CameraOutlined />, camping: <CompassOutlined />, car: <CarOutlined />,
  laptop: <LaptopOutlined />, tool: <ToolOutlined />, home: <HomeOutlined />,
  baby: <HeartOutlined />, sports: <TrophyOutlined />,
};

function HeroBenefitStrip({ light = false }: { light?: boolean }) {
  const { t } = useSite();
  const items = [
    { icon: <SafetyCertificateOutlined />, title: t('authentic'), text: t('authenticShort') },
    { icon: <TruckOutlined />, title: t('delivery'), text: t('deliveryShort') },
    { icon: <CustomerServiceOutlined />, title: t('service'), text: t('serviceShort') },
  ];
  return <div className={`hero-benefits ${light ? 'hero-benefits-light' : ''}`}>{items.map(item => <div key={item.title}><span className="hero-benefit-icon">{item.icon}</span><span><strong>{item.title}</strong><small>{item.text}</small></span></div>)}</div>;
}

export function HomeHero({ mode }: { mode: CategoryMode }) {
  const { tenant, href, language, t } = useSite();
  const singleCategory = tenant.categories[0];
  return <section className={`home-hero shell homepage-section home-hero-${mode}`}>
    <img src={tenant.heroImage} alt="" className="hero-background" />
    {mode === 'multiple' && <img src="/assets/multi-lifestyle-mobile.webp" alt="" className="hero-background hero-background-mobile" />}
    <div className="home-hero-content"><span className={`eyebrow ${mode !== 'multiple' ? 'light' : ''}`}>{mode === 'single' && singleCategory ? `${singleCategory.name} ${language === 'en' ? 'rental' : '租赁'}` : tenant.slogan}</span><h1>{tenant.heroTitle}</h1><p>{tenant.heroDescription}</p><Link className={`button ${mode === 'multiple' ? 'button-dark' : 'button-white'}`} to={href(mode === 'single' && singleCategory ? `/category/${singleCategory.id}` : '/products')}>{t('explore')}</Link></div>
    <HeroBenefitStrip light={mode !== 'multiple'} />
  </section>;
}

export function CategorySection({ mode }: { mode: CategoryMode }) {
  const { tenant, href, isRemote, productsReady, t } = useSite();
  if (mode !== 'single') return null;
  const category = tenant.categories[0];
  if (!category) return null;
  return <section className="section shell homepage-section category-section"><SectionHeading title={t('featuredCategoryTitle')} subtitle={t('featuredCategorySubtitle', { category: category.name })} action={<Link to={href(`/category/${category.id}`)}>{t('viewAll')} <ArrowRightOutlined /></Link>} />
    {isRemote && !productsReady && category.children.length === 0
      ? <div className="subcategory-grid subcategory-grid-loading" aria-busy="true">{Array.from({ length: 5 }, (_, i) => <div className="subcategory-skeleton" key={i} />)}</div>
      : <div className="subcategory-grid">{category.children.map(child => <Link className="subcategory-card" to={href(`/category/${category.id}?sub=${child.id}`)} key={child.id}><div className="subcategory-image"><img src={child.image} alt="" loading="lazy" /></div><strong>{child.name}</strong><span>{child.description}</span></Link>)}</div>}
  </section>;
}

export function SectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action && <div className="section-action">{action}</div>}</div>;
}

export function SceneSection({ mode }: { mode: CategoryMode }) {
  const { tenant, href, language, t } = useSite();
  if (mode === 'single') return null;
  const scenes = mode === 'double' ? tenant.categories : tenant.categories.slice(0, 3);
  return <section className="section shell homepage-section scene-section"><div className={`scene-grid scene-grid-${mode}`}>{scenes.map(category => <article key={category.id} className="scene-card"><img src={category.sceneImage} alt="" loading="lazy" /><div><span className="eyebrow light">{category.name} {language === 'en' ? 'rental' : '租赁'}</span><h2>{category.sceneTitle}</h2><p>{category.description}</p><Link className="button button-white" to={href(`/category/${category.id}`)}>{t('viewNow')}</Link></div></article>)}</div></section>;
}

export function ProductSection({ mode }: { mode: CategoryMode }) {
  const { tenant, href, isRemote, productsReady, t } = useSite();
  const [active, setActive] = useState('all');
  const all = siteRepository.getProducts(tenant);
  const tabs = mode === 'single' ? [{ id: 'all', name: t('recommendedSort') }, { id: 'popular', name: t('featuredProductsTitle') }, { id: 'new', name: t('ratingSort') }] : [{ id: 'all', name: t('categoryAll') }, ...tenant.categories.slice(0, mode === 'multiple' ? 7 : 2).map(category => ({ id: category.id, name: category.name }))];
  const visible = useMemo(() => {
    if (active === 'popular') return [...all].sort((a, b) => b.reviewCount - a.reviewCount).slice(0, mode === 'single' ? 5 : 6);
    if (active === 'new') return [...all].sort((a, b) => b.rating - a.rating).slice(0, mode === 'single' ? 5 : 6);
    if (active !== 'all') return all.filter(product => product.categoryId === active).slice(0, 6);
    if (mode === 'single') return all.slice(0, 5);
    const groups = tenant.categories.map(category => all.filter(product => product.categoryId === category.id));
    const mixed = [];
    for (let index = 0; index < Math.max(...groups.map(group => group.length)); index++) {
      for (const group of groups) if (group[index]) mixed.push(group[index]);
    }
    return mixed.slice(0, mode === 'double' ? 5 : 6);
  }, [active, all, mode]);
  return <section className="section shell homepage-section product-section"><div className="product-section-top"><SectionHeading title={mode === 'single' ? t('featuredProductsTitle') : t('featuredProductsTitleGeneral')} subtitle={mode === 'single' ? t('featuredProductsSubtitleSingle', { category: tenant.categories[0].name }) : t('featuredProductsSubtitleGeneral')} /><div className="product-tabs" role="tablist" aria-label={t('productCategory')}>{tabs.map(tab => <button role="tab" aria-selected={active === tab.id} className={active === tab.id ? 'active' : ''} key={tab.id} onClick={() => setActive(tab.id)}>{tab.name}</button>)}</div><Link className="text-link product-all-link" to={href('/products')}>{t('viewMore')} <ArrowRightOutlined /></Link></div>{isRemote && !productsReady ? <div className="product-grid product-grid-loading" aria-busy="true">{Array.from({ length: mode === 'single' ? 5 : 6 }, (_, i) => <div className="product-card-skeleton" key={i} />)}</div> : <div className="product-grid">{visible.map(product => <ProductCard product={product} key={product.id} />)}</div>}</section>;
}

export function ServiceBenefits({ mode }: { mode: CategoryMode }) {
  const { tenant, t } = useSite();
  const iconFor = (key?: string) => ({ authentic: <SafetyCertificateOutlined />, delivery: <TruckOutlined />, flexible: <CheckCircleOutlined />, service: <CustomerServiceOutlined />, quality: <SafetyCertificateOutlined />, support: <CustomerServiceOutlined /> } as Record<string, ReactNode>)[key ?? ''] ?? <CheckCircleOutlined />;
  // 租户在后台配置了卖点则用其内容，否则回落通用文案。
  const benefits = tenant.advantages?.length
    ? tenant.advantages.map(item => ({ icon: iconFor(item.icon), title: item.title, description: item.description ?? '' }))
    : [
      { icon: <SafetyCertificateOutlined />, title: t('authentic'), description: t('authenticDescription') },
      { icon: <TruckOutlined />, title: t('delivery'), description: t('deliveryDescription') },
      { icon: <CheckCircleOutlined />, title: t('flexible'), description: t('flexibleDescription') },
      { icon: <CustomerServiceOutlined />, title: t('service'), description: t('serviceDescription') },
    ];
  return <section className={`section shell homepage-section benefit-section benefit-section-${mode}`}><SectionHeading title={t('whyChoose')} subtitle={mode === 'single' ? t('whyChooseSingle') : t('whyChooseGeneral')} /><div className="benefit-grid">{benefits.map(item => <div className="benefit-item" key={item.title}><span className="benefit-icon">{item.icon}</span><div><strong>{item.title}</strong><p>{item.description}</p></div></div>)}</div></section>;
}

export function RentalSteps() {
  const { tenant, t } = useSite();
  const defaults = [
    { icon: <ShoppingCartOutlined />, title: t('stepChoose'), description: t('stepChooseDescription') },
    { icon: <FileTextOutlined />, title: t('stepBook'), description: t('stepBookDescription') },
    { icon: <InboxOutlined />, title: t('stepReceive'), description: t('stepReceiveDescription') },
    { icon: <CheckCircleOutlined />, title: t('stepUse'), description: t('stepUseDescription') },
  ];
  const stepIcons = [<ShoppingCartOutlined />, <FileTextOutlined />, <InboxOutlined />, <CheckCircleOutlined />];
  // 租户配置了流程则用其内容（图标按顺序取默认组），否则回落通用四步。
  const steps = tenant.steps?.length
    ? tenant.steps.map((item, index) => ({ icon: stepIcons[index % stepIcons.length], title: item.title, description: item.description ?? '' }))
    : defaults;
  return <section className="section shell homepage-section steps-section"><SectionHeading title={t('rentalProcess')} subtitle={t('rentalProcessSubtitle')} /><div className="steps-grid">{steps.map((step, index) => <div className="step-item" key={step.title}><span className="step-icon">{step.icon}</span><div><strong><b>{String(index + 1).padStart(2, '0')}</b> {step.title}</strong><p>{step.description}</p></div>{index < steps.length - 1 && <ArrowRightOutlined className="step-arrow" />}</div>)}</div></section>;
}

export function Testimonials() {
  const { tenant, t, language } = useSite();
  // 真实租户模式暂无评价数据（后端未提供评价接口）；无证言时整段隐藏，不展示空框。
  if (tenant.testimonials.length === 0) return null;
  return <section className="section shell homepage-section testimonials-section"><SectionHeading title={t('testimonials')} subtitle={t('testimonialsSubtitle')} /><div className="reviews-grid">{tenant.testimonials.map(review => <blockquote key={review.name}><div className="review-stars" aria-label={language === 'en' ? '5-star demo review' : '5 星演示评价'}>{Array.from({ length: 5 }, (_, index) => <StarFilled key={index} />)}</div><p>“{review.text}”</p><footer><strong>{review.name}</strong><span>{review.context}</span></footer></blockquote>)}</div></section>;
}

export function HomeCTA() {
  const { href, tenant, t } = useSite();
  // 真实租户模式优先用 web 渠道配置的 CTA 文案；缺省回退到通用文案。
  return <section className="home-cta"><img src="/assets/cta-mountains.webp" alt="" loading="lazy" /><div className="shell home-cta-inner"><div><span className="eyebrow light">{tenant.slogan}</span><h2>{tenant.ctaTitle || t('ctaTitle')}</h2><p>{tenant.ctaDescription || t('ctaDescription')}</p></div><Link className="button button-white" to={href('/products')}>{t('startRenting')}</Link></div></section>;
}

export function CategoryQuickLinks({ category }: { category: Category }) {
  const { href } = useSite();
  return <div className="category-quick-links">{category.children.map(child => <Link key={child.id} to={href(`/category/${category.id}?sub=${child.id}`)}>{child.name}</Link>)}</div>;
}

export function CategoryIcon({ name }: { name: string }) { return <>{icons[name] || <GiftOutlined />}</>; }

// 首页门店区：列出租户门店（真实模式来自后端 locations，演示模式为示例门店）；无门店时整段隐藏。
export function StoreSection() {
  const { tenant, t } = useSite();
  const stores = tenant.stores ?? [];
  if (stores.length === 0) return null;
  return <section className="section shell homepage-section store-section"><SectionHeading title={t('storesTitle')} subtitle={t('storesSubtitle')} /><div className="store-grid">{stores.map(store => <article className="store-card" key={store.id}><h3><EnvironmentOutlined aria-hidden="true" /> {store.name}</h3>{store.address && <p className="store-address">{store.address}</p>}<div className="store-meta">{store.businessHours && <span><ClockCircleOutlined aria-hidden="true" /> {store.businessHours}</span>}{store.contactPhone && <a href={`tel:${store.contactPhone}`}><PhoneOutlined aria-hidden="true" /> {store.contactPhone}</a>}</div></article>)}</div></section>;
}
