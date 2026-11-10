import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiTaskRepository } from '../ai-task.repository';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from '../ai-task.repository';
import type { PrismaOriginalRequestRepository } from '../task-request/prisma-original-request.repository';
import { freezeOriginalInput, originalRequestReferenceSchema } from '../task-request/original-request.validation';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const select = { id: true, runId: true, actionId: true, status: true, effect: true, revision: true, resultRef: true } satisfies Prisma.AiStepSelect;
export class AiOriginalSceneRecoveryService {
  constructor(private readonly db: Pick<PrismaClient, 'aiStep'>,
    private readonly requests: PrismaOriginalRequestRepository, private readonly tasks: AiTaskRepository,
    private readonly clock: () => Date = () => new Date()) {}
  async read(value: unknown) {
    const parsed = originalRequestReferenceSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const ref = freezeOriginalInput(parsed.data), task = await this.requests.readTaskReceipt(ref.inputRef);
    if (task.state === 'not_observed') return { task, nextAction: 'reconcile_request_or_explicit_create_task' as const, automaticExecution: false as const };
    if (task.status === 'queued' && task.revision === 1 && task.plan === 'not_observed' && !task.resultAvailable) {
      // A newly admitted request has no per-task policies yet. Its original
      // current business/resource authority may expose only this empty metadata
      // view; it does not grant a lease or infer that external work is absent.
      const before = await this.requests.readTaskLocator(ref);
      if (before.material !== 'retained' || before.receipt.state === 'revoked' || before.task.state !== 'observed'
        || requestFingerprint(before.task) !== requestFingerprint(task)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      const access = aiTaskAccessFromContext(before.context, task.taskId, this.clock());
      let existing;
      try {
        existing = await this.db.aiStep.findMany({ where: { taskId: task.taskId, task: { is: access.where } }, take: 1, select: { id: true } });
      } catch { throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE'); }
      const after = await this.requests.readTaskLocator(ref);
      if (after.material !== 'retained' || after.receipt.state === 'revoked' || after.task.state !== 'observed'
        || originalIdentityHash(before.context) !== originalIdentityHash(after.context)
        || requestFingerprint(after.task) !== requestFingerprint(task)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      if (existing.length === 0) return freezeOriginalInput({ task: after.task, steps: [], hasMore: false,
        automaticExecution: false as const, nextAction: 'host_plan_handoff' as const,
        observedResults: 'preserved_even_if_task_cancelled' as const, snapshot: 'bounded_sequential_read' as const });
    }
    const access = await this.tasks.resolveAccess(task.taskId, 'read_metadata');
    let rows;
    try { rows = await this.db.aiStep.findMany({ where: { taskId: task.taskId, task: { is: access.where } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 51, select }); }
    catch { throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE'); }
    const current = await this.tasks.resolveAccess(task.taskId, 'read_metadata');
    if (access.bindingKey !== current.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const latest = await this.requests.readTaskReceipt(ref.inputRef);
    if (latest.state !== 'observed' || latest.taskId !== task.taskId || latest.revision !== task.revision) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    const steps = rows.slice(0, 50).map(row => ({ stepId: row.id, runId: row.runId, actionId: row.actionId, revision: row.revision,
      status: row.status.toLowerCase(), effect: row.effect.toLowerCase(), resultAvailable: row.resultRef !== null,
      nextAction: row.status === 'UNKNOWN' || (row.status === 'RUNNING' && row.effect === 'POSSIBLE')
        ? 'reconcile_original_action' as const : row.status === 'SUCCEEDED' ? 'read_authorized_result' as const : 'runner_owned' as const }));
    return freezeOriginalInput({ task: latest, steps, hasMore: rows.length > 50, automaticExecution: false as const,
      nextAction: task.plan === 'not_observed' ? 'host_plan_handoff' as const : 'existing_runner_recovery' as const,
      observedResults: 'preserved_even_if_task_cancelled' as const, snapshot: 'bounded_sequential_read' as const });
  }
}
