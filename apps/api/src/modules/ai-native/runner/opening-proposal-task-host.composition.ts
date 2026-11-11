/** Original bounded R1 partition host: real plan/input/Step/resource/result
 * repositories and the normal runner, not another execution driver. The input
 * is checked Core material; only AiProposal metadata is written. No model,
 * provider, policy seed, business draft or publication is installed here. */
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { AiOriginalSceneDependencies } from '../scenes/original-scenes.composition';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiStepRegistrationRepository } from '../ai-step-registration.repository';
import { AiStepTransitionRepository } from '../ai-step-transition.repository';
import { AiTaskTransitionRepository } from '../ai-task-transition.repository';
import { composePersistedTaskAuthorization } from '../task-authorization.composition';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiGuardedOpeningConfigurationSource } from '../tools/opening-configuration.source';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { AiOpeningSectionDifferenceService, verifyOpeningSectionMaterial, openingSectionFromMaterial } from '../tools/opening-section-difference.service';
import { AiOpeningVersionFieldSource } from '../tools/opening-version-fields.source';
import { AiOpeningSectionProposalService, AiOpeningProposalUnknownError } from '../tools/opening-section-proposal.service';
import { PrismaTaskPlanInputSource } from './prisma-task-plan-input.source';
import { aiTaskRunnerLimitsSchema } from './prisma-task-run-evidence.repository';
import { OpeningProposalStepAuthority } from './opening-proposal-step.authority';
import { createAiTaskRunnerOutcomePort } from './ai-task-runner-outcome-adapter';
import { composePersistentTaskRunner } from './persistent-task-runner.composition';
import { PrismaTaskApplication, type AiTaskApplicationHost } from './prisma-task-application';
import { PrismaTaskRecoverySnapshotRepository } from './prisma-task-recovery-snapshot.repository';
import { AiTaskEventRepository } from '../ai-task-event.repository';
import { withAiTaskHeldPreparationDefinition, type AiTaskHeldPreparation } from './ai-task-runner.service';
import type { AiTaskRunnerRepositoryCommandFactory } from './ai-task-runner.repository-adapter';

