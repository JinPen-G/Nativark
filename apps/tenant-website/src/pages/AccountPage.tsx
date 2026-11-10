import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Address, Bell, Plus, Ticket, Trash } from '../components/SiteIcon';
import { MemberLayout, type MemberSection } from '../components/MemberLayout';
import { LoadingState, PageState } from '../components/PageState';
import { useSite } from '../SiteContext';
import { useAuth } from '../AuthContext';
import { useToast } from '../components/Toast';
import { sessionApi } from '../data/authClient';

const emptyAddress = { recipient: '', phone: '', province: '', city: '', district: '', detail: '', isDefault: false };

function AddressBook({ demo }: { demo: boolean }) {
  const { t, language } = useSite();
  const en = language === 'en';
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyAddress);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    if (demo) { setItems([]); setLoading(false); return; }
    setLoading(true); setError('');
    try { const response = await sessionApi.addresses(); setItems(Array.isArray(response.items) ? response.items : []); }
    catch (e: any) { setError(e?.message || t('loadFailed')); }
    finally { setLoading(false); }
  }, [demo, t]);
  useEffect(() => { void reload(); }, [reload]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (demo || busy) return;
    setBusy(true); setError('');
    try { await sessionApi.saveAddress(form); setForm(emptyAddress); setAdding(false); await reload(); toast.success(t('addressSaved')); }
    catch (e: any) { const message = e?.message || t('saveFailed'); setError(message); toast.error(message); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (demo || busy) return;
    setBusy(true); setError('');
    try { await sessionApi.deleteAddress(id); await reload(); toast.success(t('addressDeleted')); }
    catch (e: any) { const message = e?.message || t('deleteFailed'); setError(message); toast.error(message); }
    finally { setBusy(false); }
  }

  return <section className="member-section">
    <div className="member-section-toolbar"><p>{en ? 'For your delivery and return arrangements.' : '用于配送与取还安排。'}</p><button type="button" className="button button-outline" aria-expanded={adding} onClick={() => setAdding(!adding)}><Plus />{adding ? en ? 'Close form' : '收起表单' : t('addAddress')}</button></div>
    {error && <div className="inline-error" role="alert"><p>{error}</p><button type="button" className="text-button" onClick={() => { void reload(); }}>{en ? 'Try again' : '重新加载'}</button></div>}
    {adding && <form className="address-form" onSubmit={save}>
      <h2>{t('addAddress')}</h2>
      <div className="form-grid">
        <label>{t('addrRecipient')}<input required autoComplete="shipping name" value={form.recipient} maxLength={120} onChange={e => setForm({ ...form, recipient: e.target.value })} /></label>
        <label>{t('addrPhone')}<input required type="tel" autoComplete="shipping tel" value={form.phone} maxLength={32} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
        <label>{t('addrProvince')}<input required autoComplete="shipping address-level1" value={form.province} maxLength={64} onChange={e => setForm({ ...form, province: e.target.value })} /></label>
        <label>{t('addrCity')}<input required autoComplete="shipping address-level2" value={form.city} maxLength={64} onChange={e => setForm({ ...form, city: e.target.value })} /></label>
        <label>{t('addrDistrict')}<input autoComplete="shipping address-level3" value={form.district} maxLength={64} onChange={e => setForm({ ...form, district: e.target.value })} /></label>
      </div>
      <label className="full-field">{t('addrDetail')}<input required autoComplete="shipping street-address" value={form.detail} maxLength={255} onChange={e => setForm({ ...form, detail: e.target.value })} /></label>
      <label className="login-agree"><input type="checkbox" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} /><span>{t('addrDefault')}</span></label>
      <div className="form-actions"><button type="submit" className="button button-dark" disabled={busy || demo}>{busy ? t('saving') : t('save')}</button><button type="button" className="text-button" onClick={() => setAdding(false)}>{en ? 'Cancel' : '取消'}</button></div>
      {demo && <p className="field-note">{en ? 'Form preview only. Saving is available for signed-in real tenants.' : '当前可预览表单，保存地址需在真实租户下登录。'}</p>}
    </form>}
    {loading ? <LoadingState label={t('loading')} /> : items.length ? <ul className="member-addresses">{items.map(item => <li key={item.id}><Address /><div><h2>{item.recipient}<span>{item.phone}</span></h2><p>{[item.province, item.city, item.district, item.detail].filter(Boolean).join(' ')}</p>{item.isDefault && <span className="quiet-tag">{t('addrDefault')}</span>}</div><button className="icon-button" type="button" disabled={busy} onClick={() => { void remove(item.id); }} aria-label={t('delete')}><Trash /></button></li>)}</ul>
      : !error && !adding && <PageState icon={<Address />} title={t('addressEmpty')} description={en ? 'Add a delivery address when you are ready.' : '需要配送时，可以在这里添加常用地址。'} />}
  </section>;
}

function AccountCollection({ kind, demo }: { kind: 'coupons' | 'notifications'; demo: boolean }) {
  const { t, language } = useSite();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setItems([]); setError('');
    if (demo) { setLoading(false); return; }
    setLoading(true);
    const request = kind === 'coupons' ? sessionApi.coupons() : sessionApi.notifications({ page: 1, pageSize: 20 });
    request.then(response => { if (!cancelled) setItems(Array.isArray(response) ? response : Array.isArray(response.items) ? response.items : []); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || t('loadFailed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, demo, revision, t]);
  if (loading) return <LoadingState label={t('loading')} />;
  if (error) return <PageState error title={t('loadFailed')} description={error}><button type="button" className="button button-outline" onClick={() => setRevision(revision + 1)}>{language === 'en' ? 'Try again' : '重试'}</button></PageState>;
  if (!items.length) return <PageState icon={kind === 'coupons' ? <Ticket /> : <Bell />} title={kind === 'coupons' ? t('couponsEmpty') : t('notificationsEmpty')} />;
  return <ul className={kind === 'coupons' ? 'member-coupons' : 'member-notices'}>{items.map((item, index) => <li key={item.id ?? index}>{kind === 'coupons' ? <Ticket /> : <Bell />}<div><h2>{item.name || item.title || item.templateName || (kind === 'coupons' ? t('coupon') : t('notification'))}</h2><p>{item.description || item.content || item.body || item.message || item.rule || ''}</p>{kind === 'coupons' && item.expiresAt && <small>{t('couponExpires', { date: String(item.expiresAt).slice(0, 10) })}</small>}{kind === 'notifications' && item.createdAt && <time>{String(item.createdAt).slice(0, 16).replace('T', ' ')}</time>}</div></li>)}</ul>;
}

/** The demo previews the complete layout but never calls account APIs. */
export function AccountPage() {
  const { href, isRemote, t } = useSite();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const active: MemberSection = params.get('section') === 'coupons' ? 'coupons' : params.get('section') === 'notifications' ? 'notifications' : 'addresses';
  useEffect(() => { if (isRemote && !isAuthenticated) navigate(href('/login?redirect=' + encodeURIComponent('/account?' + params)), { replace: true }); }, [isRemote, isAuthenticated, params]);
  if (isRemote && !isAuthenticated) return <div className="shell simple-page"><PageState title={t('loginRequired')}><Link className="button button-dark" to={href('/login')}>{t('loginCta')}</Link></PageState></div>;
  return <MemberLayout active={active} title={active === 'addresses' ? t('addressBook') : active === 'coupons' ? t('coupons') : t('notifications')} description={t('accountSubtitle')}>
    {active === 'addresses' ? <AddressBook demo={!isRemote} /> : <AccountCollection key={active} kind={active} demo={!isRemote} />}
  </MemberLayout>;
}
