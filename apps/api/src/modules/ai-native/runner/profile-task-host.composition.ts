/** Explicit ordinary-name host on the original durable runner and resource
 * ledger. No model, controller, provider, task creation, policy seed or timer.
 * Continuation/recovery require the original application's held server lease. */
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiStepRegistrationRepository } from '../ai-step-registration.repository';
import { AiStepTransitionRepository } from '../ai-step-transition.repository';
import { AiTaskTransitionRepository } from '../ai-task-transition.repository';
import { AiTaskEventRepository } from '../ai-task-event.repository';
import { composePersistedTaskAuthorization } from '../task-authorization.composition';
import { composeApprovedProfileWaiting } from '../approval-execution/approved-profile-waiting.executor';
import { composePersistedProfileTaskInput } from '../approval-execution/approved-profile-registration.source';
import { PROFILE_NAME_TOOL_CODE, type ApprovedProfileApplicationDependencies } from '../approval-execution/approved-profile-task.authority';
import { composePersistentTaskRunner } from './persistent-task-runner.composition';
import { aiTaskRunnerLimitsSchema, PrismaTaskRunEvidenceRepository } from './prisma-task-run-evidence.repository';
import { PrismaTaskExecutionScopeAuthority } from './prisma-task-execution-scope.authority';
import { PrismaTaskOrderStepAuthority } from './prisma-task-order-step.authority';
import { PrismaTaskConfirmationCheckpointSource } from './prisma-task-confirmation-checkpoint.source';
import { PrismaTaskRecoverySnapshotRepository } from './prisma-task-recovery-snapshot.repository';
import { createAiTaskRunnerOutcomePort } from './ai-task-runner-outcome-adapter';
import { PrismaTaskApplication, type AiTaskApplicationHost } from './prisma-task-application';
import { withAiTaskHeldPreparationDefinition, type AiTaskHeldPreparation } from './ai-task-runner.service';
import type { AiTaskRunnerClock } from './ai-task-runner.ports';
import type { AiTaskRunnerRepositoryCommandFactory } from './ai-task-runner.repository-adapter';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const taskSchema = z.object({ taskId: id.max(36), runId: id.max(36), registrationRef: id,
  change: z.object({ customerId: id, changeId: z.string().uuid(), changeHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
  limits: aiTaskRunnerLimitsSchema }).strict();
export type AiProfileTask = z.infer<typeof taskSchema>;
export function composeTaskProfileHost(input: ApprovedProfileApplicationDependencies & {
  host: AiTaskApplicationHost; task: AiProfileTask; monotonic?: () => number; runnerClock?: AiTaskRunnerClock;
}) {
  const task = taskSchema.parse(structuredClone(input.task)), host = Object.freeze(structuredClone(input.host));
  if (host.holderId !== input.holderId) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const profile = composeApprovedProfileWaiting(input);
  const inputs = composePersistedProfileTaskInput({ ...input, readCommittedChange: profile.readCommittedChange });
  const authorization = composePersistedTaskAuthorization(input), tool = PROFILE_NAME_TOOL_CODE;
  const phaseResults = new PrismaTaskRunEvidenceRepository(input.db, new PrismaTaskExecutionScopeAuthority(authorization.tasks, input.db),
    inputs.source, input.clock, input.monotonic, undefined, profile, tool);
  const commands: AiTaskRunnerRepositoryCommandFactory = {
    register: async (plan, lease) => ({ taskId: lease.taskId, registrationRef: plan.registrationRef,
      expectedTaskRevision: (await authorization.tasks.readMetadata(lease.taskId)).revision,
      lease: { runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } }),
    transition: (kind, step, lease, resultRef) => {
      if (kind === 'pause' || kind !== 'start' && !resultRef) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return { taskId: lease.taskId, stepId: step.registered.stepId, expectedTaskRevision: step.registered.taskRevision,
        expectedStepRevision: step.registered.stepRevision, evidenceId: kind === 'start' ? `start-${step.registered.stepId}` : resultRef!,
        reason: kind === 'start' ? 'start' : kind === 'unknown' ? 'result_unknown'
          : step.registered.existingStatus === 'unknown' ? kind === 'succeed' ? 'reconciled_committed' : 'reconciled_not_committed' : 'result_observed',
        lease: { runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } };
    }
  };
  const steps = [{ registrationRef: task.registrationRef, operation: 'idempotent' as const, toolCode: tool, toolVersion: AI_TOOL_DRAFT_VERSION }];
  const prepare: AiTaskHeldPreparation = async ({ lease, taskRevision, signal }) => {
    if (lease.taskId !== task.taskId || lease.runId !== task.runId || signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    await inputs.inputs.publishProfileInput({ taskId: task.taskId, registrationRef: task.registrationRef,
      expectedTaskRevision: taskRevision, lease, input: structuredClone(task.change) });
    if (signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    await inputs.plans.savePlan({ taskId: task.taskId, runId: task.runId, taskRevision, steps, limits: structuredClone(task.limits) }, lease);
  };
  withAiTaskHeldPreparationDefinition(prepare, { taskId: task.taskId, runId: task.runId, steps, limits: task.limits, bindingHash: requestFingerprint(task) });
  const registrations = new AiStepRegistrationRepository(input.db, inputs.source, input.clock, undefined,
    { resolve: command => authorization.authority.resolve(command.taskId, 'read_step_terminal') });
  const transitions = new AiStepTransitionRepository(input.db,
    new PrismaTaskOrderStepAuthority(input.db, authorization.authority, inputs.source, phaseResults, input.clock, tool), input.clock);
  const taskTransitions = new AiTaskTransitionRepository(input.db, authorization.authority, input.clock,
    new PrismaTaskConfirmationCheckpointSource(profile, inputs.source, input.clock, tool));
  const taskOutcome = createAiTaskRunnerOutcomePort({ transitions: taskTransitions, tasks: authorization.tasks, commands: { transition: command => command } });
  const root = composePersistentTaskRunner({ db: input.db, tasks: authorization.tasks, executionAuthorization: authorization.execution,
    registrations, replays: registrations, transitions, taskOutcome, planAuthority: inputs.source, commands,
    confirmation: { pause: command => taskTransitions.pauseConfirmation(command), resume: command => taskTransitions.resumeConfirmation(command) },
    orderEvidence: profile, confirmationTool: tool, executors: { resolve: async (code, version) => {
      const executor = await profile.resolve(code, version); return executor ? { ...executor, phase: 'confirmation' as const } : null;
    } }, toolCatalog: { resolve: async (code, version) => code === tool && version === AI_TOOL_DRAFT_VERSION ? { modelCall: false } : null },
    wall: input.clock, monotonic: input.monotonic, clock: input.runnerClock });
  const recovery = new PrismaTaskRecoverySnapshotRepository(input.db, authorization.tasks), events = new AiTaskEventRepository(input.db, authorization.authority, input.clock);
  const unavailable = async () => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); };
  const application = new PrismaTaskApplication({ db: input.db, tasks: authorization.tasks, runner: root.runner, recovery, events,
    host, prepare, clock: input.runnerClock, inputs: { submit: unavailable, readPending: unavailable } });
  return Object.freeze({ profile, inputs, authorization, registrations, transitions, taskTransitions, recovery, events, ...root,
    application: Object.freeze({ start: application.start.bind(application), inspect: application.inspect.bind(application),
      continueConfirmation: application.continueConfirmation.bind(application), readConfirmation: application.readConfirmation.bind(application),
      readConfirmationHistory: application.readConfirmationHistory.bind(application), reconcile: application.reconcile.bind(application),
      readEvents: application.readEvents.bind(application) }) });
}
