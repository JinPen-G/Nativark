import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSite } from '../../SiteContext';
import { useAuth } from '../../AuthContext';
import { captureBookingHostSession, sessionApi } from '../../data/authClient';
import { BookingHandoffHostProvider, BookingHandoffPendingProvider } from './BookingHandoffHost';
import { createBookingHandoffHostFactory } from './booking-host.factory';
import { createBookingHandoffConsumer, type BookingHandoffHost, type BookingHandoffState } from './booking-handoff';
import { ClientBookingTransfer } from './ClientBookingTransfer';

/** Fixed OPEN_BOOKING page consumer. Navigation carries ONLY an untrusted
 * reference, not publication, scope or callbacks. Mount/show is inert; the
 * human explicitly asks the server for current capabilities before opening.
 */
export function BookingHandoffBridge({ children }: { children: ReactNode }) {
  const { state, key } = useLocation();
  const { tenantCode, isRemote, language, href } = useSite();
  const { session } = useAuth();
  const navigate = useNavigate();
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
  const [transfer, setTransfer] = useState<{ session: typeof session; key: string; tenantCode: typeof tenantCode; active: boolean }>();
  const targetScope = JSON.stringify([tenantCode, key, session?.customer.customerId, session?.workspace?.workspaceCode]);
  const [transferHold, setTransferHold] = useState<{ scope: string; session: typeof session; attempted: boolean }>();
  const [transferError, setTransferError] = useState<{ scope: string }>();
  const transferSelection = useRef<{ epoch: number; cancel?: () => void }>({ epoch: 0 });
  const transferBinding = useRef({ scope: targetScope, session });
  transferBinding.current = { scope: targetScope, session };
  const [transferReceipt, setTransferReceipt] = useState<{ scope: string; session: typeof session; generation: number; selectionEpoch: number;
    reference: string; state: BookingHandoffState }>();
  const transferActive = isRemote && session?.customer.customerType === 'personal'
    && transfer?.session === session && transfer.key === key && transfer.tenantCode === tenantCode && transfer.active;
  const transferAttempted = transferHold?.scope === targetScope && transferHold.session === session && transferHold.attempted;
  // Past locators remain recoverable, but only this page's explicit transfer
  // intent pauses its ordinary form. Other product visits are independent.
  const transferPending = transferActive;
  useEffect(() => {
    const life = lifetime.current;
    life.active = true; life.generation++; life.busy = false;
    const hide = () => { if (document.hidden) {
      life.generation++; life.busy = false; life.dispose?.(); life.dispose = undefined;
      transferSelection.current.epoch++; transferSelection.current.cancel?.(); transferSelection.current.cancel = undefined;
      setView(undefined); setTransferReceipt(undefined);
    } };
    document.addEventListener('visibilitychange', hide);
    return () => {
      life.active = false; life.generation++; life.dispose?.(); life.dispose = undefined;
      transferSelection.current.epoch++; transferSelection.current.cancel?.(); transferSelection.current.cancel = undefined;
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
  const continueTransferred = async ({ handoffRef }: { handoffRef: string }) => {
    const life = lifetime.current, generation = life.generation, captured = captureBookingHostSession();
    if (!transferActive || !captured || !life.active || life.busy || document.hidden) return;
    life.busy = true;
    const selectionEpoch = transferSelection.current.epoch;
    const valid = () => life.active && life.generation === generation && transferSelection.current.epoch === selectionEpoch
      && captured.current() && !document.hidden;
    const owner = createBookingHandoffHostFactory('server');
    const cancel = () => owner.dispose(); transferSelection.current.cancel = cancel;
    try {
      const host = await owner.openFromUser(handoffRef);
      if (!valid() || host?.mode !== 'interactive' || !host.readBookingHandoff) throw Error('unavailable');
      const material = await host.readBookingHandoff({ handoffRef });
      if (!valid() || host.isCurrent?.() !== true || material.handoffRef !== handoffRef || !material.fields.lines[0]) throw Error('unavailable');
      // The original server material supplies the route anchor. The current URL
      // and the transfer locator cannot select a product or copy its contents.
      navigate(href(`/booking/${encodeURIComponent(material.fields.lines[0].itemGroupId)}`), {
        state: { aiBookingHandoffRef: handoffRef } });
    } catch {
      if (valid()) setTransferError({ scope: targetScope });
    } finally {
      owner.dispose();
      if (transferSelection.current.cancel === cancel) transferSelection.current.cancel = undefined;
      if (life.generation === generation && transferSelection.current.epoch === selectionEpoch) life.busy = false;
    }
  };
  const readTransferredReceipt = async ({ handoffRef }: { handoffRef: string }) => {
    const life = lifetime.current, generation = life.generation, captured = captureBookingHostSession();
    if (!transferActive || !captured || !tenantCode || !life.active || life.busy || document.hidden) return;
    life.busy = true; setTransferReceipt(undefined); setTransferError(undefined);
    const selectionEpoch = transferSelection.current.epoch;
    const valid = () => life.active && life.generation === generation && transferSelection.current.epoch === selectionEpoch
      && captured.current() && !document.hidden;
    const owner = createBookingHandoffHostFactory('server', 'receipt_only');
    let consumer: ReturnType<typeof createBookingHandoffConsumer> | undefined;
    const cancel = () => { consumer?.destroy(); owner.dispose(); }; transferSelection.current.cancel = cancel;
    try {
      const host = await owner.openFromUser(handoffRef);
      if (!valid() || host?.mode !== 'receipt_only') throw Error('unavailable');
      consumer = createBookingHandoffConsumer(host, { tenantCode, workspaceCode: captured.workspaceCode,
        customerId: captured.customerId, authenticated: true, productId: '' }, state => {
        if (valid()) setTransferReceipt({ scope: targetScope, session, generation, selectionEpoch, reference: handoffRef, state });
      });
      consumer.mount(); await consumer.reconcile();
    } catch { if (valid()) setTransferError({ scope: targetScope }); }
    finally {
      cancel();
      if (transferSelection.current.cancel === cancel) transferSelection.current.cancel = undefined;
      if (life.generation === generation && transferSelection.current.epoch === selectionEpoch) life.busy = false;
    }
  };
  const currentTransferReceipt = transferReceipt?.scope === targetScope
    && transferReceipt.session === session && transferReceipt.generation === lifetime.current.generation
    && transferReceipt.selectionEpoch === transferSelection.current.epoch ? transferReceipt : undefined;
  const transferOrder = currentTransferReceipt?.state.receipt?.state === 'observed' ? currentTransferReceipt.state.receipt : null;
  return <BookingHandoffPendingProvider value={Boolean(transferPending && !activeHost)}><BookingHandoffHostProvider value={activeHost ?? null}>
    {isRemote && session && !activeHost && <section className="booking-card" aria-label={english ? 'Original AI booking draft' : 'AI预约草稿交接'}>
      <p>{english ? 'Check your original AI draft. If unavailable, continue with the ordinary booking form.' : '仅核对本人原AI草稿；入口未发布时继续使用原预约表单。'}</p>
      {typeof raw !== 'string' && <label htmlFor={inputId}>{english ? 'Original handoff reference' : '原预约草稿交接编号'}
        <input id={inputId} value={reference} maxLength={191} autoComplete="off" disabled={current?.pending}
          onChange={event => setInput({ session, key, tenantCode, value: event.target.value.trim() })} />
      </label>}
      <button type="button" disabled={!ref || current?.pending} onClick={() => void open()}>{current?.pending ? (english ? 'Checking…' : '正在核对…') : (english ? 'Check original draft' : '核对AI预约草稿')}</button>
      {current?.error && <p role="status">{english ? 'Draft or service unavailable. Check the original booking result on the Orders page.' : '当前材料或入口不可用，请到订单页核对原预约结果。'}</p>}
    </section>}
    {isRemote && session?.customer.customerType === 'personal' && !activeHost && <section className="booking-card">
      {!transferActive && <button type="button" className="button button-outline" onClick={() => {
        setTransfer({ session, key, tenantCode, active: true });
      }}>{english ? 'Continue a booking from the other device' : '接续另一端的预约'}</button>}
      {transferActive && <ClientBookingTransfer enabled scopeKey={targetScope} kind="consume" english={english}
        onHold={value => {
          if (transferBinding.current.scope !== targetScope || transferBinding.current.session !== session) return;
          // The child reports each selected original before the parent awaits.
          // Cancel that await as well as its display when selection changes.
          transferSelection.current.epoch++;
          if (transferSelection.current.cancel) {
            transferSelection.current.cancel(); transferSelection.current.cancel = undefined; lifetime.current.busy = false;
          }
          setTransferReceipt(undefined);
          setTransferHold({ scope: targetScope, session, attempted: value.attempted });
        }}
        onReceiptHandoff={value => readTransferredReceipt(value)}
        onHandoff={value => { setTransferError(undefined); return continueTransferred(value); }} />}
      {transferActive && (!transferAttempted || transferOrder) && <button type="button" className="button button-outline"
        onClick={() => { setTransfer({ session, key, tenantCode, active: false }); setTransferHold(undefined); }}>
        {english ? 'Return to ordinary booking' : '返回普通预约'}</button>}
      {transferOrder && <Link className="button button-outline" to={href(`/orders/${encodeURIComponent(transferOrder.orderId)}`)}>
        {english ? 'View the original order' : '查看原订单'}</Link>}
      {currentTransferReceipt && !transferOrder && <p role="status">{english
        ? 'The original booking result needs checking. This read does not confirm non-execution or permit another submission.'
        : '原预约结果仍需核对；这次读取不证明未执行，也不允许再次提交。'}</p>}
      {transferError?.scope === targetScope && <p role="status">{english
        ? 'The original booking cannot be opened right now. Keep the original reference and check its receipt.'
        : '原预约暂时无法打开，请保留原引用并核对原收据。'}</p>}
    </section>}
    {children}
  </BookingHandoffHostProvider></BookingHandoffPendingProvider>;
}
