import type { AiBookingHandoff, AiBookingSubmissionAcceptance, AiBookingSubmissionDecision, AiBookingSubmissionReceipt,
  AiBookingAcceptanceReadRequest, AiBookingAcceptanceReadResponse, EnterpriseOwnRentalPolicy, RentalQuoteSnapshotV1,
  RentalPricingUnit, ClientCreateQuoteRequest, AiBookingDraft } from '@rental-os/shared';
import { aiBookingDraftSchema, aiBookingHandoffSchema, aiBookingSelectionSchema, RENTAL_PRICING_UNIT_CODES } from '@rental-os/shared';

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
  'payableAmount' | 'depositAmount' | 'preAuthAmount' | 'currency' | 'ruleVersion' | 'pricingPlanVersion'> & {
  quoteId: string; timeZone: string; expiresAt: string; selection: ClientCreateQuoteRequest;
  lines: { itemGroupId: string; itemName: string | null; quantity: number; pricingUnit: RentalPricingUnit | null; usageQuantity: number | null }[];
  enterprise: { corporateCustomerId: string; corporateName: string; noticeVersion: string; noticeText: string;
    enterpriseContractAndPayer: boolean; approvalRequired: boolean } | null;
};

export function originalBookingUnitLabel(unit: RentalPricingUnit | null, english: boolean): string {
  if (!unit) return english ? 'Unit unavailable' : '计费单位未提供';
  const labels: Record<RentalPricingUnit, [string, string]> = { hour: ['小时', 'Hour'], shift: ['班次', 'Shift'],
    day_24h: ['24 小时', '24 hours'], calendar_day: ['自然日', 'Calendar day'], night: ['夜', 'Night'], week: ['周', 'Week'],
    month: ['30 日月', '30-day month'], usage: ['使用量', 'Usage'], package: ['整包', 'Package'] };
  return labels[unit][english ? 1 : 0];
}

export function originalBookingModeLabel(mode: AiBookingHandoff['fields']['fulfillmentMode'], english: boolean): string {
  const labels = { store_pickup_return: ['门店自取', 'Store pickup'], partner_pickup_return: ['合作点自取', 'Partner pickup'],
    warehouse_pickup_return: ['仓库自取', 'Warehouse pickup'], locker_pickup_return: ['柜机自取', 'Locker pickup'],
    delivery: ['配送', 'Delivery'], onsite_delivery: ['送达现场', 'On-site delivery'], carrier_shipping: ['承运寄送', 'Carrier shipping'] };
  return labels[mode][english ? 1 : 0];
}

