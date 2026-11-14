/** Original public browse reference only. Current login must explicitly choose
 * continuation; rendering, re-opening, hiding and receipt reads never prepare
 * another request. Traditional catalogue/booking remain independent. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createAiClientPublicContinuitySession, type AiClientPublicContinuityView } from '@rental-os/shared';
import { customerSessionGeneration } from '@rental-os/web-client';
import { loadSession, subscribeCustomerSession } from '../../data/authClient';
import { createClientPublicApi } from './client-public-api';

const empty: AiClientPublicContinuityView = { status: 'idle', expiresAt: null, canPrepare: true, canContinue: false,
  canRead: false, loginRequired: false };
export function ClientPublicBrowse({ tenantCode, serviceCode, kind, english, loginHref }: {
  tenantCode: string; serviceCode: string; kind: 'catalog' | 'help'; english: boolean; loginHref: string;
}) {
  const scope = JSON.stringify([tenantCode, serviceCode, kind]);
  const scopeRef = useRef(scope), owner = useRef<ReturnType<typeof createAiClientPublicContinuitySession> | null>(null);
  const epoch = useRef(0), busy = useRef(false);
  const [state, setState] = useState({ scope, view: empty }), [working, setWorking] = useState(false);
  scopeRef.current = scope;
  const view = state.scope === scope ? state.view : empty;
  useEffect(() => {
    const close = () => { epoch.current++; busy.current = false; owner.current?.dispose(); owner.current = null;
      setState({ scope, view: empty }); setWorking(false); };
    close();
    const changed = () => { close(); if (!document.hidden) void run('refresh'); };
    const visibility = () => { if (document.hidden) close(); else void run('refresh'); };
    const unsubscribe = subscribeCustomerSession(tenantCode, changed);
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', close);
    void run('refresh');
    return () => { epoch.current++; owner.current?.dispose(); owner.current = null; unsubscribe();
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', close); };
  }, [scope, tenantCode]);
  const ensure = async () => {
    if (owner.current) return owner.current;
    const captured = epoch.current, current = () => captured === epoch.current && scopeRef.current === scope && !document.hidden;
    const key = `rental-os:public-ai:${scope}`;
    const session = createAiClientPublicContinuitySession({ target: { tenantCode, serviceCode }, kind, channel: 'web', current,
      client: () => {
        const value = loadSession(tenantCode), generation = customerSessionGeneration(tenantCode);
        if (!value?.accessToken || value.workspace?.workspaceCode !== serviceCode || generation === 'unavailable') return null;
        const customerId = value.customer.customerId;
        return { ownerKey: JSON.stringify([tenantCode, serviceCode, customerId, generation]), current: () => current()
          && customerSessionGeneration(tenantCode) === generation && loadSession(tenantCode)?.customer.customerId === customerId
          && loadSession(tenantCode)?.workspace?.workspaceCode === serviceCode };
      }, api: createClientPublicApi({ tenantCode, serviceCode, current }), now: Date.now,
      newKey: () => `public-${crypto.randomUUID()}`,
      storage: { read: () => { const raw = sessionStorage.getItem(key); return raw === null ? undefined : JSON.parse(raw); },
        write: value => { sessionStorage.setItem(key, JSON.stringify(value)); } },
      changed: next => { if (current()) setState({ scope, view: next }); } });
    owner.current = session; await session.open(); return session;
  };
  const run = async (action: 'prepare' | 'refresh' | 'continueOriginal') => {
    if (busy.current || document.hidden) return;
    const captured = epoch.current; busy.current = true; setWorking(true);
    try {
      const session = await ensure();
      if (captured !== epoch.current || document.hidden || scopeRef.current !== scope) return;
      await session[action]();
    }
    catch { if (captured === epoch.current) setState({ scope, view: { ...empty, status: 'unavailable', canPrepare: false } }); }
    finally { if (captured === epoch.current) { busy.current = false; setWorking(false); } }
  };
  return <section className="booking-card" aria-busy={working} aria-label={english ? 'Continue this browsing request' : '继续本次浏览'}>
    <h3>{english ? 'Continue this browsing request' : '继续本次浏览'}</h3>
    <p>{english ? 'Keep this public browse request for an explicit continuation after login.' : '保留本次公开浏览，登录后可自行选择继续。'}</p>
    {view.canPrepare && <button type="button" className="button button-outline" disabled={working}
      onClick={() => void run('prepare')}>{english ? 'Keep this request' : '保留本次浏览'}</button>}
    {view.canRead && <button type="button" className="button button-outline" disabled={working}
      onClick={() => void run('refresh')}>{english ? 'Check original request' : '核对原浏览记录'}</button>}
    {view.loginRequired && <Link className="button button-outline" to={loginHref}>{english ? 'Log in to continue' : '登录后继续'}</Link>}
    {view.canContinue && <button type="button" className="button button-dark" disabled={working}
      onClick={() => void run('continueOriginal')}>{english ? 'Continue with this account' : '以当前账号继续本次浏览'}</button>}
    {view.status === 'continued' && <p role="status">{english ? 'This account is linked to the public request. Select rental details before requesting a quote.' : '本次公开浏览已续接到当前账号，请继续选择租赁条件后核价。'}</p>}
    {view.status === 'unknown' && <p role="status">{english ? 'The original result needs checking. Keep this request.' : '原结果待核对，请保留本次记录。'}</p>}
    {view.status === 'identity_changed' && <p role="status">{english ? 'This record belongs to another account session.' : '该记录属于另一账号会话，请继续普通浏览。'}</p>}
    {view.status === 'unavailable' && <p role="status">{english ? 'Continuation is unavailable. You can continue normal browsing and booking.' : '续接暂不可用，可继续普通浏览和预约。'}</p>}
  </section>;
}