export function composeOpeningProposalTaskHost(input: AiOriginalSceneDependencies & {
  host: AiTaskApplicationHost; scene: { code: string; version: string }; revalidateOriginal: () => Promise<void>;
  task: { taskId: string; runId: string; material: ReturnType<typeof verifyOpeningSectionMaterial>;
    /** Closed server batch; never appended to an already-frozen plan. */
    materials?: readonly ReturnType<typeof verifyOpeningSectionMaterial>[];
    limits: z.infer<typeof aiTaskRunnerLimitsSchema>; expiresAt: string }; monotonic?: () => number;
  /** Fixed by the calendar server composition, never by an input DTO. */
  calendarOnly?: boolean;
}) {
  const task = structuredClone(input.task), host = Object.freeze(structuredClone(input.host));
  task.material = verifyOpeningSectionMaterial(task.material); task.limits = aiTaskRunnerLimitsSchema.parse(task.limits);
  const materials = (task.materials ?? [task.material]).map(verifyOpeningSectionMaterial);
  if (!materials.length || materials.length > 4 || materials.length > task.limits.maxSteps
    || materials.some(material => material.status !== 'difference_ready')
    || new Set(materials.map(material => material.key)).size !== materials.length
    || materials[0].materialHash !== task.material.materialHash) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const allowedMaterials = new Set(materials.map(material => material.materialHash));
  if (input.calendarOnly && materials.some(material => material.key !== 'business_calendar'))
    throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const clock = input.clock ?? (() => new Date()), authorization = composePersistedTaskAuthorization(input);
  const routes = new AiBusinessReadRouteAuthority(input.guard, input.credentials, clock);
  const differences = new AiOpeningSectionDifferenceService(new AiGuardedOpeningConfigurationSource(input.core, routes), routes, clock,
    new AiOpeningVersionFieldSource(input.db, routes), input.calendarOnly === true);
  const proposals = new AiOpeningSectionProposalService({ ...input, holderId: host.holderId }, differences, input.calendarOnly === true);
  const source = new PrismaTaskPlanInputSource(input.db, authorization.authority, authorization.execution, clock,
    'tenant.config.propose', undefined, undefined, undefined, undefined, { verify: async (context, material, taskId) => {
      await input.revalidateOriginal();
      if (taskId !== task.taskId || material.status !== 'difference_ready' || !allowedMaterials.has(material.materialHash))
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const section = openingSectionFromMaterial(material);
      if ((await differences.prepare(section, context)).materialHash !== material.materialHash)
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      await input.revalidateOriginal();
      return { expiresAt: task.expiresAt };
    } });
  const registrationRef = `opening-section:${task.material.key}:${task.material.materialHash}`;
  const steps = materials.map(material => ({ registrationRef: `opening-section:${material.key}:${material.materialHash}`,
    toolCode: 'tenant.config.propose', toolVersion: AI_TOOL_DRAFT_VERSION, operation: 'idempotent' as const }));
  const commands: AiTaskRunnerRepositoryCommandFactory = {
    register: async (plan, lease) => ({ taskId: lease.taskId, registrationRef: plan.registrationRef,
      expectedTaskRevision: (await authorization.tasks.readMetadata(lease.taskId)).revision,
      lease: { runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } }),
    transition: (kind, step, lease, resultRef) => {
      if (kind === 'pause' || kind !== 'start' && !resultRef) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return { taskId: lease.taskId, stepId: step.registered.stepId, expectedTaskRevision: step.registered.taskRevision,
        expectedStepRevision: step.registered.stepRevision, evidenceId: kind === 'start' ? `start-${step.registered.stepId}` : resultRef!,
        reason: kind === 'start' ? 'start' : kind === 'unknown' ? 'result_unknown' : 'result_observed',
        lease: { runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } };
    }
  };
  const registrations = new AiStepRegistrationRepository(input.db, source, clock, undefined,
    { resolve: command => authorization.authority.resolve(command.taskId, 'read_step_terminal') });
  const transitions = new AiStepTransitionRepository(input.db, new OpeningProposalStepAuthority(input.db, authorization.authority, source, clock), clock);
  const taskTransitions = new AiTaskTransitionRepository(input.db, authorization.authority, clock);
  const taskOutcome = createAiTaskRunnerOutcomePort({ transitions: taskTransitions, tasks: authorization.tasks, commands: { transition: command => command } });
  const root = composePersistentTaskRunner({ db: input.db, tasks: authorization.tasks, registrations, replays: registrations,
    transitions, taskOutcome, executionAuthorization: authorization.execution, planAuthority: source, commands,
    toolCatalog: { resolve: async (code, version) => code === 'tenant.config.propose' && version === AI_TOOL_DRAFT_VERSION ? { modelCall: false } : null },
    executors: { resolve: async (code, version) => code !== 'tenant.config.propose' || version !== AI_TOOL_DRAFT_VERSION ? null : {
      operation: 'idempotent' as const, execute: async (command, signal) => {
        await input.revalidateOriginal();
        const { clarifications: _clarifications, ...binding } = command;
        try {
          const payload = await proposals.executePreparedInput(binding, signal);
          await input.revalidateOriginal();
          return { kind: 'succeeded' as const, payload };
        } catch (error) {
          if (error instanceof AiOpeningProposalUnknownError) return { kind: 'unknown' as const, payload: {
            state: 'unknown', reference: error.reference, retryable: false, nextAction: error.nextAction } };
          throw error;
        }
      }
    } }, wall: clock, monotonic: input.monotonic });
  const prepare: AiTaskHeldPreparation = async ({ lease, taskRevision, signal }) => {
    if (signal?.aborted || lease.taskId !== task.taskId || lease.runId !== task.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    await input.revalidateOriginal();
    for (const [index, material] of materials.entries()) {
      if (signal?.aborted) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      await source.publishOpeningProposalInput({ taskId: task.taskId, registrationRef: steps[index].registrationRef,
        expectedTaskRevision: taskRevision, lease, input: material });
    }
    if (signal?.aborted) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    await root.evidence.savePlan({ taskId: task.taskId, runId: task.runId, taskRevision, steps, limits: task.limits }, lease);
    await input.revalidateOriginal();
  };
  withAiTaskHeldPreparationDefinition(prepare, { taskId: task.taskId, runId: task.runId, steps, limits: task.limits,
    bindingHash: requestFingerprint(task.materials ? { ...task, materialHashes: materials.map(material => material.materialHash) }
      : { ...task, materialHash: task.material.materialHash }) });
  const unavailable = async () => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); };
  const application = new PrismaTaskApplication({ db: input.db, tasks: authorization.tasks, runner: root.runner, host, prepare,
    recovery: new PrismaTaskRecoverySnapshotRepository(input.db, authorization.tasks),
    events: new AiTaskEventRepository(input.db, authorization.authority, clock), inputs: { submit: unavailable, readPending: unavailable } });
  return Object.freeze({ ...root, source, proposals, authorization, registrationRef, registrationRefs: steps.map(step => step.registrationRef), application });
}
