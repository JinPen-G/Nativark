import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { composeControlledApprovedOrder, type ControlledApprovedOrderDependencies } from '../approval-execution/controlled-approved-order.composition';
import { composePersistedTaskAuthorization } from '../task-authorization.composition';
import { composePersistentTaskRunner } from './persistent-task-runner.composition';
import { AiStepRegistrationRepository } from '../ai-step-registration.repository';
import { AiStepTransitionRepository } from '../ai-step-transition.repository';
import { AiTaskTransitionRepository } from '../ai-task-transition.repository';
import { AiTaskEventRepository } from '../ai-task-event.repository';
import { PrismaTaskRecoverySnapshotRepository } from './prisma-task-recovery-snapshot.repository';
import { createAiTaskRunnerOutcomePort } from './ai-task-runner-outcome-adapter';
import { PrismaTaskOrderStepAuthority } from './prisma-task-order-step.authority';
import { PrismaTaskExecutionScopeAuthority } from './prisma-task-execution-scope.authority';
import { PrismaTaskConfirmationCheckpointSource } from './prisma-task-confirmation-checkpoint.source';
import { aiTaskRunnerLimitsSchema, aiTaskRunPlanSchema, PrismaTaskRunEvidenceRepository } from './prisma-task-run-evidence.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { PrismaTaskApplication, type AiTaskApplicationHost } from './prisma-task-application';
import { AiTaskRunnerError, callAiTaskRunnerDependency, snapshotAiTaskRunnerRecoveryLease,
  withAiTaskHeldPreparationDefinition, type AiTaskHeldPreparation } from './ai-task-runner.service';
import type { AiTaskRunnerClaimInput, AiTaskRunnerClock } from './ai-task-runner.ports';
import type { AiTaskRunnerRepositoryCommandFactory } from './ai-task-runner.repository-adapter';
import { AiTaskTakeoverCommitUnknownError, PrismaTaskTakeoverRepository } from './prisma-task-takeover.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const taskSchema = z.object({ taskId: id.max(36), runId: id.max(36), registrationRef: id,
  order: z.record(z.unknown()).optional(), limits: aiTaskRunnerLimitsSchema }).strict();
export type TaskOrderHostDependencies = ControlledApprovedOrderDependencies & {
  host: AiTaskApplicationHost;
  task: z.infer<typeof taskSchema>;
  /** Optional server-owned selector for a persisted human choice. The
   * caller never supplies the order body; the selector is evaluated only
   * after the runner has acquired its real lease. */
  selectedOrder?: { taskId: string; runId: string; read: () => Promise<unknown> };
  monotonic?: () => number;
  runnerClock?: AiTaskRunnerClock;
};

/** Hosts the original order-only runner, including already-published plans.
 * Every action keeps its own human approval, Core transaction and receipt;
 * no plan-wide rollback, automatic compensation, policy seed or new grant. */
