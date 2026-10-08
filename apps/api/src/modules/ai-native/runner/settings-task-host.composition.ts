import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { composeApprovedSettingsWaiting } from '../approval-execution/approved-settings-waiting.executor';
import type { ApprovedSettingsApplicationDependencies } from '../approval-execution/approved-settings-task.authority';
import { composePersistedSettingsTaskInput } from '../settings-task-input.composition';
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
import { aiTaskRunnerLimitsSchema, PrismaTaskRunEvidenceRepository } from './prisma-task-run-evidence.repository';
import { PrismaTaskApplication, type AiTaskApplicationHost } from './prisma-task-application';
import type { AiTaskHeldPreparation } from './ai-task-runner.service';
import type { AiTaskRunnerClock } from './ai-task-runner.ports';
import type { AiTaskRunnerRepositoryCommandFactory } from './ai-task-runner.repository-adapter';

const tool = 'tenant.notifications.commit' as const;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const taskSchema = z.object({ taskId: id.max(36), runId: id.max(36), registrationRef: id,
  change: z.object({ changeId: id.max(36), changeHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
  limits: aiTaskRunnerLimitsSchema }).strict();

/** Explicit normal-run settings assembly. It shares the durable runner,
 * resource ledger and confirmation checkpoint machinery with order execution;
 * the selected tool and receipt version are server-owned, never model inputs. */
export function composeTaskSettingsHost(input: ApprovedSettingsApplicationDependencies & {
  host: AiTaskApplicationHost; task: z.infer<typeof taskSchema>; monotonic?: () => number; runnerClock?: AiTaskRunnerClock;
}) {
  const task = taskSchema.parse(structuredClone(input.task));
  if (input.host.holderId !== input.holderId) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const settings = composeApprovedSettingsWaiting(input);
  const inputs = composePersistedSettingsTaskInput({ ...input, readCommittedChange: settings.readCommittedChange });
  const authorization = composePersistedTaskAuthorization(input);
  const phaseResults = new PrismaTaskRunEvidenceRepository(input.db, new PrismaTaskExecutionScopeAuthority(authorization.tasks, input.db),
    inputs.source, input.clock, input.monotonic, undefined, settings, tool);
  const commands: AiTaskRunnerRepositoryCommandFactory = {
    register: async (plan, lease) => ({ taskId: lease.taskId, registrationRef: plan.registrationRef,
      expectedTaskRevision: (await inputs.tasks.readMetadata(lease.taskId)).revision,
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
    await settings.application.publishTaskInput({ taskId: task.taskId, registrationRef: task.registrationRef,
      expectedTaskRevision: taskRevision, lease, input: structuredClone(task.change) });
    if (signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    await inputs.plans.savePlan({ taskId: task.taskId, runId: task.runId, taskRevision,
      steps: [{ registrationRef: task.registrationRef, operation: 'idempotent', toolCode: tool, toolVersion: AI_TOOL_DRAFT_VERSION }],
      limits: structuredClone(task.limits) }, lease);
  };
  const registrations = new AiStepRegistrationRepository(input.db, inputs.source, input.clock, undefined,
    { resolve: command => authorization.authority.resolve(command.taskId, 'read_step_terminal') });
  const transitions = new AiStepTransitionRepository(input.db,
    new PrismaTaskOrderStepAuthority(input.db, authorization.authority, inputs.source, phaseResults, input.clock, tool), input.clock);
  const taskTransitions = new AiTaskTransitionRepository(input.db, authorization.authority, input.clock,
    new PrismaTaskConfirmationCheckpointSource(settings, inputs.source, input.clock, tool));
  const taskOutcome = createAiTaskRunnerOutcomePort({ transitions: taskTransitions, tasks: authorization.tasks, commands: { transition: command => command } });
  const root = composePersistentTaskRunner({ db: input.db, tasks: authorization.tasks, executionAuthorization: authorization.execution,
    registrations, replays: registrations, transitions, taskOutcome,
    confirmation: { pause: command => taskTransitions.pauseConfirmation(command), resume: command => taskTransitions.resumeConfirmation(command) },
    orderEvidence: settings, confirmationTool: tool, planAuthority: inputs.source, commands,
    executors: { resolve: async (code, version) => {
      const executor = await settings.resolve(code, version);
      return executor ? { ...executor, phase: 'confirmation' as const } : null;
    } },
    toolCatalog: { resolve: async (code, version) => code === tool && version === AI_TOOL_DRAFT_VERSION ? { modelCall: false } : null },
    wall: input.clock, monotonic: input.monotonic, clock: input.runnerClock });
  const recovery = new PrismaTaskRecoverySnapshotRepository(input.db, authorization.tasks);
  const events = new AiTaskEventRepository(input.db, authorization.authority, input.clock);
  const unavailable = async () => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); };
  const application = new PrismaTaskApplication({ db: input.db, tasks: authorization.tasks, runner: root.runner, recovery, events,
    host: input.host, prepare, inputs: { submit: unavailable, readPending: unavailable } });
  return Object.freeze({ settings, inputs, ...root, authorization, registrations, transitions, taskTransitions, recovery, events,
    application: Object.freeze({ start: application.start.bind(application), continueConfirmation: application.continueConfirmation.bind(application),
      inspect: application.inspect.bind(application), readEvents: application.readEvents.bind(application), reconcile: application.reconcile.bind(application) }) });
}
