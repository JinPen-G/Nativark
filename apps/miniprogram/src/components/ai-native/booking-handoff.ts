import type { AiBookingDraft, AiBookingHandoff, AiBookingSubmissionAcceptance, AiBookingSubmissionDecision, AiBookingSubmissionReceipt,
  AiBookingAcceptanceReadRequest, AiBookingAcceptanceReadResponse,
  RentalQuoteSnapshotV1 } from "@rental-os/shared";
import { aiBookingDraftSchema, aiBookingHandoffSchema } from '../../vendor/shared-ai-client';

export function normalizeBookingAcceptanceObservation(value: AiBookingAcceptanceReadResponse, handoffRef: string): AiBookingAcceptanceReadResponse {
  const id = (x: unknown) => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(x);
  const uuid = (x: unknown) => typeof x === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(x);
  if (!value || JSON.stringify(value).length > 8192 || value.contractVersion !== "ain-booking-acceptance-read-1"
    || value.handoffRef !== handoffRef || !uuid(handoffRef) || !id(value.operationKey) || value.retryable !== false
    || value.currentUse !== "not_authorized_by_receipt" || value.execution !== "not_attested") throw Error("invalid_acceptance_observation");
  const base = { contractVersion: value.contractVersion, handoffRef, operationKey: value.operationKey,
    currentUse: "not_authorized_by_receipt" as const, execution: "not_attested" as const, retryable: false as const };
  if (value.state === "unknown" && value.acceptance === null && value.nextAction === "read_original_acceptance") {
    return { ...base, state: "unknown", acceptance: null, nextAction: "read_original_acceptance" };
  }
  const receipt = value.acceptance;
  if (value.state !== "observed" || value.nextAction !== "read_original_submission" || !receipt
    || !uuid(receipt.acceptanceRef) || !uuid(receipt.bookingDraftId) || receipt.handoffRef !== handoffRef
    || receipt.operationKey !== value.operationKey || !id(receipt.quoteId) || receipt.execution !== "not_attested"
    || !Number.isSafeInteger(receipt.selectionRevision) || receipt.selectionRevision < 1 || receipt.selectionRevision > 4294967294
    || !/^[a-f0-9]{64}$/u.test(receipt.inputFingerprint)) throw Error("invalid_acceptance_observation");
  return { ...base, state: "observed", nextAction: "read_original_submission", acceptance: {
    acceptanceRef: receipt.acceptanceRef, handoffRef, bookingDraftId: receipt.bookingDraftId, selectionRevision: receipt.selectionRevision,
    inputFingerprint: receipt.inputFingerprint, quoteId: receipt.quoteId, operationKey: receipt.operationKey, execution: "not_attested" } };
}

/** Local instance binding, not a serializable property or authorization credential. */
export interface CustomerBookingHost {
  enabled: boolean;
  mode: "interactive" | "receipt_only";
  handoffRef: string;
  capability: { tenantCode: string; serviceCode: string; customerId: string; tenantId: string; workspaceId: string; releaseRevision: string };
  readBookingHandoff?(input: { handoffRef: string }): Promise<AiBookingHandoff>;
  readBookingAcceptance?(input: AiBookingAcceptanceReadRequest): Promise<AiBookingAcceptanceReadResponse>;
  acceptBookingSubmission?(input: { handoffRef: string }): Promise<AiBookingSubmissionAcceptance>;
  submitAcceptedBooking?(input: AiBookingSubmissionDecision): Promise<AiBookingSubmissionReceipt>;
  readBookingSubmission?(input: { acceptanceRef: string }): Promise<AiBookingSubmissionReceipt>;
  readBookingDraft?(input: { bookingDraftId: string }): Promise<AiBookingDraft>;
  isCurrent?(): boolean;
  dispose?(): void;
}
export interface BookingClientContext { tenantCode: string; serviceCode: string; customerId: string; version: number }
export interface CustomerHandoffView {
  status: "disabled" | "idle" | "loading" | "available" | "continued" | "unavailable"
    | "accepting" | "accepted" | "submitting" | "checking" | "pending_reconcile" | "order_observed";
  handoff: AiBookingHandoff | null;
  quote: RentalQuoteSnapshotV1 | null;
  submissionAvailable?: boolean;
  receipt?: AiBookingSubmissionReceipt | null;
  receiptAvailable?: boolean;
}

