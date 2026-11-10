import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_ERROR_CODES, isAiTaskInputSubmissionDraft, isAiTaskInputSavedReceiptDraft,
  type AiErrorCode, type AiTaskInputSavedReceiptDraft } from '@rental-os/shared';
import type { AiTaskEventRepository } from '../ai-task-event.repository';
import type { PrismaTaskInputRepository } from '../task-input/prisma-task-input.repository';
import type { AiTaskRecoverySnapshotSource } from './task-recovery-snapshot.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, type AiTaskRepository } from '../ai-task.repository';
import { aiTaskRunPlanSchema } from './prisma-task-run-evidence.repository';
import { AiTaskRunnerError, callAiTaskRunnerDependency, type AiTaskRunner, type AiTaskHeldPreparation } from './ai-task-runner.service';
import type { AiTaskRunnerClock, AiTaskRunnerOutcome } from './ai-task-runner.ports';
import { taskExecutionPhaseStore } from './task-execution-phase.store';
import { waitingPayloadSchema } from './prisma-task-confirmation-checkpoint.source';
import { PrismaTaskConfirmationHistoryReader } from './prisma-task-confirmation-history.reader';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const requestSchema = z.object({ taskId: id, runId: id }).strict();
const hostSchema = z.object({ holderId: id, leaseMs: z.number().int().min(1).max(120000) }).strict();
export type AiTaskApplicationHost = z.infer<typeof hostSchema>;
export type AiTaskApplicationStartResult =
  | { kind: 'not_started'; reason: 'host_aborted' | 'plan_unavailable' | 'task_not_runnable' | 'lease_held' | 'recovery_lease_unavailable' }
  | { kind: 'run_outcome'; outcome: AiTaskRunnerOutcome };
type ContinuationErrorCode = AiErrorCode | AiTaskRepositoryError['code'] | AiTaskRunnerError['code'];
const continuationErrorCodes: readonly ContinuationErrorCode[] = [...AI_ERROR_CODES, 'AI_RESOURCE_UNAVAILABLE', 'AI_REVISION_CONFLICT', 'AI_STORAGE_UNAVAILABLE', 'AI_RUN_LIMIT'];
/** A committed answer reply must name the exact submitted task/question. Take
 * an owned snapshot before any later authorization await can mutate it. */
export function snapshotAiTaskInputSavedReceipt(value: unknown, expected: { taskId: string; requestId: string }): AiTaskInputSavedReceiptDraft {
  try {
    const receipt = structuredClone(value);
    if (isAiTaskInputSavedReceiptDraft(receipt) && receipt.taskId === expected.taskId && receipt.requestId === expected.requestId) return receipt;
  } catch { /* A reply failure does not prove that the answer was not saved. */ }
  throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
}
export type AiTaskApplicationResumeResult = {
  receipt: Awaited<ReturnType<PrismaTaskInputRepository['submit']>>;
  continuation: AiTaskApplicationStartResult | { kind: 'not_started'; reason: 'receipt_replayed' } | { kind: 'unavailable'; errorCode: ContinuationErrorCode };
};

type Dependencies = {
  db: Pick<PrismaClient, '$transaction'>;
  tasks: Pick<AiTaskRepository, 'resolveAccess'>;
  runner: Pick<AiTaskRunner, 'run' | 'recover'> & Partial<Pick<AiTaskRunner, 'runPrepared' | 'continueConfirmation' | 'continuePending'>>;
  prepare?: AiTaskHeldPreparation;
  inputs: Pick<PrismaTaskInputRepository, 'submit' | 'readPending'>;
  recovery: AiTaskRecoverySnapshotSource;
  events: Pick<AiTaskEventRepository, 'readPage'>;
  host: AiTaskApplicationHost;
  clock?: AiTaskRunnerClock;
};

/** Bound application preflight too, not just the runner it eventually calls.
 * A write timeout is unknown; a late read cannot proceed into a new dispatch. */
