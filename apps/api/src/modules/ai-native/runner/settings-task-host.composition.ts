import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION, AI_TASK_TERMINAL_STATUSES_DRAFT } from '@rental-os/shared';
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
import { AiTaskRunnerError, callAiTaskRunnerDependency, snapshotAiTaskRunnerRecoveryLease, withAiTaskHeldPreparationDefinition, type AiTaskHeldPreparation } from './ai-task-runner.service';
import type { AiTaskRunnerClock, AiTaskRunnerLease } from './ai-task-runner.ports';
import type { AiTaskRunnerRepositoryCommandFactory } from './ai-task-runner.repository-adapter';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const tool = 'tenant.notifications.commit' as const;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const taskSchema = z.object({ taskId: id.max(36), runId: id.max(36), registrationRef: id,
  change: z.object({ changeId: id.max(36), changeHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
  limits: aiTaskRunnerLimitsSchema }).strict();
export type AiSettingsTask = z.infer<typeof taskSchema>;

/** Explicit normal-run settings assembly. It shares the durable runner,
 * resource ledger and confirmation checkpoint machinery with order execution;
 * the selected tool and receipt version are server-owned, never model inputs. */
export function composeTaskSettingsHost(input: ApprovedSettingsApplicationDependencies & {
  host: AiTaskApplicationHost; task: AiSettingsTask; monotonic?: () => number; runnerClock?: AiTaskRunnerClock;
}) {
  const task = taskSchema.parse(structuredClone(input.task));
  const host = Object.freeze(structuredClone(input.host));
  if (host.holderId !== input.holderId) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
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
  withAiTaskHeldPreparationDefinition(prepare, { taskId: task.taskId, runId: task.runId,
    steps: [{ registrationRef: task.registrationRef, operation: 'idempotent', toolCode: tool, toolVersion: AI_TOOL_DRAFT_VERSION }],
    limits: task.limits, bindingHash: requestFingerprint(task) });
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
    host, prepare, clock: input.runnerClock, inputs: { submit: unavailable, readPending: unavailable } });
  const bounded = async <T>(operation: (signal: AbortSignal) => Promise<T>, write: boolean, limitMs = 5000, parent?: AbortSignal) => {
    try { return await callAiTaskRunnerDependency(operation, limitMs, 'settings_recovery', parent, input.runnerClock); }
    catch (error) {
      if (error instanceof AiTaskRunnerError && (error.code === 'AI_RUN_LIMIT' || error.code === 'AI_RESULT_UNKNOWN')) {
        if (write && error.code === 'AI_RESULT_UNKNOWN') throw error;
        if (write) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      }
      throw error;
    }
  };
  const recoverOriginal = async (value: unknown, confirmation: boolean, signal?: AbortSignal) => {
    const wait = <T>(operation: (signal: AbortSignal) => Promise<T>, write: boolean, limitMs = 5000, parent = signal) =>
      bounded(operation, write, limitMs, parent);
    const read = <T>(operation: () => Promise<T>) => wait(operation, false);
    const keySchema = z.object({ taskId: id.max(36), runId: id.max(36) }).strict();
    const parsed = (confirmation ? keySchema.extend({ checkpointRef: id.max(36) }).strict() : keySchema).safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = parsed.data;
    if (command.taskId !== task.taskId || command.runId !== task.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' } as const;
    const before = structuredClone(await read(() => authorization.tasks.resolveAccess(task.taskId, confirmation ? 'claim_recovery_run' : 'read_metadata')));
    const stored = structuredClone(await read(() => input.db.aiTask.findFirst({ where: before.where })));
    const foundRun = stored && await read(() => input.db.aiRun.findFirst({ where: { id: task.runId, taskId: task.taskId, scopeId: stored.scopeId } }));
    // Preserve Decimal exactly before the next await; structuredClone alone
    // does not retain Prisma.Decimal methods, and shared row objects can move.
    const run = foundRun && Object.freeze({ id: foundRun.id, taskId: foundRun.taskId, scopeId: foundRun.scopeId,
      actorKind: foundRun.actorKind, actorId: foundRun.actorId, revision: foundRun.revision,
      fencingToken: foundRun.fencingToken.toFixed(0) });
    if (!stored || stored.id !== task.taskId || !run || run.id !== task.runId || run.taskId !== task.taskId
      || run.scopeId !== stored.scopeId || run.actorKind !== before.actorKind || run.actorId !== before.actorId
      || before.scope.kind !== 'WORKSPACE' || !before.scope.tenantId || !before.scope.workspaceId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const tenantId = before.scope.tenantId, workspaceId = before.scope.workspaceId;
    // Terminal recovery is observation, not reacquisition. A committed Core
    // receipt remains a fact even if the aggregate ultimately failed/cancelled.
    // Missing receipts never attest rollback or authorize another execution.
    const change = !confirmation ? await read(() => input.db.rentalApprovedSettingsChange.findFirst({ where: {
      id: task.change.changeId, changeHash: task.change.changeHash, tenantId,
      workspaceId, actorId: before.actorId }, select: { expiresAt: true } })) : null;
    const expired = change?.expiresAt instanceof Date && change.expiresAt.getTime() <= (input.clock?.() ?? new Date()).getTime();
    // Expired input permits original observation only, never another recovery claim.
    if (!confirmation && (expired || AI_TASK_TERMINAL_STATUSES_DRAFT.some(status => status === stored.status.toLowerCase()))) {
      const key = { taskId: task.taskId, runId: task.runId };
      const snapshot = await read(() => application.inspect(key));
      const receipt = await read(() => settings.readCommittedChange({ taskId: task.taskId, ...task.change }));
      const latest = await read(() => application.inspect(key));
      const after = await read(() => authorization.tasks.resolveAccess(task.taskId, 'read_metadata'));
      if (after.bindingKey !== before.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      if (requestFingerprint(snapshot) !== requestFingerprint(latest)
        || snapshot.task.revision !== stored.revision || snapshot.run.revision !== run.revision) {
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      }
      return { mode: 'read_only' as const, snapshot,
        operation: receipt ? { state: 'committed' as const, receipt } : null,
        businessOutcome: receipt ? 'committed' as const
          : snapshot.steps.some(step => step.status === 'unknown' || step.effect === 'possible' || step.effect === 'committed')
            ? 'unknown' as const : 'not_observed' as const,
        retryable: false as const, execution: 'original_result_read_no_restart' as const };
    }
    if (confirmation && 'checkpointRef' in command && typeof command.checkpointRef === 'string') {
      const checkpointRef = command.checkpointRef;
      const receipt = await read(() => input.db.aiTaskExecutionPhaseReceipt.findFirst({ where: { scopeId: stored.scopeId,
        taskId: task.taskId, runId: task.runId, id: checkpointRef, kind: 'confirmation' } }));
      if (!receipt) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const checkpoint = await read(() => application.readConfirmation({ taskId: task.taskId, runId: task.runId, stepId: receipt.stepId }));
      if (checkpoint.checkpointRef !== command.checkpointRef) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      const decision = await read(() => settings.application.readDecisionReceipt({ draftVersion: 'ain-approved-settings-draft-1',
        taskId: task.taskId, proposalId: checkpoint.proposal.proposalId, proposalRevision: checkpoint.proposal.proposalRevision,
        reviewedPayloadHash: checkpoint.proposal.reviewedPayloadHash }));
      if (decision.state !== 'recorded') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
    const current = await read(() => authorization.tasks.resolveAccess(task.taskId, 'claim_recovery_run'));
    if (before.bindingKey !== current.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' } as const;
    // Claim acknowledgement is required. A lost response never grants a lease
    // by rereading it; original-key recovery remains a separate request.
    const claim = Object.freeze({ taskId: task.taskId, runId: task.runId,
      holderId: host.holderId, leaseMs: host.leaseMs, expectedTaskRevision: stored.revision,
      expectedRunRevision: run.revision, expectedFencingToken: run.fencingToken });
    const received = await wait(() => authorization.tasks.claimRecoveryRun({ ...claim }), true).catch(error => {
      // The repository may have committed the claim before losing its reply.
      // Storage failure cannot authorize rereading the held lease or releasing it.
      if (error instanceof AiTaskRepositoryError && error.code === 'AI_STORAGE_UNAVAILABLE') {
        throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      }
      throw error;
    });
    let lease: AiTaskRunnerLease & { purpose: 'recovery_only' };
    try {
      lease = snapshotAiTaskRunnerRecoveryLease(claim, received);
    } catch {
      throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
    }
    let cleanupSafe = true, failed = false;
    try {
      if ((await read(() => authorization.tasks.resolveAccess(task.taskId, 'claim_recovery_run'))).bindingKey !== before.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' } as const;
      // Pure application/runner reads retain this host's cleanup ownership.
      // Its synchronous server hook runs inside the runner's try/finally;
      // an uncertain write never returns ownership by inspecting a current row.
      const acceptLease = () => { cleanupSafe = false; };
      const result = await wait(child => confirmation && 'checkpointRef' in command && typeof command.checkpointRef === 'string'
        ? application.continueConfirmation({ taskId: task.taskId, runId: task.runId, checkpointRef: command.checkpointRef }, child, acceptLease)
        : application.reconcile({ taskId: task.taskId, runId: task.runId }, child, acceptLease), true,
      Math.min(120000, task.limits.maxTotalMs + 10000));
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (cleanupSafe) {
        try {
          // Cleanup has its own finite wait, independent of the cancelled host.
          // It may release only this acknowledged, never-delegated lease.
          await wait(async child => {
            const held = await input.db.aiRun.findFirst({ where: { id: task.runId, taskId: task.taskId, scopeId: stored.scopeId,
              leaseOwnerId: host.holderId, revision: lease.revision, fencingToken: new Prisma.Decimal(lease.fencingToken) } });
            if (child.aborted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
            if (held) {
              const latest = structuredClone(await authorization.tasks.readMetadata(task.taskId));
              if (child.aborted || latest.taskId !== task.taskId) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
              const release = { taskId: task.taskId, runId: task.runId, holderId: host.holderId,
                expectedTaskRevision: latest.revision, expectedRunRevision: lease.revision, expectedFencingToken: lease.fencingToken };
              const receipt = structuredClone(await authorization.tasks.releaseRun(structuredClone(release)));
              if (child.aborted || !receipt || receipt.released !== true || receipt.revision !== release.expectedRunRevision + 1) {
                throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'settings recovery cleanup requires original receipt');
              }
            }
          }, true, 5000, new AbortController().signal);
        } catch {
          if (!failed) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        }
      }
    }
  };
  const requestCancel = async (value: unknown, signal?: AbortSignal) => {
    const parsed = z.object({ taskId: id.max(36), expectedRevision: z.number().int().min(1).max(4294967294) }).strict().safeParse(structuredClone(value));
    if (!parsed.success || parsed.data.taskId !== task.taskId) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const before = structuredClone(await bounded(() => authorization.tasks.resolveAccess(task.taskId, 'read_metadata'), false, 5000, signal));
    const receipt = await bounded(() => taskTransitions.transition({ ...parsed.data, to: 'cancel_requested', reason: 'cancel_requested' }), true, 5000, signal);
    // Failure to observe after a write must not imply the cancellation was absent.
    const after = await bounded(() => authorization.tasks.resolveAccess(task.taskId, 'read_metadata'), true, 5000, signal);
    if (after.bindingKey !== before.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return { receipt, cancellation: 'requested_not_rollback' as const };
  };
  const requestCancelOriginal = async (value: unknown, signal?: AbortSignal) => {
    // Persist the authorized intent first. Only an acknowledged request may
    // attempt original-run reconciliation; no new step or external dispatch.
    const initial = structuredClone(await bounded(() => authorization.tasks.resolveAccess(task.taskId, 'read_metadata'), false, 5000, signal));
    const result = await requestCancel(value, signal);
    let reconciliation;
    try { reconciliation = await recoverOriginal({ taskId: task.taskId, runId: task.runId }, false, signal); }
    catch (error) {
      if (!(error instanceof AiTaskRepositoryError) || error.code === 'AI_ACCESS_DENIED' || error.code === 'AI_INVALID_INPUT') throw error;
      reconciliation = { kind: 'unavailable' as const, errorCode: error.code,
        nextAction: 'read_original_task' as const, retryable: false as const };
    }
    if ((await bounded(() => authorization.tasks.resolveAccess(task.taskId, 'read_metadata'), true, 5000, signal)).bindingKey !== initial.bindingKey) {
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    return { ...result, reconciliation };
  };
  return Object.freeze({ settings, inputs, ...root, authorization, registrations, transitions, taskTransitions, recovery, events,
    application: Object.freeze({ start: application.start.bind(application), continueConfirmation: application.continueConfirmation.bind(application),
      readConfirmation: application.readConfirmation.bind(application),
      readConfirmationHistory: application.readConfirmationHistory.bind(application),
      inspect: application.inspect.bind(application), readEvents: application.readEvents.bind(application), reconcile: application.reconcile.bind(application),
      continueOriginalConfirmation: (value: unknown, signal?: AbortSignal) => recoverOriginal(value, true, signal),
      reconcileOriginal: (value: unknown, signal?: AbortSignal) => recoverOriginal(value, false, signal),
      requestCancel, requestCancelOriginal }) });
}
