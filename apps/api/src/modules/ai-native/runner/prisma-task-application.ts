import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_ERROR_CODES, isAiTaskInputSubmissionDraft, type AiErrorCode } from '@rental-os/shared';
import type { AiTaskEventRepository } from '../ai-task-event.repository';
import type { PrismaTaskInputRepository } from '../task-input/prisma-task-input.repository';
import type { AiTaskRecoverySnapshotSource } from './task-recovery-snapshot.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, type AiTaskRepository } from '../ai-task.repository';
import { aiTaskRunPlanSchema } from './prisma-task-run-evidence.repository';
import type { AiTaskRunner, AiTaskRunnerError } from './ai-task-runner.service';
import type { AiTaskRunnerOutcome } from './ai-task-runner.ports';

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
export type AiTaskApplicationResumeResult = {
  receipt: Awaited<ReturnType<PrismaTaskInputRepository['submit']>>;
  continuation: AiTaskApplicationStartResult | { kind: 'not_started'; reason: 'receipt_replayed' } | { kind: 'unavailable'; errorCode: ContinuationErrorCode };
};

type Dependencies = {
  db: Pick<PrismaClient, '$transaction'>;
  tasks: Pick<AiTaskRepository, 'resolveAccess'>;
  runner: Pick<AiTaskRunner, 'run' | 'recover'>;
  inputs: Pick<PrismaTaskInputRepository, 'submit' | 'readPending'>;
  recovery: AiTaskRecoverySnapshotSource;
  events: Pick<AiTaskEventRepository, 'readPage'>;
  host: AiTaskApplicationHost;
};

export class PrismaTaskApplication {
  private readonly host: AiTaskApplicationHost;

  constructor(private readonly deps: Dependencies) {
    const host = hostSchema.safeParse(deps?.host);
    if (!host.success || typeof deps?.db?.$transaction !== 'function' || typeof deps?.tasks?.resolveAccess !== 'function'
      || typeof deps?.runner?.run !== 'function' || typeof deps?.runner?.recover !== 'function'
      || typeof deps?.inputs?.submit !== 'function' || typeof deps?.inputs?.readPending !== 'function'
      || typeof deps?.recovery?.read !== 'function' || typeof deps?.events?.readPage !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    this.host = host.data;
  }

  inspect(value: unknown) { return this.deps.recovery.read(value); }

  readEvents(value: unknown) { return this.deps.events.readPage(value); }

  readInput(value: unknown) {
    const parsed = requestSchema.pick({ taskId: true }).safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return this.deps.inputs.readPending(parsed.data.taskId);
  }

  // Host abort suppresses continuation, not the explicitly submitted answer.
  async resume(value: unknown, signal?: AbortSignal): Promise<AiTaskApplicationResumeResult> {
    const submission = structuredClone(value);
    if (!isAiTaskInputSubmissionDraft(submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const before = structuredClone(await this.deps.tasks.resolveAccess(submission.taskId, 'read_metadata'));
    const receipt = await this.deps.inputs.submit(submission);
    const verifyReader = async () => {
      const current = await this.deps.tasks.resolveAccess(submission.taskId, 'read_metadata');
      if (current.bindingKey !== before.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    };
    await verifyReader();
    if (receipt.replayed) return { receipt, continuation: { kind: 'not_started', reason: 'receipt_replayed' } };
    if (signal?.aborted) return { receipt, continuation: { kind: 'not_started', reason: 'host_aborted' } };
    let continuation: AiTaskApplicationResumeResult['continuation'];
    try {
      const runId = await this.deps.db.$transaction(async tx => {
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
        return id.parse(request.runId);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
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
    const input = parsed.data, before = structuredClone(await this.deps.tasks.resolveAccess(input.taskId, 'claim_recovery_run'));
    let lease;
    try {
      lease = await this.deps.db.$transaction(async tx => {
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
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
    const current = await this.deps.tasks.resolveAccess(input.taskId, 'claim_recovery_run');
    if (current.bindingKey !== before.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    if (!lease) return { kind: 'not_started', reason: 'recovery_lease_unavailable' };
    return { kind: 'run_outcome', outcome: await this.deps.runner.recover(lease, signal) };
  }

  async start(value: unknown, signal?: AbortSignal): Promise<AiTaskApplicationStartResult> {
    const parsed = requestSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' };
    const input = parsed.data, before = structuredClone(await this.deps.tasks.resolveAccess(input.taskId, 'claim_run'));
    let candidate;
    try {
      candidate = await this.deps.db.$transaction(async tx => {
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
        if (!saved) return { kind: 'not_started', reason: 'plan_unavailable' } as const;
        const plan = aiTaskRunPlanSchema.parse(saved.payload);
        if (saved.scopeId !== key.scopeId || saved.taskId !== key.taskId || saved.runId !== key.runId
          || plan.taskId !== key.taskId || plan.runId !== key.runId || requestFingerprint(plan) !== saved.planHash) {
          throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        }
        if (!plan.steps.length) return { kind: 'not_started', reason: 'plan_unavailable' } as const;
        const fencingToken = run.fencingToken.toFixed(0);
        if (!/^(0|[1-9][0-9]{0,19})$/u.test(fencingToken) || !run.fencingToken.equals(fencingToken)) {
          throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        }
        return { kind: 'candidate', claim: { ...input, ...this.host, expectedTaskRevision: revision.parse(task.revision),
          expectedRunRevision: revision.parse(run.revision), expectedFencingToken: fencingToken } } as const;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
    const current = await this.deps.tasks.resolveAccess(input.taskId, 'claim_run');
    if (current.bindingKey !== before.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    if (signal?.aborted) return { kind: 'not_started', reason: 'host_aborted' };
    if (candidate.kind === 'not_started') return candidate;
    // The read is not a lease: the original runner still claims with current authorization and CAS.
    return { kind: 'run_outcome', outcome: await this.deps.runner.run(candidate.claim, signal) };
  }
}
