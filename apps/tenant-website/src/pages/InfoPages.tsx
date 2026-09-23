import { Link } from 'react-router-dom';
import { ArrowRightOutlined, CustomerServiceOutlined, SafetyCertificateOutlined, TruckOutlined } from '@ant-design/icons';
import { useSite } from '../SiteContext';

export function AboutPage() {
  const { tenant, href, t } = useSite();
  return <div className="shell simple-page"><div className="page-intro"><span className="eyebrow">ABOUT US</span><h1>{t('aboutTitle', { name: tenant.name })}</h1><p>{tenant.footerText}</p></div><div className="info-grid"><article><SafetyCertificateOutlined /><h2>{t('aboutSelected')}</h2><p>{t('aboutSelectedText')}</p></article><article><TruckOutlined /><h2>{t('aboutFlexible')}</h2><p>{t('aboutFlexibleText')}</p></article><article><CustomerServiceOutlined /><h2>{t('aboutService')}</h2><p>{t('aboutServiceText')}</p></article></div><Link className="button button-dark" to={href('/products')}>{t('exploreAllProducts')} <ArrowRightOutlined /></Link></div>;
}

export function GuidePage() {
  const { href, t } = useSite();
  const steps = [[t('guideChoose'), t('guideChooseText')], [t('guideTerm'), t('guideTermText')], [t('guideSubmit'), t('guideSubmitText')], [t('guideConfirm'), t('guideConfirmText')]];
  return <div className="shell simple-page"><div className="page-intro"><span className="eyebrow">RENTAL GUIDE</span><h1>{t('guideTitle')}</h1><p>{t('guideDescription')}</p></div><div className="guide-list">{steps.map(([title, text], index) => <article key={title}><span>{String(index + 1).padStart(2, '0')}</span><div><h2>{title}</h2><p>{text}</p></div></article>)}</div><Link className="button button-dark" to={href('/products')}>{t('startChoosing')} <ArrowRightOutlined /></Link></div>;
}

export function HelpPage() {
  const { tenant, t } = useSite();
  return <div className="shell simple-page"><div className="page-intro"><span className="eyebrow">HELP CENTER</span><h1>{t('helpTitle')}</h1><p>{t('helpDescription')}</p></div><div className="faq-list"><details><summary>{t('faqTerm')}</summary><p>{t('faqTermText')}</p></details><details><summary>{t('faqDeposit')}</summary><p>{t('faqDepositText')}</p></details><details><summary>{t('faqDelivery')}</summary><p>{t('faqDeliveryText')}</p></details><details><summary>{t('faqContact')}</summary><p>{t('faqContactText', { phone: tenant.phone, service: tenant.customerService })}</p></details></div></div>;
}
