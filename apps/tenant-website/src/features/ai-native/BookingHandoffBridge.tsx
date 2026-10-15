import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useSite } from '../../SiteContext';
import { useAuth } from '../../AuthContext';
import { captureBookingHostSession, sessionApi } from '../../data/authClient';
import { BookingHandoffHostProvider } from './BookingHandoffHost';
import { createBookingHandoffHostFactory } from './booking-host.factory';
import type { BookingHandoffHost } from './booking-handoff';

/** Fixed OPEN_BOOKING page consumer. Navigation carries ONLY an untrusted
 * reference, not publication, scope or callbacks. Mount/show is inert; the
 * human explicitly asks the server for current capabilities before opening.
 */
export function BookingHandoffBridge({ children }: { children: ReactNode }) {
  const { state, key } = useLocation();
  const { tenantCode, isRemote, language } = useSite();
  const { session } = useAuth();
  const raw: unknown = state && typeof state === 'object' ? state.aiBookingHandoffRef : undefined;
  const [input, setInput] = useState<{ session: typeof session; key: string; tenantCode: typeof tenantCode; value: string }>();
  const reference = input?.session === session && input.key === key && input.tenantCode === tenantCode ? input.value : '';
  const inputId = useId(), english = language === 'en';
  const proposed = typeof raw === 'string' ? raw : reference;
  const ref = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(proposed) ? proposed : null;
  const lifetime = useRef({ generation: 0, active: false, busy: false,
    dispose: undefined as (() => void) | undefined });
  const [view, setView] = useState<{ session: typeof session; key: string; reference: string; tenantCode: string; generation: number;
    host?: BookingHandoffHost; pending?: boolean; error?: boolean }>();
  useEffect(() => {
    const life = lifetime.current;
    life.active = true; life.generation++; life.busy = false;
    const hide = () => { if (document.hidden) { life.generation++; life.busy = false; life.dispose?.(); life.dispose = undefined; setView(undefined); } };
    document.addEventListener('visibilitychange', hide);
    return () => {
      life.active = false; life.generation++; life.dispose?.(); life.dispose = undefined;
      document.removeEventListener('visibilitychange', hide);
    };
  }, [session, key, ref, tenantCode]);
  const current = view?.session === session && view.key === key && view.reference === ref && view.tenantCode === tenantCode
    && view.generation === lifetime.current.generation ? view : undefined;
  const activeHost = current?.host?.isCurrent?.() ? current.host : undefined;
  const open = async () => {
    const life = lifetime.current, generation = life.generation, captured = captureBookingHostSession();
    if (!ref || !tenantCode || !isRemote || !captured || !life.active || life.busy || document.hidden) return;
    life.busy = true;
    const valid = () => life.active && life.generation === generation && captured.current() && !document.hidden;
    let owner: ReturnType<typeof createBookingHandoffHostFactory> | undefined;
    setView({ session, key, reference: ref, tenantCode, generation, pending: true });
    try {
      const capability = await sessionApi.readBookingHostCapabilities();
      if (!valid() || capability.tenantCode !== tenantCode || capability.serviceCode !== captured.workspaceCode
        || capability.customerId !== captured.customerId || capability.channel !== 'web'
        || capability.surface !== 'tenant_website' || capability.enabled !== true) throw Error('unavailable');
      owner = createBookingHandoffHostFactory(capability);
      life.dispose?.(); life.dispose = owner.dispose;
      const host = await owner.openFromUser(ref);
      if (!valid() || !host) throw Error('unavailable');
      setView({ session, key, reference: ref, tenantCode, generation, host });
    } catch {
      owner?.dispose();
      if (valid()) setView({ session, key, reference: ref, tenantCode, generation, error: true });
    } finally { if (life.generation === generation) life.busy = false; }
  };
  return <BookingHandoffHostProvider value={activeHost ?? null}>
    {isRemote && session && !activeHost && <section className="booking-card" aria-label={english ? 'Original AI booking draft' : 'AI预约草稿交接'}>
      <p>{english ? 'Check your original AI draft. If unavailable, continue with the ordinary booking form.' : '仅核对本人原AI草稿；入口未发布时继续使用原预约表单。'}</p>
      {typeof raw !== 'string' && <label htmlFor={inputId}>{english ? 'Original handoff reference' : '原预约草稿交接编号'}
        <input id={inputId} value={reference} maxLength={191} autoComplete="off" disabled={current?.pending}
          onChange={event => setInput({ session, key, tenantCode, value: event.target.value.trim() })} />
      </label>}
      <button type="button" disabled={!ref || current?.pending} onClick={() => void open()}>{current?.pending ? (english ? 'Checking…' : '正在核对…') : (english ? 'Check original draft' : '核对AI预约草稿')}</button>
      {current?.error && <p role="status">{english ? 'Draft or service unavailable. No order was submitted; use the ordinary form.' : '当前材料或入口不可用，请继续人工预约；未提交订单。'}</p>}
    </section>}
    {children}
  </BookingHandoffHostProvider>;
}
