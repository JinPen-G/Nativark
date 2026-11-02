import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';
import { useToast } from '../components/Toast';
import { sessionApi } from '../data/authClient';

const emptyAddress = { recipient: '', phone: '', province: '', city: '', district: '', detail: '', isDefault: false };

function AddressBook() {
  const { t } = useSite();
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyAddress);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try { const r = await sessionApi.addresses(); setItems(((r as any).items as any[]) ?? []); }
    catch (e: any) { setError(e?.message || t('loadFailed')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const save = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await sessionApi.saveAddress(form);
      setForm(emptyAddress); setAdding(false); await reload();
      toast.success(t('addressSaved'));
    } catch (e: any) { const msg = e?.message || t('saveFailed'); setError(msg); toast.error(msg); }
    finally { setBusy(false); }
  }, [form, reload]);

  const remove = useCallback(async (id: string) => {
    setBusy(true); setError('');
    try { await sessionApi.deleteAddress(id); await reload(); toast.success(t('addressDeleted')); }
    catch (e: any) { const msg = e?.message || t('deleteFailed'); setError(msg); toast.error(msg); }
    finally { setBusy(false); }
  }, [reload]);

  return <section className="account-section">
    <div className="account-section-head"><h2>{t('addressBook')}</h2><button type="button" className="button button-outline" onClick={() => setAdding(v => !v)}><PlusOutlined /> {t('addAddress')}</button></div>
    {error && <p className="form-error">{error}</p>}
    {adding && <form className="address-form" onSubmit={save}>
      <div className="form-grid">
        <label>{t('addrRecipient')}<input value={form.recipient} maxLength={120} onChange={e => setForm({ ...form, recipient: e.target.value })} /></label>
        <label>{t('addrPhone')}<input inputMode="tel" value={form.phone} maxLength={32} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
        <label>{t('addrProvince')}<input value={form.province} maxLength={64} onChange={e => setForm({ ...form, province: e.target.value })} /></label>
        <label>{t('addrCity')}<input value={form.city} maxLength={64} onChange={e => setForm({ ...form, city: e.target.value })} /></label>
        <label>{t('addrDistrict')}<input value={form.district} maxLength={64} onChange={e => setForm({ ...form, district: e.target.value })} /></label>
      </div>
      <label className="full-field">{t('addrDetail')}<input value={form.detail} maxLength={255} onChange={e => setForm({ ...form, detail: e.target.value })} /></label>
      <label className="login-agree"><input type="checkbox" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} /><span>{t('addrDefault')}</span></label>
      <button type="submit" className="button button-dark" disabled={busy}>{busy ? t('saving') : t('save')}</button>
    </form>}
    {loading ? <div className="list-skeleton" aria-label={t('loading')}>{Array.from({ length: 3 }, (_, i) => <div className="list-skeleton-row" key={i} />)}</div>
      : items.length ? <ul className="address-list">{items.map(a => <li key={a.id}><div><strong>{a.recipient} · {a.phone}</strong><span>{[a.province, a.city, a.district, a.detail].filter(Boolean).join(' ')}</span>{a.isDefault && <em className="addr-default-tag">{t('addrDefault')}</em>}</div><button type="button" className="link-danger" disabled={busy} onClick={() => remove(a.id)} aria-label={t('delete')}><DeleteOutlined /></button></li>)}</ul>
      : <p className="mock-note">{t('addressEmpty')}</p>}
  </section>;
}

function Coupons() {
  const { t } = useSite();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    sessionApi.coupons()
      .then(r => { if (!cancelled) setItems(Array.isArray(r) ? r : ((r as any).items ?? [])); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return <section className="account-section"><div className="account-section-head"><h2>{t('coupons')}</h2></div>
    {loading ? <div className="list-skeleton" aria-label={t('loading')}>{Array.from({ length: 3 }, (_, i) => <div className="list-skeleton-row" key={i} />)}</div>
      : items.length ? <ul className="coupon-list">{items.map((c, i) => <li key={c.id ?? i}><strong>{c.name || c.title || c.templateName || t('coupon')}</strong><span>{c.description || c.rule || ''}</span>{c.expiresAt && <small>{t('couponExpires', { date: String(c.expiresAt).slice(0, 10) })}</small>}</li>)}</ul>
      : <p className="mock-note">{t('couponsEmpty')}</p>}
  </section>;
}

function Notifications() {
  const { t } = useSite();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    sessionApi.notifications({ page: 1, pageSize: 20 })
      .then(r => { if (!cancelled) setItems((r as any).items ?? []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return <section className="account-section"><div className="account-section-head"><h2>{t('notifications')}</h2></div>
    {loading ? <div className="list-skeleton" aria-label={t('loading')}>{Array.from({ length: 3 }, (_, i) => <div className="list-skeleton-row" key={i} />)}</div>
      : items.length ? <ul className="notice-list">{items.map((n, i) => <li key={n.id ?? i}><strong>{n.title || n.type || t('notification')}</strong><span>{n.content || n.body || n.message || ''}</span>{n.createdAt && <small>{String(n.createdAt).slice(0, 16).replace('T', ' ')}</small>}</li>)}</ul>
      : <p className="mock-note">{t('notificationsEmpty')}</p>}
  </section>;
}

/** 账户中心：地址簿、优惠券、通知。仅真实租户 + 已登录可用。 */
export function AccountPage() {
  const { href, isRemote, t } = useSite();
  const { isAuthenticated, customerName, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast(), [loggingOut, setLoggingOut] = useState(false);
  const signOut = async () => {
    setLoggingOut(true);
    try { await logout(); navigate(href('/')); }
    catch (e) { toast.error(e instanceof Error ? e.message : t('loadFailed')); }
    finally { setLoggingOut(false); }
  };

  useEffect(() => {
    if (isRemote && !isAuthenticated) navigate(href(`/login?redirect=${encodeURIComponent('/account')}`), { replace: true });
  }, [isRemote, isAuthenticated]);

  if (!isRemote) return <div className="shell simple-page"><div className="page-intro"><h1>{t('accountTitle')}</h1><p>{t('loginDemoNotice')}</p></div><Link className="button button-dark" to={href('/')}>{t('backHome')}</Link></div>;
  if (!isAuthenticated) return null;

  return <div className="shell simple-page account-page">
    <div className="page-intro"><h1>{t('accountTitle')}</h1><p>{customerName ? t('accountGreeting', { name: customerName }) : t('accountSubtitle')}</p></div>
    <div className="account-quicklinks"><Link className="button button-outline" to={href('/orders')}>{t('orders')}</Link><button type="button" className="button button-outline" disabled={loggingOut} onClick={() => void signOut()}>{t('logoutCta')}</button></div>
    <AddressBook />
    <Coupons />
    <Notifications />
  </div>;
}
