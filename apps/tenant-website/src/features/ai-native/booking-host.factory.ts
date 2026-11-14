import { aiBookingDraftSchema, aiBookingHandoffSchema, type AiClientHostCapabilities,
  type AiBookingHandoff, type AiBookingSubmissionAcceptance, type AiBookingSubmissionDecision } from '@rental-os/shared';
import { normalizeBookingAcceptanceObservation, type BookingHandoffHost } from './booking-handoff';
import { captureBookingHostSession, sessionApi } from '../../data/authClient';

type Publication = Pick<AiClientHostCapabilities, 'tenantCode' | 'serviceCode' | 'scope' | 'releaseRevision'>;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);

export function createBookingHandoffHostFactory(publication: Publication | 'server' | null = null,
  intent: 'interactive' | 'receipt_only' = 'interactive') {
  const supplied = publication && publication !== 'server' ? { ...publication, scope: { ...publication.scope } } : null;
  let closed = false, started = false;
  let clearSubmission: (() => void) | undefined;
  const visible = () => typeof document === 'undefined' || !document.hidden;
  const onVisibility = () => { if (!visible()) dispose(); };
  const dispose = () => {
    closed = true; clearSubmission?.(); clearSubmission = undefined;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', dispose);
  };
  return Object.freeze({
    dispose, hide: dispose,
    async openFromUser(handoffRef: string): Promise<BookingHandoffHost | null> {
      if (closed || started || !visible() || (!supplied && publication !== 'server') || !validId(handoffRef)) return null;
      started = true;
      const session = captureBookingHostSession();
      if (!session) { dispose(); return null; }
      let expiresAt = Number.POSITIVE_INFINITY;
      const current = () => {
        const valid = !closed && visible() && session.current() && Date.now() < expiresAt;
        if (!valid) dispose();
        return valid;
      };
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
      if (typeof window !== 'undefined') window.addEventListener('pagehide', dispose);
      try {
        const first = await sessionApi.readBookingHostCapabilities();
        if (!current()) throw Error('booking_host_unavailable');
        const expected = supplied ?? { tenantCode: first.tenantCode, serviceCode: first.serviceCode,
          scope: { ...first.scope }, releaseRevision: first.releaseRevision };
        if (![expected.tenantCode, expected.serviceCode, expected.scope.tenantId, expected.scope.workspaceId, expected.releaseRevision].every(validId)
          || expected.scope.kind !== 'workspace' || expected.serviceCode !== session.workspaceCode) throw Error('booking_host_unavailable');
        const validate = (value: AiClientHostCapabilities) => {
          const end = Date.parse(value?.expiresAt), observed = Date.parse(value?.observedAt), capabilities = value?.capabilities;
          if (!current() || !value || JSON.stringify(value).length > 8192 || value.contractVersion !== 'ain-client-host-capabilities-2'
            || value.enabled !== true || value.audience !== 'customer' || value.surface !== 'tenant_website' || value.channel !== 'web'
            || value.customerType !== 'personal' || value.customerId !== session.customerId || value.tenantCode !== expected.tenantCode
            || value.serviceCode !== expected.serviceCode || value.scope?.kind !== 'workspace'
            || value.scope.tenantId !== expected.scope.tenantId || value.scope.workspaceId !== expected.scope.workspaceId
            || value.releaseRevision !== expected.releaseRevision || value.policy?.allowRead !== true || typeof value.policy.allowCreate !== 'boolean'
            || !Number.isSafeInteger(value.policy.revision) || value.policy.revision < 1 || value.policy.revision > 4294967294
            || !Number.isFinite(end) || !Number.isFinite(observed) || end <= observed || end <= Date.now()
            || value.authorization !== 'observation_only_recheck_each_action' || typeof capabilities?.bookingReceiptRead !== 'boolean'
            || typeof capabilities.bookingDrafts !== 'boolean' || typeof capabilities.savedDeliveryAddresses !== 'boolean'
            || !Array.isArray(capabilities.entryActions) || capabilities.entryActions.length > 3
            || new Set(capabilities.entryActions).size !== capabilities.entryActions.length
            || capabilities.entryActions.some(action => !['OPEN_ORDER', 'CREATE_BOOKING_DRAFT', 'OPEN_BOOKING'].includes(action))
            || (!value.policy.allowCreate && (capabilities.entryActions.length > 0 || capabilities.bookingDrafts || capabilities.savedDeliveryAddresses))
            || capabilities.bookingDrafts !== (capabilities.entryActions.includes('OPEN_BOOKING') && capabilities.entryActions.includes('CREATE_BOOKING_DRAFT'))
            || (capabilities.savedDeliveryAddresses && !capabilities.bookingDrafts)) throw Error('booking_host_unavailable');
          return value;
        };
        const initial = validate(first), interactive = initial.policy.allowCreate && initial.capabilities.bookingDrafts;
        const mode = intent === 'interactive' && interactive ? 'interactive' as const : 'receipt_only' as const;
        if (mode === 'receipt_only' && !initial.capabilities.bookingReceiptRead) throw Error('booking_host_unavailable');
        expiresAt = Date.parse(initial.expiresAt);
        const policyRevision = initial.policy.revision, basis = JSON.stringify(initial.capabilities);
        let busy = false, submitAttempted = false, acceptanceAttempted = false, acceptanceObserved = false;
        let acceptance: AiBookingSubmissionAcceptance | undefined;
        let originalHandoff: AiBookingHandoff | undefined;
        clearSubmission = () => { acceptance = undefined; acceptanceObserved = false; originalHandoff = undefined; };
        const recheck = async () => {
          if (!current()) throw Error('booking_host_unavailable');
          const value = validate(await sessionApi.readBookingHostCapabilities());
          if (value.policy.revision !== policyRevision || value.policy.allowCreate !== initial.policy.allowCreate
            || JSON.stringify(value.capabilities) !== basis) throw Error('booking_host_changed');
          expiresAt = Math.min(expiresAt, Date.parse(value.expiresAt));
          if (!current()) throw Error('booking_host_unavailable');
        };
        const action = async <T>(call: () => Promise<T>): Promise<T> => {
          if (busy || !current()) throw Error('booking_host_unavailable');
          busy = true;
          try {
            try { await recheck(); } catch { dispose(); throw Error('booking_host_unavailable'); }
            let result: T;
            try { result = await call(); }
            catch { try { await recheck(); } catch { dispose(); } throw Error('booking_action_unavailable'); }
            const snapshot = structuredClone(result);
            try { await recheck(); } catch { dispose(); throw Error('booking_host_unavailable'); }
            return snapshot;
          } finally { busy = false; }
        };
        const reference = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/iu.test(value);
        const currentDraft = async (bookingDraftId: string) => {
          if (bookingDraftId !== (acceptance?.bookingDraftId ?? originalHandoff?.bookingDraftId)) throw Error('booking_host_reference_changed');
          const draft = aiBookingDraftSchema.parse(await sessionApi.readBookingDraft({ bookingDraftId }));
          if (!current() || draft.bookingDraftId !== bookingDraftId || draft.surface !== 'tenant_website'
            || draft.scope.tenantId !== expected.scope.tenantId || draft.scope.workspaceId !== expected.scope.workspaceId
            || acceptance && (draft.selectionRevision !== acceptance.selectionRevision || draft.inputFingerprint !== acceptance.inputFingerprint
              || draft.material.selection.quoteId !== acceptance.quoteId || draft.material.quote.quoteId !== acceptance.quoteId)
            || originalHandoff && (draft.bookingDraftId !== originalHandoff.bookingDraftId
              || JSON.stringify(draft.material.selection) !== JSON.stringify(originalHandoff.fields))) throw Error('booking_original_draft_changed');
          return draft;
        };
        const reads = initial.capabilities.bookingReceiptRead ? {
          readBookingAcceptance(input: { handoffRef: string; contactPhone?: string }) {
            if (input.handoffRef !== handoffRef || input.contactPhone !== undefined) throw Error('booking_host_reference_changed');
            return action(async () => {
              // Reading an uncertain acceptance never counts as a submit, and
              // never permits another acceptance request in this host.
              acceptanceAttempted = true;
              acceptanceObserved = false;
              const value = normalizeBookingAcceptanceObservation(await sessionApi.readBookingAcceptance({ handoffRef }), handoffRef);
              if (!current()) throw Error('booking_host_unavailable');
              if (value.state === 'observed') {
                if (acceptance && JSON.stringify(acceptance) !== JSON.stringify(value.acceptance)) throw Error('booking_original_acceptance_changed');
                acceptance = value.acceptance;
                acceptanceObserved = true;
              }
              return value;
            });
          },
          readBookingSubmission(input: { acceptanceRef: string }) {
            const ref = input.acceptanceRef;
            if (!acceptance || ref !== acceptance.acceptanceRef) throw Error('booking_host_reference_changed');
            return action(async () => {
              const value = await sessionApi.readBookingSubmission({ acceptanceRef: ref });
              // Unknown/observed business receipts cannot authorize an initial
              // submit. A not_observed read does not clear a previous attempt.
              if (value.state !== 'not_observed') submitAttempted = true;
              return value;
            });
          },
          readBookingDraft(input: { bookingDraftId: string }) {
            return action(() => currentDraft(input.bookingDraftId));
          }
        } : {};
        const writes = mode === 'interactive' ? {
          acceptBookingSubmission(input: { handoffRef: string }) {
            if (input.handoffRef !== handoffRef || submitAttempted || acceptanceAttempted) throw Error('booking_host_reference_changed');
            return action(async () => {
              acceptanceAttempted = true;
              const value = await sessionApi.acceptBookingSubmission({ handoffRef });
              if (!current() || !value || value.handoffRef !== handoffRef || !reference(value.acceptanceRef) || value.execution !== 'not_attested') throw Error('booking_acceptance_unavailable');
              acceptance = structuredClone(value);
              acceptanceObserved = true;
              return acceptance;
            });
          },
          submitAcceptedBooking(input: AiBookingSubmissionDecision) {
            const ref = input.acceptanceRef, decision = input.decision;
            if (!acceptance || !acceptanceObserved || ref !== acceptance.acceptanceRef || decision !== 'submit_original_booking' || submitAttempted) throw Error('booking_submission_unavailable');
            return action(async () => {
              const draft = await currentDraft(acceptance!.bookingDraftId);
              if (draft.state !== 'handed_to_booking_page' || draft.execution !== 'not_submitted'
                || Date.parse(draft.expiresAt) <= Date.now() || Date.parse(draft.material.quote.expiresAt) <= Date.now()) {
                if (draft.state === 'submitted') submitAttempted = true;
                throw Error('booking_initial_submission_unavailable');
              }
              // The server CAS still owns submission. This current proof only
              // distinguishes a lost acceptance from a prior business attempt.
              if (!current() || submitAttempted) throw Error('booking_submission_unavailable');
              submitAttempted = true;
              return sessionApi.submitAcceptedBooking({ acceptanceRef: ref, decision });
            });
          },
          readBookingHandoff(input: { handoffRef: string }) {
            if (input.handoffRef !== handoffRef) throw Error('booking_host_reference_changed');
            return action(async () => {
              const value = aiBookingHandoffSchema.parse(await sessionApi.readBookingHandoff(handoffRef));
              if (value.handoffRef !== handoffRef || value.surface !== 'tenant_website'
                || value.scope.tenantId !== expected.scope.tenantId || value.scope.workspaceId !== expected.scope.workspaceId
                || acceptance && value.bookingDraftId !== acceptance.bookingDraftId) throw Error('booking_original_handoff_changed');
              originalHandoff = value;
              return value;
            });
          }
        } : {};
        return Object.freeze({ get enabled() { return current(); }, mode, handoffRef,
          capability: Object.freeze({ tenantCode: expected.tenantCode, workspaceCode: expected.serviceCode, customerId: session.customerId,
            tenantId: expected.scope.tenantId, workspaceId: expected.scope.workspaceId, releaseRevision: expected.releaseRevision }),
          isCurrent: current, dispose, ...reads, ...writes });
      } catch { dispose(); return null; }
    }
  });
}
