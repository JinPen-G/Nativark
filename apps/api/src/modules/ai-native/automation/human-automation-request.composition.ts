import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthService } from '../../auth/auth.service';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../../common/request-identity';
import type { BusinessFailureDependencies } from '../business-events/business-failure.composition';
import { BusinessFailureReadAuthority } from '../business-events/business-failure-read.authority';
import { BusinessFailureCandidateService } from '../business-events/business-failure-candidate.service';
import { BusinessOutboxObservationReader } from '../business-events/business-outbox-observation.reader';
import type { RuntimeTaskFaultAlertPolicySource } from '../observability/task-fault-policy.configuration';
import { AiScopeRepository } from '../ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { composeAutomationFailureTasks, type AutomationDependencies } from './automation.composition';
import { AutomationError } from './prisma-automation.authority';
import { HumanAutomationReviewService } from './human-automation-review.service';
import { HumanAutomationReviewGrantService, type HumanAutomationReviewGrantPolicySource } from './human-automation-review-grant.service';
import { HumanAutomationReviewQueueService } from './human-automation-review-queue.service';
import { OriginalAutomationCreationReader } from './original-automation-creation.reader';
import { waitForTaskApplicationDependency } from '../runner/prisma-task-application';
import type { IncomingMessage } from 'node:http';

export type HumanAutomationHttpRequest = { headers: { authorization?: unknown } } & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
export type HumanAutomationRequestDependencies = Pick<BusinessFailureDependencies, 'db' | 'auth' | 'guard' | 'core' | 'clock' | 'resources'> & {
  /** Explicit server selection only. A current-workspace selection must resolve
   * exactly one matching recorded policy; original inputs keep their policy. */
  automation?: Pick<AutomationDependencies, 'subscriptions'> & ({ policyId: string } | { selection: 'current_workspace' })
    & { assertCurrent?: () => void };
  /** Separate trusted human metadata policy, never the automation subject's grant. */
  reviewGrantPolicy?: HumanAutomationReviewGrantPolicySource;
  outboxObservationPolicy?: Pick<RuntimeTaskFaultAlertPolicySource, 'readForScope' | 'readCurrentForScope'>;
};
export type HumanAutomationRequestAction = 'readCandidate' | 'prepareCandidate' | 'preparePending'
  | 'outboxObservation'
  | 'readPendingBatch' | 'continuePendingBatch'
  | 'prepareInput' | 'readInput' | 'createTask' | 'createEventTask' | 'readCreation' | 'read' | 'forEvent' | 'close' | 'feedback' | 'operation' | 'readQueue'
  | 'prepareGrant' | 'enableGrant' | 'readGrant';
const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const eventInput = z.object({ eventId: z.string().uuid() }).strict();
const originalInput = z.object({ inputRef: z.string().uuid() }).strict();
const policyId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u);
const policySelection = z.union([z.object({ policyId }).strict(), z.object({ selection: z.literal('current_workspace') }).strict()]);
const eventType = z.enum(['notification.failed', 'refund.failed', 'inspection.return_exception',
  'fulfillment.resource_shortage', 'opening.missing_configuration']);
const matchingPolicy = z.object({ id: policyId, tenantId: z.string(), workspaceId: z.string(), subjectId: policyId,
  revision: z.number().int().min(1).max(4294967294), mode: z.enum(['shadow', 'manual_confirmation']),
  revokedAt: z.null(), validFrom: z.date(), expiresAt: z.date(), allowedEventTypes: z.array(eventType)
    .min(1).max(5).refine(values => new Set(values).size === values.length) });
const policyFields = { id: true, tenantId: true, workspaceId: true, subjectId: true, revision: true, mode: true,
  revokedAt: true, validFrom: true, expiresAt: true, allowedEventTypes: true } as const;
const unavailable = () => new AutomationError('unavailable');

