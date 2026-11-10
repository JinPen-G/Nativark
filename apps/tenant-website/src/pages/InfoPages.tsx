import { Link } from 'react-router-dom';
import { Headphones, ShieldCheck, Calendar, Document } from '../components/SiteIcon';
import { Breadcrumbs, PageHeading } from '../components/PageHeader';
import { Img } from '../components/Img';
import { useSite } from '../SiteContext';
import { PageState } from '../components/PageState';
import { StoreDirectory } from '../components/StoreDirectory';

export function AboutPage() {
  const { tenant, href, isRemote, t } = useSite();
  return <div className="shell simple-page about-page">
    <Breadcrumbs items={[{ label: t('home'), to: href('/') }, { label: t('about') }]} />
    <div className="about-intro"><div><PageHeading title={t('aboutTitle', { name: tenant.name })} description={tenant.footerText} /><Link className="button button-dark" to={href('/products')}>{t('exploreAllProducts')}</Link></div><Img className="about-image" src={isRemote ? tenant.heroImage : '/assets/brand-journey.webp'} alt="" /></div>
    <dl className="rental-principles">
      <div><dt><ShieldCheck />{t('aboutSelected')}</dt><dd>{t('aboutSelectedText')}</dd></div>
      <div><dt><Calendar />{t('aboutFlexible')}</dt><dd>{t('aboutFlexibleText')}</dd></div>
      <div><dt><Headphones />{t('aboutService')}</dt><dd>{t('aboutServiceText')}</dd></div>
    </dl>
    <StoreDirectory />
  </div>;
}

export function GuidePage() {
  const { href, t, language } = useSite();
  const en = language === 'en';
  const steps = [
    { title:t('guideChoose'), text:t('guideChooseText'), details:en ? ['Browse a category or search by product name.', 'Compare the specifications and included accessories.'] : ['按品类浏览，或搜索具体型号。', '查看规格参数、配件和商品说明。'] },
    { title:t('guideTerm'), text:t('guideTermText'), details:en ? ['Choose pickup and return times, quantity and location.', 'Availability and the final quote are confirmed during booking.'] : ['选好取还时间、数量与方便的门店。', '库存和最终费用以预约时确认的结果为准。'] },
    { title:t('guideSubmit'), text:t('guideSubmitText'), details:en ? ['Check your contact details and pickup or delivery method.', 'Review rent, deposit and any delivery fees before submitting.'] : ['核对联系人和门店自取、配送等取还方式。', '提交前看清租金、押金及可能产生的配送费用。'] },
    { title:t('guideConfirm'), text:t('guideConfirmText'), details:en ? ['Keep your booking details and confirm the collection arrangements.', 'Check the equipment and accessories together when collecting and returning.'] : ['保留预约信息，与门店确认实际取还安排。', '取用和归还时，一起核对设备状态与配件。'] },
  ];
  return <div className="shell simple-page guide-page">
    <Breadcrumbs items={[{ label: t('home'), to: href('/') }, { label: t('guideTitle') }]} />
    <PageHeading title={t('guideTitle')} description={t('guideDescription')} />
    <div className="guide-layout">
      <aside className="guide-aside"><nav aria-label={en ? 'On this page' : '本页内容'}>{steps.map((step,index) => <a href={'#guide-step-'+index} key={step.title}><span>{String(index+1).padStart(2,'0')}</span>{step.title}</a>)}</nav><div><h2>{en ? 'Ready when you are.' : '有计划了，就开始挑选。'}</h2><Link className="button button-dark" to={href('/products')}>{t('startChoosing')}</Link><Link className="text-link" to={href('/help')}>{t('footerHelp')}</Link></div></aside>
      <div className="guide-list">{steps.map((step, index) => <article key={step.title} id={'guide-step-'+index}><span>{String(index + 1).padStart(2, '0')}</span><div><h2>{step.title}</h2><p>{step.text}</p><ul>{step.details.map(detail => <li key={detail}>{detail}</li>)}</ul></div></article>)}</div>
    </div>
  </div>;
}

export function NotFoundPage() {
  const { href, language, t } = useSite();
  return <div className="shell not-found-page"><PageState heading="h1" icon={<Document />} title={language === 'en' ? 'This page could not be found' : '没有找到这个页面'} description={language === 'en' ? 'The link may have changed. You can continue exploring our rentals.' : '链接可能已变更，你可以返回首页或继续浏览租赁商品。'}><Link className="button button-dark" to={href('/products')}>{t('browseProducts')}</Link><Link className="button button-outline" to={href('/')}>{t('backHome')}</Link></PageState></div>;
}
