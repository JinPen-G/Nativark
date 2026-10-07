import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, type AiTaskRepository } from '../ai-task.repository';
import { aiTaskRunPlanSchema } from './prisma-task-run-evidence.repository';
import type { AiTaskRunner } from './ai-task-runner.service';
import type { AiTaskRunnerOutcome } from './ai-task-runner.ports';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const requestSchema = z.object({ taskId: id, runId: id }).strict();
const hostSchema = z.object({ holderId: id, leaseMs: z.number().int().min(1).max(120000) }).strict();
export type AiTaskApplicationHost = z.infer<typeof hostSchema>;
export type AiTaskApplicationStartResult =
  | { kind: 'not_started'; reason: 'host_aborted' | 'plan_unavailable' | 'task_not_runnable' | 'lease_held' }
  | { kind: 'run_outcome'; outcome: AiTaskRunnerOutcome };

type Dependencies = {
  db: Pick<PrismaClient, '$transaction'>;
  tasks: Pick<AiTaskRepository, 'resolveAccess'>;
  runner: Pick<AiTaskRunner, 'run'>;
  host: AiTaskApplicationHost;
};

export class PrismaTaskApplication {
  private readonly host: AiTaskApplicationHost;

  constructor(private readonly deps: Dependencies) {
    const host = hostSchema.safeParse(deps?.host);
    if (!host.success || typeof deps?.db?.$transaction !== 'function' || typeof deps?.tasks?.resolveAccess !== 'function'
      || typeof deps?.runner?.run !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    this.host = host.data;
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