export class HumanAutomationRequestFactory {
  private readonly dependencies: HumanAutomationRequestDependencies;
  constructor(input: HumanAutomationRequestDependencies) {
    if (!input || Object.keys(input).some(key => !['db', 'auth', 'guard', 'core', 'clock', 'automation', 'resources', 'reviewGrantPolicy', 'outboxObservationPolicy'].includes(key))
      || typeof input.db?.$transaction !== 'function' || typeof input.db.aiBusinessFailureOutbox?.findFirst !== 'function'
      || typeof input.db.aiAutomationInput?.findFirst !== 'function' || typeof input.db.aiTask?.findFirst !== 'function'
      || typeof input.auth?.resolveAccessContext !== 'function' || typeof input.guard?.canActivate !== 'function'
      || typeof input.core?.getOrder !== 'function' || input.clock !== undefined && typeof input.clock !== 'function') throw unavailable();
    for (const name of ['aiScope', 'aiAutomationReviewGrant', 'aiAutomationReviewOperation',
      'rentalNotificationLog', 'rentalPaymentRefund', 'rentalInspectionRecord'] as const) {
      if (typeof input.db[name]?.findFirst !== 'function') throw unavailable();
    }
    if (typeof input.db.aiAutomationInput.findMany !== 'function' || typeof input.db.aiBusinessFailureOutbox.findMany !== 'function') throw unavailable();
    if (input.automation) {
      const { subscriptions, assertCurrent, ...selection } = input.automation;
      if (!policySelection.safeParse(selection).success || typeof subscriptions?.readCategoryCommercialContext !== 'function'
        || assertCurrent !== undefined && typeof assertCurrent !== 'function') throw unavailable();
      if ('selection' in selection && typeof input.db.aiAutomationPolicy?.findMany !== 'function') throw unavailable();
    }
    if (input.reviewGrantPolicy !== undefined && typeof input.reviewGrantPolicy?.read !== 'function') throw unavailable();
    if (input.outboxObservationPolicy !== undefined && (typeof input.outboxObservationPolicy?.readForScope !== 'function'
      || typeof input.outboxObservationPolicy.readCurrentForScope !== 'function')) throw unavailable();
    this.dependencies = { ...input, ...(input.automation ? { automation: { ...input.automation } } : {}) };
  }

