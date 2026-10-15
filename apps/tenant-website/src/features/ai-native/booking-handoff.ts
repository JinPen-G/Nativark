import type { AiBookingHandoff, AiBookingSubmissionAcceptance, AiBookingSubmissionDecision, AiBookingSubmissionReceipt,
  AiBookingAcceptanceReadRequest, AiBookingAcceptanceReadResponse } from '../../../../../packages/shared/src/ai-booking-draft';
import type { RentalQuoteSnapshotV1 } from '../../../../../packages/shared/src';

export function normalizeBookingAcceptanceObservation(value: AiBookingAcceptanceReadResponse, handoffRef: string): AiBookingAcceptanceReadResponse {
  const id = (x: unknown) => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(x);
  const uuid = (x: unknown) => typeof x === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(x);
  if (!value || JSON.stringify(value).length > 8192 || value.contractVersion !== 'ain-booking-acceptance-read-1'
    || value.handoffRef !== handoffRef || !uuid(handoffRef) || !id(value.operationKey) || value.retryable !== false
    || value.currentUse !== 'not_authorized_by_receipt' || value.execution !== 'not_attested') throw Error('invalid_acceptance_observation');
  const base = { contractVersion: value.contractVersion, handoffRef, operationKey: value.operationKey,
    currentUse: 'not_authorized_by_receipt' as const, execution: 'not_attested' as const, retryable: false as const };
  if (value.state === 'unknown' && value.acceptance === null && value.nextAction === 'read_original_acceptance') {
    return { ...base, state: 'unknown', acceptance: null, nextAction: 'read_original_acceptance' };
  }
  const receipt = value.acceptance;
  if (value.state !== 'observed' || value.nextAction !== 'read_original_submission' || !receipt
    || !uuid(receipt.acceptanceRef) || !uuid(receipt.bookingDraftId) || receipt.handoffRef !== handoffRef
    || receipt.operationKey !== value.operationKey || !id(receipt.quoteId) || receipt.execution !== 'not_attested'
    || !Number.isSafeInteger(receipt.selectionRevision) || receipt.selectionRevision < 1 || receipt.selectionRevision > 4294967294
    || !/^[a-f0-9]{64}$/u.test(receipt.inputFingerprint)) throw Error('invalid_acceptance_observation');
  return { ...base, state: 'observed', nextAction: 'read_original_submission', acceptance: {
    acceptanceRef: receipt.acceptanceRef, handoffRef, bookingDraftId: receipt.bookingDraftId, selectionRevision: receipt.selectionRevision,
    inputFingerprint: receipt.inputFingerprint, quoteId: receipt.quoteId, operationKey: receipt.operationKey, execution: 'not_attested' } };
}

export type OriginalBookingQuoteFacts = Pick<RentalQuoteSnapshotV1,
  'payableAmount' | 'depositAmount' | 'preAuthAmount' | 'currency' | 'ruleVersion' | 'pricingPlanVersion'>;

/** Original GET quote only, returning a minimal display whitelist, not a new quote. */
export async function readOriginalBookingQuote(handoff: AiBookingHandoff, customerId: unknown,
  read: (quoteId: string) => Promise<unknown>, clock: () => number = Date.now): Promise<OriginalBookingQuoteFacts | null> {
  const source = structuredClone(handoff);
  try {
    const quote = structuredClone(await read(source.fields.quoteId)) as RentalQuoteSnapshotV1;
    const fields = source.fields, request = quote.request;
    if (!customerId || JSON.stringify(quote).length > 65536 || quote.id !== fields.quoteId || quote.tenantId !== source.scope.tenantId || !request
      || request.customerId !== customerId || request.customerType !== 'personal' || request.bookingIdentity?.bookingIdentity === 'enterprise_employee'
      || request.startAt !== fields.startAt || request.endAt !== fields.endAt
      || request.fulfillmentMode !== fields.fulfillmentMode || request.fulfillmentLocationId !== fields.fulfillmentLocationId
      || request.returnLocationId !== fields.returnLocationId || request.deliveryAddressId !== fields.deliveryAddressId
      || JSON.stringify(request.lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity }))) !== JSON.stringify(fields.lines)
      || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= clock()
      || ![quote.payableAmount, quote.depositAmount, quote.preAuthAmount].every(amount => Number.isFinite(amount) && amount >= 0)
      || typeof quote.currency !== 'string' || !/^[A-Z]{3}$/u.test(quote.currency)) return null;
    const version = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
    if (!version(quote.ruleVersion) || !version(quote.pricingPlanVersion)) return null;
    return { payableAmount: quote.payableAmount, depositAmount: quote.depositAmount, preAuthAmount: quote.preAuthAmount,
      currency: quote.currency, ruleVersion: quote.ruleVersion, pricingPlanVersion: quote.pricingPlanVersion };
  } catch { return null; }
}

