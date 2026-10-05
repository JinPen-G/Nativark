import type { PrismaClient } from '@prisma/client';
import type { AiTaskStatusDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskExecutionBudgetError, type AiTaskExecutionResource } from '../task-execution-budget.ports';
import type { AiTaskExecutionScopeSource } from './prisma-task-execution-budget.repository';
import type { AiTaskRunnerLease, AiTaskRunnerStepRef, AiTaskRunnerResourceTicket } from './ai-task-runner.ports';
import type { AiTaskRunnerResourceEvidenceSource } from './persistent-task-runner-resource-gate';
import type { PrismaTaskRunEvidenceRepository } from './prisma-task-run-evidence.repository';
import { PrismaTaskResourceRecoverySource } from './prisma-task-resource-recovery.source';

export interface AiTaskToolResourceCatalog {
  /** Closed server registry; absence is unavailable, not a non-model default. */
  resolve(toolCode: string, toolVersion: string): Promise<{ modelCall: boolean } | null>;
}
const fail = () => new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
const uuid = (hash: string) => `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;

/** Plans and result refs come from scoped persistence. No model-selected charge
 * amount, fabricated invocation or callback-created evidence is accepted here.
 */
export class PrismaTaskRunnerResourceSource implements AiTaskRunnerResourceEvidenceSource {
  private readonly recovery: PrismaTaskResourceRecoverySource;
  constructor(private readonly db: Pick<PrismaClient, 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskExecutionCharge' | 'aiGatewayInvocation'>,
    private readonly scopes: AiTaskExecutionScopeSource, private readonly plans: Pick<PrismaTaskRunEvidenceRepository, 'resolve'>,
    private readonly catalog: AiTaskToolResourceCatalog, private readonly clock: () => Date = () => new Date()) {
    if (typeof plans?.resolve !== 'function' || typeof catalog?.resolve !== 'function') throw fail();
    this.recovery = new PrismaTaskResourceRecoverySource(db, scopes, clock);
  }
  recoverTicket(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease) { return this.recovery.recoverTicket(step, lease); }

  async charges(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease) {
    step = structuredClone(step); lease = structuredClone(lease);
    const access = structuredClone(await this.scopes.resolve(lease.taskId, lease, 'write'));
    const task = await this.db.aiTask.findFirst({ where: { AND: [access.taskWhere, { scopeId: access.scopeId }] } });
    if (!task) throw fail();
    const plan = await this.plans.resolve({ taskId: task.id, revision: task.revision, status: task.status.toLowerCase() as AiTaskStatusDraft,
      cancelRequestedAt: task.cancelRequestedAt?.toISOString() ?? null }, lease, false);
    const planned = plan.steps.find(row => row.registrationRef === step.plan.registrationRef);
    if (!planned || requestFingerprint(planned) !== requestFingerprint(step.plan) || task.cancelRequestedAt !== null) throw fail();
    const stored = await this.db.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: step.registered.stepId,
      toolCode: planned.toolCode, toolVersion: planned.toolVersion, revision: step.registered.stepRevision, status: 'PENDING' } });
    if (!stored) throw fail();
    const descriptor = structuredClone(await this.catalog.resolve(planned.toolCode, planned.toolVersion));
    if (!descriptor || typeof descriptor.modelCall !== 'boolean') throw fail();
    const invocation = descriptor.modelCall ? await this.db.aiGatewayInvocation.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId,
      runId: lease.runId, stepId: stored.id, actionId: stored.actionId, stepFingerprint: stored.requestFingerprint,
      leaseOwnerId: lease.holderId, fencingToken: lease.fencingToken, expiresAt: { gt: this.clock() } } }) : null;
    if (descriptor.modelCall && !invocation) throw fail();
    const current = await this.scopes.resolve(lease.taskId, lease, 'write');
    if (access.bindingKey !== current.bindingKey || access.scopeId !== current.scopeId) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const resources: AiTaskExecutionResource[] = descriptor.modelCall ? ['steps', 'active_ms', 'output_bytes', 'calls'] : ['steps', 'active_ms', 'output_bytes'];
    return { modelCall: descriptor.modelCall, requests: resources.map(resource => ({ taskId: lease.taskId, lease: structuredClone(lease), resource,
      chargeId: uuid(requestFingerprint({ scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId: stored.id, actionId: stored.actionId, fingerprint: stored.requestFingerprint, resource })),
      amount: resource === 'active_ms' ? BigInt(plan.limits.maxStepMs) : resource === 'output_bytes' ? BigInt(plan.limits.maxOutputBytes) : 1n,
      target: { kind: 'step' as const, stepId: stored.id, actionId: stored.actionId, stepFingerprint: stored.requestFingerprint,
        ...(invocation ? { gatewayInvocationId: invocation.id } : {}) } })) };
  }

  async settlements(ticket: AiTaskRunnerResourceTicket, step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease) {
    ticket = structuredClone(ticket); step = structuredClone(step); lease = structuredClone(lease);
    const access = await this.scopes.resolve(lease.taskId, lease, 'write');
    const stored = await this.db.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: step.registered.stepId,
      toolCode: step.plan.toolCode, toolVersion: step.plan.toolVersion, status: { in: ['SUCCEEDED', 'FAILED'] } } });
    if (!stored?.resultRef) throw fail();
    const rows = await this.db.aiTaskExecutionCharge.findMany({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId,
      stepId: stored.id, actionId: stored.actionId, stepFingerprint: stored.requestFingerprint }, take: 5 });
    if (rows.length !== ticket.chargeIds.length || rows.length < 3 || rows.length > 4
      || rows.some(row => !ticket.chargeIds.includes(row.chargeId))) throw fail();
    const current = await this.scopes.resolve(lease.taskId, lease, 'write');
    if (current.bindingKey !== access.bindingKey || current.scopeId !== access.scopeId) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    return rows.map(row => ({ taskId: lease.taskId, lease: structuredClone(lease), chargeId: row.chargeId, evidenceRef: `${stored.resultRef}:${row.resource.toLowerCase()}` }));
  }
}
