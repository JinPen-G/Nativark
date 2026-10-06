import type { Prisma, PrismaClient } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiCatalogReadFactsService } from '../catalog-read-facts.service';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import type { AiTaskInputSource } from '../task-input/task-input.ports';
import { PrismaTaskPlanInputSource } from './prisma-task-plan-input.source';
import { composeAuthorizedReadonlyPersistentTaskInputRunner } from './authorized-persistent-task-input.composition';
import type { AiTaskRunnerRepositoryCommandFactory } from './ai-task-runner.repository-adapter';
import type { AiTaskRunnerClock } from './ai-task-runner.ports';
import type { AiTaskRegisteredExecutor } from './prisma-task-measured-effects';

const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const identity = ({ authorizedAt: _at, requestId: _id, ...context }: AiExecutionContext) => requestFingerprint(context);

/** One existing Core reader, with actual policy/input/registration/result stores.
 * No caller-supplied plan authority, registration grant, command factory or
 * generic executor. The existing Guard establishes ALS for the Core call.
 * No AppModule, HTTP route, worker or enabled/default policy is installed.
 */
export function composePersistedCatalogTaskRunner(input: {
  db: PrismaClient;
  authorization: Omit<PersistedTaskAuthorizationDependencies, 'db' | 'clock'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  core: Pick<RentalCoreService, 'listItemGroups'>;
  wall?: () => Date;
  monotonic?: () => number;
  clock?: AiTaskRunnerClock;
}) {
  if (typeof input?.guard?.canActivate !== 'function' || typeof input?.core?.listItemGroups !== 'function') throw unavailable();
  const authorization = composePersistedTaskAuthorization({ ...input.authorization, db: input.db, clock: input.wall });
  const source = new PrismaTaskPlanInputSource(input.db, authorization.authority, authorization.execution, input.wall);
  const route = new AiBusinessReadRouteAuthority(input.guard, input.authorization.credentials, input.wall);
  const commands: AiTaskRunnerRepositoryCommandFactory = {
    async register(plan, lease) {
      const task = await authorization.tasks.readMetadata(lease.taskId);
      return { taskId: lease.taskId, registrationRef: plan.registrationRef, expectedTaskRevision: task.revision,
        lease: { runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } };
    },
    transition(kind, step, lease, resultRef) {
      if (kind === 'pause' || (kind !== 'start' && !resultRef)) throw unavailable();
      return { taskId: lease.taskId, stepId: step.registered.stepId,
        expectedTaskRevision: step.registered.taskRevision, expectedStepRevision: step.registered.stepRevision,
        evidenceId: kind === 'start' ? `start-${step.registered.stepId}` : resultRef!,
        reason: kind === 'start' ? 'start' : kind === 'unknown' ? 'result_unknown' : 'result_observed',
        lease: { runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } };
    }
  };
  const executors: AiTaskRegisteredExecutor = {
    async resolve(code, version) {
      if (code !== 'rental.catalog.search' || version !== AI_TOOL_DRAFT_VERSION) return null;
      return { operation: 'readonly', async execute(binding, signal) {
        if (signal.aborted || binding.clarifications?.length) throw unavailable();
        const stored = await source.readForExecution(binding);
        // Per-execution closure: concurrent tasks cannot swap a shared expected identity.
        const facts = new AiCatalogReadFactsService(input.core, { withRead: (kind, request, read) =>
          route.withRead(kind, request, async context => {
            if (signal.aborted || identity(context) !== identity(stored.context)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
            return read(context);
          }) }, input.wall);
        const result = await facts.read(stored.input);
        const current = await authorization.execution.authorize(binding.taskId);
        if (signal.aborted || identity(current) !== identity(stored.context)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const payload = { ...result, scope: { ...result.scope }, items: result.items.map(item => ({ ...item })) } satisfies Prisma.InputJsonObject;
        return { kind: 'succeeded', payload };
      } };
    }
  };
  const inputSource: AiTaskInputSource = {
    async resolve(binding) {
      const stored = await source.readCatalogInput({ taskId: binding.taskId, runId: binding.runId,
        inputRef: binding.inputRef, fingerprint: binding.inputHash });
      if (stored.registrationRef !== binding.registrationRef || binding.toolCode !== 'rental.catalog.search'
        || binding.toolVersion !== AI_TOOL_DRAFT_VERSION) throw unavailable();
      return { kind: 'not_required' };
    },
    async validateAnswers() { throw unavailable(); }
  };
  const root = composeAuthorizedReadonlyPersistentTaskInputRunner({ ...input, authorization: input.authorization,
    planAuthority: source, registrationAuthority: source, inputSource, commands, executors,
    toolCatalog: { resolve: async (code, version) => code === 'rental.catalog.search' && version === AI_TOOL_DRAFT_VERSION ? { modelCall: false } : null } });
  return Object.freeze({ ...root, source });
}
