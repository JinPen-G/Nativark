import { Prisma, type PrismaClient } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION } from '@rental-os/shared';
import { AiTaskRepository, AiTaskRepositoryError, type AiTaskRepositoryAuthority } from '../ai-task.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
/** The takeover may have committed; its acknowledgement was not observed. */
export class AiTaskTakeoverCommitUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN' as const;
  readonly retryable = false;
  readonly nextAction = 'read_takeover_receipt' as const;
  constructor() { super('AI_RESULT_UNKNOWN'); }
}
const command = z.object({ taskId: id, runId: id, previousHolderId: id, holderId: id,
  expectedTaskRevision: revision, expectedRunRevision: revision,
  expectedFencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u),
  leaseMs: z.number().int().min(1).max(120000) }).strict();
const receiptCommand = command.pick({ taskId: true, runId: true, expectedTaskRevision: true,
  expectedRunRevision: true, expectedFencingToken: true });
function receiptId(scopeId: string, actorId: string, input: z.infer<typeof receiptCommand>) {
  const hash = requestFingerprint({ version: 'original-run-takeover-1', scopeId, actorId, ...input });
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Same-owner human takeover only. Changes the original run's fencing generation
 * and records an internal audit in the same transaction. It does not change any
 * step/task business state, refund resources, approve actions or issue dispatch.
 * A lost COMMIT reply is ambiguous; retrying the old CAS cannot grant another lease.
 */
export class PrismaTaskTakeoverRepository {
  private readonly access: AiTaskRepository;
  constructor(private readonly db: Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun'> & Partial<Pick<PrismaClient, 'operationLog'>>,
    authority: AiTaskRepositoryAuthority, private readonly clock: () => Date = () => new Date()) {
    this.access = new AiTaskRepository(db, authority, clock);
  }

  async takeover(value: unknown, signal?: AbortSignal) {
    const active = () => { if (signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); };
    active();
    const parsed = command.safeParse(structuredClone(value));
    if (!parsed.success || parsed.data.holderId === parsed.data.previousHolderId
      || BigInt(parsed.data.expectedFencingToken) >= 99999999999999999999n) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const input = parsed.data;
    const initial = await this.access.resolveAccess(input.taskId, 'takeover_run');
    active();
    if (initial.actorKind !== 'USER' || !initial.scope.tenantId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    let callbackCompleted = false, writeAttempted = false;
    try {
      const acknowledgement = await this.db.$transaction(async tx => {
        const found = await tx.aiTask.findFirst({ where: initial.where, select: { id: true, scopeId: true } });
        if (!found) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${found.scopeId} AND id = ${input.taskId} FOR UPDATE`);
        active();
        const task = await tx.aiTask.findFirst({ where: { ...initial.where, scopeId: found.scopeId,
          revision: input.expectedTaskRevision, contractVersion: AI_TASK_DRAFT_VERSION,
          status: { in: ['RUNNING', 'WAITING_INPUT', 'WAITING_CONFIRMATION', 'WAITING_EXTERNAL', 'CANCEL_REQUESTED'] }
        }, select: { id: true } });
        if (!task) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        // A plain post-lock SELECT may still use an older REPEATABLE READ
        // snapshot. A conditional no-op UPDATE verifies the current row without
        // inventing a public task revision/event for a lease-only mutation.
        active();
        writeAttempted = true;
        const lockedTask = await tx.aiTask.updateMany({ where: { ...initial.where, scopeId: found.scopeId,
          revision: input.expectedTaskRevision, contractVersion: AI_TASK_DRAFT_VERSION,
          status: { in: ['RUNNING', 'WAITING_INPUT', 'WAITING_CONFIRMATION', 'WAITING_EXTERNAL', 'CANCEL_REQUESTED'] }
        }, data: { revision: input.expectedTaskRevision } });
        if (lockedTask.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        const current = await this.access.resolveAccess(input.taskId, 'takeover_run');
        if (current.bindingKey !== initial.bindingKey
          || !await tx.aiTask.findFirst({ where: { ...current.where, scopeId: found.scopeId }, select: { id: true } })) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        active();
        const expiresAt = new Date(current.now.getTime() + input.leaseMs);
        const changed = await tx.aiRun.updateMany({ where: { id: input.runId, taskId: input.taskId, scopeId: found.scopeId,
          revision: input.expectedRunRevision, fencingToken: new Prisma.Decimal(input.expectedFencingToken),
          leaseOwnerId: input.previousHolderId, actorKind: current.actorKind, actorId: current.actorId,
          status: { in: ['QUEUED', 'RUNNING'] }
        }, data: { revision: { increment: 1 }, fencingToken: { increment: new Prisma.Decimal(1) },
          leaseOwnerId: input.holderId, leaseExpiresAt: expiresAt, authorizedAt: current.authorizedAt } });
        if (changed.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        active();
        const reference = receiptCommand.parse(Object.fromEntries(Object.keys(receiptCommand.shape).map(key => [key, input[key as keyof typeof input]])));
        await tx.operationLog.create({ data: { id: receiptId(found.scopeId, current.actorId, reference),
          tenantId: initial.scope.tenantId!, workspaceId: initial.scope.workspaceId,
          userId: current.actorId, action: 'ai_task_run_takeover', detail: {
            receiptVersion: 'original-run-takeover-1',
            taskId: input.taskId, runId: input.runId, requestId: current.requestId,
            previousHolderId: input.previousHolderId, holderId: input.holderId,
            previousFencingToken: input.expectedFencingToken, fencingToken: (BigInt(input.expectedFencingToken) + 1n).toString(),
            taskRevision: input.expectedTaskRevision, runRevision: input.expectedRunRevision + 1,
            expiresAt: expiresAt.toISOString(),
            purpose: 'recovery_only'
          } } });
        const final = await this.access.resolveAccess(input.taskId, 'takeover_run');
        if (final.bindingKey !== initial.bindingKey || expiresAt <= final.now) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        active();
        callbackCompleted = true;
        return { taskId: input.taskId, runId: input.runId, holderId: input.holderId,
          revision: input.expectedRunRevision + 1, fencingToken: (BigInt(input.expectedFencingToken) + 1n).toString(),
          expiresAt: expiresAt.toISOString(), purpose: 'recovery_only' as const };
      }, { maxWait: 2500, timeout: 5000 });
      // The committed fencing mutation is not undone by revocation while the
      // commit acknowledgement was in flight. Do not disclose an execution
      // acknowledgement under stale authority, nor label it uncommitted.
      const after = await this.access.resolveAccess(input.taskId, 'takeover_run');
      if (after.bindingKey !== initial.bindingKey || Date.parse(acknowledgement.expiresAt) <= after.now.getTime()) {
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
      return acknowledgement;
    } catch (error) {
      // Classify the commit boundary before trusting an error's public code.
      // Even an apparent CAS/authorization error can be a lost COMMIT reply.
      if (callbackCompleted || writeAttempted && !(error instanceof AiTaskRepositoryError)) {
        throw new AiTaskTakeoverCommitUnknownError();
      }
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
  }

  /** Original generation observation only. A receipt is NOT a new held lease,
   * permission to execute, a refund, or evidence that remote work stopped. */
  async readReceipt(value: unknown) {
    const parsed = receiptCommand.safeParse(structuredClone(value));
    if (!parsed.success || BigInt(parsed.data.expectedFencingToken) >= 99999999999999999999n) {
      throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    }
    if (typeof this.db.operationLog?.findFirst !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    // Historical observation requires current result-read permission, not the
    // authority to fence a worker again. Owner/scope and exact generation still bind.
    const input = parsed.data, before = await this.access.resolveAccess(input.taskId, 'read_step_terminal');
    if (before.actorKind !== 'USER' || !before.scope.tenantId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const task = structuredClone(await this.db.aiTask.findFirst({ where: before.where, select: { id: true, scopeId: true } }));
    if (!task || task.id !== input.taskId) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const auditId = receiptId(task.scopeId, before.actorId, input);
    const where = { id: auditId, tenantId: before.scope.tenantId,
      workspaceId: before.scope.workspaceId ?? null, userId: before.actorId, action: 'ai_task_run_takeover' };
    const row = structuredClone(await this.db.operationLog.findFirst({ where }));
    const run = await this.db.aiRun.findFirst({ where: { id: input.runId, taskId: input.taskId,
      scopeId: task.scopeId, actorKind: before.actorKind, actorId: before.actorId } });
    if (!run || run.id !== input.runId || run.taskId !== input.taskId || run.scopeId !== task.scopeId
      || run.actorKind !== before.actorKind || run.actorId !== before.actorId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const observedRunRevision = run.revision, observedFence = run.fencingToken.toFixed(0);
    if (!/^[1-9][0-9]{0,19}$/u.test(observedFence) || !run.fencingToken.equals(observedFence)) {
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
    const nextFence = (BigInt(input.expectedFencingToken) + 1n).toString();
    if (row) {
      const detail = z.object({ receiptVersion: z.literal('original-run-takeover-1'),
        taskId: id, runId: id, taskRevision: revision, runRevision: revision,
        previousFencingToken: z.string(), fencingToken: z.string(), purpose: z.literal('recovery_only'),
        expiresAt: z.string().datetime({ offset: true }) }).passthrough().safeParse(row.detail);
      if (!detail.success || row.id !== auditId || row.tenantId !== where.tenantId || row.workspaceId !== where.workspaceId
        || row.userId !== where.userId || row.action !== where.action
        || detail.data.taskId !== input.taskId || detail.data.runId !== input.runId
        || detail.data.taskRevision !== input.expectedTaskRevision || detail.data.runRevision !== input.expectedRunRevision + 1
        || detail.data.previousFencingToken !== input.expectedFencingToken || detail.data.fencingToken !== nextFence) {
        throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
      }
    }
    const after = await this.access.resolveAccess(input.taskId, 'read_step_terminal');
    const latest = structuredClone(await this.db.operationLog.findFirst({ where }));
    if (after.bindingKey !== before.bindingKey || !await this.db.aiTask.findFirst({ where: after.where, select: { id: true } })) {
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    if (!isDeepStrictEqual(latest ?? null, row ?? null)) {
      throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    }
    const currentRun = await this.db.aiRun.findFirst({ where: { id: input.runId, taskId: input.taskId,
      scopeId: task.scopeId, actorKind: before.actorKind, actorId: before.actorId } });
    if (!currentRun || currentRun.id !== input.runId || currentRun.scopeId !== task.scopeId || currentRun.taskId !== input.taskId
      || currentRun.actorKind !== before.actorKind || currentRun.actorId !== before.actorId
      || currentRun.revision !== observedRunRevision || !currentRun.fencingToken.equals(observedFence)) {
      throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    }
    if ((await this.access.resolveAccess(input.taskId, 'read_step_terminal')).bindingKey !== before.bindingKey) {
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    return Object.freeze({ taskId: input.taskId, runId: input.runId, status: row ? 'observed' as const : 'not_observed' as const,
      ...(row ? { receiptId: auditId, recordedRunRevision: input.expectedRunRevision + 1, recordedFencingToken: nextFence } : {}),
      currentGeneration: row && observedFence === nextFence ? 'recorded_generation' as const : 'not_attested' as const,
      admission: 'not_granted' as const, automaticRetry: false as const,
      consistency: 'revalidated_reads_not_atomic_snapshot' as const,
      remoteCancellation: 'not_attested' as const, absenceSemantics: 'not_observed_is_not_proof_of_rollback' as const });
  }
}