  /** The controller supplies the audience as a literal. No credentials or service
   * graph survive the request; an ambient ALS identity is never an authority. */
  async call(request: HumanAutomationHttpRequest, audience: 'operator' | 'staff', action: HumanAutomationRequestAction, value: unknown, signal?: AbortSignal) {
    const header = bearer.safeParse(request?.headers?.authorization);
    if (!header.success || !['operator', 'staff'].includes(audience)) throw unavailable();
    let command: unknown;
    try { command = structuredClone(value); if (Buffer.byteLength(JSON.stringify(command) ?? '', 'utf8') > 65536) throw Error(); }
    catch { throw new AutomationError('invalid_input'); }
    const credential = Object.freeze({ authorization: header.data, audience, requestId: randomUUID() });
    const server = this.dependencies, clock = server.clock ?? (() => new Date());
    let active = true, initialIdentity: string | undefined;
    const close = () => { active = false; };
    signal?.addEventListener('abort', close, { once: true });
    if (signal?.aborted) close();
    // A stale candidate read can expire its original outbox marker. Treat
    // interruption conservatively even though it never changes the business.
    const write = ['readCandidate', 'prepareCandidate', 'preparePending', 'continuePendingBatch', 'prepareInput', 'createTask', 'createEventTask', 'close', 'feedback', 'enableGrant'].includes(action);
    let writeReturned = false;
    const credentials = { current: async () => {
      if (!active) throw unavailable();
      return { ...credential };
    } };
    const auth: Pick<AuthService, 'resolveAccessContext'> = { resolveAccessContext: async (authorization, options) => {
      if (!active || authorization !== credential.authorization || options?.audience !== audience) throw unavailable();
      const access = structuredClone(await server.auth.resolveAccessContext(authorization, options));
      if (!access) throw unavailable();
      const context = await new AiTaskCurrentIdentityAuthority({ resolveAccessContext: async () => access }, credentials, clock).resolve();
      const fingerprint = hash({ actor: context.actor, scope: context.scope, audience: context.audience,
        access: 'access' in context ? context.access : null, organizationId: access.user.organizationId ?? null });
      if (initialIdentity !== undefined && fingerprint !== initialIdentity) throw unavailable();
      initialIdentity = fingerprint;
      return access;
    } };
    const identity = new AiTaskCurrentIdentityAuthority(auth, credentials, clock);
    const guard: Pick<ApiAuthGuard, 'canActivate'> = { canActivate: async execution => {
      await identity.resolve();
      if (await server.guard.canActivate(execution) !== true) throw unavailable();
      const context = await identity.resolve(), stored = getRequestIdentity();
      if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || !('access' in context)
        || !stored || stored.userId !== context.actor.userId || stored.tenantId !== context.scope.tenantId
        || stored.workspaceId !== context.scope.workspaceId || stored.staffApi !== (audience === 'staff') || stored.isSaasAdmin
        || stored.dataScope !== context.access.dataScope || hash(stored.locationScope) !== hash(context.access.locationScope)) throw unavailable();
      return true;
    } };
    try {
      return await waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
        await identity.resolve();
        const reads = new BusinessFailureReadAuthority(server.db, auth, credentials, guard, server.core, clock, server.resources);
        const candidates = new BusinessFailureCandidateService(server.db, reads, clock, server.db);
        let grants: HumanAutomationReviewGrantService | undefined;
        const reviews = new HumanAutomationReviewService(server.db, reads, clock,
          (inputRef, kind, tx, original) => {
            if (!grants) throw unavailable();
            return grants.assertCurrentGrant(inputRef, kind, tx, original);
          });
        if (server.reviewGrantPolicy) grants = new HumanAutomationReviewGrantService(server.db, reviews, server.reviewGrantPolicy, clock);
        const configured = () => {
          if (!server.automation) throw unavailable();
          server.automation.assertCurrent?.();
          return server.automation;
        };
        const eventPolicy = async (eventId: string, db: Pick<HumanAutomationRequestDependencies['db'],
          'aiBusinessFailureOutbox' | 'aiAutomationInput' | 'aiAutomationPolicy'> = server.db) => {
          const configuration = configured();
          if ('policyId' in configuration) return { id: configuration.policyId, fingerprint: hash({ policyId: configuration.policyId }) };
          const current = await reads.current(), event = await db.aiBusinessFailureOutbox.findFirst({ where: { id: eventId, ...current.scope } });
          if (!event || event.id !== eventId || event.tenantId !== current.scope.tenantId || event.workspaceId !== current.scope.workspaceId) throw unavailable();
          return reads.withEvent(event, async source => {
            if (!source.failed || source.revision !== event.resourceRevision) throw unavailable();
            const now = clock(), type = eventType.safeParse(event.eventType);
            if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !type.success) throw unavailable();
            const originals = await db.aiAutomationInput.findMany({ where: { ...current.scope, eventId },
              orderBy: { id: 'asc' }, take: 2, select: { id: true, policyId: true } });
            if (originals.length > 1 || originals.some(row => !z.string().uuid().safeParse(row.id).success || !policyId.safeParse(row.policyId).success)) throw unavailable();
            // A policy change cannot mint another operation for an event that
            // already has an input, including a creation/dispatch unknown.
            const rows = originals.length ? [await db.aiAutomationPolicy.findFirst({
              where: { ...current.scope, id: originals[0].policyId }, select: policyFields })]
              : await db.aiAutomationPolicy.findMany({ where: { ...current.scope, mode: { in: ['shadow', 'manual_confirmation'] },
                revokedAt: null, validFrom: { lte: now }, expiresAt: { gt: now } }, orderBy: { id: 'asc' }, take: 21, select: policyFields });
            if (rows.length > 20) throw unavailable();
            const eligible = rows.map(row => {
              const parsed = matchingPolicy.safeParse(row);
              if (!parsed.success || parsed.data.tenantId !== current.scope.tenantId || parsed.data.workspaceId !== current.scope.workspaceId
                || parsed.data.validFrom > now || parsed.data.expiresAt <= now) throw unavailable();
              return parsed.data;
            }).filter(row => row.allowedEventTypes.includes(type.data));
            // Overlapping policies are a configuration conflict, never an excuse
            // to choose the first or to fall back after a denied/unknown action.
            if (eligible.length !== 1) throw unavailable();
            const selected = eligible[0];
            configured();
            return { id: selected.id, fingerprint: hash({ ...selected, validFrom: selected.validFrom.toISOString(),
              expiresAt: selected.expiresAt.toISOString() }) };
          });
        };
        let eventSelection: { eventId: string; id: string; fingerprint: string } | undefined;
        const verifyEventSelection = async () => {
          configured();
          if (eventSelection && hash(await eventPolicy(eventSelection.eventId)) !== hash({ id: eventSelection.id, fingerprint: eventSelection.fingerprint })) {
            throw new AutomationError('result_unknown');
          }
        };
        const automation = async (value: unknown, origin: 'event' | 'input') => {
          const configuration = configured();
          let selectedId: string;
          if (origin === 'event') {
            const selected = eventInput.safeParse(value);
            if (!selected.success) throw new AutomationError('invalid_input');
            const selectedPolicy = await eventPolicy(selected.data.eventId);
            if (eventSelection && (eventSelection.eventId !== selected.data.eventId
              || hash({ id: eventSelection.id, fingerprint: eventSelection.fingerprint }) !== hash(selectedPolicy))) throw new AutomationError('result_unknown');
            eventSelection = { eventId: selected.data.eventId, ...selectedPolicy };
            selectedId = selectedPolicy.id;
          } else {
            const selected = originalInput.safeParse(value);
            if (!selected.success) throw new AutomationError('invalid_input');
            const current = await reads.current(), row = await server.db.aiAutomationInput.findFirst({ where: { id: selected.data.inputRef, ...current.scope },
              select: { id: true, tenantId: true, workspaceId: true, policyId: true } });
            if (!row || row.id !== selected.data.inputRef || row.tenantId !== current.scope.tenantId || row.workspaceId !== current.scope.workspaceId
              || !policyId.safeParse(row.policyId).success || 'policyId' in configuration && configuration.policyId !== row.policyId) throw unavailable();
            // Policy discovery never redirects an existing input. The original
            // source verifies its exact subject, revision, material and boundary.
            selectedId = row.policyId;
          }
          configured();
          const originalSelection = eventSelection;
          return composeAutomationFailureTasks({ db: server.db, clock, policyId: selectedId, subscriptions: configuration.subscriptions,
            ...(origin === 'event' && 'selection' in configuration && originalSelection ? { assertPreparationPolicy: async tx => {
              const selected = await eventPolicy(originalSelection.eventId, tx);
              if (hash(selected) !== hash({ id: originalSelection.id, fingerprint: originalSelection.fingerprint })) throw unavailable();
            } } : {}) }, reads);
        };
        const prepareInput = async (value: unknown) => {
          const selected = eventInput.safeParse(value);
          if (!selected.success) throw new AutomationError('invalid_input');
          const candidate = await candidates.read(selected.data);
          if (candidate.status !== 'ready' || !candidate.material) throw unavailable();
          const service = await automation(selected.data, 'event');
          const result = await service.prepare(selected.data);
          writeReturned = true;
          await verifyEventSelection();
          if (result.state === 'prepared') {
            const view = await reviews.read({ inputRef: result.inputRef });
            if (view.event.eventId !== selected.data.eventId || view.actionResource.creationKey !== result.creationKey
              || view.review.status !== 'open' || !view.currentSource.failed
              || view.currentSource.revision !== view.event.resourceRevision) throw new AutomationError('result_unknown');
          }
          return result;
        };
        const creation = async (value: unknown, create: boolean) => {
          const service = await automation(value, 'input');
          const result = await (create ? service.create(value) : service.reconcile(value));
          if (create) writeReturned = true;
          const view = await reviews.read({ inputRef: result.inputRef });
          if (view.actionResource.creationKey !== result.creationKey || view.review.status !== 'open'
            || !view.currentSource.failed || view.currentSource.revision !== view.event.resourceRevision
            || result.state === 'observed' && (view.task.taskId !== result.task.taskId || view.task.runId !== result.task.runId
              || view.task.state !== 'observed' || view.task.revision !== result.task.revision || view.task.status !== result.task.status)
            || result.state === 'not_observed' && view.task.state !== 'not_observed') throw new AutomationError('result_unknown');
          return result;
        };
        let assertOutboxPolicy: (() => void) | undefined;
        const execute = async () => {
          switch (action) {
            case 'outboxObservation': {
              const captured = await new BusinessOutboxObservationReader({ db: server.db, reads, clock,
              policy: server.outboxObservationPolicy, scopeId: async context => {
                const resolved = await new AiScopeRepository(server.db, identity, clock).resolveCurrent();
                const { authorizedAt: _at, requestId: _request, ...expected } = context;
                const { authorizedAt: _currentAt, requestId: _currentRequest, ...current } = resolved.context;
                if (hash(current) !== hash(expected)) throw unavailable();
                return resolved.scope.id;
              } }).capture(command);
              assertOutboxPolicy = captured.assertCurrentPolicy;
              return captured.value;
            }
            case 'readCandidate': return candidates.read(command);
            case 'prepareCandidate': return candidates.prepare(command);
            // The original bounded algorithm owns partial failures and final re-reads.
            case 'preparePending': return candidates.preparePending(command);
            case 'readPendingBatch': return candidates.readPendingBatch(command);
            case 'continuePendingBatch': return candidates.continuePendingBatch(command);
            case 'createEventTask': {
              const selected = eventInput.safeParse(command);
              if (!selected.success) throw new AutomationError('invalid_input');
              // Resolve the explicit server policy dependency before touching
              // the event marker. No fallback subject or execution driver.
              await automation(selected.data, 'event');
              const candidate = await candidates.prepare(selected.data);
              writeReturned = true;
              if (candidate.status !== 'ready' || !candidate.material) throw unavailable();
              const input = structuredClone(await prepareInput(selected.data));
              const base = { eventId: selected.data.eventId, inputRef: input.inputRef, creationKey: input.creationKey,
                dispatchRequested: false as const, confirmationGranted: false as const,
                executionPermission: false as const, businessActionRequested: false as const,
                workerStarted: false as const, automaticRetry: false as const, execution: 'metadata_only_no_dispatch' as const };
              // A possibly committed input is not permission to create a task.
              // The caller can recover its reference through reviews/for-event.
              if (input.state === 'unknown') return { ...base, inputState: 'unknown' as const,
                creationState: 'not_attempted' as const, task: null, nextAction: 'read_original_event' as const };
              const task = structuredClone(await creation({ inputRef: input.inputRef }, true));
              if (task.inputRef !== input.inputRef || task.creationKey !== input.creationKey) throw new AutomationError('result_unknown');
              const observed = await reviews.read({ inputRef: input.inputRef });
              if (observed.event.eventId !== selected.data.eventId) throw new AutomationError('result_unknown');
              return { ...base, inputState: 'prepared' as const, creationState: task.state, task: task.task,
                nextAction: task.state === 'observed' ? 'read_original_task' as const : 'read_original_creation' as const };
            }
            case 'prepareInput': return prepareInput(command);
            case 'readInput': {
              const service = await automation(command, 'input'), result = await service.read(command);
              if (hash(result) !== hash(await service.read(command))) throw unavailable();
              return result;
            }
            case 'createTask': return creation(command, true);
            case 'readCreation': return new OriginalAutomationCreationReader(server.db, reads, clock).readCreation(command);
            case 'readQueue': return new HumanAutomationReviewQueueService(server.db, reads, reviews, async () => {
              await identity.resolve();
              if (!initialIdentity) throw unavailable();
              return initialIdentity;
            }).read(command);
            case 'read': return reviews.read(command);
            case 'forEvent': return reviews.forEvent(command);
            case 'operation': return reviews.operation(command);
            case 'prepareGrant': {
              if (!grants) throw unavailable();
              return grants.prepare(command);
            }
            case 'readGrant': {
              if (!grants) throw unavailable();
              return grants.read(command);
            }
            case 'enableGrant': {
              if (!grants) throw unavailable();
              const result = await grants.enable(command);
              writeReturned = true;
              return result;
            }
            case 'close':
            case 'feedback': {
              const result = await (action === 'close' ? reviews.close(command) : reviews.feedback(command));
              writeReturned = true;
              if (result.state === 'observed' && hash(result) !== hash(await reviews.operation({ inputRef: result.inputRef, operationKey: result.operationKey }))) {
                throw new AutomationError('result_unknown');
              }
              return result;
            }
            default: throw new AutomationError('invalid_input');
          }
        };
        const result = await execute();
        writeReturned = write;
        if (eventSelection || action === 'createTask' || action === 'readInput') await verifyEventSelection();
        await identity.resolve();
        assertOutboxPolicy?.();
        return result;
      }), write, signal);
    } catch (error) {
      if (writeReturned || error instanceof Error && 'code' in error && error.code === 'AI_RESULT_UNKNOWN') throw new AutomationError('result_unknown');
      throw error;
    } finally { close(); signal?.removeEventListener('abort', close); }
  }
}
