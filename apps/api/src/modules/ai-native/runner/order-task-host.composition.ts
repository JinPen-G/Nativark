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
import type { AiTaskHeldPreparation } from './ai-task-runner.service';
import type { AiTaskRunnerClock } from './ai-task-runner.ports';
import type { AiTaskRunnerRepositoryCommandFactory } from './ai-task-runner.repository-adapter';

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
    if (lease.taskId !== task.taskId || lease.runId !== task.runId || signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    if (input.selectedOrder && (input.selectedOrder.taskId !== task.taskId || input.selectedOrder.runId !== task.runId)) {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
    const order = input.selectedOrder ? await input.selectedOrder.read() : task.order;
    if (!order || typeof order !== 'object' || Array.isArray(order)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    await orders.source.publishOrderInput({ taskId: task.taskId, registrationRef: task.registrationRef,
      expectedTaskRevision: taskRevision, lease, input: structuredClone(order) });
    if (input.selectedOrder) {
      if (requestFingerprint(await input.selectedOrder.read()) !== requestFingerprint(order)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
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
  return Object.freeze({ orders, ...root, authorization, registrations, transitions, taskTransitions, recovery, events,
    application: Object.freeze({ start: application.start.bind(application), continueConfirmation: application.continueConfirmation.bind(application),
      readConfirmation: application.readConfirmation.bind(application),
      readConfirmationHistory: application.readConfirmationHistory.bind(application),
      inspect: application.inspect.bind(application), readEvents: application.readEvents.bind(application), reconcile: application.reconcile.bind(application) }) });
}
