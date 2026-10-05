import { Prisma, type PrismaClient } from '@prisma/client';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import {
  AiTaskExecutionBudgetError, type AiTaskExecutionBudgetPort, type AiTaskExecutionBudgetSnapshot,
  type AiTaskExecutionChargeEvidence, type AiTaskExecutionChargeReceipt, type AiTaskExecutionChargeRequest,
  type AiTaskExecutionCounters, type AiTaskExecutionLease,
  type AiTaskExecutionPolicy, type AiTaskExecutionResource, type AiTaskExecutionSettlementRequest, type AiTaskExecutionEvidenceSource,
} from '../task-execution-budget.ports';

type Db = PrismaClient;
type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export interface AiTaskExecutionScopeSource {
  resolve(taskId: string, lease: AiTaskExecutionLease): Promise<{ scopeId: string }>;
}

const resources: Record<AiTaskExecutionResource, { max: string; reserved: string; consumed: string; enum: string }> = {
  steps: { max: 'maxSteps', reserved: 'reservedSteps', consumed: 'consumedSteps', enum: 'STEPS' },
  calls: { max: 'maxCalls', reserved: 'reservedCalls', consumed: 'consumedCalls', enum: 'CALLS' },
  active_ms: { max: 'maxActiveMs', reserved: 'reservedActiveMs', consumed: 'consumedActiveMs', enum: 'ACTIVE_MS' },
  output_bytes: { max: 'maxOutputBytes', reserved: 'reservedOutputBytes', consumed: 'consumedOutputBytes', enum: 'OUTPUT_BYTES' },
};
const id = (value: unknown, max = 191): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
const positive = (value: unknown): value is bigint => typeof value === 'bigint' && value > 0n;
const maxCounter = (1n << 64n) - 1n;
const counter = (value: unknown): value is bigint => typeof value === 'bigint' && value >= 0n && value <= maxCounter;
const copyCounters = (row: Record<string, unknown>, prefix: 'reserved' | 'consumed'): AiTaskExecutionCounters => ({
  steps: BigInt(row[`${prefix}Steps`] as bigint), calls: BigInt(row[`${prefix}Calls`] as bigint),
  active_ms: BigInt(row[`${prefix}ActiveMs`] as bigint), output_bytes: BigInt(row[`${prefix}OutputBytes`] as bigint),
});
function validateLease(taskId: string, lease: AiTaskExecutionLease) {
  if (!id(taskId, 36) || !lease || lease.taskId !== taskId || !id(lease.runId, 36) || !id(lease.holderId)
    || !/^[1-9][0-9]{0,19}$/u.test(lease.fencingToken) || !Number.isSafeInteger(lease.revision) || lease.revision < 1 || lease.revision >= 0xffffffff) throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
}
function validatePolicy(policy: AiTaskExecutionPolicy) {
  if (!policy || !id(policy.version, 64) || !/^[a-f0-9]{64}$/u.test(policy.fingerprint)) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
  for (const name of Object.keys(resources) as AiTaskExecutionResource[]) if (!positive(policy.limits?.[name]) || !counter(policy.limits[name])) throw new AiTaskExecutionBudgetError('AI_RUN_LIMIT');
}
function validateResource(resource: AiTaskExecutionResource, amount: bigint) {
  if (!resources[resource] || !positive(amount) || !counter(amount)) throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
}

/**
 * Durable task-resource accounting. This is intentionally a repository/port
 * adapter and is not registered by AppModule. A caller must provide an
 * already-authorized scope resolver and policy source; absence of either is a
 * hard failure rather than an unlimited task.
 */
