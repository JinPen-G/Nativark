import { Prisma, type PrismaClient } from '@prisma/client';
import { AiTaskExecutionBudgetError } from '../task-execution-budget.ports';
import { taskStepChargesValid } from './task-model-count-charge';
import type { AiTaskExecutionScopeSource } from './prisma-task-execution-budget.repository';
import type { AiTaskRunnerLease, AiTaskRunnerStepRef } from './ai-task-runner.ports';

/** Reads original receipts only; never reserves resources or issues dispatch.
 * Recovery stays in the original run. Cross-run migration needs a separately
 * authorized contract, not a scope-only lookup or new charge IDs.
 */
export class PrismaTaskResourceRecoverySource {
  constructor(private readonly db: Pick<PrismaClient, 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskExecutionCharge'>,
    private readonly authority: AiTaskExecutionScopeSource, private readonly clock: () => Date = () => new Date()) {
    if (typeof db?.aiTaskExecutionCharge?.findMany !== 'function' || typeof authority?.resolve !== 'function') throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
  }

  async recoverTicket(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease) {
    step = structuredClone(step); lease = structuredClone(lease);
    if (step.registered.runId !== lease.runId) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const before = structuredClone(await this.authority.resolve(lease.taskId, lease, 'write'));
    if (!await this.db.aiTask.findFirst({ where: { AND: [before.taskWhere, { scopeId: before.scopeId }] }, select: { id: true } })) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const runWhere = { scopeId: before.scopeId, taskId: lease.taskId, id: lease.runId, leaseOwnerId: lease.holderId,
      fencingToken: new Prisma.Decimal(lease.fencingToken), revision: lease.revision, leaseExpiresAt: { gt: this.clock() } };
    if (!await this.db.aiRun.findFirst({ where: runWhere, select: { id: true } })) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const stored = await this.db.aiStep.findFirst({ where: { scopeId: before.scopeId, taskId: lease.taskId, id: step.registered.stepId,
      runId: lease.runId, toolCode: step.plan.toolCode, toolVersion: step.plan.toolVersion, revision: step.registered.stepRevision }, select: { actionId: true, requestFingerprint: true, status: true } });
    if (!stored || !['UNKNOWN', 'RUNNING', 'SUCCEEDED', 'FAILED', 'WAITING_INPUT', 'WAITING_CONFIRMATION', 'WAITING_EXTERNAL'].includes(stored.status)) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    const rows = await this.db.aiTaskExecutionCharge.findMany({ where: { scopeId: before.scopeId, taskId: lease.taskId, runId: lease.runId,
      stepId: step.registered.stepId, actionId: stored.actionId, stepFingerprint: stored.requestFingerprint }, orderBy: { chargeId: 'asc' }, take: 6 });
    if (!taskStepChargesValid(rows)
      || rows.some(row => !['RESERVED', 'UNKNOWN', 'RECORDED'].includes(row.status) || row.resource === 'CALLS' && !row.gatewayInvocationId)) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    const after = await this.authority.resolve(lease.taskId, lease, 'write');
    if (after.bindingKey !== before.bindingKey || after.scopeId !== before.scopeId
      || !await this.db.aiRun.findFirst({ where: { ...runWhere, leaseExpiresAt: { gt: this.clock() } }, select: { id: true } })) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    return { chargeIds: rows.map(row => row.chargeId) };
  }
}
