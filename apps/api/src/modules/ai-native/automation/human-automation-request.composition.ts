import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthService } from '../../auth/auth.service';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../../common/request-identity';
import type { BusinessFailureDependencies } from '../business-events/business-failure.composition';
import { BusinessFailureReadAuthority } from '../business-events/business-failure-read.authority';
import { BusinessFailureCandidateService } from '../business-events/business-failure-candidate.service';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { composeAutomationFailureTasks, type AutomationDependencies } from './automation.composition';
import { AutomationError } from './prisma-automation.authority';
import { HumanAutomationReviewService } from './human-automation-review.service';
import { HumanAutomationReviewQueueService } from './human-automation-review-queue.service';
import { waitForTaskApplicationDependency } from '../runner/prisma-task-application';
import type { IncomingMessage } from 'node:http';

export type HumanAutomationHttpRequest = { headers: { authorization?: unknown } } & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
export type HumanAutomationRequestDependencies = Pick<BusinessFailureDependencies, 'db' | 'auth' | 'guard' | 'core' | 'clock'> & {
  /** Server configuration, never selected by the HTTP body. History reads need no active policy. */
  automation?: Pick<AutomationDependencies, 'policyId' | 'subscriptions'>;
};
export type HumanAutomationRequestAction = 'readCandidate' | 'prepareCandidate' | 'preparePending'
  | 'prepareInput' | 'readInput' | 'createTask' | 'createEventTask' | 'readCreation' | 'read' | 'forEvent' | 'close' | 'feedback' | 'operation' | 'readQueue';
const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);
const eventInput = z.object({ eventId: z.string().uuid() }).strict();
const unavailable = () => new AutomationError('unavailable');

export class HumanAutomationRequestFactory {
  private readonly dependencies: HumanAutomationRequestDependencies;
  constructor(input: HumanAutomationRequestDependencies) {
    if (!input || Object.keys(input).some(key => !['db', 'auth', 'guard', 'core', 'clock', 'automation'].includes(key))
      || typeof input.db?.$transaction !== 'function' || typeof input.db.aiBusinessFailureOutbox?.findFirst !== 'function'
      || typeof input.db.aiAutomationInput?.findFirst !== 'function' || typeof input.db.aiTask?.findFirst !== 'function'
      || typeof input.auth?.resolveAccessContext !== 'function' || typeof input.guard?.canActivate !== 'function'
      || typeof input.core?.getOrder !== 'function' || input.clock !== undefined && typeof input.clock !== 'function') throw unavailable();
    for (const name of ['aiScope', 'aiAutomationReviewGrant', 'aiAutomationReviewOperation',
      'rentalNotificationLog', 'rentalPaymentRefund', 'rentalInspectionRecord'] as const) {
      if (typeof input.db[name]?.findFirst !== 'function') throw unavailable();
    }
    if (typeof input.db.aiAutomationInput.findMany !== 'function' || typeof input.db.aiBusinessFailureOutbox.findMany !== 'function') throw unavailable();
    if (input.automation && (Object.keys(input.automation).some(key => !['policyId', 'subscriptions'].includes(key))
      || !z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u).safeParse(input.automation.policyId).success
      || typeof input.automation.subscriptions?.readCategoryCommercialContext !== 'function')) throw unavailable();
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
    const write = ['readCandidate', 'prepareCandidate', 'preparePending', 'prepareInput', 'createTask', 'createEventTask', 'close', 'feedback'].includes(action);
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
        const reads = new BusinessFailureReadAuthority(server.db, auth, credentials, guard, server.core, clock);
        const candidates = new BusinessFailureCandidateService(server.db, reads, clock);
        const reviews = new HumanAutomationReviewService(server.db, reads, clock);
        const automation = () => {
          if (!server.automation) throw unavailable();
          // This request path always supplies original human resource authority.
          return composeAutomationFailureTasks({ db: server.db, clock, ...server.automation }, reads);
        };
        const prepareInput = async (value: unknown) => {
          const selected = eventInput.safeParse(value);
          if (!selected.success) throw new AutomationError('invalid_input');
          const candidate = await candidates.read(selected.data);
          if (candidate.status !== 'ready' || !candidate.material) throw unavailable();
          const result = await automation().prepare(selected.data);
          writeReturned = true;
          if (result.state === 'prepared') {
            const view = await reviews.read({ inputRef: result.inputRef });
            if (view.event.eventId !== selected.data.eventId || view.actionResource.creationKey !== result.creationKey
              || view.review.status !== 'open' || !view.currentSource.failed
              || view.currentSource.revision !== view.event.resourceRevision) throw new AutomationError('result_unknown');
          }
          return result;
        };
        const creation = async (value: unknown, create: boolean) => {
          const service = automation();
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
        const execute = async () => {
          switch (action) {
            case 'readCandidate': return candidates.read(command);
            case 'prepareCandidate': return candidates.prepare(command);
            // The original bounded algorithm owns partial failures and final re-reads.
            case 'preparePending': return candidates.preparePending(command);
            case 'createEventTask': {
              const selected = eventInput.safeParse(command);
              if (!selected.success) throw new AutomationError('invalid_input');
              // Resolve the explicit server policy dependency before touching
              // the event marker. No fallback subject or execution driver.
              automation();
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
              const service = automation(), result = await service.read(command);
              if (hash(result) !== hash(await service.read(command))) throw unavailable();
              return result;
            }
            case 'createTask':
            case 'readCreation': return creation(command, action === 'createTask');
            case 'readQueue': return new HumanAutomationReviewQueueService(server.db, reads, reviews, async () => {
              await identity.resolve();
              if (!initialIdentity) throw unavailable();
              return initialIdentity;
            }).read(command);
            case 'read': return reviews.read(command);
            case 'forEvent': return reviews.forEvent(command);
            case 'operation': return reviews.operation(command);
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
        await identity.resolve();
        return result;
      }), write, signal);
    } catch (error) {
      if (writeReturned || error instanceof Error && 'code' in error && error.code === 'AI_RESULT_UNKNOWN') throw new AutomationError('result_unknown');
      throw error;
    } finally { close(); signal?.removeEventListener('abort', close); }
  }
}
