import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiTaskRepository } from '../ai-task.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { PrismaOriginalRequestRepository } from '../task-request/prisma-original-request.repository';
import { freezeOriginalInput, originalRequestReferenceSchema } from '../task-request/original-request.validation';

const select = { id: true, runId: true, actionId: true, status: true, effect: true, revision: true, resultRef: true } satisfies Prisma.AiStepSelect;
export class AiOriginalSceneRecoveryService {
  constructor(private readonly db: Pick<PrismaClient, 'aiStep'>,
    private readonly requests: PrismaOriginalRequestRepository, private readonly tasks: AiTaskRepository) {}
  async read(value: unknown) {
    const parsed = originalRequestReferenceSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const ref = freezeOriginalInput(parsed.data), task = await this.requests.readTaskReceipt(ref.inputRef);
    if (task.state === 'not_observed') return { task, nextAction: 'reconcile_request_or_explicit_create_task' as const, automaticExecution: false as const };
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
