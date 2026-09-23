import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ArrowRightOutlined, CloseOutlined, DownOutlined, GlobalOutlined, MenuOutlined, MoonOutlined, SearchOutlined, SunOutlined, UserOutlined } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';

function LanguagePicker() {
  const { language, setLanguage, t } = useSite();
  const [open, setOpen] = useState(false);
  return <div className="language-picker">
    <button type="button" className="language-picker-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={t('chooseLanguage')} onClick={() => setOpen(value => !value)}>
      <GlobalOutlined aria-hidden="true" /><span>{language === 'zh' ? t('zhLanguage') : t('enLanguage')}</span><DownOutlined aria-hidden="true" />
    </button>
    {open && <div className="language-picker-menu" role="listbox" aria-label={t('chooseLanguage')}>
      <button type="button" role="option" aria-selected={language === 'zh'} className={language === 'zh' ? 'active' : ''} onClick={() => { setLanguage('zh'); setOpen(false); }}>{t('zhLanguage')}</button>
      <button type="button" role="option" aria-selected={language === 'en'} className={language === 'en' ? 'active' : ''} onClick={() => { setLanguage('en'); setOpen(false); }}>{t('enLanguage')}</button>
    </div>}
  </div>;
}

export function SiteHeader() {
  const { tenant, href, mode, isRemote, language, toggleLanguage, theme, toggleTheme, t } = useSite();
  const { isAuthenticated, customerName, logout } = useAuth();
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    let scrollTicking = false;
    const updateScrolledState = () => { setIsScrolled(window.scrollY > 0); scrollTicking = false; };
    const onScroll = () => { if (!scrollTicking) { window.requestAnimationFrame(updateScrolledState); scrollTicking = true; } };
    updateScrolledState();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', updateScrolledState);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', updateScrolledState); };
  }, []);
  function submitSearch(event: FormEvent) {
    event.preventDefault();
    navigate(href(`/products?search=${encodeURIComponent(search.trim())}`));
    setMenuOpen(false);
  }
  const links = [
    { to: '/', label: t('home') },
    { to: '/products', label: t('allProducts') },
    { to: '/guide', label: t('guide') },
    { to: '/about', label: t('about') },
  ];
  return <header className={`site-header${isScrolled ? ' is-scrolled' : ''}`}>
    <div className="header-inner shell">
      <Link to={href('/')} className="brand-lockup" aria-label={`${tenant.name} ${t('home')}`}>
        <img src={tenant.logo} alt={tenant.name} className="brand-logo" />
        <span className="brand-slogan">{tenant.slogan}</span>
      </Link>
      <nav className={`main-nav ${menuOpen ? 'is-open' : ''}`} aria-label={t('home')}>
        {links.map(link => <NavLink key={link.to} to={href(link.to)} onClick={() => setMenuOpen(false)} className={({ isActive }) => isActive ? 'nav-active' : ''}>{link.label}</NavLink>)}
        {mode === 'double' && tenant.categories.map(category => <Link key={category.id} to={href(`/category/${category.id}`)} onClick={() => setMenuOpen(false)} className="mobile-category-link">{category.name}</Link>)}
      </nav>
      <form className="header-search" onSubmit={submitSearch} role="search">
        <SearchOutlined aria-hidden="true" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('searchAria')} />
      </form>
      <button className="language-switcher-header" type="button" onClick={toggleLanguage} aria-label={t('switchLanguage')} title={t('switchLanguage')}><GlobalOutlined aria-hidden="true" /><span>{language === 'zh' ? 'EN' : '中'}</span></button>
      <button className="theme-switcher-header" type="button" onClick={toggleTheme} aria-label={t('switchTheme')} title={t('switchTheme')}>{theme === 'dark' ? <MoonOutlined aria-hidden="true" /> : <SunOutlined aria-hidden="true" />}</button>
      <Link className="header-orders" to={href('/orders')} aria-label={t('orders')}><UserOutlined aria-hidden="true" /><span>{t('orders')}</span></Link>
      {isRemote && (isAuthenticated
        ? <button className="header-account" type="button" onClick={() => { logout(); setMenuOpen(false); }} title={customerName || t('logoutCta')}>{customerName ? `${customerName} · ` : ''}{t('logoutCta')}</button>
        : <Link className="header-account" to={href(`/login?redirect=${encodeURIComponent('/orders')}`)} onClick={() => setMenuOpen(false)}>{t('loginCta')}</Link>)}
      <Link className="button button-dark header-cta" to={href('/products')}>{t('rentNow')} <ArrowRightOutlined aria-hidden="true" /></Link>
      <button className="mobile-menu-button" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? t('closeMenu') : t('openMenu')} aria-expanded={menuOpen}>{menuOpen ? <CloseOutlined /> : <MenuOutlined />}</button>
    </div>
  </header>;
}

export function SiteFooter() {
  const { tenant, href, t } = useSite();
  return <footer className="site-footer">
    <div className="shell footer-main">
      <div className="footer-brand"><img src={tenant.logo} alt={tenant.name} /><p>{tenant.footerText}</p></div>
      <div><h3>{t('footerExplore')}</h3><Link to={href('/products')}>{t('allProducts')}</Link><Link to={href('/guide')}>{t('guide')}</Link><Link to={href('/orders')}>{t('orders')}</Link></div>
      <div><h3>{t('about')}</h3><Link to={href('/about')}>{t('footerBrand')}</Link><Link to={href('/help')}>{t('footerHelp')}</Link><a href={`tel:${tenant.phone}`}>{t('contactSupport')}</a></div>
      <div className="footer-contact"><h3>{t('footerContact')}</h3><strong>{tenant.phone}</strong><p>{tenant.customerService}</p><p>{tenant.address}</p></div>
    </div>
    <div className="shell footer-bottom"><span>© {new Date().getFullYear()} {tenant.name}. {t('allRights')}</span><div className="footer-bottom-actions">{tenant.showPoweredBy && <span>Powered by Rental OS</span>}<LanguagePicker /></div></div>
  </footer>;
}

export function SiteLayout({ children }: { children: ReactNode }) {
  return <><SiteHeader /><main>{children}</main><SiteFooter /></>;
}