/** Original GET quote only, returning a minimal display whitelist, not a new quote. */
export async function readOriginalBookingQuote(handoff: AiBookingHandoff, customerId: unknown,
  read: (quoteId: string) => Promise<unknown>, clock: () => number = Date.now,
  readEnterprisePolicies?: () => Promise<EnterpriseOwnRentalPolicy[]>): Promise<OriginalBookingQuoteFacts | null> {
  const source = structuredClone(handoff);
  try {
    const quote = structuredClone(await read(source.fields.quoteId)) as RentalQuoteSnapshotV1;
    const fields = source.fields, request = quote.request;
    if (!customerId || JSON.stringify(quote).length > 65536 || quote.id !== fields.quoteId || quote.tenantId !== source.scope.tenantId || !request
      || request.customerId !== customerId || request.customerType !== 'personal'
      || request.startAt !== fields.startAt || request.endAt !== fields.endAt
      || request.fulfillmentMode !== fields.fulfillmentMode || request.fulfillmentLocationId !== fields.fulfillmentLocationId
      || (request.returnLocationId ?? request.fulfillmentLocationId) !== (fields.returnLocationId ?? fields.fulfillmentLocationId)
      || request.deliveryAddressId !== fields.deliveryAddressId
      || JSON.stringify(request.lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity }))) !== JSON.stringify(fields.lines)
      || quote.pricingContext?.timeZone !== fields.timeZone
      || quote.sourceSnapshot && (quote.sourceSnapshot.tenantId !== source.scope.tenantId || quote.sourceSnapshot.workspaceId !== source.scope.workspaceId
        || quote.sourceSnapshot.actor.kind !== 'customer' || quote.sourceSnapshot.actor.id !== customerId)
      || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= clock()
      || ![quote.payableAmount, quote.depositAmount, quote.preAuthAmount].every(amount => Number.isFinite(amount) && amount >= 0)
      || typeof quote.currency !== 'string' || !/^[A-Z]{3}$/u.test(quote.currency)) return null;
    const version = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
    if (!version(quote.ruleVersion) || !version(quote.pricingPlanVersion)) return null;
    const membership = quote.membershipSnapshot, selectedIdentity = fields.bookingIdentity;
    const originalIdentity = { bookingIdentity: request.bookingIdentity?.bookingIdentity ?? 'personal',
      ...(request.bookingIdentity?.corporateCustomerId ? { corporateCustomerId: request.bookingIdentity.corporateCustomerId } : {}),
      enterpriseContractAndPayer: request.bookingIdentity?.enterpriseContractAndPayer === true };
    if (originalIdentity.bookingIdentity !== selectedIdentity.bookingIdentity
      || originalIdentity.enterpriseContractAndPayer !== selectedIdentity.enterpriseContractAndPayer
      || (originalIdentity.corporateCustomerId ?? null) !== (selectedIdentity.corporateCustomerId ?? null)
      || membership && (membership.personalCustomerId !== customerId || membership.bookingIdentity !== selectedIdentity.bookingIdentity
        || membership.enterpriseContractAndPayer !== selectedIdentity.enterpriseContractAndPayer
        || (membership.corporateCustomerId ?? null) !== (selectedIdentity.corporateCustomerId ?? null))) return null;
    const originalServices = quote.serviceSnapshots?.length ? quote.serviceSnapshots.map(service => ({ serviceId: service.serviceId, quantity: service.quantity,
      scheduledStartAt: service.scheduledStartAt, scheduledEndAt: service.scheduledEndAt, serviceLocationId: service.serviceLocationId })) : request.services ?? [];
    const services = fields.services ?? [];
    if (JSON.stringify(originalServices) !== JSON.stringify(services)) return null;
    const lines: OriginalBookingQuoteFacts['lines'] = [];
    for (const line of request.lines) {
      if (!line.itemGroupId || !Number.isInteger(line.quantity) || line.quantity < 1
        || line.pricingUnit !== undefined && !RENTAL_PRICING_UNIT_CODES.includes(line.pricingUnit)
        || line.usageQuantity !== undefined && (!Number.isFinite(line.usageQuantity) || line.usageQuantity < 0)) return null;
      lines.push({ itemGroupId: line.itemGroupId, itemName: quote.inventoryBasis?.groups.find(group => group.id === line.itemGroupId)?.name ?? null,
        quantity: line.quantity, pricingUnit: line.pricingUnit ?? null, usageQuantity: line.usageQuantity ?? null });
    }
    let enterprise: OriginalBookingQuoteFacts['enterprise'] = null;
    if (selectedIdentity.bookingIdentity === 'enterprise_employee') {
      const notice = request.bookingIdentity?.enterpriseDisclosure, basis = membership?.enterpriseBasis;
      if (!membership || !basis || !selectedIdentity.corporateCustomerId || !notice?.acknowledged || !version(notice.noticeVersion)
        || notice.noticeVersion !== basis.noticeVersion || !readEnterprisePolicies) return null;
      const policies = await readEnterprisePolicies(), current = policies.filter(policy => policy.corporateCustomerId === selectedIdentity.corporateCustomerId
        && policy.workspaceId === source.scope.workspaceId);
      if (current.length !== 1 || !current[0].available || current[0].noticeVersion !== notice.noticeVersion || !current[0].noticeText
        || current[0].membershipId !== membership.corporateMembershipId
        || selectedIdentity.enterpriseContractAndPayer && current[0].approvalMode !== basis.approvalMode
        || (selectedIdentity.enterpriseContractAndPayer ? !current[0].enterprisePaymentAllowed : !current[0].personalPaymentAllowed)) return null;
      enterprise = { corporateCustomerId: selectedIdentity.corporateCustomerId, corporateName: current[0].corporateName,
        noticeVersion: notice.noticeVersion, noticeText: current[0].noticeText,
        enterpriseContractAndPayer: selectedIdentity.enterpriseContractAndPayer,
        approvalRequired: selectedIdentity.enterpriseContractAndPayer && basis.approvalMode === 'per_order' };
    }
    const latest = structuredClone(await read(source.fields.quoteId));
    if (JSON.stringify(latest) !== JSON.stringify(quote)) return null;
    if (Date.parse(quote.expiresAt) <= clock()) return null;
    const selection: ClientCreateQuoteRequest = { bookingIdentity: { ...originalIdentity,
      ...(request.bookingIdentity?.enterpriseDisclosure ? { enterpriseDisclosure: { ...request.bookingIdentity.enterpriseDisclosure } } : {}) },
      fulfillmentMode: fields.fulfillmentMode, fulfillmentLocationId: fields.fulfillmentLocationId,
      returnLocationId: fields.returnLocationId ?? fields.fulfillmentLocationId, startAt: fields.startAt, endAt: fields.endAt,
      lines: request.lines.map(line => ({ itemGroupId: line.itemGroupId!, quantity: line.quantity,
        ...(line.pricingUnit ? { pricingUnit: line.pricingUnit } : {}), ...(line.usageQuantity !== undefined ? { usageQuantity: line.usageQuantity } : {}) })),
      ...(fields.deliveryAddressId ? { deliveryAddressId: fields.deliveryAddressId } : {}), ...(services.length ? { services } : {}) };
    return { payableAmount: quote.payableAmount, depositAmount: quote.depositAmount, preAuthAmount: quote.preAuthAmount,
      currency: quote.currency, ruleVersion: quote.ruleVersion, pricingPlanVersion: quote.pricingPlanVersion,
      quoteId: quote.id, timeZone: fields.timeZone, expiresAt: quote.expiresAt, selection, lines, enterprise };
  } catch { return null; }
}

