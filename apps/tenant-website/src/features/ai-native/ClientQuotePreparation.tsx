/** Personal selected inputs -> quote and booking draft -> original booking page.
 * Each user intent covers a bounded chain of original operations. Reading a
 * retained reference never grants an Action or resumes that chain. */
import { useEffect, useRef, useState } from 'react';
import type { AiClientQuoteFacts, AiBookingSelection, AiBookingHandoff, ClientCreateQuoteRequest } from '@rental-os/shared';
import { captureEnterpriseHostSession, sessionApi, subscribeCustomerSession } from '../../data/authClient';
import { createClientQuoteSession, createClientQuoteBookingSession, clientQuoteStorageKey, clientQuoteBookingStoredRequest,
  type ClientQuoteView, type ClientQuoteBookingView } from './client-quote-session';
import { BookingDraftReview, QuoteParameterReview } from './BookingDraftReview';
import { ClientOriginalQuoteFacts } from './ClientOriginalQuoteFacts';

const initial: ClientQuoteView = { status: 'closed', canPrepare: false, canConfirm: false, canRead: false,
  pendingCore: false, matchesInput: true, material: null, quote: null };
export function ClientQuotePreparation(props: {
  selection: ClientCreateQuoteRequest | null; scopeKey: string; english: boolean;
  onMode(active: boolean, hasLocator: boolean, pendingCore: boolean): void;
  validateSelection(input: ClientCreateQuoteRequest): Promise<void>;
  bookingSelection?: (quote: AiClientQuoteFacts, selected: ClientCreateQuoteRequest) => Promise<AiBookingSelection>;
  onHandoff?: (handoff: AiBookingHandoff) => void;
}) {
  const [record, setRecord] = useState({ scopeKey: props.scopeKey, quote: initial, booking: null as ClientQuoteBookingView | null });
  const [working, setWorking] = useState(false), [error, setError] = useState(false), [canOrdinary, setCanOrdinary] = useState(false);
  const scope = useRef(props.scopeKey), selected = useRef(props.selection), callbacks = useRef(props), generation = useRef(0), busy = useRef(false);
  const activeIntent = useRef(false);
  const ordinaryReference = useRef<string | null>(null);
  scope.current = props.scopeKey; selected.current = props.selection; callbacks.current = props;
  const quoteRef = useRef<ReturnType<typeof createClientQuoteSession> | null>(null), bookingRef = useRef<ReturnType<typeof createClientQuoteBookingSession> | null>(null);
  const quoteOwner = useRef<{ key: string; current(): boolean } | null>(null);
  const state = record.scopeKey === props.scopeKey ? record : { scopeKey: props.scopeKey, quote: initial, booking: null };
  const setQuote = (quote: ClientQuoteView) => setRecord(old => ({ scopeKey: props.scopeKey, quote, booking: old.scopeKey === props.scopeKey ? old.booking : null }));
  const setBooking = (booking: ClientQuoteBookingView | null) => setRecord(old => ({ scopeKey: props.scopeKey, quote: old.scopeKey === props.scopeKey ? old.quote : initial, booking }));
  useEffect(() => {
    generation.current++; busy.current = false; activeIntent.current = false; ordinaryReference.current = null; setCanOrdinary(false);
    quoteRef.current?.dispose(); bookingRef.current?.dispose(); quoteRef.current = null; bookingRef.current = null; quoteOwner.current = null;
    setRecord({ scopeKey: props.scopeKey, quote: initial, booking: null }); setWorking(false); setError(false);
    const close = () => {
      generation.current++; busy.current = false; activeIntent.current = false; ordinaryReference.current = null; setCanOrdinary(false);
      quoteRef.current?.dispose(); bookingRef.current?.dispose(); quoteRef.current = null; bookingRef.current = null; quoteOwner.current = null;
      setRecord({ scopeKey: props.scopeKey, quote: { ...initial, status: 'invalidated' }, booking: null }); setWorking(false);
    };
    const visibility = () => { if (document.hidden) close(); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', close);
    const session = captureEnterpriseHostSession(), unsubscribe = session ? subscribeCustomerSession(session.tenantCode, close) : () => undefined;
    return () => { generation.current++; quoteRef.current?.dispose(); bookingRef.current?.dispose(); quoteRef.current = null; bookingRef.current = null;
      quoteOwner.current = null; unsubscribe(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', close); };
  }, [props.scopeKey]);
  const reportMode = (nextQuote?: ClientQuoteView, nextBooking?: ClientQuoteBookingView | null) => {
    const owner = quoteOwner.current; if (!owner?.current()) return;
    const quote = nextQuote ?? quoteRef.current?.snapshot(), booking = nextBooking ?? bookingRef.current?.snapshot();
    const retained = localStorage.getItem(owner.key), retainedBooking = localStorage.getItem(`${owner.key}:booking`);
    let pending = quote?.pendingCore === true;
    // A retained unknown/confirmed reference is conservative until this SAME
    // instance has observed it. Merely having a cache never selects AI mode.
    if (retained) {
      try { const phase = (JSON.parse(retained) as { phase?: unknown }).phase;
        pending ||= phase === 'quote_observed' ? quote?.status !== 'quoted' || !quote.quote
          : phase !== 'prepared' || quote?.status !== 'prepared'; }
      catch { pending = true; }
    }
    if (retainedBooking) pending ||= !booking?.observed || booking.pendingCore !== false;
    ordinaryReference.current = !pending ? JSON.stringify([owner.key, retained, retainedBooking]) : null;
    setCanOrdinary(!pending);
    callbacks.current.onMode(activeIntent.current, retained !== null, pending);
  };
  const ensureQuote = async (purpose: 'read' | 'write') => {
    if (scope.current !== props.scopeKey || document.hidden) return null;
    if (purpose === 'write') activeIntent.current = true;
    if (quoteRef.current && quoteOwner.current?.current()) { reportMode(); return quoteRef.current; }
    const session = captureEnterpriseHostSession(); if (!session) throw Error('quote_session_unavailable');
    const epoch = generation.current, current = () => epoch === generation.current && scope.current === props.scopeKey && session.current() && !document.hidden;
    const context = { tenantCode: session.tenantCode, serviceCode: session.workspaceCode, customerId: session.customerId,
      surface: 'tenant_website' as const, current }, key = clientQuoteStorageKey(context);
    quoteOwner.current = { key, current };
    reportMode();
    const instance = createClientQuoteSession({ context, api: { prepare: sessionApi.prepareClientQuote, readPreparation: sessionApi.readClientQuotePreparation,
      confirm: sessionApi.confirmClientQuote, readOriginal: sessionApi.readClientQuoteOriginal }, readHost: sessionApi.readBookingHostCapabilities,
      now: Date.now, newKey: () => `client-quote-${crypto.randomUUID()}`, selection: () => { if (!selected.current) throw Error('quote_selection_unavailable'); return selected.current; },
      storage: { read: () => { const value = localStorage.getItem(key); return value === null ? undefined : JSON.parse(value); }, write: value => localStorage.setItem(key, JSON.stringify(value)) },
      changed: next => { if (current()) { setQuote(next); reportMode(next); } } });
    quoteRef.current = instance; quoteOwner.current = { key, current }; await instance.open(); return current() ? instance : null;
  };
  const ensureBooking = async (purpose: 'read' | 'write') => {
    const quote = quoteRef.current?.snapshot(), originalInput = quoteRef.current?.originalInput(), owner = quoteOwner.current;
    if (!quote?.quote || !quote.material || !originalInput || !owner?.current()) return null;
    const session = captureEnterpriseHostSession(); if (!session) return null;
    const key = `${owner.key}:booking`, cached = localStorage.getItem(key);
    if (purpose === 'read' && cached === null) return null;
    const selection = purpose === 'read' ? clientQuoteBookingStoredRequest(JSON.parse(cached!)).selection
      : await callbacks.current.bookingSelection?.(quote.quote, originalInput);
    if (!selection || !owner.current()) return null;
    bookingRef.current?.dispose();
    const context = { tenantCode: session.tenantCode, serviceCode: session.workspaceCode, customerId: session.customerId,
      surface: 'tenant_website' as const, current: owner.current };
    const instance = createClientQuoteBookingSession({ context, original: { materialRef: quote.material.materialRef, expectedMaterialHash: quote.material.materialHash },
      selection: () => selection, readHost: sessionApi.readBookingHostCapabilities, now: Date.now, newKey: () => `booking-${crypto.randomUUID()}`,
      api: { prepareBooking: sessionApi.prepareOriginalQuoteBooking, readBookingPreparation: sessionApi.readOriginalQuoteBookingOperation,
        issueBookingAction: sessionApi.issueBookingAction, createBookingDraft: sessionApi.createBookingDraft, readBookingDraft: sessionApi.readBookingDraft,
        chooseBookingDraft: sessionApi.chooseBookingDraft, handoffBookingDraft: sessionApi.handoffBookingDraft, readBookingOperation: sessionApi.readBookingOperation, readHandoff: sessionApi.readBookingHandoff },
      storage: { read: () => { const value = localStorage.getItem(key); return value === null ? undefined : JSON.parse(value); }, write: value => localStorage.setItem(key, JSON.stringify(value)) },
      changed: next => { if (owner.current()) { setBooking(next); reportMode(undefined, next); } } });
    bookingRef.current = instance; await instance.open(); if (cached !== null) await instance.recover(); return instance;
  };
  const work = async (action: () => Promise<void>) => {
    if (busy.current || document.hidden || scope.current !== props.scopeKey) return;
    const epoch = generation.current; busy.current = true; setWorking(true); setError(false);
    try { await action(); } catch { if (epoch === generation.current) setError(true); }
    finally { if (epoch === generation.current) { busy.current = false; setWorking(false); } }
  };
  const generate = () => work(async () => {
    const instance = await ensureQuote('write'); if (!instance) return;
    if (instance.originalInput()) await instance.recover();
    else {
      const owner = quoteOwner.current, input = selected.current;
      if (!input || !owner?.current()) return;
      await callbacks.current.validateSelection(input);
      if (quoteOwner.current !== owner || !owner.current() || quoteRef.current !== instance) return;
      await instance.prepare();
    }
    const next = instance.snapshot(); if (next.status !== 'quoted' || !next.matchesInput || next.readOnly) return;
    const booking = await ensureBooking('write'); await booking?.generateDraft();
  });
  const confirmParameters = () => work(async () => {
    const instance = quoteRef.current; if (!instance?.snapshot().canConfirm || !quoteOwner.current?.current()) return;
    const owner = quoteOwner.current, input = instance.originalInput();
    if (!input) return;
    await callbacks.current.validateSelection(input);
    if (quoteOwner.current !== owner || !owner.current() || quoteRef.current !== instance || !instance.snapshot().canConfirm) return;
    activeIntent.current = true; reportMode();
    await instance.confirm();
    const next = instance.snapshot(); if (next.status !== 'quoted' || !next.matchesInput || next.readOnly) return;
    await (await ensureBooking('write'))?.generateDraft();
  });
  const recover = () => work(async () => {
    const instance = await ensureQuote('read'); if (!instance) return;
    if (instance.snapshot().canRead) await instance.recover();
    await ensureBooking('read'); // No prepare, confirm, Action issue, draft write or successor here.
  });
  const proceed = () => work(async () => {
    if (!quoteRef.current?.snapshot().matchesInput || !quoteOwner.current?.current()) return;
    const result = await bookingRef.current?.continueBooking();
    if (result?.status === 'handoff_ready' && result.handoff && !result.readOnly && quoteOwner.current?.current()) callbacks.current.onHandoff?.(result.handoff);
  });
  const ordinary = () => {
    const owner = quoteOwner.current; if (!owner?.current() || !canOrdinary || busy.current) return;
    if (ordinaryReference.current !== JSON.stringify([owner.key, localStorage.getItem(owner.key), localStorage.getItem(`${owner.key}:booking`)])) {
      ordinaryReference.current = null; setCanOrdinary(false); return;
    }
    const retained = localStorage.getItem(owner.key) !== null;
    activeIntent.current = false;
    quoteRef.current?.dispose(); bookingRef.current?.dispose(); quoteRef.current = null; bookingRef.current = null;
    callbacks.current.onMode(false, retained, false); setQuote(initial); setBooking(null); ordinaryReference.current = null; setCanOrdinary(false);
  };
  const en = props.english, quote = state.quote, booking = state.booking;
  // Request submission comes from the original Draft, never quote freshness,
  // an Action or a create/handoff receipt. Business results use their own reads.
  const submitted = booking?.draft?.state === 'submitted'
    && booking.draft.execution === 'submitted_request_not_business_success';
  const checkingBooking = booking?.status === 'unknown' || booking?.status === 'checking';
  const notSubmitted = !checkingBooking && booking?.observed === true && booking.draft?.execution === 'not_submitted'
    && ['draft_created', 'user_selected', 'handed_to_booking_page'].includes(booking.draft.state);
  const canContinue = Boolean(!submitted && booking && !booking.readOnly && (booking.canChoose || booking.canHandoff || booking.handoff));
  return <section aria-label={en ? 'Reservation draft' : '预约草稿'} aria-busy={working}>
    <h3>{en ? 'Reservation draft' : '预约草稿'}</h3>
    <p>{en ? 'Generate a quote and draft for your selection. Submit the order on the original booking page.' : '按所选条件生成报价和草稿，订单需在原预约页确认提交。'}</p>
    {!submitted && !booking?.draft && !booking?.handoff && !quote.canConfirm && <button type="button" className="button button-dark button-block" disabled={working || !props.selection || quote.readOnly === true || booking?.readOnly === true}
      onClick={() => void generate()}>{working ? (en ? 'Processing…' : '正在处理…') : (en ? 'Generate reservation draft' : '生成预约草稿')}</button>}
    {!submitted && quote.status === 'prepared' && <QuoteParameterReview review={quote.material?.parameterReview ?? null} english={en} />}
    {!submitted && quote.canConfirm && <button type="button" className="button button-dark button-block" disabled={working}
      onClick={() => void confirmParameters()}>{en ? 'Confirm pricing units and generate draft' : '确认计费单位并生成草稿'}</button>}
    <BookingDraftReview draft={booking?.draft ?? null} english={en} />
    {canContinue && quote.matchesInput && <button type="button" className="button button-dark button-block" disabled={working} onClick={() => void proceed()}>
      {en ? 'Confirm draft and continue booking' : '确认草稿并继续预约'}</button>}
    <button type="button" className="button button-outline button-block" disabled={working} onClick={() => void recover()}>{en ? 'Check original result' : '核对原结果'}</button>
    {working && <p role="status">{en ? 'Processing the selected reservation…' : '正在处理所选预约…'}</p>}
    {submitted && <p role="status" aria-live="polite">{en ? 'The original booking request was submitted. Check the original business result; payment, fulfillment and resource status require their original receipts.' : '原预约请求已提交，业务结果待核对；付款、履约和资源状态以原业务收据为准。'}</p>}
    {!submitted && (quote.status === 'unknown' || checkingBooking) && <p role="status" aria-live="polite">{en ? 'The original result needs checking. No request is sent again.' : '原结果待核对，不重复派发。'}</p>}
    {((quote.readOnly && quote.material) || booking?.readOnly && booking.observed) && <p role="status">{en ? 'Original record found. Current access is read only; you cannot continue.' : '已找到原记录；当前仅可查看，不能继续办理。'}</p>}
    {!quote.matchesInput && <p role="status">{en ? 'The selection changed. The original record is available only for checking.' : '所选条件已变化，原记录仅供核对。'}</p>}
    {notSubmitted && <p role="status">{en ? 'The original reservation draft has not submitted a booking request. Order and resource status come from the original business receipts.' : '原预约草稿尚未提交预约请求；订单和资源状态以原业务收据为准。'}</p>}
    {booking?.draft && !submitted && !notSubmitted && !checkingBooking && <p role="status">{en ? 'The original draft cannot currently be submitted. Check its original record or contact the merchant.' : '原草稿当前不可用于提交，请核对原记录或联系商户。'}</p>}
    {booking?.draft && <p style={{ overflowWrap: 'anywhere' }}>{en ? 'Original draft / revision' : '原草稿／修订'}：{booking.draft.bookingDraftId} / {booking.draft.revision}</p>}
    {booking?.observed && !booking.draft && !booking.handoff && <p>{en ? 'The original draft or handoff operation was recorded. Booking acceptance, submission and business results still require their original receipts.' : '原草稿或交接操作已记录；预约受理、提交和业务结果仍须核对原收据。'}</p>}
    <ClientOriginalQuoteFacts quote={quote.quote} observedAt={quote.quoteObservedAt} english={en} />
    {(error || quote.status === 'unavailable' || booking?.status === 'unavailable') && <p role="status">{en ? 'Currently unavailable. Keep any original reference and check its result.' : '当前暂不可用，请保留已有引用并核对原结果。'}</p>}
    {!submitted && canOrdinary && <button type="button" className="button button-outline button-block" disabled={working} onClick={ordinary}>{en ? 'Use ordinary booking' : '继续普通预约'}</button>}
  </section>;
}
