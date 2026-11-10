import { Prisma, type PrismaClient } from '@prisma/client';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import {
  AiTaskExecutionBudgetError, AiTaskExecutionPreReservationLimitError, type AiTaskExecutionBudgetPort, type AiTaskExecutionBudgetSnapshot,
  type AiTaskExecutionChargeEvidence, type AiTaskExecutionChargeReceipt, type AiTaskExecutionChargeRequest,
  type AiTaskExecutionCounters, type AiTaskExecutionLease,
  type AiTaskExecutionPolicy, type AiTaskExecutionResource, type AiTaskExecutionSettlementRequest, type AiTaskExecutionEvidenceSource, type AiTaskExecutionPolicySource,
} from '../task-execution-budget.ports';

type Db = PrismaClient;
type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export interface AiTaskExecutionScopeSource {
  resolve(taskId: string, lease: AiTaskExecutionLease, operation: 'read' | 'write'): Promise<{ scopeId: string; bindingKey: string; taskWhere: Prisma.AiTaskWhereInput }>;
}

const resources: Record<AiTaskExecutionResource, { max: string; reserved: string; consumed: string; enum: import('@prisma/client').AiTaskExecutionResource }> = {
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
    private readonly policies: AiTaskExecutionPolicySource,
    private readonly evidenceSource?: AiTaskExecutionEvidenceSource, private readonly clock: () => Date = () => new Date()) {
    if (!db || typeof db.$transaction !== 'function' || typeof scopes?.resolve !== 'function' || typeof policies?.resolve !== 'function'
      || (evidenceSource !== undefined && typeof evidenceSource.read !== 'function')) {
      throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    }
  }

  private async access(taskId: string, lease: AiTaskExecutionLease, operation: 'read' | 'write' = 'write') {
    validateLease(taskId, lease);
    const resolved = structuredClone(await this.scopes.resolve(taskId, structuredClone(lease), operation));
    if (!resolved || !id(resolved.scopeId, 36) || typeof resolved.bindingKey !== 'string' || !resolved.bindingKey || !resolved.taskWhere
      || resolved.taskWhere.id !== taskId) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    return resolved;
  }

  private async scope(taskId: string, lease: AiTaskExecutionLease) { return (await this.access(taskId, lease)).scopeId; }

  private async currentTask(tx: Tx, taskId: string, lease: AiTaskExecutionLease, before: Awaited<ReturnType<AiTaskExecutionScopeSource['resolve']>>) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${before.scopeId} AND id = ${taskId} FOR UPDATE`);
    await this.verifyCurrentAccess(tx, taskId, lease, before);
  }

  private async verifyCurrentAccess(tx: Tx, taskId: string, lease: AiTaskExecutionLease, before: Awaited<ReturnType<AiTaskExecutionScopeSource['resolve']>>) {
    const current = await this.access(taskId, lease);
    if (current.scopeId !== before.scopeId || current.bindingKey !== before.bindingKey
      || !await tx.aiTask.findFirst({ where: { AND: [current.taskWhere, { scopeId: current.scopeId }] }, select: { id: true } })) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
  }

  private async policy(taskId: string, lease: AiTaskExecutionLease, originalOnly = false) {
    const read = originalOnly && this.policies.resolveReconciliation ? this.policies.resolveReconciliation.bind(this.policies)
      : this.policies.resolve.bind(this.policies);
    const policy = structuredClone(await read(taskId, structuredClone(lease)));
    validatePolicy(policy);
    return policy;
  }

  private async activeLease(tx: Tx, scopeId: string, lease: AiTaskExecutionLease, settlingRunTime = false) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${scopeId} AND taskId = ${lease.taskId} AND id = ${lease.runId} FOR UPDATE`);
    // Only original pure Run time can close after the aggregate or release.
    // An absent holder never admits a reservation, step or Gateway invocation.
    const statuses: import('@prisma/client').AiTaskStatus[] = settlingRunTime
      ? ['RUNNING', 'SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'] : ['RUNNING'];
    const row = await tx.aiRun.findFirst({ where: { scopeId, taskId: lease.taskId, id: lease.runId,
      fencingToken: new Prisma.Decimal(lease.fencingToken), revision: lease.revision, status: { in: statuses },
      ...(settlingRunTime ? { OR: [{ status: { in: ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'] } },
        { leaseOwnerId: lease.holderId, leaseExpiresAt: { gt: this.clock() } },
        { leaseOwnerId: null, leaseExpiresAt: null }] }
        : { leaseOwnerId: lease.holderId, leaseExpiresAt: { gt: this.clock() } }) } });
    const terminalAccounting = settlingRunTime && row && (row.status !== 'RUNNING'
      || row.leaseOwnerId === null && row.leaseExpiresAt === null);
    if (!row || row.id !== lease.runId || row.scopeId !== scopeId || row.taskId !== lease.taskId
      || row.fencingToken.toFixed(0) !== lease.fencingToken || row.revision !== lease.revision || !statuses.includes(row.status)
      || !terminalAccounting && (row.leaseOwnerId !== lease.holderId || !row.leaseExpiresAt || row.leaseExpiresAt <= this.clock()))
      throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
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
    const access = await this.access(taskId, lease), scopeId = access.scopeId, policy = await this.policy(taskId, lease);
    await this.db.$transaction(async tx => {
      await this.currentTask(tx, taskId, lease, access);
      await this.activeLease(tx, scopeId, lease);
      await tx.aiTaskExecutionBudget.upsert({ where: { scopeId_taskId: { scopeId, taskId } }, create: { scopeId, taskId, policyVersion: policy.version, policyFingerprint: policy.fingerprint,
        maxSteps: policy.limits.steps, maxCalls: policy.limits.calls, maxActiveMs: policy.limits.active_ms, maxOutputBytes: policy.limits.output_bytes },
        update: {} });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    return this.readBudget(scopeId, taskId, lease, policy);
  }

  async load(taskId: string, lease: AiTaskExecutionLease) {
    lease = structuredClone(lease);
    const access = await this.access(taskId, lease, 'read'), policy = await this.policy(taskId, lease, true);
    if (!await this.db.aiTask.findFirst({ where: { AND: [access.taskWhere, { scopeId: access.scopeId }] }, select: { id: true } })) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const result = await this.readBudget(access.scopeId, taskId, lease, policy);
    const current = await this.access(taskId, lease, 'read');
    if (current.bindingKey !== access.bindingKey || current.scopeId !== access.scopeId) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    return result;
  }

  private async target(tx: Tx, input: AiTaskExecutionChargeRequest, scopeId: string) {
    if (input.target.kind === 'run' && input.resource !== 'active_ms') throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
    if (input.resource === 'calls' && (input.target.kind !== 'step' || !input.target.gatewayInvocationId)) throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
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
    const access = await this.access(input.taskId, input.lease), scopeId = access.scopeId,
      policy = await this.policy(input.taskId, input.lease, action !== 'reserve'), expected = expectedFingerprint;
    if (evidence && (evidence.scopeId !== scopeId || evidence.taskId !== input.taskId || evidence.runId !== input.lease.runId || evidence.chargeId !== input.chargeId
      || evidence.requestFingerprint !== expected || evidence.resource !== input.resource || !counter(evidence.actualAmount) || !id(evidence.evidenceRef) || !/^[a-f0-9]{64}$/u.test(evidence.evidenceHash))) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    const result = await this.db.$transaction(async tx => {
      await this.currentTask(tx, input.taskId, input.lease, access);
      await this.activeLease(tx, scopeId, input.lease, action !== 'reserve' && input.target.kind === 'run' && input.resource === 'active_ms');
      const budget = await this.lockBudget(tx, scopeId, input.taskId);
      this.snapshot(budget as unknown as Record<string, unknown>, policy);
      await this.target(tx, input, scopeId);
      const existing = await tx.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId, taskId: input.taskId, chargeId: input.chargeId } } });
      await this.verifyCurrentAccess(tx, input.taskId, input.lease, access);
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

  /** Infrastructure participant, not a Runtime/model callback. Close one
   * original RESERVED Run-time charge and reserve its successor atomically.
   * The successor covers this transaction/COMMIT/reply; lost delivery is not a
   * retry token. Financial, step and invocation accounting remain untouched. */
  async rotateRunTime<T>(input: { taskId: string; lease: AiTaskExecutionLease; expiresAt: string;
    previousChargeId: string; nextChargeId: string; maximumMs: number; retainMs: bigint }, participant: {
    close(tx: Prisma.TransactionClient, scopeId: string, charge: import('@prisma/client').AiTaskExecutionCharge,
      policyFingerprint: string): Promise<AiTaskExecutionChargeEvidence>;
    open(tx: Prisma.TransactionClient, scopeId: string, charge: { amount: bigint; requestFingerprint: string }): Promise<T>;
  }) {
    input = structuredClone(input); validateLease(input.taskId, input.lease);
    if (!id(input.previousChargeId, 36) || !id(input.nextChargeId, 36) || input.previousChargeId === input.nextChargeId
      || !Number.isSafeInteger(input.maximumMs) || input.maximumMs < 1 || !counter(input.retainMs)
      || !Number.isFinite(Date.parse(input.expiresAt)) || typeof participant?.close !== 'function'
      || typeof participant?.open !== 'function') throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
    const access = await this.access(input.taskId, input.lease), policy = await this.policy(input.taskId, input.lease);
    return this.db.$transaction(async tx => {
      await this.currentTask(tx, input.taskId, input.lease, access);
      const held = await this.activeLease(tx, access.scopeId, input.lease);
      if (held.leaseExpiresAt?.getTime() !== Date.parse(input.expiresAt)) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
      const budget = await this.lockBudget(tx, access.scopeId, input.taskId);
      this.snapshot(budget as unknown as Record<string, unknown>, policy);
      const key = { scopeId: access.scopeId, taskId: input.taskId };
      const original = await tx.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { ...key, chargeId: input.previousChargeId } } });
      if (!original || original.scopeId !== key.scopeId || original.taskId !== key.taskId || original.runId !== input.lease.runId
        || original.resource !== 'ACTIVE_MS' || original.status !== 'RESERVED' || original.amount <= 0n
        || original.stepId !== null || original.actionId !== null || original.stepFingerprint !== null || original.gatewayInvocationId !== null
        || original.leaseOwnerId !== input.lease.holderId || original.fencingToken.toFixed(0) !== input.lease.fencingToken
        || original.actualAmount !== null || original.outcomeFingerprint !== null || original.evidenceRef !== null)
        throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
      if (await tx.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { ...key, chargeId: input.nextChargeId } } }))
        throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
      const evidence = await participant.close(tx, access.scopeId, original, policy.fingerprint);
      if (evidence.scopeId !== key.scopeId || evidence.taskId !== key.taskId || evidence.runId !== original.runId
        || evidence.chargeId !== original.chargeId || evidence.requestFingerprint !== original.requestFingerprint
        || evidence.resource !== 'active_ms' || !counter(evidence.actualAmount) || evidence.actualAmount > original.amount
        || !/^[a-f0-9]{64}$/u.test(evidence.evidenceHash) || !id(evidence.evidenceRef)
        || evidence.dispatchToken !== null || evidence.gatewayInvocationId !== null) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
      if (budget.reservedActiveMs < original.amount) throw new AiTaskExecutionBudgetError('AI_STORAGE_UNAVAILABLE');
      const available = policy.limits.active_ms - budget.consumedActiveMs - budget.reservedActiveMs + original.amount - evidence.actualAmount;
      const stepAllowanceUnavailable = input.retainMs > 0n && available <= input.retainMs;
      const free = available - (stepAllowanceUnavailable ? 0n : input.retainMs);
      const maximum = Math.min(input.maximumMs, Date.parse(input.expiresAt) - this.clock().getTime());
      const amount = free < BigInt(Math.max(0, Math.floor(maximum))) ? free : BigInt(Math.max(0, Math.floor(maximum)));
      if (amount < 1n) throw new AiTaskExecutionBudgetError('AI_RUN_LIMIT');
      const request: AiTaskExecutionChargeRequest = { taskId: input.taskId, lease: input.lease, chargeId: input.nextChargeId,
        resource: 'active_ms', amount, target: { kind: 'run' } };
      const fingerprint = this.fingerprint(request);
      if ((await tx.aiTaskExecutionCharge.updateMany({ where: { ...key, chargeId: original.chargeId, revision: original.revision,
        status: 'RESERVED', requestFingerprint: original.requestFingerprint }, data: { status: 'RECORDED', actualAmount: evidence.actualAmount,
        outcomeFingerprint: evidence.evidenceHash, evidenceRef: evidence.evidenceRef, unknownReason: null, revision: { increment: 1 } } })).count !== 1)
        throw new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');
      await tx.aiTaskExecutionCharge.create({ data: { ...key, chargeId: input.nextChargeId, runId: input.lease.runId,
        stepId: null, actionId: null, stepFingerprint: null, gatewayInvocationId: null, leaseOwnerId: input.lease.holderId,
        fencingToken: new Prisma.Decimal(input.lease.fencingToken), requestFingerprint: fingerprint, resource: 'ACTIVE_MS', amount,
        status: 'RESERVED', actualAmount: null, outcomeFingerprint: null, evidenceRef: null, unknownReason: null } });
      if ((await tx.aiTaskExecutionBudget.updateMany({ where: { ...key, revision: budget.revision }, data: {
        reservedActiveMs: budget.reservedActiveMs - original.amount + amount,
        consumedActiveMs: { increment: evidence.actualAmount }, revision: { increment: 1 } } })).count !== 1)
        throw new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');
      const value = await participant.open(tx, access.scopeId, { amount, requestFingerprint: fingerprint });
      await this.verifyCurrentAccess(tx, input.taskId, input.lease, access);
      const current = await this.activeLease(tx, access.scopeId, input.lease);
      if (current.leaseExpiresAt?.getTime() !== Date.parse(input.expiresAt)) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
      return { value, amount, stepAllowanceUnavailable };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }

  /** Final original-time receipt and settlement share one transaction after an
   * exact release acknowledgement. This admits no new reservation, step, Run
   * mutation or dispatch, and never reconstructs a lost clock from a receipt. */
  async finalizeReleasedRunTime(input: { taskId: string; lease: AiTaskExecutionLease; expiresAt: string;
    chargeId: string; release: { released: true; revision: number } },
    participant: {
      measure(tx: Prisma.TransactionClient, scopeId: string): Promise<AiTaskExecutionChargeEvidence>;
      verify(tx: Prisma.TransactionClient, scopeId: string): Promise<void>;
    }) {
    input = structuredClone(input); validateLease(input.taskId, input.lease);
    if (!id(input.chargeId, 36) || !Number.isFinite(Date.parse(input.expiresAt))
      || typeof participant?.measure !== 'function' || typeof participant?.verify !== 'function'
      || input.release?.released !== true || input.release.revision !== input.lease.revision + 1
      || input.release.revision >= 0xffffffff) throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
    const lease = { ...input.lease, revision: input.release.revision };
    const access = await this.access(input.taskId, lease), policy = await this.policy(input.taskId, lease, true);
    await this.db.$transaction(async tx => {
      await this.currentTask(tx, input.taskId, lease, access);
      const released = await this.activeLease(tx, access.scopeId, lease, true);
      if (released.leaseOwnerId !== null || released.leaseExpiresAt !== null) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
      const budget = await this.lockBudget(tx, access.scopeId, input.taskId);
      this.snapshot(budget as unknown as Record<string, unknown>, policy);
      const key = { scopeId: access.scopeId, taskId: input.taskId };
      const charge = await tx.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { ...key, chargeId: input.chargeId } } });
      if (!charge || charge.scopeId !== key.scopeId || charge.taskId !== key.taskId || charge.runId !== lease.runId
        || charge.leaseOwnerId !== lease.holderId || charge.fencingToken.toFixed(0) !== lease.fencingToken
        || charge.resource !== 'ACTIVE_MS' || charge.status !== 'RESERVED' || charge.amount <= 0n
        || charge.stepId !== null || charge.actionId !== null || charge.stepFingerprint !== null || charge.gatewayInvocationId !== null
        || charge.actualAmount !== null || charge.outcomeFingerprint !== null || charge.evidenceRef !== null)
        throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
      const evidence = await participant.measure(tx, access.scopeId);
      if (evidence.scopeId !== key.scopeId || evidence.taskId !== key.taskId || evidence.runId !== lease.runId
        || evidence.chargeId !== charge.chargeId || evidence.requestFingerprint !== charge.requestFingerprint
        || evidence.resource !== 'active_ms' || !counter(evidence.actualAmount) || evidence.actualAmount > charge.amount
        || evidence.evidenceRef !== `overhead:${charge.chargeId}` || !/^[a-f0-9]{64}$/u.test(evidence.evidenceHash)
        || evidence.dispatchToken !== null || evidence.gatewayInvocationId !== null)
        throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
      if (budget.reservedActiveMs < charge.amount || !counter(budget.consumedActiveMs + evidence.actualAmount))
        throw new AiTaskExecutionBudgetError('AI_STORAGE_UNAVAILABLE');
      if ((await tx.aiTaskExecutionCharge.updateMany({ where: { ...key, chargeId: charge.chargeId, revision: charge.revision,
        status: 'RESERVED', requestFingerprint: charge.requestFingerprint }, data: { status: 'RECORDED',
        actualAmount: evidence.actualAmount, outcomeFingerprint: evidence.evidenceHash, evidenceRef: evidence.evidenceRef,
        unknownReason: null, revision: { increment: 1 } } })).count !== 1) throw new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');
      if ((await tx.aiTaskExecutionBudget.updateMany({ where: { ...key, revision: budget.revision }, data: {
        reservedActiveMs: { decrement: charge.amount }, consumedActiveMs: { increment: evidence.actualAmount },
        revision: { increment: 1 } } })).count !== 1) throw new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');
      await participant.verify(tx, access.scopeId);
      await this.verifyCurrentAccess(tx, input.taskId, lease, access);
      const current = await this.activeLease(tx, access.scopeId, lease, true);
      if (current.leaseOwnerId !== null || current.leaseExpiresAt !== null) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }

  async reserve(input: AiTaskExecutionChargeRequest) { return this.mutate(structuredClone(input), 'reserve'); }

  /** One original step's base resources share admission, not a new allowance.
   * Keep Task -> Run -> budget lock order and recheck authority/lease before
   * COMMIT. A partial historical group or replay never authorizes dispatch. */
  async reserveStep(requests: readonly AiTaskExecutionChargeRequest[]) {
    if (!Array.isArray(requests) || requests.length !== 3) throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
    const inputs: readonly AiTaskExecutionChargeRequest[] = structuredClone(requests);
    for (const input of inputs) {
      if (!input) throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
      validateLease(input.taskId, input.lease); validateResource(input.resource, input.amount);
      if (!['steps', 'active_ms', 'output_bytes'].includes(input.resource) || !id(input.chargeId, 36)
        || input.target?.kind !== 'step' || !id(input.target.stepId, 36) || !id(input.target.actionId)
        || !/^[a-f0-9]{64}$/u.test(input.target.stepFingerprint) || input.target.gatewayInvocationId !== undefined
        || input.resource === 'steps' && input.amount !== 1n) throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
    }
    const first = inputs[0];
    if (new Set(inputs.map(input => input.resource)).size !== 3 || new Set(inputs.map(input => input.chargeId)).size !== 3
      || inputs.some(input => input.taskId !== first.taskId || input.lease.runId !== first.lease.runId
        || input.lease.holderId !== first.lease.holderId || input.lease.revision !== first.lease.revision
        || input.lease.fencingToken !== first.lease.fencingToken || input.target.kind !== 'step' || first.target.kind !== 'step'
        || input.target.stepId !== first.target.stepId || input.target.actionId !== first.target.actionId
        || input.target.stepFingerprint !== first.target.stepFingerprint)) throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
    const access = await this.access(first.taskId, first.lease), scopeId = access.scopeId,
      policy = await this.policy(first.taskId, first.lease), fingerprints = inputs.map(input => this.fingerprint(input));
    const result = await this.db.$transaction(async tx => {
      await this.currentTask(tx, first.taskId, first.lease, access);
      await this.activeLease(tx, scopeId, first.lease);
      const budget = await this.lockBudget(tx, scopeId, first.taskId);
      this.snapshot(budget as unknown as Record<string, unknown>, policy);
      await this.target(tx, first, scopeId);
      const existing: import('@prisma/client').AiTaskExecutionCharge[] = [];
      for (const [index, input] of inputs.entries()) {
        const row = await tx.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId, taskId: input.taskId, chargeId: input.chargeId } } });
        if (!row) continue;
        if (input.target.kind !== 'step' || row.requestFingerprint !== fingerprints[index] || row.resource !== resources[input.resource].enum
          || row.amount !== input.amount || row.scopeId !== scopeId || row.taskId !== input.taskId || row.runId !== input.lease.runId
          || row.stepId !== input.target.stepId || row.actionId !== input.target.actionId || row.stepFingerprint !== input.target.stepFingerprint
          || row.gatewayInvocationId !== null || row.leaseOwnerId !== input.lease.holderId || row.fencingToken.toFixed(0) !== input.lease.fencingToken)
          throw new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');
        existing.push(row);
      }
      if (existing.length !== 0 && existing.length !== inputs.length) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
      const replayed = existing.length === inputs.length;
      const charges = [...existing];
      const limited = !replayed && inputs.some(input => {
        const spec = resources[input.resource], row = budget as unknown as Record<string, unknown>;
        return BigInt(row[spec.reserved] as bigint) + BigInt(row[spec.consumed] as bigint) + input.amount > BigInt(row[spec.max] as bigint);
      });
      if (!replayed && !limited) {
        const update: Record<string, unknown> = { revision: { increment: 1 } };
        for (const input of inputs) update[resources[input.resource].reserved] = { increment: input.amount };
        for (const [index, input] of inputs.entries()) {
          if (input.target.kind !== 'step') throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
          charges.push(await tx.aiTaskExecutionCharge.create({ data: { scopeId, taskId: input.taskId, chargeId: input.chargeId,
            runId: input.lease.runId, stepId: input.target.stepId, actionId: input.target.actionId, stepFingerprint: input.target.stepFingerprint,
            gatewayInvocationId: null, leaseOwnerId: input.lease.holderId, fencingToken: new Prisma.Decimal(input.lease.fencingToken),
            requestFingerprint: fingerprints[index], resource: resources[input.resource].enum,
            amount: input.amount, status: 'RESERVED', actualAmount: null, outcomeFingerprint: null, evidenceRef: null, unknownReason: null } }));
        }
        if ((await tx.aiTaskExecutionBudget.updateMany({ where: { scopeId, taskId: first.taskId, revision: budget.revision }, data: update })).count !== 1)
          throw new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');
      }
      // Do not turn authorization or lease expiry during the writes into a
      // committed allowance. The transaction, including all three IDs, rolls back.
      await this.verifyCurrentAccess(tx, first.taskId, first.lease, access);
      await this.activeLease(tx, scopeId, first.lease);
      return { replayed, charges, limited };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    // Only this successfully acknowledged, write-free transaction proves a known
    // limit. An exception (including a lost denial reply) remains uncertain.
    if (result.limited) throw new AiTaskExecutionPreReservationLimitError();
    const fresh = await this.db.aiTaskExecutionBudget.findUnique({ where: { scopeId_taskId: { scopeId, taskId: first.taskId } } });
    if (!fresh) throw new AiTaskExecutionBudgetError('AI_STORAGE_UNAVAILABLE');
    const snapshot = this.snapshot(fresh as unknown as Record<string, unknown>, policy);
    return result.charges.map(charge => ({ replayed: result.replayed, budget: structuredClone(snapshot),
      charge: this.chargeReceipt(charge as unknown as Record<string, unknown>) }));
  }

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
    return { taskId: input.taskId, lease: structuredClone(input.lease), chargeId: input.chargeId, resource: String(row.resource).toLowerCase() as AiTaskExecutionResource, amount: BigInt(row.amount), target, persistedFingerprint: row.requestFingerprint };
  }
  async record(input: AiTaskExecutionSettlementRequest) { input = structuredClone(input); const evidence = await this.evidence(input, false); if (evidence.evidenceRef !== input.evidenceRef) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED'); const scopeId = await this.scope(input.taskId, input.lease); const original = await this.original(scopeId, input); return this.mutate(original, 'record', evidence, evidence.requestFingerprint); }
  async reconcile(input: AiTaskExecutionSettlementRequest) { input = structuredClone(input); const evidence = await this.evidence(input, true); if (evidence.evidenceRef !== input.evidenceRef) throw new AiTaskExecutionBudgetError('AI_ACCESS_DENIED'); const scopeId = await this.scope(input.taskId, input.lease); const original = await this.original(scopeId, input); return this.mutate(original, 'reconcile', evidence, evidence.requestFingerprint); }
  async markUnknown(input: { taskId: string; lease: AiTaskExecutionLease; chargeId: string; reason: string }) {
    input = structuredClone(input);
    if (!id(input.reason, 128)) throw new AiTaskExecutionBudgetError('AI_INVALID_INPUT');
    const scopeId = await this.scope(input.taskId, input.lease), original = await this.original(scopeId, input);
    return this.mutate(original, 'unknown', undefined, original.persistedFingerprint);
  }
}