export class PrismaTaskExecutionBudgetRepository implements AiTaskExecutionBudgetPort {
  constructor(private readonly db: Db, private readonly scopes: AiTaskExecutionScopeSource,
    private readonly policies: { resolve(taskId: string, lease: AiTaskExecutionLease): Promise<AiTaskExecutionPolicy> },
    private readonly evidenceSource?: AiTaskExecutionEvidenceSource, private readonly clock: () => Date = () => new Date()) {
    if (!db || typeof db.$transaction !== 'function' || typeof scopes?.resolve !== 'function' || typeof policies?.resolve !== 'function'
      || (evidenceSource !== undefined && typeof evidenceSource.read !== 'function')) {
      throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    }
  }

  private async scope(taskId: string, lease: AiTaskExecutionLease) {
    validateLease(taskId, lease);
    const resolved = structuredClone(await this.scopes.resolve(taskId, structuredClone(lease)));
    if (!resolved || !id(resolved.scopeId, 36)) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    return resolved.scopeId;
  }

  private async policy(taskId: string, lease: AiTaskExecutionLease) {
    const policy = structuredClone(await this.policies.resolve(taskId, structuredClone(lease)));
    validatePolicy(policy);
    return policy;
  }

  private async activeLease(tx: Tx, scopeId: string, lease: AiTaskExecutionLease) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${scopeId} AND taskId = ${lease.taskId} AND id = ${lease.runId} FOR UPDATE`);
    const row = await tx.aiRun.findFirst({ where: { scopeId, taskId: lease.taskId, id: lease.runId, leaseOwnerId: lease.holderId,
      fencingToken: new Prisma.Decimal(lease.fencingToken), revision: lease.revision, status: 'RUNNING', leaseExpiresAt: { gt: this.clock() } } });
    if (!row) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    return row;
  }

  private async lockBudget(tx: Tx, scopeId: string, taskId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT scopeId FROM ai_task_execution_budgets WHERE scopeId = ${scopeId} AND taskId = ${taskId} FOR UPDATE`);
    const row = await tx.aiTaskExecutionBudget.findUnique({ where: { scopeId_taskId: { scopeId, taskId } } });
    if (!row) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    return row;
  }

  private snapshot(row: Record<string, unknown>, policy: AiTaskExecutionPolicy): AiTaskExecutionBudgetSnapshot {
    if (row.policyVersion !== policy.version || row.policyFingerprint !== policy.fingerprint
      || Object.entries(resources).some(([name, spec]) => BigInt(row[spec.max] as bigint) !== policy.limits[name as AiTaskExecutionResource])) throw new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');
    return { scopeId: String(row.scopeId), taskId: String(row.taskId), revision: Number(row.revision), policy: structuredClone(policy),
      reserved: copyCounters(row, 'reserved'), consumed: copyCounters(row, 'consumed') };
  }

  private chargeReceipt(row: Record<string, unknown>): AiTaskExecutionChargeReceipt {
    return { chargeId: String(row.chargeId), requestFingerprint: String(row.requestFingerprint), resource: String(row.resource).toLowerCase() as AiTaskExecutionResource,
      amount: BigInt(row.amount as bigint), actualAmount: row.actualAmount == null ? null : BigInt(row.actualAmount as bigint),
      status: String(row.status).toLowerCase() as AiTaskExecutionChargeReceipt['status'], revision: Number(row.revision) };
  }

  private async readBudget(scopeId: string, taskId: string, lease: AiTaskExecutionLease, policy: AiTaskExecutionPolicy) {
    const row = await this.db.aiTaskExecutionBudget.findUnique({ where: { scopeId_taskId: { scopeId, taskId } } });
    if (!row) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    const leaseRow = await this.db.aiRun.findFirst({ where: { scopeId, taskId, id: lease.runId, leaseOwnerId: lease.holderId,
      fencingToken: new Prisma.Decimal(lease.fencingToken), revision: lease.revision, status: 'RUNNING', leaseExpiresAt: { gt: this.clock() } } });
    if (!leaseRow) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    return this.snapshot(row as unknown as Record<string, unknown>, policy);
  }

  async initialize(taskId: string, lease: AiTaskExecutionLease) {
    lease = structuredClone(lease);
    const scopeId = await this.scope(taskId, lease), policy = await this.policy(taskId, lease);
    await this.db.$transaction(async tx => {
      await this.activeLease(tx, scopeId, lease);
      await tx.aiTaskExecutionBudget.upsert({ where: { scopeId_taskId: { scopeId, taskId } }, create: { scopeId, taskId, policyVersion: policy.version, policyFingerprint: policy.fingerprint,
        maxSteps: policy.limits.steps, maxCalls: policy.limits.calls, maxActiveMs: policy.limits.active_ms, maxOutputBytes: policy.limits.output_bytes },
        update: {} });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    return this.readBudget(scopeId, taskId, lease, policy);
  }

  async load(taskId: string, lease: AiTaskExecutionLease) {
    lease = structuredClone(lease);
    const scopeId = await this.scope(taskId, lease), policy = await this.policy(taskId, lease);
    return this.readBudget(scopeId, taskId, lease, policy);
  }

  private async target(tx: Tx, input: AiTaskExecutionChargeRequest, scopeId: string) {
    if (input.target.kind === 'step') {
      if (!id(input.target.stepId, 36) || !id(input.target.actionId) || !/^[a-f0-9]{64}$/u.test(input.target.stepFingerprint)
        || (input.target.gatewayInvocationId !== undefined && !id(input.target.gatewayInvocationId, 36))) throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
      const step = await tx.aiStep.findFirst({ where: { scopeId, taskId: input.taskId, id: input.target.stepId, runId: input.lease.runId, actionId: input.target.actionId, requestFingerprint: input.target.stepFingerprint } });
      if (!step) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
      if (input.target.gatewayInvocationId) {
        const invocation = await tx.aiGatewayInvocation.findFirst({ where: { scopeId, taskId: input.taskId, id: input.target.gatewayInvocationId, runId: input.lease.runId, stepId: input.target.stepId, actionId: input.target.actionId, stepFingerprint: input.target.stepFingerprint } });
        if (!invocation) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
      }
    }
  }

  private fingerprint(input: AiTaskExecutionChargeRequest) { return requestFingerprint({ taskId: input.taskId, lease: input.lease, chargeId: input.chargeId, resource: input.resource, amount: input.amount.toString(), target: input.target }); }

  private async mutate(input: AiTaskExecutionChargeRequest, action: 'reserve' | 'record' | 'reconcile' | 'unknown', evidence?: AiTaskExecutionChargeEvidence, expectedFingerprint = this.fingerprint(input)) {
    validateLease(input.taskId, input.lease); validateResource(input.resource, input.amount);
    if (!id(input.chargeId, 36) || !input.target || !['run', 'step'].includes(input.target.kind)) throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
    const scopeId = await this.scope(input.taskId, input.lease), policy = await this.policy(input.taskId, input.lease), expected = expectedFingerprint;
    if (evidence && (evidence.scopeId !== scopeId || evidence.taskId !== input.taskId || evidence.runId !== input.lease.runId || evidence.chargeId !== input.chargeId
      || evidence.requestFingerprint !== expected || evidence.resource !== input.resource || !counter(evidence.actualAmount) || !id(evidence.evidenceRef) || !/^[a-f0-9]{64}$/u.test(evidence.evidenceHash))) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const result = await this.db.$transaction(async tx => {
      await this.activeLease(tx, scopeId, input.lease);
      const budget = await this.lockBudget(tx, scopeId, input.taskId);
      this.snapshot(budget as unknown as Record<string, unknown>, policy);
      await this.target(tx, input, scopeId);
      const existing = await tx.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId, taskId: input.taskId, chargeId: input.chargeId } } });
      if (existing) {
        const same = existing.requestFingerprint === expected && existing.resource.toLowerCase() === input.resource && BigInt(existing.amount) === input.amount;
        if (!same) throw new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');
        if (evidence && (evidence.gatewayInvocationId !== existing.gatewayInvocationId || (existing.gatewayInvocationId !== null && !id(evidence.dispatchToken)))) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
        if (action === 'reserve') return { replayed: true, budget, charge: existing };
        if (action === 'unknown') {
          if (existing.status !== 'RESERVED') return { replayed: true, budget, charge: existing };
          const changed = await tx.aiTaskExecutionCharge.updateMany({ where: { scopeId, taskId: input.taskId, chargeId: input.chargeId, status: 'RESERVED', revision: existing.revision }, data: { status: 'UNKNOWN', unknownReason: 'unknown', revision: { increment: 1 } } });
          if (changed.count !== 1) throw new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');
          const next = await tx.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId, taskId: input.taskId, chargeId: input.chargeId } } });
          if (!next) throw new AiTaskExecutionBudgetError('AI_STORAGE_UNAVAILABLE');
          return { replayed: false, budget, charge: next };
        }
        if (existing.status === 'RECORDED') {
          if (existing.outcomeFingerprint === evidence?.evidenceHash && existing.actualAmount === evidence?.actualAmount && existing.evidenceRef === evidence?.evidenceRef) return { replayed: true, budget, charge: existing };
          throw new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');
        }
        if (action === 'record' && existing.status !== 'RESERVED') throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
        if (action === 'reconcile' && !['RESERVED', 'UNKNOWN'].includes(existing.status)) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
        const spec = resources[input.resource];
        const currentReserved = BigInt((budget as Record<string, unknown>)[spec.reserved] as bigint);
        if (currentReserved < existing.amount) throw new AiTaskExecutionBudgetError('AI_STORAGE_UNAVAILABLE');
        if (!counter(BigInt((budget as Record<string, unknown>)[spec.consumed] as bigint) + evidence!.actualAmount)) throw new AiTaskExecutionBudgetError('AI_RUN_LIMIT');
        const update: Record<string, unknown> = { [spec.reserved]: { decrement: existing.amount }, [spec.consumed]: { increment: evidence!.actualAmount }, revision: { increment: 1 } };
        const budgetChanged = await tx.aiTaskExecutionBudget.updateMany({ where: { scopeId, taskId: input.taskId, revision: budget.revision }, data: update });
        if (budgetChanged.count !== 1) throw new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');
        const chargeChanged = await tx.aiTaskExecutionCharge.updateMany({ where: { scopeId, taskId: input.taskId, chargeId: input.chargeId, status: existing.status }, data: {
          status: 'RECORDED', actualAmount: evidence!.actualAmount, outcomeFingerprint: evidence!.evidenceHash, evidenceRef: evidence!.evidenceRef ?? evidence!.evidenceHash, unknownReason: null, revision: { increment: 1 } } });
        if (chargeChanged.count !== 1) throw new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');
        const next = await tx.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId, taskId: input.taskId, chargeId: input.chargeId } } });
        if (!next) throw new AiTaskExecutionBudgetError('AI_STORAGE_UNAVAILABLE');
        return { replayed: false, budget, charge: next };
      }
      if (action !== 'reserve') throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
      const spec = resources[input.resource];
      const currentReserved = BigInt((budget as Record<string, unknown>)[spec.reserved] as bigint);
      const currentConsumed = BigInt((budget as Record<string, unknown>)[spec.consumed] as bigint);
      if (action === 'reserve' && currentReserved + currentConsumed + input.amount > BigInt((budget as Record<string, unknown>)[spec.max] as bigint)) throw new AiTaskExecutionBudgetError('AI_RUN_LIMIT');
      const data = { scopeId, taskId: input.taskId, chargeId: input.chargeId, runId: input.lease.runId,
        stepId: input.target.kind === 'step' ? input.target.stepId : null, actionId: input.target.kind === 'step' ? input.target.actionId : null,
        stepFingerprint: input.target.kind === 'step' ? input.target.stepFingerprint : null, gatewayInvocationId: input.target.kind === 'step' ? input.target.gatewayInvocationId ?? null : null,
        leaseOwnerId: input.lease.holderId, fencingToken: new Prisma.Decimal(input.lease.fencingToken), requestFingerprint: expected,
        resource: spec.enum, amount: input.amount, status: 'RESERVED',
        actualAmount: null, outcomeFingerprint: null, evidenceRef: null, unknownReason: null } as Prisma.AiTaskExecutionChargeUncheckedCreateInput;
      await tx.aiTaskExecutionCharge.create({ data });
      const update: Record<string, unknown> = { revision: { increment: 1 } };
      update[spec.reserved] = { increment: input.amount };
      const changed = await tx.aiTaskExecutionBudget.updateMany({ where: { scopeId, taskId: input.taskId, revision: budget.revision }, data: update });
      if (changed.count !== 1) throw new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');
      const next = await tx.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId, taskId: input.taskId, chargeId: input.chargeId } } });
      if (!next) throw new AiTaskExecutionBudgetError('AI_STORAGE_UNAVAILABLE');
      return { replayed: false, budget, charge: next };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    const fresh = await this.db.aiTaskExecutionBudget.findUnique({ where: { scopeId_taskId: { scopeId, taskId: input.taskId } } });
    if (!fresh) throw new AiTaskExecutionBudgetError('AI_STORAGE_UNAVAILABLE');
    return { replayed: result.replayed, budget: this.snapshot(fresh as unknown as Record<string, unknown>, policy), charge: this.chargeReceipt(result.charge as unknown as Record<string, unknown>) };
  }

  async reserve(input: AiTaskExecutionChargeRequest) { return this.mutate(structuredClone(input), 'reserve'); }

  private async evidence(input: AiTaskExecutionSettlementRequest, reconcile: boolean) {
    if (!id(input.evidenceRef)) throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
    if (!this.evidenceSource) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    return structuredClone(await this.evidenceSource.read(structuredClone(input), reconcile));
  }

  private async original(scopeId: string, input: { taskId: string; lease: AiTaskExecutionLease; chargeId: string }) {
    const row = await this.db.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId, taskId: input.taskId, chargeId: input.chargeId } } });
    if (!row) throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    if (row.runId !== input.lease.runId) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const target = row.stepId ? { kind: 'step' as const, stepId: row.stepId, actionId: row.actionId ?? '', stepFingerprint: row.stepFingerprint ?? '', ...(row.gatewayInvocationId ? { gatewayInvocationId: row.gatewayInvocationId } : {}) } : { kind: 'run' as const };
    if (target.kind === 'step' && (!target.actionId || !target.stepFingerprint)) throw new AiTaskExecutionBudgetError('AI_STORAGE_UNAVAILABLE');
    return { taskId: input.taskId, lease: structuredClone(input.lease), chargeId: input.chargeId, resource: String(row.resource).toLowerCase() as AiTaskExecutionResource, amount: BigInt(row.amount), target };
  }
  async record(input: AiTaskExecutionSettlementRequest) { input = structuredClone(input); const evidence = await this.evidence(input, false); if (evidence.evidenceRef !== input.evidenceRef) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED'); const scopeId = await this.scope(input.taskId, input.lease); const original = await this.original(scopeId, input); return this.mutate(original, 'record', evidence, evidence.requestFingerprint); }
  async reconcile(input: AiTaskExecutionSettlementRequest) { input = structuredClone(input); const evidence = await this.evidence(input, true); if (evidence.evidenceRef !== input.evidenceRef) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED'); const scopeId = await this.scope(input.taskId, input.lease); const original = await this.original(scopeId, input); return this.mutate(original, 'reconcile', evidence, evidence.requestFingerprint); }
  async markUnknown(input: { taskId: string; lease: AiTaskExecutionLease; chargeId: string; reason: string }) {
    input = structuredClone(input);
    if (!id(input.reason, 128)) throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
    const scopeId = await this.scope(input.taskId, input.lease), original = await this.original(scopeId, input);
    return this.mutate(original, 'unknown');
  }
}