export interface BookingHandoffHost {
  enabled: boolean;
  mode: 'interactive' | 'receipt_only';
  capability: { tenantCode: string; workspaceCode: string; customerId: string; tenantId: string; workspaceId: string; releaseRevision: string };
  handoffRef: string;
  readBookingHandoff?: (input: { handoffRef: string }) => Promise<AiBookingHandoff>;
  readBookingDraft?: (input: { bookingDraftId: string }) => Promise<AiBookingDraft>;
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
  handoff: AiBookingHandoff | null; quote?: OriginalBookingQuoteFacts | null; receipt?: AiBookingSubmissionReceipt | null };

/** Instance-owned consumer. The host must bind the port to the current request;
 * page context is isolation input, never a server authorization credential. */
export function createBookingHandoffConsumer(host: BookingHandoffHost | null, context: BookingPageContext,
  publish: (state: BookingHandoffState) => void, clock: () => number = Date.now,
  reads?: { quote(quoteId: string): Promise<unknown>; enterprisePolicies(): Promise<EnterpriseOwnRentalPolicy[]> }) {
  // Capture serializable identity separately from the private request-bound function.
  host = host ? { ...host, capability: { ...host.capability } } : null;
  context = { ...context };
  let generation = 0, destroyed = false, pending = false;
  let paused = false, acceptanceAttempted = false, submitAttempted = false, acceptance: AiBookingSubmissionAcceptance | undefined;
  let state: BookingHandoffState = { status: 'disabled', handoff: null };
  const emit = (next: BookingHandoffState) => { state = next; if (!destroyed) publish(next); };
  const enabled = () => Boolean(host?.enabled === true
    && ((host.mode === 'interactive' && typeof host.readBookingHandoff === 'function')
      || (host.mode === 'receipt_only' && typeof host.readBookingAcceptance === 'function' && typeof host.readBookingSubmission === 'function'))
    && context.authenticated && context.tenantCode === host.capability?.tenantCode
    && context.workspaceCode === host.capability?.workspaceCode && context.customerId === host.capability?.customerId
    && host.capability?.releaseRevision && host.capability?.tenantId && host.capability?.workspaceId && host.handoffRef && (host.isCurrent?.() ?? true));
  const validate = (value: AiBookingHandoff): AiBookingHandoff => {
    value = aiBookingHandoffSchema.parse(value);
    const ref = (input: unknown) => typeof input === 'string' && input.length > 0 && input.length <= 512;
    if (!host || !value || JSON.stringify(value).length > 32768 || value.contractVersion !== 'ain-booking-draft-1'
      || !ref(value.handoffRef) || !ref(value.bookingDraftId) || typeof value.expiresAt !== 'string'
      || value.handoffRef !== host?.handoffRef || value.surface !== 'tenant_website' || value.audience !== 'customer'
      || value.scope?.kind !== 'workspace' || value.scope.tenantId !== host.capability.tenantId
      || value.scope.workspaceId !== host.capability.workspaceId || !Number.isSafeInteger(value.revision) || value.revision < 1
      || value.actionCode !== 'OPEN_BOOKING' || value.submission !== 'original_booking_page_required' || value.inventory !== 'not_reserved'
      || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= clock()) throw Error('unavailable');
    const fields = value.fields;
    // The route names the first product only as a navigation anchor. Every
    // original line, location and identity remains in the formal handoff.
    if (!fields || fields.lines[0]?.itemGroupId !== context.productId || Date.parse(fields.startAt) <= clock()) throw Error('unavailable');
    new Intl.DateTimeFormat('en', { timeZone: fields.timeZone }).format(new Date(fields.startAt));
    return { ...value, fields: aiBookingSelectionSchema.parse(fields) };
  };
  const read = async (continuing: boolean) => {
    if (destroyed || paused || pending) return null;
    if (acceptanceAttempted || submitAttempted) { emit({ status: 'pending_reconcile', handoff: null }); return null; }
    if (!enabled()) { emit({ status: 'disabled', handoff: null }); return null; }
    if (host?.mode !== 'interactive' || !host.readBookingHandoff) { emit({ status: 'pending_reconcile', handoff: null }); return null; }
    const before = state.handoff, epoch = ++generation; pending = true;
    emit({ status: 'loading', handoff: null });
    try {
      const result = validate(structuredClone(await host!.readBookingHandoff({ handoffRef: host!.handoffRef })));
      if (destroyed || epoch !== generation || !(host?.isCurrent?.() ?? true)) return null;
      if (continuing && (!before || JSON.stringify(before) !== JSON.stringify(result))) throw Error('changed');
      const quote = reads ? await readOriginalBookingQuote(result, context.customerId, reads.quote, clock, reads.enterprisePolicies) : null;
      if (reads && !quote) throw Error('original_quote_unavailable');
      if (destroyed || epoch !== generation || !(host?.isCurrent?.() ?? true)) return null;
      if (reads) {
        const latest = validate(structuredClone(await host!.readBookingHandoff({ handoffRef: host!.handoffRef })));
        if (JSON.stringify(latest) !== JSON.stringify(result)) throw Error('changed');
      }
      if (destroyed || epoch !== generation || !(host?.isCurrent?.() ?? true)) return null;
      emit({ status: continuing ? 'continued' : 'available', handoff: result, quote });
      return result;
    } catch { if (!destroyed && epoch === generation) emit({ status: 'unavailable', handoff: null }); return null; }
    finally { if (epoch === generation) pending = false; }
  };
  const submissionsAvailable = () => enabled() && host?.mode === 'interactive' && (!reads || Boolean(state.quote && !state.quote.enterprise?.approvalRequired))
    && [host?.acceptBookingSubmission, host?.submitAcceptedBooking, host?.readBookingSubmission]
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
  const acceptedDraft = (value: unknown, original: AiBookingSubmissionAcceptance) => {
    const draft = aiBookingDraftSchema.parse(value);
    if (!host || draft.bookingDraftId !== original.bookingDraftId || draft.surface !== 'tenant_website'
      || draft.scope.tenantId !== host.capability.tenantId || draft.scope.workspaceId !== host.capability.workspaceId
      || draft.inputFingerprint !== original.inputFingerprint || draft.selectionRevision !== original.selectionRevision
      || draft.material.selection.quoteId !== original.quoteId || draft.material.quote.quoteId !== original.quoteId) throw Error('booking_original_draft_changed');
    return draft;
  };
  const action = async (kind: 'accept' | 'submit' | 'reconcile') => {
    if (destroyed || paused || pending || !enabled()) return;
    if (kind === 'reconcile' ? !canReconcile() : !submissionsAvailable()) return;
    if ((kind === 'accept' && (acceptanceAttempted || submitAttempted || state.status !== 'continued'))
      || (kind === 'submit' && (submitAttempted || !acceptance || state.status !== 'accepted'))) return;
    const epoch = ++generation; pending = true;
    emit({ ...state, status: kind === 'accept' ? 'accepting' : kind === 'submit' ? 'submitting' : 'checking', receipt: null });
    const current = () => !destroyed && !paused && epoch === generation && (host?.isCurrent?.() ?? true);
    try {
      if (kind === 'accept') {
        acceptanceAttempted = true;
        const original = accept(await host!.acceptBookingSubmission!({ handoffRef: host!.handoffRef }));
        if (!current()) return;
        acceptance = original;
      } else if (kind === 'reconcile' && host?.readBookingAcceptance) {
        acceptanceAttempted = true;
        const observation = normalizeBookingAcceptanceObservation(await host.readBookingAcceptance({ handoffRef: host.handoffRef }), host.handoffRef);
        if (!current()) return;
        if (observation.state === 'unknown') {
          emit({ status: 'pending_reconcile', handoff: null, receipt: null }); return;
        }
        const restored = accept(observation.acceptance);
        if (acceptance && JSON.stringify(restored) !== JSON.stringify(accept(acceptance))) throw Error('acceptance_changed');
        acceptance = restored;
      }
      if (!current()) return;
      if (kind === 'accept') { emit({ ...state, status: 'accepted' }); return; }
      const original = acceptance!;
      if (kind === 'submit') submitAttempted = true;
      const receipt = result(kind === 'submit'
        ? await host!.submitAcceptedBooking!({ acceptanceRef: original.acceptanceRef, decision: 'submit_original_booking' })
        : await host!.readBookingSubmission!({ acceptanceRef: original.acceptanceRef }));
      if (!current()) return;
      if (receipt.state === 'observed') { submitAttempted = true; emit({ ...state, status: 'order_observed', receipt }); return; }
      if (kind === 'reconcile' && receipt.state === 'not_observed' && !submitAttempted && host?.mode === 'interactive'
        && host.readBookingDraft && host.readBookingHandoff) {
        const draft = acceptedDraft(await host.readBookingDraft({ bookingDraftId: original.bookingDraftId }), original);
        if (!current()) return;
        if (draft.state === 'handed_to_booking_page' && draft.execution === 'not_submitted'
          && Date.parse(draft.expiresAt) > clock() && Date.parse(draft.material.quote.expiresAt) > clock()) {
          const handoff = validate(await host.readBookingHandoff({ handoffRef: original.handoffRef }));
          if (!current() || handoff.bookingDraftId !== draft.bookingDraftId || handoff.revision !== draft.revision
            || JSON.stringify(handoff.fields) !== JSON.stringify(draft.material.selection)) throw Error('booking_original_handoff_changed');
          const quote = reads ? await readOriginalBookingQuote(handoff, context.customerId, reads.quote, clock, reads.enterprisePolicies) : null;
          if (!current() || reads && !quote) throw Error('booking_original_quote_unavailable');
          const closing = acceptedDraft(await host.readBookingDraft({ bookingDraftId: original.bookingDraftId }), original);
          if (!current() || JSON.stringify(draft) !== JSON.stringify(closing)) throw Error('booking_original_draft_changed');
          // The original handed/not_submitted Draft plus no local submit attempt
          // permits the first explicit submit. not_observed alone never does.
          emit({ status: 'accepted', handoff, quote, receipt }); return;
        }
        if (draft.state === 'submitted') submitAttempted = true;
      }
      if (receipt.state === 'unknown') submitAttempted = true;
      emit({ ...state, status: 'pending_reconcile', receipt });
    } catch { if (current()) emit({ status: 'pending_reconcile', handoff: null, receipt: null }); }
    finally { if (epoch === generation) pending = false; }
  };
  return { read: () => read(false), continue: () => read(true), submissionsAvailable,
    canReconcile,
    accept: () => action('accept'), submit: () => action('submit'), reconcile: () => action('reconcile'),
    pause() { generation++; pending = false; paused = true; emit({ status: acceptanceAttempted || submitAttempted ? 'pending_reconcile' : 'disabled', handoff: null }); },
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
