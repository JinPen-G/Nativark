import type { PrismaClient } from '@prisma/client';
import type { AiTaskStatusDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskExecutionBudgetError, type AiTaskExecutionResource, type AiTaskExecutionBudgetPort, type AiTaskExecutionChargeRequest } from '../task-execution-budget.ports';
import { taskStepChargesValid, isTaskModelCountCharge, reconcileTaskModelCountCharge } from './task-model-count-charge';
import type { AiTaskExecutionScopeSource } from './prisma-task-execution-budget.repository';
import type { AiTaskRunnerLease, AiTaskRunnerStepRef, AiTaskRunnerResourceTicket } from './ai-task-runner.ports';
import type { AiTaskRunnerResourceEvidenceSource } from './persistent-task-runner-resource-gate';
import type { PrismaTaskRunEvidenceRepository } from './prisma-task-run-evidence.repository';
import { PrismaTaskResourceRecoverySource } from './prisma-task-resource-recovery.source';

export interface AiTaskToolResourceCatalog {
  /** Closed server registry; absence is unavailable, not a non-model default. */
  resolve(toolCode: string, toolVersion: string): Promise<{ modelCall: boolean } | null>;
}
export interface AiTaskModelInvocationPreparation {
  /** Registers the server-owned invocation after step start; never sends it. */
  prepare(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, signal?: AbortSignal): Promise<{ invocationId: string }>;
  /** Undefined means no extra counting call was needed; generation's own
   * persisted CALLS charge and financial admission are still mandatory. */
  beforeDispatch?(request: AiTaskExecutionChargeRequest, budget: AiTaskExecutionBudgetPort, signal?: AbortSignal): Promise<string | undefined>;
}
const fail = () => new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
const uuid = (hash: string) => `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;

/** Plans and result refs come from scoped persistence. No model-selected charge
 * amount, fabricated invocation or callback-created evidence is accepted here.
 */
export class PrismaTaskRunnerResourceSource implements AiTaskRunnerResourceEvidenceSource {
  private readonly recovery: PrismaTaskResourceRecoverySource;
  constructor(private readonly db: Pick<PrismaClient, 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskExecutionCharge' | 'aiTaskExecutionBudget' | 'aiGatewayInvocation'>,
    private readonly scopes: AiTaskExecutionScopeSource, private readonly plans: Pick<PrismaTaskRunEvidenceRepository, 'resolve'>,
    private readonly catalog: AiTaskToolResourceCatalog, private readonly clock: () => Date = () => new Date(),
    private readonly invocations?: AiTaskModelInvocationPreparation) {
    if (typeof plans?.resolve !== 'function' || typeof catalog?.resolve !== 'function') throw fail();
    this.recovery = new PrismaTaskResourceRecoverySource(db, scopes, clock);
  }
  async recoverTicket(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, budget?: AiTaskExecutionBudgetPort) {
    const ticket = await this.recovery.recoverTicket(step, lease);
    if (budget) {
      const access = await this.scopes.resolve(lease.taskId, lease, 'write');
      const stored = await this.db.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId,
        runId: lease.runId, id: step.registered.stepId }, select: { id: true, actionId: true, requestFingerprint: true } });
      const rows = await this.db.aiTaskExecutionCharge.findMany({ where: { scopeId: access.scopeId, taskId: lease.taskId,
        runId: lease.runId, stepId: step.registered.stepId }, take: 6 });
      if (!stored || !taskStepChargesValid(rows) || rows.length !== ticket.chargeIds.length
        || rows.some(row => row.scopeId !== access.scopeId || row.taskId !== lease.taskId || row.runId !== lease.runId
          || row.stepId !== stored.id || row.actionId !== stored.actionId
          || row.stepFingerprint !== stored.requestFingerprint || !ticket.chargeIds.includes(row.chargeId))) throw fail();
      for (const count of rows.filter(isTaskModelCountCharge)) {
        // Count may have finished before generation ever started. Read its own
        // original receipt without requiring a completed generation artifact.
        // Unavailable/unknown evidence keeps the charge held, never re-counts.
        try { await reconcileTaskModelCountCharge(budget, lease, count); }
        catch (error) {
          if (!(error instanceof Error && 'code' in error
            && ['AI_RESOURCE_UNAVAILABLE', 'AI_RESULT_UNKNOWN', 'UNAVAILABLE', 'PENDING_RECONCILIATION'].includes(String(error.code)))) throw error;
        }
      }
    }
    return ticket;
  }

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
    if (descriptor.modelCall && typeof this.invocations?.prepare !== 'function') throw fail();
    const budget = await this.db.aiTaskExecutionBudget.findUnique({ where: { scopeId_taskId: { scopeId: access.scopeId, taskId: lease.taskId } } });
    if (!budget || budget.scopeId !== access.scopeId || budget.taskId !== lease.taskId
      || budget.consumedOutputBytes < 0n || budget.reservedOutputBytes < 0n) throw fail();
    const current = await this.scopes.resolve(lease.taskId, lease, 'write');
    if (access.bindingKey !== current.bindingKey || access.scopeId !== current.scopeId) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const bounds = [
      [budget.maxSteps, budget.consumedSteps, budget.reservedSteps, BigInt(plan.limits.maxSteps)],
      [budget.maxActiveMs, budget.consumedActiveMs, budget.reservedActiveMs, BigInt(plan.limits.maxTotalMs)],
      [budget.maxOutputBytes, budget.consumedOutputBytes, budget.reservedOutputBytes, BigInt(plan.limits.maxOutputBytes)],
      [budget.maxCalls, budget.consumedCalls, budget.reservedCalls, BigInt(plan.limits.maxCalls)]
    ];
    if (bounds.some(([maximum, consumed, reserved, expected]) => typeof maximum !== 'bigint' || typeof consumed !== 'bigint'
      || typeof reserved !== 'bigint' || maximum !== expected || maximum <= 0n || consumed < 0n || reserved < 0n
      || consumed + reserved > maximum)) throw fail();
    const outputAllowance = budget.maxOutputBytes - budget.consumedOutputBytes - budget.reservedOutputBytes;
    // Stop from the original cumulative snapshot before creating any new charge.
    // Atomic reserve remains authoritative if another mutation wins after this
    // observation; its uncertain/partial writes are not reclassified here.
    if (budget.consumedSteps + budget.reservedSteps + 1n > budget.maxSteps
      || budget.consumedActiveMs + budget.reservedActiveMs + BigInt(plan.limits.maxStepMs) > budget.maxActiveMs
      || outputAllowance <= 0n
      || descriptor.modelCall && budget.consumedCalls + budget.reservedCalls + 1n > budget.maxCalls) {
      throw new AiTaskExecutionBudgetError('AI_RUN_LIMIT');
    }
    const resources: AiTaskExecutionResource[] = ['steps', 'active_ms', 'output_bytes'];
    return { modelCall: descriptor.modelCall, ...(descriptor.modelCall ? { deferredModelCall: true as const } : {}), requests: resources.map(resource => ({ taskId: lease.taskId, lease: structuredClone(lease), resource,
      chargeId: uuid(requestFingerprint({ scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId: stored.id, actionId: stored.actionId, fingerprint: stored.requestFingerprint, resource })),
      amount: resource === 'active_ms' ? BigInt(plan.limits.maxStepMs) : resource === 'output_bytes' ? outputAllowance : 1n,
      target: { kind: 'step' as const, stepId: stored.id, actionId: stored.actionId, stepFingerprint: stored.requestFingerprint } })) };
  }

  async modelCharge(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, signal?: AbortSignal) {
    step = structuredClone(step); lease = structuredClone(lease);
    if (!this.invocations) throw fail();
    const access = structuredClone(await this.scopes.resolve(lease.taskId, lease, 'write'));
    const stored = await this.db.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId,
      id: step.registered.stepId, revision: step.registered.stepRevision, status: 'RUNNING', toolCode: step.plan.toolCode, toolVersion: step.plan.toolVersion } });
    if (!stored || (await this.catalog.resolve(step.plan.toolCode, step.plan.toolVersion))?.modelCall !== true) throw fail();
    if (signal?.aborted) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
    const prepared = structuredClone(await this.invocations.prepare(step, lease, signal));
    if (signal?.aborted) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
    const invocation = await this.db.aiGatewayInvocation.findFirst({ where: { id: prepared.invocationId, scopeId: access.scopeId, taskId: lease.taskId,
      runId: lease.runId, stepId: stored.id, actionId: stored.actionId, stepFingerprint: stored.requestFingerprint,
      leaseOwnerId: lease.holderId, fencingToken: lease.fencingToken, expiresAt: { gt: this.clock() } } });
    const current = await this.scopes.resolve(lease.taskId, lease, 'write');
    if (!invocation || access.bindingKey !== current.bindingKey || access.scopeId !== current.scopeId) throw fail();
    return { taskId: lease.taskId, lease: structuredClone(lease), resource: 'calls' as const, amount: 1n,
      chargeId: uuid(requestFingerprint({ scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId: stored.id,
        actionId: stored.actionId, fingerprint: stored.requestFingerprint, resource: 'calls' })),
      target: { kind: 'step' as const, stepId: stored.id, actionId: stored.actionId, stepFingerprint: stored.requestFingerprint, gatewayInvocationId: invocation.id } };
  }

  async prepareModelDispatch(request: AiTaskExecutionChargeRequest, budget: AiTaskExecutionBudgetPort, signal?: AbortSignal) {
    const charge = await this.invocations?.beforeDispatch?.(request, budget, signal);
    return charge === undefined ? [] : [charge];
  }

  async settlements(ticket: AiTaskRunnerResourceTicket, step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease) {
    ticket = structuredClone(ticket); step = structuredClone(step); lease = structuredClone(lease);
    const access = await this.scopes.resolve(lease.taskId, lease, 'write');
    const stored = await this.db.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: step.registered.stepId,
      toolCode: step.plan.toolCode, toolVersion: step.plan.toolVersion, status: { in: ['SUCCEEDED', 'FAILED'] } } });
    if (!stored?.resultRef) throw fail();
    const rows = await this.db.aiTaskExecutionCharge.findMany({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId,
      stepId: stored.id, actionId: stored.actionId, stepFingerprint: stored.requestFingerprint }, take: 6 });
    if (rows.length !== ticket.chargeIds.length || !taskStepChargesValid(rows)
      || rows.some(row => !ticket.chargeIds.includes(row.chargeId))) throw fail();
    const current = await this.scopes.resolve(lease.taskId, lease, 'write');
    if (current.bindingKey !== access.bindingKey || current.scopeId !== access.scopeId) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    return rows.map(row => ({ taskId: lease.taskId, lease: structuredClone(lease), chargeId: row.chargeId, evidenceRef: isTaskModelCountCharge(row) ? `count:${row.gatewayInvocationId}` : `${stored.resultRef}:${row.resource.toLowerCase()}` }));
  }
}