export async function waitForTaskApplicationDependency<T>(operation: () => Promise<T>, write: boolean, signal?: AbortSignal, clock?: AiTaskRunnerClock): Promise<T> {
  try { return await callAiTaskRunnerDependency(operation, 5000, 'task_application', signal, clock); }
  catch (error) {
    if (error instanceof AiTaskRunnerError && (error.code === 'AI_RESULT_UNKNOWN' || error.code === 'AI_RUN_LIMIT')) {
      if (write) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
    throw error;
  }
}

export class PrismaTaskApplication {
  private readonly host: AiTaskApplicationHost;
  private readonly prepare?: AiTaskHeldPreparation;

  constructor(private readonly deps: Dependencies) {
    const host = hostSchema.safeParse(deps?.host);
    if (!host.success || typeof deps?.db?.$transaction !== 'function' || typeof deps?.tasks?.resolveAccess !== 'function'
      || typeof deps?.runner?.run !== 'function' || typeof deps?.runner?.recover !== 'function'
      || typeof deps?.inputs?.submit !== 'function' || typeof deps?.inputs?.readPending !== 'function'
      || typeof deps?.recovery?.read !== 'function' || typeof deps?.events?.readPage !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    this.host = host.data;
    if (deps.prepare !== undefined && (typeof deps.prepare !== 'function' || typeof deps.runner.runPrepared !== 'function')) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    this.prepare = deps.prepare;
  }

  private wait<T>(operation: () => Promise<T>, write = false, signal?: AbortSignal) {
    return waitForTaskApplicationDependency(operation, write, signal, this.deps.clock);
  }

  inspect(value: unknown) { return this.wait(() => this.deps.recovery.read(value)); }

  readEvents(value: unknown) { return this.wait(() => this.deps.events.readPage(value)); }

  /** Read-only discovery of the original durable wait. This grants neither a
   * lease nor approval; continuation still validates the full original proof. */
  readConfirmation(value: unknown) {
    return PrismaTaskApplication.readConfirmation(this.deps, value);
  }

  readConfirmationHistory(value: unknown) {
    return PrismaTaskApplication.readConfirmationHistory(this.deps, value);
  }

  /** Original receipts remain observations, not a replacement for the live
   * checkpoint/approval checks required by continueConfirmation. */
  static readConfirmationHistory(dependencies: Pick<Dependencies, 'db' | 'tasks' | 'clock'>, value: unknown) {
    const command = structuredClone(value);
    return waitForTaskApplicationDependency(
      () => new PrismaTaskConfirmationHistoryReader(dependencies.db, dependencies.tasks).read(command),
      false, undefined, dependencies.clock);
  }

  /** The same durable wait reader without constructing an execution host. */
  static async readConfirmation(dependencies: Pick<Dependencies, 'db' | 'tasks' | 'clock'>, value: unknown) {
    const parsed = requestSchema.extend({ stepId: id.max(36) }).safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const input = parsed.data;
    const read = <T>(operation: () => Promise<T>) => waitForTaskApplicationDependency(operation, false, undefined, dependencies.clock);
    const before = structuredClone(await read(() => dependencies.tasks.resolveAccess(input.taskId, 'read_step_terminal')));
    const result = await read(() => dependencies.db.$transaction(async tx => {
      const task = await tx.aiTask.findFirst({ where: before.where });
      if (!task || task.id !== input.taskId || task.contractVersion !== AI_TASK_DRAFT_VERSION
        || task.status !== 'WAITING_CONFIRMATION' || task.cancelRequestedAt !== null) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const key = { scopeId: task.scopeId, taskId: task.id, runId: input.runId, stepId: input.stepId };
      const run = await tx.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId } });
      const step = await tx.aiStep.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, runId: key.runId, id: key.stepId } });
      if (!run || run.id !== key.runId || run.scopeId !== key.scopeId || run.taskId !== key.taskId
        || run.actorKind !== before.actorKind || run.actorId !== before.actorId || run.status !== 'RUNNING'
        || !step || step.id !== key.stepId || step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== key.runId
        || step.status !== 'RUNNING' || step.effect !== 'POSSIBLE') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const store = taskExecutionPhaseStore(tx);
      const receipts = await store.readReceipts(key);
      if (receipts.length !== 1 || receipts[0].kind !== 'confirmation') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const receipt = receipts[0], payload = waitingPayloadSchema.parse(receipt.payload);
      const phase = await store.readStart({ ...key, id: receipt.phaseId });
      if (!phase || phase.sequence !== 1 || phase.scopeId !== key.scopeId || phase.taskId !== key.taskId
        || phase.runId !== key.runId || phase.stepId !== key.stepId || phase.id !== receipt.phaseId
        || receipt.scopeId !== key.scopeId || receipt.taskId !== key.taskId || receipt.runId !== key.runId || receipt.stepId !== key.stepId
        || payload.binding.scopeId !== key.scopeId || payload.binding.taskId !== key.taskId || payload.binding.runId !== key.runId
        || payload.binding.stepId !== key.stepId || payload.binding.inputRef !== step.inputRef || payload.binding.inputRef !== phase.inputRef
        || payload.binding.actionId !== phase.actionId || payload.binding.fingerprint !== phase.stepFingerprint
        || payload.proposal.proposalId !== receipt.proposalId || payload.proposal.proposalRevision !== receipt.proposalRevision
        || payload.proposal.reviewedPayloadHash !== receipt.reviewedPayloadHash
        || requestFingerprint(receipt.payload) !== receipt.contentHash
        || BigInt(Buffer.byteLength(JSON.stringify(receipt.payload), 'utf8')) !== receipt.outputBytes) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return { ...input, taskRevision: revision.parse(task.revision), checkpointRef: receipt.id,
        proposal: structuredClone(payload.proposal), execution: 'not_attested' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 }));
    const after = await read(() => dependencies.tasks.resolveAccess(input.taskId, 'read_step_terminal'));
    if (after.bindingKey !== before.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const current = await read(() => dependencies.db.$transaction(tx => tx.aiTask.findFirst({ where: after.where,
      select: { id: true, revision: true, status: true, cancelRequestedAt: true } })));
    if (!current || current.id !== input.taskId || current.revision !== result.taskRevision
      || current.status !== 'WAITING_CONFIRMATION' || current.cancelRequestedAt !== null) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    const final = await read(() => dependencies.tasks.resolveAccess(input.taskId, 'read_step_terminal'));
    if (final.bindingKey !== before.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return result;
  }

  readInput(value: unknown) {
    const parsed = requestSchema.pick({ taskId: true }).safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return this.wait(() => this.deps.inputs.readPending(parsed.data.taskId));
  }

  // Host abort suppresses continuation, not the explicitly submitted answer.
  async resume(value: unknown, signal?: AbortSignal): Promise<AiTaskApplicationResumeResult> {
    const submission = structuredClone(value);
    if (!isAiTaskInputSubmissionDraft(submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const before = structuredClone(await this.wait(() => this.deps.tasks.resolveAccess(submission.taskId, 'read_metadata')));
    const receipt = snapshotAiTaskInputSavedReceipt(await this.wait(() => this.deps.inputs.submit(submission), true), submission);
    // The answer may already be committed. An invalid/cross-task reply cannot
    // authorize continuation or be treated as an unsubmitted answer to retry.
    const verifyReader = async () => {
      const current = await this.wait(() => this.deps.tasks.resolveAccess(submission.taskId, 'read_metadata'), true);
      if (current.bindingKey !== before.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    };
    await verifyReader();
    if (receipt.replayed) return { receipt, continuation: { kind: 'not_started', reason: 'receipt_replayed' } };
    if (signal?.aborted) return { receipt, continuation: { kind: 'not_started', reason: 'host_aborted' } };
    let continuation: AiTaskApplicationResumeResult['continuation'];
    try {
      const runId = await this.wait(() => this.deps.db.$transaction(async tx => {
        const task = await tx.aiTask.findFirst({ where: before.where, select: { id: true, scopeId: true } });
        if (!task || task.id !== submission.taskId) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const key = { scopeId: task.scopeId, taskId: task.id };
        const saved = await tx.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_id: { ...key, id: receipt.receiptId } },
          select: { scopeId: true, taskId: true, id: true, requestId: true, consumedTaskRevision: true } });
        const request = await tx.aiTaskInputRequest.findUnique({ where: { scopeId_taskId_id: { ...key, id: receipt.requestId } },
          select: { scopeId: true, taskId: true, id: true, runId: true, status: true } });
        if (!saved || !request || saved.scopeId !== key.scopeId || saved.taskId !== key.taskId || saved.id !== receipt.receiptId
          || saved.requestId !== receipt.requestId || saved.consumedTaskRevision !== receipt.taskRevision
          || request.scopeId !== key.scopeId || request.taskId !== key.taskId || request.id !== receipt.requestId || request.status !== 'CONSUMED') {
          throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        }
        const successor = await tx.aiRun.findUnique({ where: { scopeId_taskId_inputReceiptId: { ...key, inputReceiptId: saved.id } },
          select: { id: true, scopeId: true, taskId: true, inputReceiptId: true, actorKind: true, actorId: true } });
        if (successor && (successor.scopeId !== key.scopeId || successor.taskId !== key.taskId || successor.inputReceiptId !== saved.id
          || successor.actorKind !== before.actorKind || successor.actorId !== before.actorId)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return id.parse(successor?.id ?? request.runId);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 }), false, signal);
      await verifyReader();
      continuation = await this.start({ taskId: receipt.taskId, runId }, signal);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      continuation = { kind: 'unavailable', errorCode: continuationErrorCodes.includes(code as ContinuationErrorCode) ? code as ContinuationErrorCode : 'AI_STORAGE_UNAVAILABLE' };
    }
    // Submission is durable even when execution cannot start; revoked readers still receive no buffered receipt.
    await verifyReader();
    return { receipt, continuation };
  }

  async reconcile(value: unknown, signal?: AbortSignal): Promise<AiTaskApplicationStartResult> {
    const parsed = requestSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' };
    const input = parsed.data, before = structuredClone(await this.wait(() => this.deps.tasks.resolveAccess(input.taskId, 'claim_recovery_run'), false, signal));
    let lease;
    try {
      lease = await this.wait(() => this.deps.db.$transaction(async tx => {
        const task = await tx.aiTask.findFirst({ where: before.where, select: { id: true, scopeId: true } });
        if (!task || task.id !== input.taskId) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const run = await tx.aiRun.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, id: input.runId },
          select: { id: true, scopeId: true, taskId: true, revision: true, fencingToken: true, leaseOwnerId: true, leaseExpiresAt: true } });
        if (!run || run.id !== input.runId || run.taskId !== task.id || run.scopeId !== task.scopeId) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        if (run.leaseOwnerId !== this.host.holderId || !run.leaseExpiresAt || run.leaseExpiresAt <= before.now) return null;
        const fencingToken = run.fencingToken.toFixed(0);
        if (!/^[1-9][0-9]{0,19}$/u.test(fencingToken) || !run.fencingToken.equals(fencingToken)) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        return { ...input, holderId: this.host.holderId, revision: revision.parse(run.revision), fencingToken,
          expiresAt: run.leaseExpiresAt.toISOString(), purpose: 'recovery_only' as const };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 }), false, signal);
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
    const current = await this.wait(() => this.deps.tasks.resolveAccess(input.taskId, 'claim_recovery_run'), false, signal);
    if (current.bindingKey !== before.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' };
    if (!lease) return { kind: 'not_started', reason: 'recovery_lease_unavailable' };
    return { kind: 'run_outcome', outcome: await this.deps.runner.recover(lease, signal) };
  }

  async continueConfirmation(value: unknown, signal?: AbortSignal): Promise<AiTaskApplicationStartResult | { kind: 'not_started'; reason: 'confirmation_lease_unavailable' }> {
    const parsed = requestSchema.extend({ checkpointRef: id.max(36) }).safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' };
    if (typeof this.deps.runner.continueConfirmation !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const input = parsed.data, before = structuredClone(await this.wait(() => this.deps.tasks.resolveAccess(input.taskId, 'transition_task'), false, signal));
    const candidate = await this.wait(() => this.deps.db.$transaction(async tx => {
      const task = await tx.aiTask.findFirst({ where: before.where });
      if (!task || task.id !== input.taskId || task.contractVersion !== AI_TASK_DRAFT_VERSION) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      if (task.status !== 'WAITING_CONFIRMATION' || task.cancelRequestedAt !== null) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const run = await tx.aiRun.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, id: input.runId } });
      if (!run || run.id !== input.runId || run.scopeId !== task.scopeId || run.taskId !== task.id) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      if (run.leaseOwnerId !== this.host.holderId || !run.leaseExpiresAt || run.leaseExpiresAt <= before.now) return null;
      if (run.actorKind !== before.actorKind || run.actorId !== before.actorId || run.status !== 'RUNNING') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const receipt = await taskExecutionPhaseStore(tx).readReceipt({ scopeId: task.scopeId, taskId: task.id, runId: input.runId, id: input.checkpointRef });
      if (!receipt || receipt.kind !== 'confirmation' || receipt.scopeId !== task.scopeId || receipt.taskId !== task.id
        || receipt.runId !== input.runId || receipt.id !== input.checkpointRef) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const step = await tx.aiStep.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, runId: input.runId, id: receipt.stepId } });
      if (!step || step.id !== receipt.stepId || step.scopeId !== task.scopeId || step.taskId !== task.id || step.runId !== input.runId
        || step.status !== 'RUNNING' || step.effect !== 'POSSIBLE') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const fencingToken = run.fencingToken.toFixed(0);
      if (!/^[1-9][0-9]{0,19}$/u.test(fencingToken) || !run.fencingToken.equals(fencingToken)) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
      return { taskId: task.id, stepId: step.id, expectedTaskRevision: revision.parse(task.revision),
        expectedStepRevision: revision.parse(step.revision), checkpointRef: receipt.id,
        lease: { taskId: task.id, runId: run.id, holderId: this.host.holderId, revision: revision.parse(run.revision), fencingToken, expiresAt: run.leaseExpiresAt.toISOString() } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 }), false, signal);
    const current = await this.wait(() => this.deps.tasks.resolveAccess(input.taskId, 'transition_task'), false, signal);
    if (current.bindingKey !== before.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' };
    if (!candidate) return { kind: 'not_started', reason: 'confirmation_lease_unavailable' };
    return { kind: 'run_outcome', outcome: await this.deps.runner.continueConfirmation(candidate, signal) };
  }

  async start(value: unknown, signal?: AbortSignal): Promise<AiTaskApplicationStartResult> {
    const parsed = requestSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' };
    let candidate;
    try { candidate = await this.startCandidate(parsed.data, signal); }
    catch (error) {
      // Preflight is observation only. After delegation the same error cannot
      // be reported as not_started: the runner may already own durable work.
      if (signal?.aborted && error instanceof AiTaskRepositoryError && error.code === 'AI_RESOURCE_UNAVAILABLE') {
        return { kind: 'not_started', reason: 'host_aborted' };
      }
      throw error;
    }
    if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' };
    if (candidate.kind === 'not_started') return candidate;
    // Only this explicit start command selects PENDING continuation from a
    // server-read original identity. Ordinary workers and reconcile do not.
    return { kind: 'run_outcome', outcome: candidate.pendingStart && typeof this.deps.runner.continuePending === 'function'
      ? await this.deps.runner.continuePending(candidate.claim, signal, this.prepare)
      : this.prepare ? await this.deps.runner.runPrepared!(candidate.claim, this.prepare, signal)
        : await this.deps.runner.run(candidate.claim, signal) };
  }

  private async startCandidate(input: z.infer<typeof requestSchema>, signal?: AbortSignal) {
    const before = structuredClone(await this.wait(() => this.deps.tasks.resolveAccess(input.taskId, 'claim_run'), false, signal));
    let candidate;
    try {
      candidate = await this.wait(() => this.deps.db.$transaction(async tx => {
        const task = await tx.aiTask.findFirst({ where: before.where,
          select: { id: true, scopeId: true, revision: true, status: true, cancelRequestedAt: true, contractVersion: true } });
        if (!task) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        if (task.id !== input.taskId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        if (task.contractVersion !== AI_TASK_DRAFT_VERSION) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const key = { scopeId: task.scopeId, taskId: task.id, runId: input.runId };
        const run = await tx.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId },
          select: { id: true, scopeId: true, taskId: true, revision: true, fencingToken: true, status: true, leaseOwnerId: true, leaseExpiresAt: true } });
        if (!run) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        if (run.id !== key.runId || run.taskId !== key.taskId || run.scopeId !== key.scopeId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        if (!['QUEUED', 'RUNNING'].includes(task.status) || task.cancelRequestedAt !== null || !['QUEUED', 'RUNNING'].includes(run.status)) {
          return { kind: 'not_started', reason: 'task_not_runnable' } as const;
        }
        if ((run.leaseOwnerId === null) !== (run.leaseExpiresAt === null)) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        if (run.leaseOwnerId !== null && run.leaseExpiresAt! > before.now) return { kind: 'not_started', reason: 'lease_held' } as const;
        const saved = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key },
          select: { scopeId: true, taskId: true, runId: true, planHash: true, payload: true } });
        if (!saved && !this.prepare) return { kind: 'not_started', reason: 'plan_unavailable' } as const;
        let pendingStart = false;
        if (saved) {
        const plan = aiTaskRunPlanSchema.parse(saved.payload);
        if (saved.scopeId !== key.scopeId || saved.taskId !== key.taskId || saved.runId !== key.runId
          || plan.taskId !== key.taskId || plan.runId !== key.runId || requestFingerprint(plan) !== saved.planHash) {
          throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        }
        if (!plan.steps.length) return { kind: 'not_started', reason: 'plan_unavailable' } as const;
        const steps = await tx.aiStep.findMany({ where: key, take: 2 });
        pendingStart = task.status === 'RUNNING' && steps.length === 1 && steps[0].status === 'PENDING'
          && steps[0].effect === 'NONE' && steps[0].resultRef === null;
        }
        const fencingToken = run.fencingToken.toFixed(0);
        if (!/^(0|[1-9][0-9]{0,19})$/u.test(fencingToken) || !run.fencingToken.equals(fencingToken)) {
          throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        }
        return { kind: 'candidate', pendingStart, claim: { ...input, ...this.host, expectedTaskRevision: revision.parse(task.revision),
          expectedRunRevision: revision.parse(run.revision), expectedFencingToken: fencingToken } } as const;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 }), false, signal);
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
    const current = await this.wait(() => this.deps.tasks.resolveAccess(input.taskId, 'claim_run'), false, signal);
    if (current.bindingKey !== before.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' } as const;
    // The read is not a lease: the original runner still claims with current authorization and CAS.
    return candidate;
  }
}
