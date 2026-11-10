import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';
import { Address, Bell, LogOut, Receipt, Ticket, User } from './SiteIcon';
import { Breadcrumbs, PageHeading } from './PageHeader';
import { useActiveRail } from '../hooks/useActiveRail';

export type MemberSection = 'orders' | 'addresses' | 'coupons' | 'notifications';
export function MemberLayout({ active, title, description, children }: { active: MemberSection; title: string; description?: string; children: ReactNode }) {
  const { href, t, isRemote, language } = useSite();
  const { customerName, isAuthenticated, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const rail = useActiveRail<HTMLElement>(`${active}:${language}`);
  async function signOut() {
    setSigningOut(true); setLogoutError('');
    try { await logout(); }
    catch { setLogoutError(language === 'en' ? 'Could not sign out. Please try again.' : '退出失败，请重试。'); }
    finally { setSigningOut(false); }
  }
  const links = [
    { id: 'orders', label: t('orders'), to: '/orders', Icon: Receipt },
    { id: 'addresses', label: t('addressBook'), to: '/account?section=addresses', Icon: Address },
    { id: 'coupons', label: t('coupons'), to: '/account?section=coupons', Icon: Ticket },
    { id: 'notifications', label: t('notifications'), to: '/account?section=notifications', Icon: Bell },
  ];
  return <div className="shell member-page">
    <Breadcrumbs items={[{ label: t('home'), to: href('/') }, { label: t('accountTitle'), to: active === 'orders' ? href('/account') : undefined }, { label: title }]} />
    <div className="member-layout">
      <aside className="member-nav"><div className="member-identity"><User /><div><strong>{customerName || (language === 'en' ? 'Your rental space' : '你的租赁空间')}</strong><span>{isRemote ? t('accountTitle') : language === 'en' ? 'Demo preview' : '演示预览'}</span></div></div>
        <nav ref={rail} aria-label={t('accountTitle')}>{links.map(({ id, label, to, Icon }) => <Link key={id} to={href(to)} aria-current={active === id ? 'page' : undefined}><Icon />{label}</Link>)}</nav>
        {isRemote && isAuthenticated && <button className="member-signout" type="button" disabled={signingOut} onClick={() => { void signOut(); }}><LogOut />{t('logoutCta')}</button>}
        {logoutError && <p className="form-error" role="alert">{logoutError}</p>}
      </aside>
      <div className="member-content"><PageHeading title={title} description={description} />{!isRemote && <p className="preview-notice">{language === 'en' ? 'Demo preview · Bookings are local to this browser. Account services are not connected.' : '演示预览 · 预约记录仅在当前浏览器保存，账户服务尚未连接。'}</p>}{children}</div>
    </div>
  </div>;
}
