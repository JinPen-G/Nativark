import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronDown as DownOutlined, Globe as GlobalOutlined, Moon as MoonOutlined, Sun as SunOutlined, Receipt } from './SiteIcon';
import { MenuToggleIcon } from './animate-ui/MenuToggleIcon';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';
import { enterpriseHref } from '@rental-os/web-client';

export function TenantLogo({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  const { tenant, theme } = useSite();
  return <img src={(onDark || theme === 'dark') && tenant.logoDark ? tenant.logoDark : tenant.logo} alt={tenant.name} className={className} data-logo-variant={tenant.logoDark ? 'configured' : 'fallback'} />;
}

function LanguagePicker() {
  const { language, setLanguage, t } = useSite();
  return <label className="footer-language-select"><GlobalOutlined /><select value={language} aria-label={t('chooseLanguage')} onChange={event => setLanguage(event.target.value as 'zh' | 'en')}><option value="zh">{t('zhLanguage')}</option><option value="en">{t('enLanguage')}</option></select><DownOutlined /></label>;
}

export function SiteHeader() {
  const { tenant, tenantCode, enterpriseDomainBound, href, mode, isRemote, language, toggleLanguage, theme, toggleTheme, t } = useSite();
  const { isAuthenticated, customerName } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const location = useLocation();
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);
  useEffect(() => {
    let scrollTicking = false;
    const updateScrolledState = () => { setIsScrolled(window.scrollY > 24); scrollTicking = false; };
    const onScroll = () => { if (!scrollTicking) { window.requestAnimationFrame(updateScrolledState); scrollTicking = true; } };
    updateScrolledState();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', updateScrolledState);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', updateScrolledState); };
  }, []);
  const links = [
    { to: '/', label: t('home') },
    { to: '/products', label: t('allProducts') },
    { to: '/guide', label: t('guide') },
    { to: '/about', label: t('about') },
  ];
  return <header className={`site-header${isScrolled ? ' is-scrolled' : ''}`}>
    <div className="header-inner shell">
      <Link to={href('/')} className="brand-lockup" aria-label={`${tenant.name} ${t('home')}`}>
        <TenantLogo className="brand-logo" />
        <span className="brand-slogan">{tenant.slogan}</span>
      </Link>
      <nav id="site-navigation" className={`main-nav ${menuOpen ? 'is-open' : ''}`} aria-label={t('home')}>
        {links.map(link => <NavLink key={link.to} to={href(link.to)} onClick={() => setMenuOpen(false)} className={({ isActive }) => isActive ? 'nav-active' : ''}>{link.label}</NavLink>)}
        {mode === 'double' && tenant.categories.map(category => <Link key={category.id} to={href(`/category/${category.id}`)} onClick={() => setMenuOpen(false)} className="mobile-category-link">{category.name}</Link>)}
        <Link className="mobile-utility-link" to={href('/orders')} onClick={() => setMenuOpen(false)}>{t('orders')}</Link>
        {<Link className="mobile-utility-link" to={href(!isRemote || isAuthenticated ? '/account' : `/login?redirect=${encodeURIComponent('/orders')}`)} onClick={() => setMenuOpen(false)}>{!isRemote || isAuthenticated ? customerName || t('accountTitle') : t('loginCta')}</Link>}
      </nav>
      <button className="language-switcher-header" type="button" onClick={toggleLanguage} aria-label={t('switchLanguage')} title={t('switchLanguage')}><GlobalOutlined aria-hidden="true" /><span>{language === 'zh' ? 'EN' : '中'}</span></button>
      <button className="theme-switcher-header" type="button" onClick={toggleTheme} aria-label={t('switchTheme')} title={t('switchTheme')}>{theme === 'dark' ? <MoonOutlined aria-hidden="true" /> : <SunOutlined aria-hidden="true" />}</button>
      {isRemote && tenantCode && <a className="header-account" href={enterpriseHref(tenantCode, enterpriseDomainBound)}>{language === 'zh' ? '企业服务' : 'Enterprise'}</a>}
      <Link className="header-orders" to={href('/orders')} aria-label={t('orders')}><Receipt aria-hidden="true" /><span>{t('orders')}</span></Link>
      {isRemote && (isAuthenticated
        ? <Link className="header-account" to={href('/account')} onClick={() => setMenuOpen(false)} title={t('accountTitle')}>{customerName || t('accountTitle')}</Link>
        : <Link className="header-account" to={href(`/login?redirect=${encodeURIComponent('/orders')}`)} onClick={() => setMenuOpen(false)}>{t('loginCta')}</Link>)}
      <Link className="button button-dark header-cta" to={href('/products')}>{t('rentNow')}</Link>
      <button ref={menuButton} className="mobile-menu-button" aria-controls="site-navigation" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? t('closeMenu') : t('openMenu')} aria-expanded={menuOpen}><MenuToggleIcon open={menuOpen} /></button>
    </div>
  </header>;
}

export function SiteFooter() {
  const { tenant, href, t, isRemote, language } = useSite();
  const demoContact = !isRemote;
  return <footer className="site-footer">
    <div className="shell footer-main">
      <div className="footer-brand"><TenantLogo onDark /><p>{tenant.footerText}</p></div>
      <div><h3>{t('footerExplore')}</h3><Link to={href('/products')}>{t('allProducts')}</Link><Link to={href('/guide')}>{t('guide')}</Link><Link to={href('/orders')}>{t('orders')}</Link></div>
      <div><h3>{t('about')}</h3><Link to={href('/about')}>{t('footerBrand')}</Link><Link to={href('/help')}>{t('footerHelp')}</Link>{demoContact ? <Link to={href('/help')}>{t('contactSupport')}</Link> : <a href={`tel:${tenant.phone}`}>{t('contactSupport')}</a>}</div>
      <div><h3>{t('footerLegal')}</h3><Link to={href('/agreement')}>{t('docUserAgreement')}</Link><Link to={href('/privacy')}>{t('docPrivacyPolicy')}</Link></div>
      <div className="footer-contact"><h3>{t('footerContact')}</h3><strong>{tenant.phone}</strong>{demoContact && <p>{language === 'en' ? 'Demo contact details' : '演示联系方式'}</p>}<p>{tenant.customerService}</p><p>{tenant.address}</p></div>
    </div>
    <div className="shell footer-bottom"><span>© {new Date().getFullYear()} {tenant.name}. {t('allRights')}</span><div className="footer-bottom-actions">{tenant.showPoweredBy && <span>Powered by Rental OS</span>}<LanguagePicker /></div></div>
  </footer>;
}

export function SiteLayout({ children }: { children: ReactNode }) {
  return <><SiteHeader /><main>{children}</main><SiteFooter /></>;
}