export interface BookingHandoffHost {
  enabled: boolean;
  mode: 'interactive' | 'receipt_only';
  capability: { tenantCode: string; workspaceCode: string; customerId: string; tenantId: string; workspaceId: string; releaseRevision: string };
  handoffRef: string;
  readBookingHandoff?: (input: { handoffRef: string }) => Promise<AiBookingHandoff>;
  readBookingAcceptance?: (input: AiBookingAcceptanceReadRequest) => Promise<AiBookingAcceptanceReadResponse>;
  acceptBookingSubmission?: (input: { handoffRef: string }) => Promise<AiBookingSubmissionAcceptance>;
  submitAcceptedBooking?: (input: AiBookingSubmissionDecision) => Promise<AiBookingSubmissionReceipt>;
  readBookingSubmission?: (input: { acceptanceRef: string }) => Promise<AiBookingSubmissionReceipt>;
  isCurrent?(): boolean;
  dispose?(): void;
}
export interface BookingPageContext { tenantCode: string | null; workspaceCode?: string; customerId?: string; authenticated: boolean; productId: string }
export type BookingHandoffState = { status: 'disabled' | 'loading' | 'available' | 'continued' | 'unavailable'
  | 'accepting' | 'accepted' | 'submitting' | 'checking' | 'pending_reconcile' | 'order_observed';
  handoff: AiBookingHandoff | null; receipt?: AiBookingSubmissionReceipt | null };

/** Instance-owned consumer. The host must bind the port to the current request;
 * page context is isolation input, never a server authorization credential. */
