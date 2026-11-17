/** Inline explicit transfer controls for an existing Booking host. It restores
 * minimal local locators only; the original parent host owns publication and
 * the independently guarded handoff/page. No URL or browser cache enables it. */
import { useEffect, useRef, useState } from 'react';
import { captureEnterpriseHostSession, subscribeCustomerSession } from '../../data/authClient';
import { createClientBookingTransferApi } from './client-booking-transfer-api';
import { clientBookingTransferStorageKey, createClientBookingTransferStorage, createClientBookingTransferSession,
  type ClientBookingTransferView } from './client-booking-transfer-session';

type Session = ReturnType<typeof createClientBookingTransferSession>;
type Hold = Pick<ClientBookingTransferView, 'hasLocator' | 'attempted'>;
export function ClientBookingTransfer(props: {
  enabled: boolean; scopeKey: string; kind: 'issue' | 'consume'; handoffRef?: string; english?: boolean;
  onHandoff(value: { handoffRef: string }): void;
  onReceiptHandoff?(value: { handoffRef: string }): void;
  onHold?(value: { hasLocator: boolean; attempted: boolean }): void;
}) {
  const renderKey = JSON.stringify([props.scopeKey, props.kind, props.handoffRef ?? null]);
  const [state, setState] = useState<{ scopeKey: string; view: ClientBookingTransferView | null }>({ scopeKey: renderKey, view: null });
  const [reference, setReference] = useState(''), [error, setError] = useState(false), [loggedIn, setLoggedIn] = useState(false);
  const owner = useRef<Session | null>(null), scope = useRef(props.scopeKey), latest = useRef(props), epoch = useRef(0);
  const abort = useRef<AbortController | null>(null), currentOwner = useRef<(() => boolean) | null>(null);
  const held = useRef<(Hold & { key: string }) | null>(null);
  const selected = useRef<{ key: string; ref: string } | null>(null);
  scope.current = renderKey; latest.current = props;
  useEffect(() => {
    let release: () => void = () => undefined, active = true;
    let attached: Session | null = null, controller: AbortController | null = null;
    let reportHold: ((view: Hold) => void) | null = null;
    const close = () => {
      if (attached) reportHold?.(attached.snapshot());
      if (attached && owner.current === attached) {
        epoch.current++; owner.current = null; currentOwner.current = null;
        if (abort.current === controller) abort.current = null;
      }
      attached?.dispose(); attached = null; controller?.abort(); controller = null;
      reportHold = null; release(); release = () => undefined;
      if (active && scope.current === renderKey) {
        setReference(''); setState({ scopeKey: renderKey, view: null }); setLoggedIn(false);
      }
    };
    const attach = () => {
      if (!active || !props.enabled || document.hidden || owner.current) return;
      const captured = captureEnterpriseHostSession(); if (!captured) { setLoggedIn(false); return; }
      const generation = ++epoch.current, current = () => active && generation === epoch.current && scope.current === renderKey
        && latest.current.enabled && captured.current() && !document.hidden;
      const context = { tenantCode: captured.tenantCode, serviceCode: captured.workspaceCode, customerId: captured.customerId,
        surface: 'tenant_website' as const, current };
      const key = clientBookingTransferStorageKey(context, props.kind, props.handoffRef);
      const localKey = JSON.stringify([renderKey, key]);
      const storage = createClientBookingTransferStorage({ context, kind: props.kind, handoffRef: props.handoffRef,
        initialRef: selected.current?.key === localKey ? selected.current.ref : undefined,
        read: entry => { const value = localStorage.getItem(entry); return value === null ? undefined : JSON.parse(value); },
        write: (entry, value) => localStorage.setItem(entry, JSON.stringify(value)) });
      // Cleanup belongs to the callback captured for this owner and scope. A
      // later render's callback must never receive the previous operation hold.
      const onHold = props.onHold;
      const report = (view: Hold) => {
        const holdKey = JSON.stringify([renderKey, storage.key()]), before = held.current;
        const retained = before?.key === holdKey ? before : { key: holdKey, hasLocator: false, attempted: false };
        held.current = retained;
        const ref = storage.reference(); if (ref) selected.current = { key: localKey, ref };
        retained.hasLocator ||= view.hasLocator; retained.attempted ||= view.attempted;
        onHold?.({ hasLocator: retained.hasLocator, attempted: retained.attempted });
      };
      reportHold = report; controller = new AbortController(); abort.current = controller;
      const session = createClientBookingTransferSession({ context, kind: props.kind, handoffRef: props.handoffRef,
        api: createClientBookingTransferApi(context, controller.signal), now: Date.now,
        newKey: () => `booking-transfer-${crypto.randomUUID()}`,
        storage,
        changed: view => { if (current()) { report(view); setState({ scopeKey: renderKey, view }); } } });
      attached = session; owner.current = session; currentOwner.current = current; setLoggedIn(true); session.open();
      release = subscribeCustomerSession(captured.tenantCode, close);
    };
    setError(false); close();
    try { attach(); } catch { setError(true); }
    const visibility = () => { if (document.hidden) close(); else { try { attach(); } catch { setError(true); } } };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', close);
    return () => { active = false; close(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', close); };
  }, [props.enabled, renderKey]);
  const work = async (run: (session: Session) => Promise<unknown> | void) => {
    const session = owner.current, generation = epoch.current;
    if (!session || !currentOwner.current?.()) return;
    setError(false);
    try { await run(session); } catch { if (generation === epoch.current) setError(true); }
  };
  const continueOriginal = () => work(async session => {
    const result = await session.continueHandoff();
    if (result && session === owner.current && currentOwner.current?.()) latest.current.onHandoff(result);
  });
  const readOriginalReceipt = () => work(async session => {
    const result = await session.readReceiptHandoff();
    if (result && session === owner.current && currentOwner.current?.()) latest.current.onReceiptHandoff?.(result);
  });
  if (!props.enabled) return null;
  const en = props.english === true, view = state.scopeKey === renderKey ? state.view : null, busy = view?.status === 'checking';
  const text = (cn: string, english: string) => en ? english : cn;
  return <section aria-label={text('在另一端继续预约', 'Continue your booking on another device')} aria-busy={busy}
    style={{ display: 'grid', gap: 'var(--s12)', marginBlock: 'var(--s16)', minWidth: 0 }}>
    <h3>{text('在另一端继续预约', 'Continue your booking on another device')}</h3>
    <p>{text('先在另一端正常登录同一商户和服务。这里只转接原预约引用，订单仍需在原预约页确认提交。',
      'Sign in to the same merchant and service on the other device. This transfers the original booking reference; submit the order on the original booking page.')}</p>
    {!loggedIn && <p role="status">{text('请先正常登录，再打开此预约转接入口。', 'Sign in normally, then reopen this booking transfer.')}</p>}
    {props.kind === 'issue' && view?.canIssue && <button type="button" className="button button-dark button-block" disabled={busy}
      onClick={() => void work(session => session.issue())}>{text('生成短期转接引用', 'Generate a short-lived transfer reference')}</button>}
    {props.kind === 'consume' && view?.canRetain && <form className="full-field" onSubmit={event => {
      event.preventDefault(); void work(session => { session.retain(reference); if (session.snapshot().hasLocator) setReference(''); });
    }}>
      <label className="booking-field">{text('另一端提供的转接引用', 'Transfer reference from the other device')}
        <input type="text" value={reference} onChange={event => setReference(event.target.value)} maxLength={36} required
          autoComplete="off" spellCheck={false} disabled={!loggedIn || busy} /></label>
      <button type="submit" className="button button-outline button-block" disabled={!view?.canRetain || !reference.trim() || busy}>
        {text('保留引用，准备接续', 'Retain reference for continuation')}</button>
      {view.hasLocator && <p>{text('可明确选择另一个原转接引用；原引用和未知操作继续保留。',
        'You can explicitly select another original transfer reference. Previous references and unknown operations remain retained.')}</p>}
    </form>}
    {props.kind === 'consume' && view?.hasLocator && <p style={{ overflowWrap: 'anywhere' }}>{text('已保留原转接引用：', 'Original transfer reference retained: ')}{view.transferRef}</p>}
    {view?.canConsume && <button type="button" className="button button-dark button-block" disabled={busy}
      onClick={() => void work(session => session.consume())}>{text('确认接续原预约', 'Confirm continuation of the original booking')}</button>}
    {view?.issue?.state === 'issued' && <div style={{ overflowWrap: 'anywhere' }}>
      <p>{text('在另一端输入此短期引用：', 'Enter this short-lived reference on the other device: ')}</p>
      <p><output>{view.transferRef}</output></p><p>{text('引用有效至：', 'Valid until: ')}{view.expiresAt}</p>
    </div>}
    {view?.canRead && <button type="button" className="button button-outline button-block" disabled={busy}
      onClick={() => void work(session => session.read())}>{text('核对原转接结果', 'Check the original transfer result')}</button>}
    {props.kind === 'consume' && view?.canRead && props.onReceiptHandoff && <button type="button"
      className="button button-outline button-block" disabled={busy} onClick={() => void readOriginalReceipt()}>
      {text('只核对原预约结果', 'Check only the original booking result')}</button>}
    {view?.canContinue && <button type="button" className="button button-dark button-block" disabled={busy}
      onClick={() => void continueOriginal()}>{text('核对引用并打开原预约页', 'Check reference and open the original booking page')}</button>}
    {busy && <p role="status">{text('正在核对原转接。', 'Checking the original transfer.')}</p>}
    {view?.status === 'unknown' && <p role="status">{text('原结果待核对，请读取原收据，不重复转接。', 'The original result needs checking. Read its receipt without repeating the transfer.')}</p>}
    {view?.status === 'expired' && <p role="status">{text('短期引用已到期，不能继续；已有操作仍可核对原收据。', 'The short-lived reference expired. Continuation is unavailable; existing operations can still be checked.')}</p>}
    {view?.status === 'consumed' && <p>{text('已读取原接续收据；它不表示订单创建、付款或履约成功。', 'Original continuation receipt read. It does not mean the order, payment or fulfillment succeeded.')}</p>}
    {(error || view?.status === 'unavailable') && <p role="status">{text('暂时无法核对，请保留原引用并读取原结果。', 'Unable to check right now. Keep the original reference and check its result.')}</p>}
  </section>;
}
