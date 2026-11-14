import type { AiClientHostCapabilities, AiBookingDraft, AiBookingSubmissionAcceptance, AiBookingSubmissionDecision } from "@rental-os/shared";
import { aiBookingDraftSchema } from '../../vendor/shared-ai-client';
import { clientQuoteApi } from '../../api/ai-quotes';
import { normalizeBookingAcceptanceObservation, type CustomerBookingHost } from "./booking-handoff";
import { readBookingHostCapabilities, readBookingHandoff, readBookingAcceptance, acceptBookingSubmission, submitAcceptedBooking, readBookingSubmission } from "../../api/orders";
import { PUBLIC_CONFIG } from "../../config/public";
import { serverNow } from "../../core/clock";
import { contextVersion, currentSession, sessionEvents } from "../../core/session";

export type CustomerBookingPublication = Pick<AiClientHostCapabilities, "tenantCode" | "serviceCode" | "scope" | "releaseRevision">;
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);

export function createCustomerBookingHostFactory(publication: CustomerBookingPublication | "server" | null = null,
  intent: "interactive" | "receipt_only" = "interactive") {
  const supplied = publication && publication !== "server" ? { ...publication, scope: { ...publication.scope } } : null;
  let closed = false, started = false;
  let unsubscribe: (() => void) | undefined, clearSubmission: (() => void) | undefined;
  const dispose = () => {
    closed = true; unsubscribe?.(); unsubscribe = undefined;
    clearSubmission?.(); clearSubmission = undefined;
    if (typeof wx.offAppHide === "function") wx.offAppHide(dispose);
  };
  return Object.freeze({
    dispose, hide: dispose,
    async openFromUser(handoffRef: string): Promise<CustomerBookingHost | null> {
      if (closed || started || (!supplied && publication !== "server") || !validId(handoffRef)) return null;
      started = true;
      const session = currentSession(), version = contextVersion();
      if (!session?.accessToken || session.customer.customerType !== "personal") { dispose(); return null; }
      const customerId = session.customer.customerId, token = session.accessToken, serviceCode = session.serviceCode;
      const tenantCode = PUBLIC_CONFIG.tenantCode;
      let expiresAt = Number.POSITIVE_INFINITY;
      const current = () => {
        const latest = currentSession();
        const valid = !closed && contextVersion() === version && latest === session && latest.accessToken === token
          && latest.customer.customerId === customerId && latest.customer.customerType === "personal"
          && latest.serviceCode === serviceCode && PUBLIC_CONFIG.tenantCode === tenantCode && serverNow() < expiresAt;
        if (!valid) dispose();
        return valid;
      };
      unsubscribe = sessionEvents.on(dispose);
      if (typeof wx.onAppHide === "function") wx.onAppHide(dispose);
      try {
        const first = await readBookingHostCapabilities();
        if (!current()) throw Error("booking_host_unavailable");
        const expected = supplied ?? { tenantCode: first.tenantCode, serviceCode: first.serviceCode,
          scope: { ...first.scope }, releaseRevision: first.releaseRevision };
        if (![expected.tenantCode, expected.serviceCode, expected.scope.tenantId, expected.scope.workspaceId, expected.releaseRevision].every(validId)
          || expected.scope.kind !== "workspace" || expected.tenantCode !== tenantCode || expected.serviceCode !== serviceCode) throw Error("booking_host_unavailable");
        const validate = (value: AiClientHostCapabilities) => {
          const end = Date.parse(value?.expiresAt), observed = Date.parse(value?.observedAt), capabilities = value?.capabilities;
          if (!current() || !value || JSON.stringify(value).length > 8192 || value.contractVersion !== "ain-client-host-capabilities-2"
            || value.enabled !== true || value.audience !== "customer" || value.surface !== "client_miniprogram" || value.channel !== "wechat_miniprogram"
            || value.customerType !== "personal" || value.customerId !== customerId || value.tenantCode !== expected.tenantCode
            || value.serviceCode !== expected.serviceCode || value.scope?.kind !== "workspace"
            || value.scope.tenantId !== expected.scope.tenantId || value.scope.workspaceId !== expected.scope.workspaceId
            || value.releaseRevision !== expected.releaseRevision || value.policy?.allowRead !== true || typeof value.policy.allowCreate !== "boolean"
            || !Number.isSafeInteger(value.policy.revision) || value.policy.revision < 1 || value.policy.revision > 4294967294
            || !Number.isFinite(end) || !Number.isFinite(observed) || end <= observed || end <= serverNow()
            || value.authorization !== "observation_only_recheck_each_action" || typeof capabilities?.bookingReceiptRead !== "boolean"
            || typeof capabilities.bookingDrafts !== "boolean" || typeof capabilities.savedDeliveryAddresses !== "boolean"
            || !Array.isArray(capabilities.entryActions) || capabilities.entryActions.length > 3
            || new Set(capabilities.entryActions).size !== capabilities.entryActions.length
            || capabilities.entryActions.some(action => !["OPEN_ORDER", "CREATE_BOOKING_DRAFT", "OPEN_BOOKING"].includes(action))
            || (!value.policy.allowCreate && (capabilities.entryActions.length > 0 || capabilities.bookingDrafts || capabilities.savedDeliveryAddresses))
            || capabilities.bookingDrafts !== (capabilities.entryActions.includes("OPEN_BOOKING") && capabilities.entryActions.includes("CREATE_BOOKING_DRAFT"))
            || (capabilities.savedDeliveryAddresses && !capabilities.bookingDrafts)) throw Error("booking_host_unavailable");
          return value;
        };
        const initial = validate(first), interactive = initial.policy.allowCreate && initial.capabilities.bookingDrafts;
        const mode = intent === "interactive" && interactive ? "interactive" as const : "receipt_only" as const;
        if (mode === "receipt_only" && !initial.capabilities.bookingReceiptRead) throw Error("booking_host_unavailable");
        expiresAt = Date.parse(initial.expiresAt);
        const policyRevision = initial.policy.revision, basis = JSON.stringify(initial.capabilities);
        let busy = false, attempted = false, acceptanceAttempted = false, acceptance: AiBookingSubmissionAcceptance | undefined;
        clearSubmission = () => { acceptance = undefined; };
        const recheck = async () => {
          if (!current()) throw Error("booking_host_unavailable");
          const value = validate(await readBookingHostCapabilities());
          if (value.policy.revision !== policyRevision || value.policy.allowCreate !== initial.policy.allowCreate
            || JSON.stringify(value.capabilities) !== basis) throw Error("booking_host_changed");
          expiresAt = Math.min(expiresAt, Date.parse(value.expiresAt));
          if (!current()) throw Error("booking_host_unavailable");
        };
        const action = async <T>(call: () => Promise<T>): Promise<T> => {
          if (busy || !current()) throw Error("booking_host_unavailable");
          busy = true;
          try {
            try { await recheck(); } catch { dispose(); throw Error("booking_host_unavailable"); }
            let result: T;
            try { result = await call(); }
            catch { try { await recheck(); } catch { dispose(); } throw Error("booking_action_unavailable"); }
            const snapshot = JSON.parse(JSON.stringify(result)) as T;
            try { await recheck(); } catch { dispose(); throw Error("booking_host_unavailable"); }
            return snapshot;
          } finally { busy = false; }
        };
        const reference = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/iu.test(value);
        const reads = initial.capabilities.bookingReceiptRead ? {
          readBookingAcceptance(input: { handoffRef: string; contactPhone?: string }) {
            if (input.handoffRef !== handoffRef || input.contactPhone !== undefined) throw Error("booking_host_reference_changed");
            return action(async () => {
              acceptanceAttempted = true;
              const value = normalizeBookingAcceptanceObservation(await readBookingAcceptance({ handoffRef }), handoffRef);
              if (!current()) throw Error("booking_host_unavailable");
              acceptance = value.state === "observed" ? value.acceptance : undefined;
              return value;
            });
          },
          readBookingSubmission(input: { acceptanceRef: string }) {
            const ref = input.acceptanceRef;
            if (!acceptance || ref !== acceptance.acceptanceRef) throw Error("booking_host_reference_changed");
            return action(async () => {
              const value = await readBookingSubmission({ acceptanceRef: ref });
              if (value.state !== 'not_observed') attempted = true;
              return value;
            });
          },
          readBookingDraft(input: { bookingDraftId: string }): Promise<AiBookingDraft> {
            if (!acceptance || input.bookingDraftId !== acceptance.bookingDraftId) throw Error('booking_host_reference_changed');
            return action(async () => {
              const draft = aiBookingDraftSchema.parse(await clientQuoteApi.readBookingDraft(input));
              if (draft.bookingDraftId !== input.bookingDraftId || draft.surface !== 'client_miniprogram'
                || draft.scope.tenantId !== expected.scope.tenantId || draft.scope.workspaceId !== expected.scope.workspaceId
                || draft.inputFingerprint !== acceptance!.inputFingerprint || draft.selectionRevision !== acceptance!.selectionRevision
                || draft.material.selection.quoteId !== acceptance!.quoteId) throw Error('booking_host_reference_changed');
              return draft;
            });
          }
        } : {};
        const writes = mode === "interactive" ? {
          acceptBookingSubmission(input: { handoffRef: string }) {
            if (input.handoffRef !== handoffRef || attempted || acceptanceAttempted) throw Error("booking_host_reference_changed");
            return action(async () => {
              acceptanceAttempted = true;
              const value = await acceptBookingSubmission({ handoffRef });
              if (!current() || !value || value.handoffRef !== handoffRef || !reference(value.acceptanceRef) || value.execution !== "not_attested") throw Error("booking_acceptance_unavailable");
              acceptance = JSON.parse(JSON.stringify(value)) as AiBookingSubmissionAcceptance;
              return acceptance;
            });
          },
          submitAcceptedBooking(input: AiBookingSubmissionDecision) {
            const ref = input.acceptanceRef, decision = input.decision;
            if (!acceptance || ref !== acceptance.acceptanceRef || decision !== "submit_original_booking" || attempted) throw Error("booking_submission_unavailable");
            return action(async () => {
              // A read of acceptance is not a submit. Require the persisted
              // same Draft's pre-submit state before its first explicit submit.
              const draft = aiBookingDraftSchema.parse(await clientQuoteApi.readBookingDraft({ bookingDraftId: acceptance!.bookingDraftId }));
              if (!current() || attempted || draft.state !== 'handed_to_booking_page' || draft.bookingDraftId !== acceptance!.bookingDraftId
                || draft.inputFingerprint !== acceptance!.inputFingerprint || draft.selectionRevision !== acceptance!.selectionRevision
                || draft.material.selection.quoteId !== acceptance!.quoteId) throw Error('booking_submission_unavailable');
              attempted = true; return submitAcceptedBooking({ acceptanceRef: ref, decision });
            });
          },
          readBookingHandoff(input: { handoffRef: string }) {
            if (input.handoffRef !== handoffRef) throw Error("booking_host_reference_changed");
            return action(() => readBookingHandoff(handoffRef));
          }
        } : {};
        return Object.freeze({ get enabled() { return current(); }, mode, handoffRef,
          capability: Object.freeze({ tenantCode: expected.tenantCode, serviceCode: expected.serviceCode, customerId,
            tenantId: expected.scope.tenantId, workspaceId: expected.scope.workspaceId, releaseRevision: expected.releaseRevision }),
          isCurrent: current, dispose, ...reads, ...writes });
      } catch { dispose(); return null; }
    }
  });
}