export function createBookingHandoffConsumer(host: BookingHandoffHost | null, context: BookingPageContext,
  publish: (state: BookingHandoffState) => void, clock: () => number = Date.now) {
  // Capture serializable identity separately from the private request-bound function.
  host = host ? { ...host, capability: { ...host.capability } } : null;
  context = { ...context };
  let generation = 0, destroyed = false, pending = false;
  let paused = false, attempted = false, acceptance: AiBookingSubmissionAcceptance | undefined;
  let state: BookingHandoffState = { status: 'disabled', handoff: null };
  const emit = (next: BookingHandoffState) => { state = next; if (!destroyed) publish(next); };
  const enabled = () => Boolean(host?.enabled === true
    && ((host.mode === 'interactive' && typeof host.readBookingHandoff === 'function')
      || (host.mode === 'receipt_only' && typeof host.readBookingAcceptance === 'function' && typeof host.readBookingSubmission === 'function'))
    && context.authenticated && context.tenantCode === host.capability?.tenantCode
    && context.workspaceCode === host.capability?.workspaceCode && context.customerId === host.capability?.customerId
    && host.capability?.releaseRevision && host.capability?.tenantId && host.capability?.workspaceId && host.handoffRef && (host.isCurrent?.() ?? true));
  const validate = (value: AiBookingHandoff): AiBookingHandoff => {
    const ref = (input: unknown) => typeof input === 'string' && input.length > 0 && input.length <= 512;
    if (!host || !value || JSON.stringify(value).length > 32768 || value.contractVersion !== 'ain-booking-draft-1'
      || !ref(value.handoffRef) || !ref(value.bookingDraftId) || typeof value.expiresAt !== 'string'
      || value.handoffRef !== host?.handoffRef || value.surface !== 'tenant_website' || value.audience !== 'customer'
      || value.scope?.kind !== 'workspace' || value.scope.tenantId !== host.capability.tenantId
      || value.scope.workspaceId !== host.capability.workspaceId || !Number.isSafeInteger(value.revision) || value.revision < 1
      || value.actionCode !== 'OPEN_BOOKING' || value.submission !== 'original_booking_page_required' || value.inventory !== 'not_reserved'
      || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= clock()) throw Error('unavailable');
    const fields = value.fields;
    // This page only implements one personal item and same-location pickup or delivery.
    if (!fields || fields.lines?.length !== 1 || fields.lines[0].itemGroupId !== context.productId
      || !Number.isInteger(fields.lines[0].quantity) || fields.lines[0].quantity < 1 || fields.lines[0].quantity > 10
      || fields.bookingIdentity?.bookingIdentity !== 'personal' || fields.bookingIdentity.enterpriseContractAndPayer
      || fields.bookingIdentity.corporateCustomerId || fields.services?.length
      || !['store_pickup_return', 'delivery'].includes(fields.fulfillmentMode)
      || (fields.returnLocationId && fields.returnLocationId !== fields.fulfillmentLocationId)
      || !fields.fulfillmentLocationId || (fields.fulfillmentMode === 'delivery' && !fields.deliveryAddressId)
      || !ref(fields.quoteId) || !ref(fields.fulfillmentLocationId) || !ref(fields.timeZone)
      || (fields.returnLocationId !== undefined && !ref(fields.returnLocationId))
      || (fields.deliveryAddressId !== undefined && !ref(fields.deliveryAddressId))
      || typeof fields.startAt !== 'string' || typeof fields.endAt !== 'string'
      || !Number.isFinite(Date.parse(fields.startAt)) || !Number.isFinite(Date.parse(fields.endAt))
      || Date.parse(fields.startAt) <= clock() || Date.parse(fields.endAt) <= Date.parse(fields.startAt)) throw Error('unavailable');
    new Intl.DateTimeFormat('en', { timeZone: fields.timeZone }).format(new Date(fields.startAt));
    // Whitelist: do not forward arbitrary extra fields or URLs to the page.
    return { contractVersion: value.contractVersion, handoffRef: value.handoffRef, bookingDraftId: value.bookingDraftId,
      revision: value.revision, audience: value.audience, surface: value.surface,
      scope: { kind: 'workspace', tenantId: value.scope.tenantId, workspaceId: value.scope.workspaceId }, expiresAt: value.expiresAt,
      actionCode: value.actionCode, submission: value.submission, inventory: value.inventory,
      fields: { quoteId: fields.quoteId, timeZone: fields.timeZone, startAt: fields.startAt, endAt: fields.endAt,
        fulfillmentMode: fields.fulfillmentMode, fulfillmentLocationId: fields.fulfillmentLocationId,
        ...(fields.returnLocationId ? { returnLocationId: fields.returnLocationId } : {}),
        ...(fields.deliveryAddressId ? { deliveryAddressId: fields.deliveryAddressId } : {}),
        bookingIdentity: { bookingIdentity: 'personal', enterpriseContractAndPayer: false },
        lines: [{ itemGroupId: fields.lines[0].itemGroupId, quantity: fields.lines[0].quantity }] } };
  };
  const read = async (continuing: boolean) => {
    if (destroyed || paused || pending) return null;
    if (attempted) { emit({ status: 'pending_reconcile', handoff: null }); return null; }
    if (!enabled()) { emit({ status: 'disabled', handoff: null }); return null; }
    if (host?.mode !== 'interactive' || !host.readBookingHandoff) { emit({ status: 'pending_reconcile', handoff: null }); return null; }
    const before = state.handoff, epoch = ++generation; pending = true;
    emit({ status: 'loading', handoff: null });
    try {
      const result = validate(structuredClone(await host!.readBookingHandoff({ handoffRef: host!.handoffRef })));
      if (destroyed || epoch !== generation || !(host?.isCurrent?.() ?? true)) return null;
      if (continuing && (!before || JSON.stringify(before) !== JSON.stringify(result))) throw Error('changed');
      emit({ status: continuing ? 'continued' : 'available', handoff: result });
      return result;
    } catch { if (!destroyed && epoch === generation) emit({ status: 'unavailable', handoff: null }); return null; }
    finally { if (epoch === generation) pending = false; }
  };
  const submissionsAvailable = () => enabled() && host?.mode === 'interactive' && [host?.acceptBookingSubmission, host?.submitAcceptedBooking, host?.readBookingSubmission]
    .every(method => typeof method === 'function');
  const canReconcile = () => Boolean(enabled() && typeof host?.readBookingSubmission === 'function'
    && (acceptance || typeof host?.readBookingAcceptance === 'function'));
  const accept = (value: AiBookingSubmissionAcceptance) => {
    const copy = structuredClone(value);
    if (!host || !copy || JSON.stringify(copy).length > 4096 || copy.execution !== 'not_attested'
      || copy.handoffRef !== host.handoffRef || copy.selectionRevision !== 1
      || !/^[a-f0-9-]{36}$/iu.test(copy.acceptanceRef) || !/^[a-f0-9]{64}$/u.test(copy.inputFingerprint)
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(copy.operationKey)
      || (state.handoff && (copy.bookingDraftId !== state.handoff.bookingDraftId || copy.quoteId !== state.handoff.fields.quoteId))) throw Error('acceptance_unavailable');
    return { acceptanceRef: copy.acceptanceRef, handoffRef: copy.handoffRef, bookingDraftId: copy.bookingDraftId,
      selectionRevision: copy.selectionRevision, inputFingerprint: copy.inputFingerprint, quoteId: copy.quoteId,
      operationKey: copy.operationKey, execution: 'not_attested' as const };
  };
  const result = (value: AiBookingSubmissionReceipt): AiBookingSubmissionReceipt => {
    const copy = structuredClone(value);
    if (!acceptance || copy.operationKey !== acceptance.operationKey || copy.retryable !== false
      || copy.payment !== 'not_inferred' || copy.fulfillment !== 'not_inferred'
      || !['observed', 'unknown', 'not_observed'].includes(copy.state)
      || (copy.state === 'observed' ? typeof copy.orderId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(copy.orderId) : copy.orderId !== null)) throw Error('receipt_unavailable');
    return { state: copy.state, orderId: copy.orderId, operationKey: copy.operationKey, retryable: false,
      payment: 'not_inferred', fulfillment: 'not_inferred' } as AiBookingSubmissionReceipt;
  };
  const action = async (kind: 'accept' | 'submit' | 'reconcile') => {
    if (destroyed || paused || pending || !enabled()) return;
    if (kind === 'reconcile' ? !canReconcile() : !submissionsAvailable()) return;
    if ((kind === 'accept' && (attempted || state.status !== 'continued'))
      || (kind === 'submit' && (attempted || !acceptance || state.status !== 'accepted'))) return;
    const epoch = ++generation; pending = true;
    if (kind === 'reconcile') attempted = true;
    emit({ ...state, status: kind === 'accept' ? 'accepting' : kind === 'submit' ? 'submitting' : 'checking', receipt: null });
    const current = () => !destroyed && !paused && epoch === generation && (host?.isCurrent?.() ?? true);
    try {
      if (kind === 'accept') {
        attempted = true;
        const original = accept(await host!.acceptBookingSubmission!({ handoffRef: host!.handoffRef }));
        if (!current()) return;
        acceptance = original;
      } else if (kind === 'reconcile' && host?.readBookingAcceptance) {
        const observation = normalizeBookingAcceptanceObservation(await host.readBookingAcceptance({ handoffRef: host.handoffRef }), host.handoffRef);
        if (!current()) return;
        if (observation.state === 'unknown') {
          acceptance = undefined; emit({ status: 'pending_reconcile', handoff: null, receipt: null }); return;
        }
        const restored = accept(observation.acceptance);
        if (acceptance && JSON.stringify(restored) !== JSON.stringify(accept(acceptance))) throw Error('acceptance_changed');
        acceptance = restored;
      }
      if (!current()) return;
      if (kind === 'accept') { attempted = false; emit({ ...state, status: 'accepted' }); return; }
      const original = acceptance!;
      if (kind === 'submit') attempted = true;
      const receipt = result(kind === 'submit'
        ? await host!.submitAcceptedBooking!({ acceptanceRef: original.acceptanceRef, decision: 'submit_original_booking' })
        : await host!.readBookingSubmission!({ acceptanceRef: original.acceptanceRef }));
      if (current()) emit({ ...state, status: receipt.state === 'observed' ? 'order_observed' : 'pending_reconcile', receipt });
    } catch { if (current()) emit({ status: 'pending_reconcile', handoff: null, receipt: null }); }
    finally { if (epoch === generation) pending = false; }
  };
  return { read: () => read(false), continue: () => read(true), submissionsAvailable,
    canReconcile,
    accept: () => action('accept'), submit: () => action('submit'), reconcile: () => action('reconcile'),
    pause() { generation++; pending = false; paused = true; emit({ status: attempted ? 'pending_reconcile' : 'disabled', handoff: null }); },
    resume() { paused = false; },
    mount() { generation++; destroyed = false; paused = false; pending = false; state = { status: 'disabled', handoff: null }; },
    invalidate() { generation++; pending = false; host?.dispose?.(); emit({ status: 'unavailable', handoff: null }); },
    destroy() { generation++; destroyed = true; pending = false; host?.dispose?.(); acceptance = undefined; state = { status: 'disabled', handoff: null }; } };
}

export function handoffLocalInput(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