export function composeTaskOrderHost(input: TaskOrderHostDependencies) {
  const task = taskSchema.parse(structuredClone(input.task));
  const orders = composeControlledApprovedOrder(input);
  const authorization = composePersistedTaskAuthorization(input);
  const phaseResults = new PrismaTaskRunEvidenceRepository(input.db, new PrismaTaskExecutionScopeAuthority(authorization.tasks, input.db),
    orders.source, input.clock, input.monotonic, undefined, orders.waiting);
  const commands: AiTaskRunnerRepositoryCommandFactory = {
    register: async (plan, lease) => ({ taskId: lease.taskId, registrationRef: plan.registrationRef,
      expectedTaskRevision: (await orders.tasks.readMetadata(lease.taskId)).revision,
      lease: { runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } }),
    transition: (kind, step, lease, resultRef) => {
      if (kind === 'pause' || (kind !== 'start' && !resultRef)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return { taskId: lease.taskId, stepId: step.registered.stepId, expectedTaskRevision: step.registered.taskRevision,
        expectedStepRevision: step.registered.stepRevision, evidenceId: kind === 'start' ? `start-${step.registered.stepId}` : resultRef!,
        reason: kind === 'start' ? 'start' : kind === 'unknown' ? 'result_unknown'
          : step.registered.existingStatus === 'unknown' ? kind === 'succeed' ? 'reconciled_committed' : 'reconciled_not_committed' : 'result_observed',
        lease: { runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } };
    }
  };
  const prepare: AiTaskHeldPreparation = async ({ lease, taskRevision, signal }) => {
    const selectedOrder = input.selectedOrder;
    if (lease.taskId !== task.taskId || lease.runId !== task.runId || signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    if (selectedOrder && (selectedOrder.taskId !== task.taskId || selectedOrder.runId !== task.runId)) {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
    const order = selectedOrder ? await selectedOrder.read() : task.order;
    if (order === undefined && selectedOrder === undefined) {
      // Host an already-published order-only plan; never synthesize inputs or
      // approvals from its IDs. Each action retains its own Core transaction,
      // confirmation and result. A failed successor cannot roll back ancestors.
      const access = await authorization.tasks.resolveAccess(task.taskId, 'read_metadata');
      const owner = await input.db.aiTask.findFirst({ where: access.where });
      if (!owner) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const key = { scopeId: owner.scopeId, taskId: task.taskId, runId: task.runId };
      const saved = await input.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
      if (!saved) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const plan = aiTaskRunPlanSchema.parse(saved.payload);
      if (Object.entries(key).some(([name, value]) => saved[name as keyof typeof saved] !== value)
        || plan.taskId !== task.taskId || plan.runId !== task.runId || requestFingerprint(plan) !== saved.planHash
        || plan.taskRevision > taskRevision || plan.steps.length === 0 || plan.steps[0].registrationRef !== task.registrationRef
        || requestFingerprint(plan.limits) !== requestFingerprint(task.limits)
        || plan.steps.some(step => step.toolCode !== 'rental.order.commit' || step.toolVersion !== AI_TOOL_DRAFT_VERSION
          || step.operation !== 'idempotent')) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      await orders.source.authorize(plan, lease);
      const latest = await input.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
      if (!latest || latest.planHash !== saved.planHash || requestFingerprint(latest.payload) !== saved.planHash)
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      if (signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return;
    }
    if (!order || typeof order !== 'object' || Array.isArray(order)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    await orders.source.publishOrderInput({ taskId: task.taskId, registrationRef: task.registrationRef,
      expectedTaskRevision: taskRevision, lease, input: structuredClone(order) });
    if (selectedOrder) {
      if (requestFingerprint(await selectedOrder.read()) !== requestFingerprint(order)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const access = await authorization.tasks.resolveAccess(task.taskId, 'read_metadata');
      const owner = await input.db.aiTask.findFirst({ where: access.where });
      if (!owner) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const saved = await input.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: {
        scopeId: owner.scopeId, taskId: task.taskId, runId: task.runId } } });
      if (saved) {
        const plan = aiTaskRunPlanSchema.parse(saved.payload);
        if (plan.taskId !== task.taskId || plan.runId !== task.runId || requestFingerprint(plan) !== saved.planHash
          || plan.steps.length !== 1 || plan.steps[0].registrationRef !== task.registrationRef
          || plan.steps[0].toolCode !== 'rental.order.commit' || plan.steps[0].toolVersion !== AI_TOOL_DRAFT_VERSION
          || plan.steps[0].operation !== 'idempotent') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return;
      }
    }
    if (signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    await orders.plans.savePlan({ taskId: task.taskId, runId: task.runId, taskRevision,
      steps: [{ registrationRef: task.registrationRef, operation: 'idempotent', toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION }],
      limits: structuredClone(task.limits) }, lease);
  };
  if (task.order !== undefined || input.selectedOrder) withAiTaskHeldPreparationDefinition(prepare, { taskId: task.taskId, runId: task.runId,
    steps: [{ registrationRef: task.registrationRef, operation: 'idempotent', toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION }],
    limits: task.limits, bindingHash: requestFingerprint({ task, selected: !!input.selectedOrder }) });
  const registrations = new AiStepRegistrationRepository(input.db, orders.source, input.clock, undefined,
    { resolve: command => authorization.authority.resolve(command.taskId, 'read_step_terminal') });
  const transitions = new AiStepTransitionRepository(input.db,
    new PrismaTaskOrderStepAuthority(input.db, authorization.authority, orders.source, phaseResults, input.clock), input.clock);
  const taskTransitions = new AiTaskTransitionRepository(input.db, authorization.authority, input.clock,
    new PrismaTaskConfirmationCheckpointSource(orders.waiting, orders.source, input.clock));
  const taskOutcome = createAiTaskRunnerOutcomePort({ transitions: taskTransitions, tasks: authorization.tasks,
    commands: { transition: command => command } });
  const root = composePersistentTaskRunner({ db: input.db, tasks: authorization.tasks, executionAuthorization: authorization.execution,
    registrations, replays: registrations, transitions, taskOutcome,
    confirmation: { pause: command => taskTransitions.pauseConfirmation(command), resume: command => taskTransitions.resumeConfirmation(command) },
    orderEvidence: orders.waiting, planAuthority: orders.source, commands,
    executors: { resolve: async (code, version) => {
      const executor = await orders.waiting.resolve(code, version);
      return executor ? { ...executor, phase: 'confirmation' as const } : null;
    } },
    toolCatalog: { resolve: async (code, version) => code === 'rental.order.commit' && version === AI_TOOL_DRAFT_VERSION ? { modelCall: false } : null },
    wall: input.clock, monotonic: input.monotonic, clock: input.runnerClock });
  const recovery = new PrismaTaskRecoverySnapshotRepository(input.db, authorization.tasks);
  const events = new AiTaskEventRepository(input.db, authorization.authority, input.clock);
  const unavailableInput = async () => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); };
  const application = new PrismaTaskApplication({ db: input.db, tasks: authorization.tasks, runner: root.runner,
    recovery, events, host: input.host, prepare, clock: input.runnerClock, inputs: { submit: unavailableInput, readPending: unavailableInput } });
  const takeovers = input.selectedOrder ? new PrismaTaskTakeoverRepository(input.db, authorization.authority, input.clock) : undefined;
  const selectedRecovery = takeovers ? {
    /** Only an acknowledged fence can enter original-result recovery. The
     * selection consumer rechecks its immutable material after this mutation;
     * a receipt read cannot repair a lost ACK or authorize another claim. */
    async takeoverAndRecover(command: AiTaskRunnerClaimInput & { previousHolderId: string },
      signal: AbortSignal | undefined, revalidate: () => Promise<void>) {
      if (command.taskId !== task.taskId || command.runId !== task.runId || typeof revalidate !== 'function')
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      if (signal?.aborted) return { status: 'unavailable' as const, completedSteps: 0, cleanupFailed: 0 };
      const original = structuredClone(command);
      let lease;
      try {
        const received = await callAiTaskRunnerDependency(child => takeovers.takeover(original, child),
          5000, 'selected_order_takeover', undefined, input.runnerClock);
        lease = snapshotAiTaskRunnerRecoveryLease(original, received);
      } catch (error) {
        if (error instanceof AiTaskRunnerError && (error.code === 'AI_RUN_LIMIT' || error.code === 'AI_RESULT_UNKNOWN'))
          throw new AiTaskTakeoverCommitUnknownError();
        throw error;
      }
      let runnerOwnsLease = false;
      try {
        await callAiTaskRunnerDependency(() => revalidate(), 5000,
          'selected_order_takeover_revalidate', undefined, input.runnerClock);
        if (signal?.aborted) return { status: 'unavailable' as const, completedSteps: 0, cleanupFailed: 0 };
        return await root.runner.recover(lease, signal, () => { runnerOwnsLease = true; });
      } catch {
        // Fencing already committed and its ACK was checked. A later source,
        // permission or recovery failure cannot be reported as no takeover.
        throw new AiTaskTakeoverCommitUnknownError();
      } finally {
        if (!runnerOwnsLease) {
          // Preflight has not transferred the protected interval to the runner.
          // Release only this positively acknowledged generation, never one
          // reconstructed from a holder lookup or the takeover audit receipt.
          try {
            await callAiTaskRunnerDependency(async child => {
              const current = await authorization.tasks.readMetadata(task.taskId);
              if (child.aborted || current.taskId !== task.taskId) throw new AiTaskTakeoverCommitUnknownError();
              const release = { taskId: task.taskId, runId: task.runId, holderId: lease.holderId,
                expectedTaskRevision: current.revision, expectedRunRevision: lease.revision,
                expectedFencingToken: lease.fencingToken };
              const receipt = await authorization.tasks.releaseRun(release);
              if (child.aborted || receipt.released !== true || receipt.revision !== release.expectedRunRevision + 1)
                throw new AiTaskTakeoverCommitUnknownError();
            }, 5000, 'selected_order_takeover_cleanup', undefined, input.runnerClock);
          } catch { throw new AiTaskTakeoverCommitUnknownError(); }
        }
      }
    },
    async readTakeoverReceipt(command: Pick<AiTaskRunnerClaimInput,
      'taskId' | 'runId' | 'expectedTaskRevision' | 'expectedRunRevision' | 'expectedFencingToken'>,
      signal?: AbortSignal) {
      if (command.taskId !== task.taskId || command.runId !== task.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      try {
        return await callAiTaskRunnerDependency(() => takeovers.readReceipt(structuredClone(command)),
          5000, 'selected_order_takeover_receipt', signal, input.runnerClock);
      } catch (error) {
        if (error instanceof AiTaskRunnerError && (error.code === 'AI_RUN_LIMIT' || error.code === 'AI_RESULT_UNKNOWN'))
          throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        throw error;
      }
    }
  } : {};
  return Object.freeze({ orders, ...root, authorization, registrations, transitions, taskTransitions, recovery, events,
    ...selectedRecovery,
    application: Object.freeze({ start: application.start.bind(application), continueConfirmation: application.continueConfirmation.bind(application),
      readConfirmation: application.readConfirmation.bind(application),
      readConfirmationHistory: application.readConfirmationHistory.bind(application),
      inspect: application.inspect.bind(application), readEvents: application.readEvents.bind(application), reconcile: application.reconcile.bind(application) }) });
}
