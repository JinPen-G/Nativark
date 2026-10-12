import type { AiClientHostCapabilities, AiBookingSubmissionAcceptance, AiBookingSubmissionDecision } from '@rental-os/shared';
import type { BookingHandoffHost } from './booking-handoff';
import { captureBookingHostSession, sessionApi } from '../../data/authClient';

type Publication = Pick<AiClientHostCapabilities, 'tenantCode' | 'serviceCode' | 'scope' | 'releaseRevision'>;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);

export function createBookingHandoffHostFactory(publication: Publication | null = null) {
  const expected = publication ? { ...publication, scope: { ...publication.scope } } : null;
  let closed = false, started = false;
  let clearSubmission: (() => void) | undefined;
  const visible = () => typeof document === 'undefined' || !document.hidden;
  const onVisibility = () => { if (!visible()) dispose(); };
  const dispose = () => {
    closed = true;
    clearSubmission?.(); clearSubmission = undefined;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', dispose);
  };
  return Object.freeze({
    dispose, hide: dispose,
    async openFromUser(handoffRef: string): Promise<BookingHandoffHost | null> {
      if (closed || started || !visible() || !expected || !validId(handoffRef)
        || ![expected.tenantCode, expected.serviceCode, expected.scope.tenantId, expected.scope.workspaceId, expected.releaseRevision].every(validId)
        || expected.scope.kind !== 'workspace') return null;
      started = true;
      const session = captureBookingHostSession();
      if (!session || session.workspaceCode !== expected.serviceCode) { dispose(); return null; }
      let expiresAt = Number.POSITIVE_INFINITY;
      const current = () => {
        const valid = !closed && visible() && session.current() && Date.now() < expiresAt;
        if (!valid) dispose();
        return valid;
      };
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
      if (typeof window !== 'undefined') window.addEventListener('pagehide', dispose);
      const validate = (value: AiClientHostCapabilities) => {
        const end = Date.parse(value?.expiresAt), observed = Date.parse(value?.observedAt);
        if (!current() || !value || JSON.stringify(value).length > 8192 || value.contractVersion !== 'ain-client-host-capabilities-1'
          || value.enabled !== true || value.audience !== 'customer' || value.surface !== 'tenant_website' || value.channel !== 'web'
          || value.customerType !== 'personal' || value.customerId !== session.customerId || value.tenantCode !== expected.tenantCode
          || value.serviceCode !== expected.serviceCode || value.scope?.kind !== 'workspace'
          || value.scope.tenantId !== expected.scope.tenantId || value.scope.workspaceId !== expected.scope.workspaceId
          || value.releaseRevision !== expected.releaseRevision || value.policy?.allowRead !== true || value.policy.allowCreate !== true
          || !Number.isSafeInteger(value.policy.revision) || value.policy.revision < 1 || value.policy.revision > 4294967294
          || !Number.isFinite(end) || !Number.isFinite(observed) || end <= observed || end <= Date.now()
          || value.authorization !== 'observation_only_recheck_each_action' || value.capabilities?.bookingDrafts !== true
          || typeof value.capabilities.savedDeliveryAddresses !== 'boolean' || !Array.isArray(value.capabilities.entryActions)
          || value.capabilities.entryActions.length > 3 || new Set(value.capabilities.entryActions).size !== value.capabilities.entryActions.length
          || value.capabilities.entryActions.some(action => !['OPEN_ORDER', 'CREATE_BOOKING_DRAFT', 'OPEN_BOOKING'].includes(action))
          || !value.capabilities.entryActions.includes('OPEN_BOOKING') || !value.capabilities.entryActions.includes('CREATE_BOOKING_DRAFT')) throw Error('booking_host_unavailable');
        return value;
      };
      try {
        const initial = validate(await sessionApi.readBookingHostCapabilities());
        expiresAt = Date.parse(initial.expiresAt);
        const policyRevision = initial.policy.revision;
        let busy = false, attempted = false, acceptance: AiBookingSubmissionAcceptance | undefined;
        clearSubmission = () => { acceptance = undefined; };
        const recheck = async () => {
          if (!current()) throw Error('booking_host_unavailable');
          const value = validate(await sessionApi.readBookingHostCapabilities());
          if (value.policy.revision !== policyRevision) throw Error('booking_host_changed');
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
            catch {
              try { await recheck(); } catch { dispose(); }
              throw Error('booking_action_unavailable');
            }
            const snapshot = structuredClone(result);
            try { await recheck(); } catch { dispose(); throw Error('booking_host_unavailable'); }
            return snapshot;
          } finally { busy = false; }
        };
        const reference = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/iu.test(value);
        const submission = [sessionApi.acceptBookingSubmission, sessionApi.submitAcceptedBooking, sessionApi.readBookingSubmission]
          .every(method => typeof method === 'function') ? {
          async acceptBookingSubmission(input: { handoffRef: string }) {
            if (input.handoffRef !== handoffRef || attempted) throw Error('booking_host_reference_changed');
            return action(async () => {
              const value = await sessionApi.acceptBookingSubmission({ handoffRef });
              if (!current() || !value || value.handoffRef !== handoffRef || !reference(value.acceptanceRef) || value.execution !== 'not_attested') throw Error('booking_acceptance_unavailable');
              acceptance = structuredClone(value);
              return acceptance;
            });
          },
          async submitAcceptedBooking(input: AiBookingSubmissionDecision) {
            const ref = input.acceptanceRef, decision = input.decision;
            if (!acceptance || ref !== acceptance.acceptanceRef || decision !== 'submit_original_booking' || attempted) throw Error('booking_submission_unavailable');
            return action(() => {
              attempted = true;
              return sessionApi.submitAcceptedBooking({ acceptanceRef: ref, decision });
            });
          },
          async readBookingSubmission(input: { acceptanceRef: string }) {
            const ref = input.acceptanceRef;
            if (!reference(ref) || (acceptance && ref !== acceptance.acceptanceRef)) throw Error('booking_host_reference_changed');
            return action(() => sessionApi.readBookingSubmission({ acceptanceRef: ref }));
          }
        } : {};
        return Object.freeze({
          get enabled() { return current(); }, handoffRef,
          capability: Object.freeze({ tenantCode: expected.tenantCode, workspaceCode: expected.serviceCode, customerId: session.customerId,
            tenantId: expected.scope.tenantId, workspaceId: expected.scope.workspaceId, releaseRevision: expected.releaseRevision }),
          isCurrent: current, dispose,
          ...submission,
          async readBookingHandoff(input: { handoffRef: string }) {
            try {
              if (input.handoffRef !== handoffRef) throw Error('booking_host_reference_changed');
              await recheck();
              const handoff = structuredClone(await sessionApi.readBookingHandoff(handoffRef));
              await recheck();
              return handoff;
            } catch { dispose(); throw Error('booking_host_unavailable'); }
          }
        });
      } catch { dispose(); return null; }
    }
  });
}
