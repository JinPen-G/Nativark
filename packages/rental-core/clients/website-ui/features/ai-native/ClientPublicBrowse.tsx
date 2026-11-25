import { customerSessionGeneration, websiteTransientStorage } from "../../host";
/** Original public browse reference only. Lifecycle callbacks inspect local
 * locator presence; only explicit intents read or continue the original request.
 * Cached records grant no execution. Traditional browsing stays independent. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createAiClientPublicContinuitySession, type AiClientPublicContinuityView } from '@rental-os/shared';

import { loadSession, sessionApi, subscribeCustomerSession } from '../../data/authClient';
import { createClientPublicApi } from './client-public-api';

const empty: AiClientPublicContinuityView = { status: 'idle', expiresAt: null, canPrepare: false, canContinue: false,
  canRead: false, loginRequired: false };
export function ClientPublicBrowse({ tenantCode, serviceCode, kind, english, loginHref }: {
  tenantCode: string; serviceCode: string; kind: 'catalog' | 'help'; english: boolean; loginHref: string;
}) {
  const scope = JSON.stringify([tenantCode, serviceCode, kind]);
  const scopeRef = useRef(scope), owner = useRef<ReturnType<typeof createAiClientPublicContinuitySession> | null>(null);
  const epoch = useRef(0), busy = useRef(false);
  const failedWrite = useRef<{ scope: string; reference: string | null; previous: string | null } | null>(null);
  const [state, setState] = useState({ scope, view: empty }), [working, setWorking] = useState(false);
  scopeRef.current = scope;
  const view = state.scope === scope ? state.view : empty;
  const signedIn = loadSession(tenantCode);
  const needsServiceSwitch = view.loginRequired && !!signedIn?.accessToken && signedIn.workspace?.workspaceCode !== serviceCode;
  useEffect(() => {
    let active = true;
    const close = () => { if (!active) return; epoch.current++; busy.current = false; owner.current?.dispose(); owner.current = null;
      if (active && scopeRef.current === scope) { setState({ scope, view: empty }); setWorking(false); } };
    const restoreLocal = () => {
      if (!active) return;
      close();
      if (!active || scopeRef.current !== scope || document.hidden) return;
      try {
        const present = websiteTransientStorage().getItem(`rental-os:public-ai:${scope}`) !== null;
        // Presence offers an explicit check only. The shared session validates
        // the exact original locator under current authority after that click.
        const held = present || failedWrite.current?.scope === scope;
        setState({ scope, view: { ...empty, status: held ? 'unknown' : 'idle', canRead: held, canPrepare: !held } });
      } catch { setState({ scope, view: { ...empty, status: 'unavailable', canRead: true } }); }
    };
    const changed = restoreLocal;
    const visibility = () => { if (document.hidden) close(); else restoreLocal(); };
    const unsubscribe = subscribeCustomerSession(tenantCode, changed);
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', close);
    restoreLocal();
    return () => { close(); active = false; unsubscribe();
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', close); };
  }, [scope, tenantCode]);
  const ensure = async () => {
    if (owner.current) return { session: owner.current, opened: false };
    const captured = epoch.current, sessionGeneration = customerSessionGeneration(tenantCode);
    const current = () => captured === epoch.current && scopeRef.current === scope && !document.hidden
      && customerSessionGeneration(tenantCode) === sessionGeneration;
    const key = `rental-os:public-ai:${scope}`;
    let held = websiteTransientStorage().getItem(key);
    const read = () => {
      const raw = websiteTransientStorage().getItem(key);
      if (!current() || raw !== held) throw Error('public_original_reference_changed');
      return raw === null ? undefined : JSON.parse(raw);
    };
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
      storage: { read,
        write: value => {
          const previous = held;
          try {
            read(); held = JSON.stringify(value);
            websiteTransientStorage().setItem(key, held);
            if (websiteTransientStorage().getItem(key) !== held) throw Error('public_original_reference_not_retained');
          } catch (error) { failedWrite.current = { scope, reference: held, previous }; throw error; }
        } },
      changed: next => { if (current()) setState({ scope, view: failedWrite.current?.scope === scope
        ? { ...next, canPrepare: false, canContinue: false, canRead: true } : next }); } });
    owner.current = session; await session.open(); return current() ? { session, opened: true } : null;
  };
  const run = async (action: 'prepare' | 'refresh' | 'continueOriginal') => {
    if (busy.current || document.hidden || scopeRef.current !== scope) return;
    if (failedWrite.current?.scope === scope && action !== 'refresh') return;
    const available = owner.current?.snapshot() ?? view;
    if (action === 'prepare' && !available.canPrepare || action === 'continueOriginal' && !available.canContinue) return;
    const captured = epoch.current; busy.current = true; setWorking(true);
    try {
      if (failedWrite.current?.scope === scope) {
        const retained = websiteTransientStorage().getItem(`rental-os:public-ai:${scope}`);
        // A failed response write may leave the confirmed pending journal. It
        // still identifies this exact original request, so an explicit read may
        // recover it; a competing page's different locator remains rejected.
        if (retained === null || retained !== failedWrite.current.reference && retained !== failedWrite.current.previous) {
          throw Error('public_original_reference_not_retained');
        }
        owner.current?.dispose(); owner.current = null; failedWrite.current = null;
      }
      const opened = await ensure();
      if (!opened || captured !== epoch.current || document.hidden || scopeRef.current !== scope) return;
      // open() already reads the held original record. One explicit check
      // needs one read; subsequent checks reuse the same original session.
      if (action !== 'refresh' || !opened.opened) await opened.session[action]();
    }
    catch { if (captured === epoch.current) setState({ scope, view: { ...empty, status: 'unavailable', canRead: true } }); }
    finally { if (captured === epoch.current) { busy.current = false; setWorking(false); } }
  };
  return <section className="booking-card" aria-busy={working} aria-label={english ? 'Continue this browsing request' : '继续本次浏览'}>
    <h3>{english ? 'Continue this browsing request' : '继续本次浏览'}</h3>
    <p>{english ? 'Keep this public browse request for an explicit continuation after login.' : '保留本次公开浏览，登录后可自行选择继续。'}</p>
    {view.canPrepare && <button type="button" className="button button-outline" disabled={working}
      onClick={() => void run('prepare')}>{english ? 'Keep this request' : '保留本次浏览'}</button>}
    {view.canRead && <button type="button" className="button button-outline" disabled={working}
      onClick={() => void run('refresh')}>{english ? 'Check original request' : '核对原浏览记录'}</button>}
    {view.loginRequired && !needsServiceSwitch && <Link className="button button-outline" to={loginHref}>{english ? 'Log in to continue' : '登录后继续'}</Link>}
    {needsServiceSwitch && <button type="button" className="button button-outline" disabled={working} onClick={() => {
      if (busy.current || document.hidden || scopeRef.current !== scope) return;
      const captured = epoch.current;
      busy.current = true; setWorking(true);
      void sessionApi.switchWorkspace(serviceCode).catch(() => {
        if (captured === epoch.current && scopeRef.current === scope) setState({ scope, view: { ...empty, status: 'unavailable', canPrepare: false } });
      }).finally(() => { if (captured === epoch.current) { busy.current = false; setWorking(false); } });
    }}>{english ? 'Switch to this service' : '切换到此服务再继续'}</button>}
    {view.canContinue && <button type="button" className="button button-dark" disabled={working}
      onClick={() => void run('continueOriginal')}>{english ? 'Continue with this account' : '以当前账号继续本次浏览'}</button>}
    {view.status === 'continued' && <p role="status">{english ? 'This account is linked to the public request. Select rental details before requesting a quote.' : '本次公开浏览已续接到当前账号，请继续选择租赁条件后核价。'}</p>}
    {view.status === 'unknown' && <p role="status">{english ? 'The original result needs checking. Check the original request.' : '原结果待核对，请点击核对原浏览记录。'}</p>}
    {view.status === 'identity_changed' && <p role="status">{english ? 'This record belongs to another account session.' : '该记录属于另一账号会话，请继续普通浏览。'}</p>}
    {view.status === 'unavailable' && <p role="status">{english ? 'Continuation is unavailable. You can continue normal browsing and booking.' : '续接暂不可用，可继续普通浏览和预约。'}</p>}
  </section>;
}