export function createCustomerBookingConsumer(host: CustomerBookingHost, current: () => BookingClientContext,
  readQuote: (id: string) => Promise<RentalQuoteSnapshotV1>, publish: (view: CustomerHandoffView) => void,
  clock: () => number = Date.now, originalAcceptance?: AiBookingSubmissionAcceptance) {
  const bound = { ...host, capability: { ...host.capability } };
  const identity = { ...current() };
  let generation = 0, active = true, pending = false;
  let view: CustomerHandoffView = { status: "idle", handoff: null, quote: null };
  let acceptance: AiBookingSubmissionAcceptance | undefined = originalAcceptance
    ? JSON.parse(JSON.stringify(originalAcceptance)) : undefined;
  let attempted = Boolean(acceptance);
  let submitAttempted = false;
  const sameContext = () => JSON.stringify(current()) === JSON.stringify(identity);
  const eligible = () => bound.enabled === true
    && ((bound.mode === "interactive" && typeof bound.readBookingHandoff === "function")
      || (bound.mode === "receipt_only" && typeof bound.readBookingAcceptance === "function" && typeof bound.readBookingSubmission === "function"))
    && identity.customerId && identity.customerId === bound.capability.customerId
    && identity.serviceCode === bound.capability.serviceCode && identity.tenantCode === bound.capability.tenantCode
    && bound.capability.releaseRevision && bound.capability.tenantId && bound.capability.workspaceId && (bound.isCurrent?.() ?? true);
  const submissionAvailable = () => eligible() && bound.mode === "interactive" && [bound.acceptBookingSubmission, bound.submitAcceptedBooking, bound.readBookingSubmission]
    .every(method => typeof method === "function");
  const canReconcile = () => Boolean(eligible() && typeof bound.readBookingSubmission === "function"
    && (acceptance || typeof bound.readBookingAcceptance === "function"));
  const emit = (next: CustomerHandoffView) => { view = { ...next, submissionAvailable: Boolean(submissionAvailable()), receiptAvailable: canReconcile() };
    if (active && sameContext()) publish(view); };
  const validateAcceptance = (value: AiBookingSubmissionAcceptance) => {
    const copy = JSON.parse(JSON.stringify(value)) as AiBookingSubmissionAcceptance;
    if (!copy || JSON.stringify(copy).length > 4096 || copy.execution !== "not_attested"
      || copy.handoffRef !== bound.handoffRef || copy.selectionRevision !== 1
      || !/^[a-f0-9]{64}$/u.test(copy.inputFingerprint) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(copy.operationKey)
      || typeof copy.acceptanceRef !== "string" || !/^[a-f0-9-]{36}$/iu.test(copy.acceptanceRef)
      || (view.handoff && (copy.bookingDraftId !== view.handoff.bookingDraftId || copy.quoteId !== view.handoff.fields.quoteId))) throw Error("invalid_acceptance");
    return { acceptanceRef: copy.acceptanceRef, handoffRef: copy.handoffRef, bookingDraftId: copy.bookingDraftId,
      selectionRevision: copy.selectionRevision, inputFingerprint: copy.inputFingerprint, quoteId: copy.quoteId,
      operationKey: copy.operationKey, execution: "not_attested" as const };
  };
  const validateReceipt = (value: AiBookingSubmissionReceipt): AiBookingSubmissionReceipt => {
    const copy = JSON.parse(JSON.stringify(value)) as AiBookingSubmissionReceipt;
    if (!acceptance || copy.operationKey !== acceptance.operationKey || copy.retryable !== false
      || copy.payment !== "not_inferred" || copy.fulfillment !== "not_inferred"
      || !["observed", "unknown", "not_observed"].includes(copy.state)
      || (copy.state === "observed" ? typeof copy.orderId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(copy.orderId) : copy.orderId !== null)) throw Error("invalid_receipt");
    return { state: copy.state, orderId: copy.orderId, operationKey: copy.operationKey,
      retryable: false, payment: "not_inferred", fulfillment: "not_inferred" } as AiBookingSubmissionReceipt;
  };
  const validate = (input: AiBookingHandoff): AiBookingHandoff => {
    const value = aiBookingHandoffSchema.parse(JSON.parse(JSON.stringify(input)));
    if (!value || JSON.stringify(value).length > 32768 || value.contractVersion !== "ain-booking-draft-1"
      || value.surface !== "client_miniprogram" || value.audience !== "customer" || value.handoffRef !== bound.handoffRef
      || value.scope?.kind !== "workspace" || value.scope.tenantId !== bound.capability.tenantId || value.scope.workspaceId !== bound.capability.workspaceId
      || value.actionCode !== "OPEN_BOOKING" || value.submission !== "original_booking_page_required" || value.inventory !== "not_reserved"
      || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= clock()) throw Error("unavailable");
    const f = value.fields;
    if (Date.parse(f.startAt) <= clock()) throw Error("unsupported");
    new Intl.DateTimeFormat("en", { timeZone: f.timeZone }).format(new Date(f.startAt));
    return value;
  };
  const readBoundQuote = async (handoff: AiBookingHandoff, valid: () => boolean) => {
    const quote = JSON.parse(JSON.stringify(await readQuote(handoff.fields.quoteId))) as RentalQuoteSnapshotV1;
    if (!valid()) throw Error('booking_host_changed');
    const q = quote.request, f = handoff.fields, membership = quote.membershipSnapshot;
    const bookingIdentity = membership && { bookingIdentity: membership.bookingIdentity,
      ...(membership.corporateCustomerId ? { corporateCustomerId: membership.corporateCustomerId } : {}),
      enterpriseContractAndPayer: membership.enterpriseContractAndPayer };
    if (quote.id !== f.quoteId || quote.tenantId !== bound.capability.tenantId || q.customerId !== identity.customerId
      || q.customerType !== 'personal' || !membership || membership.personalCustomerId !== identity.customerId
      || quote.pricingContext?.timeZone !== f.timeZone
      || JSON.stringify(bookingIdentity) !== JSON.stringify(f.bookingIdentity)
      || q.startAt !== f.startAt || q.endAt !== f.endAt || q.fulfillmentMode !== f.fulfillmentMode
      || q.fulfillmentLocationId !== f.fulfillmentLocationId || (q.returnLocationId ?? q.fulfillmentLocationId) !== f.returnLocationId
      || q.deliveryAddressId !== f.deliveryAddressId
      || JSON.stringify((quote.serviceSnapshots ?? q.services ?? []).map(service => ({ serviceId: service.serviceId, quantity: service.quantity,
        scheduledStartAt: service.scheduledStartAt ?? q.startAt, scheduledEndAt: service.scheduledEndAt ?? q.endAt,
        serviceLocationId: service.serviceLocationId ?? q.fulfillmentLocationId }))) !== JSON.stringify(f.services ?? [])
      || JSON.stringify(q.lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity }))) !== JSON.stringify(f.lines)
      || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= clock()
      || ![quote.payableAmount, quote.depositAmount, quote.preAuthAmount].every(amount => Number.isFinite(amount) && amount >= 0)
      || typeof quote.currency !== 'string' || !/^[A-Z]{3}$/u.test(quote.currency)) throw Error('quote_unavailable');
    validate(handoff);
    return quote;
  };
  const read = async (continuing: boolean) => {
    if (!active || pending) return;
    if (attempted) { emit({ ...view, status: "pending_reconcile" }); return; }
    if (!sameContext() || !eligible()) { emit({ status: "disabled", handoff: null, quote: null }); return; }
    if (bound.mode !== "interactive" || !bound.readBookingHandoff) { emit({ status: "pending_reconcile", handoff: null, quote: null }); return; }
    const before = view.handoff, epoch = ++generation; pending = true;
    emit({ status: "loading", handoff: null, quote: null });
    try {
      const handoff = validate(await bound.readBookingHandoff({ handoffRef: bound.handoffRef }));
      if (!active || epoch !== generation || !sameContext() || !(bound.isCurrent?.() ?? true)) return;
      if (continuing && (!before || JSON.stringify(before) !== JSON.stringify(handoff))) throw Error("changed");
      let quote: RentalQuoteSnapshotV1 | null = null;
      if (continuing) {
        quote = await readBoundQuote(handoff, () => active && epoch === generation && sameContext() && (bound.isCurrent?.() ?? true));
      }
      emit({ status: continuing ? "continued" : "available", handoff, quote });
    } catch { if (active && epoch === generation && sameContext()) emit({ status: "unavailable", handoff: null, quote: null }); }
    finally { if (epoch === generation) pending = false; }
  };
  const action = async (kind: "accept" | "submit" | "reconcile") => {
    if (!active || pending || !sameContext() || !eligible()) return;
    if (kind === "reconcile" ? !canReconcile() : !submissionAvailable()) return;
    if ((kind === "accept" && (attempted || view.status !== "continued"))
      || (kind === "submit" && (attempted || !acceptance || view.status !== "accepted"))) return;
    const epoch = ++generation; pending = true;
    if (kind === "reconcile") attempted = true;
    emit({ ...view, status: kind === "accept" ? "accepting" : kind === "submit" ? "submitting" : "checking", receipt: null });
    const valid = () => active && generation === epoch && sameContext() && (bound.isCurrent?.() ?? true);
    try {
      if (kind === "accept") {
        attempted = true;
        const accepted = validateAcceptance(await bound.acceptBookingSubmission!({ handoffRef: bound.handoffRef }));
        if (!valid()) return;
        acceptance = accepted;
      } else if (kind === "reconcile" && bound.readBookingAcceptance) {
        const observation = normalizeBookingAcceptanceObservation(await bound.readBookingAcceptance({ handoffRef: bound.handoffRef }), bound.handoffRef);
        if (!valid()) return;
        if (observation.state === "unknown") {
          acceptance = undefined; emit({ status: "pending_reconcile", handoff: null, quote: null, receipt: null }); return;
        }
        const restored = validateAcceptance(observation.acceptance);
        if (acceptance && JSON.stringify(restored) !== JSON.stringify(validateAcceptance(acceptance))) throw Error("acceptance_changed");
        acceptance = restored;
      }
      if (!valid()) return;
      if (acceptance) acceptance = validateAcceptance(acceptance);
      if (kind === "accept") { attempted = false; emit({ ...view, status: "accepted" }); return; }
      const original = acceptance!;
      if (kind === 'submit') { attempted = true; submitAttempted = true; }
      const receipt = validateReceipt(kind === 'submit'
        ? await bound.submitAcceptedBooking!({ acceptanceRef: original.acceptanceRef, decision: 'submit_original_booking' })
        : await bound.readBookingSubmission!({ acceptanceRef: original.acceptanceRef }));
      if (!valid()) return;
      if (receipt.state === 'observed') { submitAttempted = true; emit({ ...view, status: 'order_observed', receipt }); return; }
      if (kind === 'reconcile' && receipt.state === 'not_observed' && !submitAttempted
        && bound.mode === 'interactive' && bound.readBookingDraft && bound.readBookingHandoff && acceptance) {
        const draft = aiBookingDraftSchema.parse(await bound.readBookingDraft({ bookingDraftId: acceptance.bookingDraftId }));
        if (!valid()) return;
        if (draft.state === 'handed_to_booking_page' && draft.bookingDraftId === acceptance.bookingDraftId
          && draft.surface === 'client_miniprogram' && draft.scope.tenantId === bound.capability.tenantId
          && draft.scope.workspaceId === bound.capability.workspaceId && Date.parse(draft.expiresAt) > clock()
          && draft.inputFingerprint === acceptance.inputFingerprint && draft.selectionRevision === acceptance.selectionRevision
          && draft.material.selection.quoteId === acceptance.quoteId) {
          const handoff = validate(await bound.readBookingHandoff!({ handoffRef: bound.handoffRef }));
          if (!valid()) return;
          if (handoff.bookingDraftId !== draft.bookingDraftId || JSON.stringify(handoff.fields) !== JSON.stringify(draft.material.selection)) throw Error('booking_origin_changed');
          const quote = await readBoundQuote(handoff, valid);
          if (!valid()) return;
          const closing = aiBookingDraftSchema.parse(await bound.readBookingDraft({ bookingDraftId: acceptance.bookingDraftId }));
          if (!valid() || JSON.stringify(closing) !== JSON.stringify(draft)) throw Error('booking_origin_changed');
          attempted = false; emit({ status: 'accepted', handoff, quote, receipt: null }); return;
        }
      }
      if (receipt.state === 'unknown') submitAttempted = true;
      emit({ ...view, status: 'pending_reconcile', receipt });
    } catch { if (valid()) emit({ status: "pending_reconcile",
      handoff: null, quote: null, receipt: null }); }
    finally { if (epoch === generation) pending = false; }
  };
  return { read: () => read(false), continue: () => read(true), accept: () => action("accept"),
    submit: () => action("submit"), reconcile: () => action("reconcile"),
    snapshotAcceptance: () => acceptance ? JSON.parse(JSON.stringify(acceptance)) as AiBookingSubmissionAcceptance : undefined,
    destroy() { active = false; generation++; pending = false; bound.dispose?.(); acceptance = undefined; view = { status: "disabled", handoff: null, quote: null }; } };
}
