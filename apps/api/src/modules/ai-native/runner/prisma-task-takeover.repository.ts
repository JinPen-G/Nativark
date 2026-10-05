import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION } from '@rental-os/shared';
import { AiTaskRepository, AiTaskRepositoryError, type AiTaskRepositoryAuthority } from '../ai-task.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const command = z.object({ taskId: id, runId: id, previousHolderId: id, holderId: id,
  expectedTaskRevision: revision, expectedRunRevision: revision,
  expectedFencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u),
  leaseMs: z.number().int().min(1).max(120000) }).strict();

/** Same-owner human takeover only. Changes the original run's fencing generation
 * and records an internal audit in the same transaction. It does not change any
 * step/task business state, refund resources, approve actions or issue dispatch.
 * A lost COMMIT reply is ambiguous; retrying the old CAS cannot grant another lease.
 */
export class PrismaTaskTakeoverRepository {
  private readonly access: AiTaskRepository;
  constructor(private readonly db: Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun'>,
    authority: AiTaskRepositoryAuthority, private readonly clock: () => Date = () => new Date()) {
    this.access = new AiTaskRepository(db, authority, clock);
  }

  async takeover(value: unknown) {
    const parsed = command.safeParse(value);
    if (!parsed.success || parsed.data.holderId === parsed.data.previousHolderId
      || BigInt(parsed.data.expectedFencingToken) >= 99999999999999999999n) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const input = parsed.data;
    const initial = await this.access.resolveAccess(input.taskId, 'takeover_run');
    if (initial.actorKind !== 'USER' || !initial.scope.tenantId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    try {
      return await this.db.$transaction(async tx => {
        const found = await tx.aiTask.findFirst({ where: initial.where, select: { id: true, scopeId: true } });
        if (!found) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${found.scopeId} AND id = ${input.taskId} FOR UPDATE`);
        const task = await tx.aiTask.findFirst({ where: { ...initial.where, scopeId: found.scopeId,
          revision: input.expectedTaskRevision, contractVersion: AI_TASK_DRAFT_VERSION,
          status: { in: ['RUNNING', 'WAITING_INPUT', 'WAITING_CONFIRMATION', 'WAITING_EXTERNAL', 'CANCEL_REQUESTED'] }
        }, select: { id: true } });
        if (!task) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        const current = await this.access.resolveAccess(input.taskId, 'takeover_run');
        if (current.bindingKey !== initial.bindingKey
          || !await tx.aiTask.findFirst({ where: { ...current.where, scopeId: found.scopeId }, select: { id: true } })) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const expiresAt = new Date(current.now.getTime() + input.leaseMs);
        const changed = await tx.aiRun.updateMany({ where: { id: input.runId, taskId: input.taskId, scopeId: found.scopeId,
          revision: input.expectedRunRevision, fencingToken: new Prisma.Decimal(input.expectedFencingToken),
          leaseOwnerId: input.previousHolderId, actorKind: current.actorKind, actorId: current.actorId,
          status: { in: ['QUEUED', 'RUNNING'] }
        }, data: { revision: { increment: 1 }, fencingToken: { increment: new Prisma.Decimal(1) },
          leaseOwnerId: input.holderId, leaseExpiresAt: expiresAt, authorizedAt: current.authorizedAt } });
        if (changed.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        await tx.operationLog.create({ data: { tenantId: initial.scope.tenantId!, workspaceId: initial.scope.workspaceId,
          userId: current.actorId, action: 'ai_task_run_takeover', detail: {
            taskId: input.taskId, runId: input.runId, requestId: current.requestId,
            previousHolderId: input.previousHolderId, holderId: input.holderId,
            previousFencingToken: input.expectedFencingToken, fencingToken: (BigInt(input.expectedFencingToken) + 1n).toString(),
            taskRevision: input.expectedTaskRevision, runRevision: input.expectedRunRevision + 1,
            purpose: 'recovery_only'
          } } });
        const final = await this.access.resolveAccess(input.taskId, 'takeover_run');
        if (final.bindingKey !== initial.bindingKey || expiresAt <= final.now) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return { taskId: input.taskId, runId: input.runId, holderId: input.holderId,
          revision: input.expectedRunRevision + 1, fencingToken: (BigInt(input.expectedFencingToken) + 1n).toString(),
          expiresAt: expiresAt.toISOString(), purpose: 'recovery_only' as const };
      });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
  }
}
