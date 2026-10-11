import type { AiBookingHandoff, AiBookingSubmissionAcceptance, AiBookingSubmissionDecision, AiBookingSubmissionReceipt,
  RentalQuoteSnapshotV1 } from "@rental-os/shared";

/** Local instance binding, not a serializable property or authorization credential. */
export interface CustomerBookingHost {
  enabled: boolean;
  handoffRef: string;
  capability: { tenantCode: string; serviceCode: string; customerId: string; tenantId: string; workspaceId: string; releaseRevision: string };
  readBookingHandoff(input: { handoffRef: string }): Promise<AiBookingHandoff>;
  acceptBookingSubmission?(input: { handoffRef: string }): Promise<AiBookingSubmissionAcceptance>;
  submitAcceptedBooking?(input: AiBookingSubmissionDecision): Promise<AiBookingSubmissionReceipt>;
  readBookingSubmission?(input: { acceptanceRef: string }): Promise<AiBookingSubmissionReceipt>;
}
export interface BookingClientContext { tenantCode: string; serviceCode: string; customerId: string; version: number }
export interface CustomerHandoffView {
  status: "disabled" | "idle" | "loading" | "available" | "continued" | "unavailable"
    | "accepting" | "accepted" | "submitting" | "checking" | "pending_reconcile" | "order_observed";
  handoff: AiBookingHandoff | null;
  quote: RentalQuoteSnapshotV1 | null;
  submissionAvailable?: boolean;
  receipt?: AiBookingSubmissionReceipt | null;
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
  const sameContext = () => JSON.stringify(current()) === JSON.stringify(identity);
  const eligible = () => bound.enabled === true && typeof bound.readBookingHandoff === "function"
    && identity.customerId && identity.customerId === bound.capability.customerId
    && identity.serviceCode === bound.capability.serviceCode && identity.tenantCode === bound.capability.tenantCode
    && bound.capability.releaseRevision && bound.capability.tenantId && bound.capability.workspaceId;
  const submissionAvailable = () => eligible() && [bound.acceptBookingSubmission, bound.submitAcceptedBooking, bound.readBookingSubmission]
    .every(method => typeof method === "function");
  const emit = (next: CustomerHandoffView) => { view = { ...next, submissionAvailable: Boolean(submissionAvailable()) };
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
    const value = JSON.parse(JSON.stringify(input)) as AiBookingHandoff;
    const ref = (x: unknown) => typeof x === "string" && x.length > 0 && x.length <= 512;
    if (!value || JSON.stringify(value).length > 32768 || value.contractVersion !== "ain-booking-draft-1"
      || value.surface !== "client_miniprogram" || value.audience !== "customer" || value.handoffRef !== bound.handoffRef
      || !ref(value.bookingDraftId) || !ref(value.handoffRef) || !Number.isSafeInteger(value.revision) || value.revision < 1
      || value.scope?.kind !== "workspace" || value.scope.tenantId !== bound.capability.tenantId || value.scope.workspaceId !== bound.capability.workspaceId
      || value.actionCode !== "OPEN_BOOKING" || value.submission !== "original_booking_page_required" || value.inventory !== "not_reserved"
      || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= clock()) throw Error("unavailable");
    const f = value.fields;
    if (!f || !ref(f.quoteId) || !ref(f.timeZone) || !ref(f.fulfillmentLocationId)
      || !Array.isArray(f.lines) || !f.lines.length || f.lines.length > 20
      || f.lines.some(l => !ref(l.itemGroupId) || !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 999)
      || new Set(f.lines.map(l => l.itemGroupId)).size !== f.lines.length
      || f.bookingIdentity?.bookingIdentity !== "personal" || f.bookingIdentity.enterpriseContractAndPayer || f.bookingIdentity.corporateCustomerId
      || f.services?.length || !["store_pickup_return", "delivery"].includes(f.fulfillmentMode)
      || (f.returnLocationId !== undefined && !ref(f.returnLocationId))
      || (f.fulfillmentMode === "delivery" && !ref(f.deliveryAddressId))
      || !Number.isFinite(Date.parse(f.startAt)) || Date.parse(f.startAt) <= clock()
      || !Number.isFinite(Date.parse(f.endAt)) || Date.parse(f.endAt) <= Date.parse(f.startAt)) throw Error("unsupported");
    new Intl.DateTimeFormat("en", { timeZone: f.timeZone }).format(new Date(f.startAt));
    return { contractVersion: value.contractVersion, handoffRef: value.handoffRef, bookingDraftId: value.bookingDraftId,
      revision: value.revision, audience: value.audience, surface: value.surface,
      scope: { kind: "workspace", tenantId: value.scope.tenantId, workspaceId: value.scope.workspaceId }, expiresAt: value.expiresAt,
      actionCode: value.actionCode, submission: value.submission, inventory: value.inventory,
      fields: { quoteId: f.quoteId, timeZone: f.timeZone, startAt: f.startAt, endAt: f.endAt, fulfillmentMode: f.fulfillmentMode,
        fulfillmentLocationId: f.fulfillmentLocationId, ...(f.returnLocationId ? { returnLocationId: f.returnLocationId } : {}),
        ...(f.deliveryAddressId ? { deliveryAddressId: f.deliveryAddressId } : {}),
        bookingIdentity: { bookingIdentity: "personal", enterpriseContractAndPayer: false },
        lines: f.lines.map(l => ({ itemGroupId: l.itemGroupId, quantity: l.quantity })) } };
  };
  const read = async (continuing: boolean) => {
    if (!active || pending) return;
    if (attempted) { emit({ ...view, status: "pending_reconcile" }); return; }
    if (!sameContext() || !eligible()) { emit({ status: "disabled", handoff: null, quote: null }); return; }
    const before = view.handoff, epoch = ++generation; pending = true;
    emit({ status: "loading", handoff: null, quote: null });
    try {
      const handoff = validate(await bound.readBookingHandoff({ handoffRef: bound.handoffRef }));
      if (!active || epoch !== generation || !sameContext()) return;
      if (continuing && (!before || JSON.stringify(before) !== JSON.stringify(handoff))) throw Error("changed");
      let quote: RentalQuoteSnapshotV1 | null = null;
      if (continuing) {
        quote = JSON.parse(JSON.stringify(await readQuote(handoff.fields.quoteId))) as RentalQuoteSnapshotV1;
        if (!active || epoch !== generation || !sameContext()) return;
        const q = quote.request, f = handoff.fields;
        if (quote.id !== f.quoteId || quote.tenantId !== bound.capability.tenantId || q.customerId !== identity.customerId
          || q.customerType !== "personal" || q.bookingIdentity?.bookingIdentity === "enterprise_employee"
          || q.startAt !== f.startAt || q.endAt !== f.endAt || q.fulfillmentMode !== f.fulfillmentMode
          || q.fulfillmentLocationId !== f.fulfillmentLocationId || q.returnLocationId !== f.returnLocationId
          || q.deliveryAddressId !== f.deliveryAddressId || q.services?.length
          || JSON.stringify(q.lines.map(l => ({ itemGroupId: l.itemGroupId, quantity: l.quantity }))) !== JSON.stringify(f.lines)
          || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= clock()
          || ![quote.payableAmount, quote.depositAmount, quote.preAuthAmount].every(n => Number.isFinite(n) && n >= 0)
          || !quote.currency) throw Error("quote_unavailable");
        // The handoff might expire while the original quote read was pending.
        validate(handoff);
      }
      emit({ status: continuing ? "continued" : "available", handoff, quote });
    } catch { if (active && epoch === generation && sameContext()) emit({ status: "unavailable", handoff: null, quote: null }); }
    finally { if (epoch === generation) pending = false; }
  };
  const action = async (kind: "accept" | "submit" | "reconcile") => {
    if (!active || pending || !sameContext() || !submissionAvailable()) return;
    if ((kind === "accept" && (attempted || view.status !== "continued"))
      || (kind === "submit" && (attempted || !acceptance || view.status !== "accepted"))) return;
    const epoch = ++generation; pending = true;
    if (kind === "reconcile") attempted = true;
    emit({ ...view, status: kind === "accept" ? "accepting" : kind === "submit" ? "submitting" : "checking", receipt: null });
    const valid = () => active && generation === epoch && sameContext();
    try {
      if (kind === "accept" || !acceptance) {
        const accepted = validateAcceptance(await bound.acceptBookingSubmission!({ handoffRef: bound.handoffRef }));
        if (!valid()) return;
        acceptance = accepted;
      }
      if (!valid()) return;
      if (acceptance) acceptance = validateAcceptance(acceptance);
      if (kind === "accept") { emit({ ...view, status: "accepted" }); return; }
      const original = acceptance!;
      // Once a business call was attempted, never call it again. Reconcile only.
      if (kind === "submit") attempted = true;
      const receipt = validateReceipt(kind === "submit"
        ? await bound.submitAcceptedBooking!({ acceptanceRef: original.acceptanceRef, decision: "submit_original_booking" })
        : await bound.readBookingSubmission!({ acceptanceRef: original.acceptanceRef }));
      if (!valid()) return;
      emit({ ...view, status: receipt.state === "observed" ? "order_observed" : "pending_reconcile", receipt });
    } catch { if (valid()) emit({ status: kind === "accept" ? "unavailable" : "pending_reconcile",
      handoff: null, quote: null, receipt: null }); }
    finally { if (epoch === generation) pending = false; }
  };
  return { read: () => read(false), continue: () => read(true), accept: () => action("accept"),
    submit: () => action("submit"), reconcile: () => action("reconcile"),
    snapshotAcceptance: () => acceptance ? JSON.parse(JSON.stringify(acceptance)) as AiBookingSubmissionAcceptance : undefined,
    destroy() { active = false; generation++; pending = false; view = { status: "disabled", handoff: null, quote: null }; } };
}
