import type { PrismaClient } from '@prisma/client';
import type { AiTaskRepository } from '../ai-task.repository';
import { AiTaskExecutionBudgetError, type AiTaskExecutionLease } from '../task-execution-budget.ports';
import type { AiTaskExecutionScopeSource } from './prisma-task-execution-budget.repository';

/** Reuses the existing owner/audience/scope resolver, not caller-supplied scope.
 * resolveAccess must itself be wired to current credentials by the composition
 * root. This adapter does not invent an AI route or authorize an unknown action.
 */
export class PrismaTaskExecutionScopeAuthority implements AiTaskExecutionScopeSource {
  constructor(private readonly tasks: Pick<AiTaskRepository, 'resolveAccess'>,
    private readonly db: Pick<PrismaClient, 'aiTask'>) {
    if (typeof tasks?.resolveAccess !== 'function' || typeof db?.aiTask?.findFirst !== 'function') throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
  }

  async resolve(taskId: string, lease: AiTaskExecutionLease, operation: 'read' | 'write') {
    if (lease?.taskId !== taskId || !['read', 'write'].includes(operation)) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const action = operation === 'read' ? 'read_metadata' : 'transition_task';
    const access = await this.tasks.resolveAccess(taskId, action);
    const row = await this.db.aiTask.findFirst({ where: access.where, select: { scopeId: true } });
    if (!row) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const current = await this.tasks.resolveAccess(taskId, action);
    if (current.bindingKey !== access.bindingKey) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    return { scopeId: row.scopeId, bindingKey: current.bindingKey, taskWhere: structuredClone(current.where) };
  }
}
