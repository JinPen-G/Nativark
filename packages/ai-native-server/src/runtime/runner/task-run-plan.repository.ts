/** One persisted Run plan and lease fence for public and Rental hosts.
 * A plan is evidence for the original Run, never an executor or a replacement quota. */
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma, PrismaClient, AiTaskStatus } from '@prisma/client';
import { z } from 'zod';
import type { AiTaskPreparationDefinition, AiTaskRunnerLease, AiTaskRunnerPlan, AiTaskRunnerTaskMetadata } from '@rental-os/platform-server/ai-runtime';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import type { AiTaskTransactionBoundary } from '../../task-transactions';
import { AiTaskExecutionBudgetError } from '../task-execution-budget.ports';
import { isRecoveryTimeLease, type AiTaskExecutionScopeSource } from './task-execution-budget.repository';

type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun' | 'aiTaskRunPlan' | 'aiTaskInputRequest' | 'aiTaskInputReceipt'>;
type Tx = Prisma.TransactionClient;
type RunAccess = 'work' | 'settle' | 'accounting' | 'recovery_time';
const unavailable = () => new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
const conflict = () => new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

export const aiTaskRunnerLimitsSchema = z.object({ maxSteps: z.number().int().min(1).max(1000), maxCalls: z.number().int().min(1).max(1000), maxConcurrent: z.literal(1),
  maxTotalMs: z.number().int().min(1).max(86400000), maxStepMs: z.number().int().min(1).max(86400000), maxOutputBytes: z.number().int().min(1).max(16777216) }).strict();
export function isAiTaskRunPlanBounded(plan: Pick<AiTaskRunnerPlan, 'steps' | 'limits'>) {
  return plan.steps.length <= plan.limits.maxSteps && plan.limits.maxStepMs <= plan.limits.maxTotalMs
    && new Set(plan.steps.map(step => step.registrationRef)).size === plan.steps.length;
}
export const aiTaskRunPlanSchema = z.object({ taskId: id.max(36), runId: id.max(36), taskRevision: z.number().int().min(1).max(4294967294),
  steps: z.array(z.object({ registrationRef: id, operation: z.enum(['readonly', 'idempotent', 'external_unknown']), toolCode: id, toolVersion: id }).strict()).max(1000),
  limits: aiTaskRunnerLimitsSchema
}).strict().refine(isAiTaskRunPlanBounded);

const planProofSchema = z.object({ authorityHash: z.string().regex(/^[a-f0-9]{64}$/u), policyVersion: id.max(64), expiresAt: z.string().datetime({ offset: true }) }).strict();
export interface TaskRunPlanAuthority {
  /** Check the published plan; a supplied Native owns every read for this check. */
  authorize(plan: Readonly<AiTaskRunnerPlan>, lease: Readonly<AiTaskRunnerLease>, tx?: Tx): Promise<z.infer<typeof planProofSchema>>;
  /** Authorizes a bounded preparation interval without authorizing execution. */
  authorizePreparation?(definition: AiTaskPreparationDefinition, lease: AiTaskRunnerLease, tx?: Tx): Promise<z.infer<typeof planProofSchema>>;
}

/** Optional server-owned proof for an explicit operator model-control Run.
 * Returns the original saved resource plan, never a new allowance or a grant.
 * Ordinary and human-answer runs keep their existing lineage reader. */
export type AiTaskControlResourceOrigin = (key: { scopeId: string; taskId: string; runId: string;
  resourceOriginRunId: string }, tx?: Tx) => Promise<AiTaskRunnerPlan>;

export class TaskRunPlanRepository<Database extends Db = Db> {
  constructor(protected readonly db: Database, private readonly scopes: AiTaskExecutionScopeSource,
    private readonly planAuthority: TaskRunPlanAuthority, protected readonly wall: () => Date,
    private readonly controlResourceOrigin: AiTaskControlResourceOrigin | undefined,
    private readonly transactions: Pick<AiTaskTransactionBoundary<Tx>, 'withAiTaskTransaction'>,
    protected readonly nativeScope = false) {
    if (typeof db?.$transaction !== 'function' || typeof db?.aiTaskRunPlan?.findUnique !== 'function'
      || typeof scopes?.resolve !== 'function' || typeof planAuthority?.authorize !== 'function') throw unavailable();
  }

  private authorize(plan: AiTaskRunnerPlan, lease: AiTaskRunnerLease, transaction?: Tx) {
    return this.planAuthority.authorize(structuredClone(plan), structuredClone(lease), this.nativeScope ? transaction : undefined);
  }

  protected async access(lease: AiTaskRunnerLease, mode: RunAccess = 'work', transaction?: Tx) {
    lease = structuredClone(lease);
    if (!lease || !id.max(36).safeParse(lease.taskId).success || !id.max(36).safeParse(lease.runId).success || !id.safeParse(lease.holderId).success
      || !/^[1-9][0-9]{0,19}$/u.test(lease.fencingToken) || !Number.isSafeInteger(lease.revision) || lease.revision < 1) throw denied();
    if (mode === 'recovery_time' && (!this.nativeScope || !isRecoveryTimeLease(lease))
      || this.nativeScope && mode === 'work' && 'purpose' in lease && lease.purpose === 'recovery_only') throw denied();
    const operation = mode === 'recovery_time' ? 'recovery_time' : mode === 'accounting' && lease.expiresAt === '' ? 'settle_released_run'
      : this.nativeScope && mode !== 'work' ? 'settle' : 'write';
    const access = structuredClone(await this.scopes.resolve(lease.taskId, lease, operation, this.nativeScope ? transaction : undefined));
    if (!access?.scopeId || access.taskWhere?.id !== lease.taskId || !access.bindingKey) throw denied();
    return access;
  }

  protected async held(db: Pick<PrismaClient, 'aiTask' | 'aiRun'>, lease: AiTaskRunnerLease,
    before: Awaited<ReturnType<TaskRunPlanRepository['access']>>, locked = false, mode: RunAccess = 'work', transaction?: Tx) {
    const statuses: AiTaskStatus[] = mode === 'accounting'
      ? ['QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED']
      : mode === 'recovery_time' ? ['RUNNING'] : ['QUEUED', 'RUNNING'];
    const current = await this.access(lease, mode, transaction);
    if (current.bindingKey !== before.bindingKey || current.scopeId !== before.scopeId) throw denied();
    const task = await db.aiTask.findFirst({ where: { AND: [current.taskWhere, { scopeId: current.scopeId }] }, select: { id: true, scopeId: true } });
    const receiptOnly = mode === 'accounting' && lease.expiresAt === '';
    const run = await db.aiRun.findFirst({ where: { scopeId: current.scopeId, taskId: lease.taskId, id: lease.runId,
      fencingToken: new prismaRuntime.Decimal(lease.fencingToken), revision: lease.revision, status: { in: statuses },
      ...(receiptOnly ? { OR: [{ status: { in: ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'] } },
        { leaseOwnerId: lease.holderId, leaseExpiresAt: { gt: this.wall() } },
        { leaseOwnerId: null, leaseExpiresAt: null }] }
        : { leaseOwnerId: lease.holderId, leaseExpiresAt: { gt: this.wall() } }) },
      select: { id: true, scopeId: true, taskId: true, leaseOwnerId: true, fencingToken: true, revision: true, status: true, leaseExpiresAt: true } });
    // A released or terminal receipt is not a held execution lease. It can
    // verify original measured time, never reserve or enter ordinary marker writes.
    const terminalReceipt = receiptOnly && run && (!['QUEUED', 'RUNNING'].includes(run.status)
      || run.leaseOwnerId === null && run.leaseExpiresAt === null);
    if (!task || task.id !== lease.taskId || task.scopeId !== current.scopeId || !run || run.id !== lease.runId
      || run.scopeId !== current.scopeId || run.taskId !== lease.taskId
      || run.fencingToken.toFixed(0) !== lease.fencingToken || run.revision !== lease.revision || !statuses.includes(run.status)
      || terminalReceipt && locked
      || !terminalReceipt && (run.leaseOwnerId !== lease.holderId || !run.leaseExpiresAt || run.leaseExpiresAt <= this.wall()
        || lease.expiresAt && Date.parse(lease.expiresAt) !== run.leaseExpiresAt.getTime())) throw denied();
    if (locked && (await db.aiRun.updateMany({ where: { scopeId: current.scopeId, taskId: lease.taskId, id: lease.runId,
      leaseOwnerId: lease.holderId, fencingToken: new prismaRuntime.Decimal(lease.fencingToken), revision: lease.revision,
      status: { in: statuses }, leaseExpiresAt: { gt: this.wall() } }, data: { revision: lease.revision } })).count !== 1) throw denied();
  }

  protected async locked<T>(lease: AiTaskRunnerLease,
    consume: (tx: Tx, access: Awaited<ReturnType<TaskRunPlanRepository['access']>>) => Promise<T>,
    mode: RunAccess = 'work') {
    lease = structuredClone(lease);
    const access = await this.access(lease, mode);
    try {
      return await this.db.$transaction(async tx => {
        const work = async () => {
          await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM ai_tasks WHERE scopeId = ${access.scopeId} AND id = ${lease.taskId} FOR UPDATE`);
          await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM ai_runs WHERE scopeId = ${access.scopeId} AND taskId = ${lease.taskId} AND id = ${lease.runId} FOR UPDATE`);
          await this.held(tx, lease, access, true, mode, tx);
          const result = await consume(tx, access);
          await this.held(tx, lease, access, true, mode, tx);
          return result;
        };
        if (mode === 'work' || this.nativeScope) return this.transactions.withAiTaskTransaction(tx,
          { kind: mode === 'work' ? 'task' : 'task_control', taskId: lease.taskId }, work);
        return work();
      }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskExecutionBudgetError) throw error;
      throw new AiTaskExecutionBudgetError('AI_STORAGE_UNAVAILABLE');
    }
  }

  /** Internal resource participant: execute no business/model callback in this transaction. */
  withHeldRun<T>(lease: AiTaskRunnerLease, participant: (tx: Prisma.TransactionClient, scopeId: string) => Promise<T>) {
    return this.locked(lease, (tx, access) => participant(tx, access.scopeId));
  }

  async assertHeldRun(lease: AiTaskRunnerLease) {
    const access = await this.access(lease);
    await this.held(this.db, lease, access);
    return access.scopeId;
  }

  /** Original time receipts only. A nonempty deadline still needs the exact
   * live holder; empty released/terminal observation can read saved measurements
   * after release/expiry, never capture, prepare, dispatch or write a new marker. */
  async assertAccountingRun(lease: AiTaskRunnerLease, transaction?: Tx, mode: 'accounting' | 'recovery_time' = 'accounting') {
    const native = this.nativeScope ? transaction : undefined;
    const access = await this.access(lease, mode, native);
    await this.held(native ?? this.db, lease, access, false, mode, native);
    return access.scopeId;
  }

  async withAccountingRun<T>(lease: AiTaskRunnerLease, participant: (tx: Prisma.TransactionClient, scopeId: string) => Promise<T>,
    mode: 'accounting' | 'recovery_time' = 'accounting') {
    if (!lease.expiresAt) throw denied();
    return this.locked(lease, (tx, access) => participant(tx, access.scopeId), mode);
  }

  /** Infrastructure-only final time participant. A terminal/absent holder alone
   * is insufficient: lock the exact released CAS+1 tuple, recheck current receipt
   * authority, and leave owner/deadline/fence untouched. The caller must also own
   * the original same-process measurement; no tool/model callback belongs here. */
  async withReleasedAccountingRun<T>(before: AiTaskRunnerLease, receipt: { released: true; revision: number },
    participant: (tx: Prisma.TransactionClient, scopeId: string) => Promise<T>) {
    before = structuredClone(before); receipt = structuredClone(receipt);
    if (!before.expiresAt || !Number.isFinite(Date.parse(before.expiresAt)) || receipt?.released !== true
      || !Number.isSafeInteger(receipt.revision) || receipt.revision !== before.revision + 1
      || receipt.revision > 0xffffffff) throw denied();
    const lease = { ...before, revision: receipt.revision, expiresAt: '' }, access = await this.access(lease, 'accounting');
    const key = { scopeId: access.scopeId, taskId: lease.taskId, id: lease.runId, revision: lease.revision,
      fencingToken: new prismaRuntime.Decimal(lease.fencingToken), leaseOwnerId: null, leaseExpiresAt: null };
    try {
      return await this.db.$transaction(async tx => {
        const work = async () => {
          await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM ai_tasks WHERE scopeId = ${access.scopeId} AND id = ${lease.taskId} FOR UPDATE`);
          await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM ai_runs WHERE scopeId = ${access.scopeId} AND taskId = ${lease.taskId} AND id = ${lease.runId} FOR UPDATE`);
          await this.held(tx, lease, access, false, 'accounting', tx);
          // The FOR UPDATE lock already fences this observation. A no-op Prisma
          // update would still change AiRun.updatedAt during original-time closure.
          if (!await tx.aiRun.findFirst({ where: key })) throw denied();
          const result = await participant(tx, access.scopeId);
          await this.held(tx, lease, access, false, 'accounting', tx);
          if (!await tx.aiRun.findFirst({ where: key })) throw denied();
          return result;
        };
        return this.nativeScope
          ? this.transactions.withAiTaskTransaction(tx, { kind: 'task_control', taskId: lease.taskId }, work) : work();
      }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskExecutionBudgetError) throw error;
      throw new AiTaskExecutionBudgetError('AI_STORAGE_UNAVAILABLE');
    }
  }

  async assertExecutable(lease: AiTaskRunnerLease) {
    lease = structuredClone(lease);
    const access = await this.access(lease);
    const task = await this.db.aiTask.findFirst({ where: { AND: [access.taskWhere, { scopeId: access.scopeId, status: 'RUNNING', cancelRequestedAt: null }] },
      select: { id: true, scopeId: true, status: true, cancelRequestedAt: true } });
    if (!task || task.id !== lease.taskId || task.scopeId !== access.scopeId || task.status !== 'RUNNING' || task.cancelRequestedAt !== null) throw denied();
    await this.held(this.db, lease, access);
  }

  async savePlan(value: AiTaskRunnerPlan, lease: AiTaskRunnerLease,
    publishInputs?: (tx: Tx, scopeId: string) => Promise<void>) {
    const plan = aiTaskRunPlanSchema.parse(structuredClone(value)); lease = structuredClone(lease);
    if (plan.taskId !== lease.taskId || plan.runId !== lease.runId || publishInputs && !this.nativeScope) throw denied();
    const proof = planProofSchema.parse(await this.authorize(plan, lease));
    if (Date.parse(proof.expiresAt) <= this.wall().getTime()) throw denied();
    return this.locked(lease, async (tx, access) => {
      const key = { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId };
      const hash = requestFingerprint(plan);
      const prior = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
      if (prior && (prior.planHash !== hash || prior.authorityHash !== proof.authorityHash || prior.policyVersion !== proof.policyVersion)) throw conflict();
      const current = planProofSchema.parse(await this.authorize(plan, lease, tx));
      if (current.authorityHash !== proof.authorityHash || current.policyVersion !== proof.policyVersion || Date.parse(current.expiresAt) <= this.wall().getTime()) throw denied();
      if (!prior) {
        const task = await tx.aiTask.updateMany({ where: { AND: [access.taskWhere, { revision: plan.taskRevision, cancelRequestedAt: null }] }, data: { revision: plan.taskRevision } });
        if (task.count !== 1) throw conflict();
        await publishInputs?.(tx, access.scopeId);
        await tx.aiTaskRunPlan.create({ data: { ...key, planHash: hash, authorityHash: proof.authorityHash, policyVersion: proof.policyVersion, payload: plan } });
      }
      if (this.nativeScope) {
        const final = planProofSchema.parse(await this.authorize(plan, lease, tx));
        if (final.authorityHash !== proof.authorityHash || final.policyVersion !== proof.policyVersion
          || Date.parse(final.expiresAt) <= this.wall().getTime()) throw denied();
      }
      return { planHash: hash, replayed: prior !== null };
    });
  }

  async resolve(task: AiTaskRunnerTaskMetadata, lease: AiTaskRunnerLease, recovery: boolean, accountingOnly = false, transaction?: Tx): Promise<AiTaskRunnerPlan> {
    task = structuredClone(task); lease = structuredClone(lease);
    if (accountingOnly && !recovery) throw denied();
    const native = this.nativeScope ? transaction : undefined, db = native ?? this.db;
    const mode = accountingOnly ? 'accounting' : recovery ? 'settle' : 'work';
    const access = await this.access(lease, mode, native);
    await this.held(db, lease, access, false, mode, native);
    const plan = await this.currentPlan(db, lease, access.scopeId, recovery, native);
    if (plan.taskId !== task.taskId) throw denied();
    await this.held(db, lease, access, false, mode, native);
    return { ...plan, taskRevision: task.revision };
  }

  async resourceOrigin(plan: AiTaskRunnerPlan, lease: AiTaskRunnerLease, accountingOnly = false, transaction?: Tx): Promise<AiTaskRunnerPlan> {
    plan = aiTaskRunPlanSchema.parse(structuredClone(plan)); lease = structuredClone(lease);
    const native = this.nativeScope ? transaction : undefined, db = native ?? this.db;
    const mode = accountingOnly ? 'accounting' : 'work';
    const access = await this.access(lease, mode, native);
    await this.held(db, lease, access, false, mode, native);
    const key = { scopeId: access.scopeId, taskId: lease.taskId };
    const run = await db.aiRun.findFirst({ where: { ...key, id: lease.runId } });
    if (!run || run.id !== lease.runId || run.scopeId !== key.scopeId || run.taskId !== key.taskId
      || plan.runId !== run.id || plan.taskId !== key.taskId) throw denied();
    if (run.inputReceiptId == null && run.resourceOriginRunId == null) {
      if (this.nativeScope) await this.held(db, lease, access, false, mode, native);
      return plan;
    }
    if (run.inputReceiptId == null && run.resourceOriginRunId && run.sequence > 1 && this.controlResourceOrigin) {
      if (run.actorKind !== 'USER') throw denied();
      const original = aiTaskRunPlanSchema.parse(await this.controlResourceOrigin({ ...key, runId: run.id,
        resourceOriginRunId: run.resourceOriginRunId }, native));
      const stored = await db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: {
        ...key, runId: run.resourceOriginRunId } } });
      if (!stored || stored.scopeId !== key.scopeId || stored.taskId !== key.taskId || stored.runId !== run.resourceOriginRunId
        || original.taskId !== key.taskId || original.runId !== run.resourceOriginRunId
        || stored.planHash !== requestFingerprint(stored.payload) || stored.planHash !== requestFingerprint(original)
        || Object.entries(original.limits).some(([name, ceiling]) => plan.limits[name as keyof typeof plan.limits] > ceiling)) throw denied();
      await this.held(db, lease, access, false, mode, native);
      return original;
    }
    if (!run.inputReceiptId || !run.resourceOriginRunId || run.sequence < 2) throw denied();
    const receipt = await db.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_id: { ...key, id: run.inputReceiptId } } });
    const request = receipt && await db.aiTaskInputRequest.findUnique({ where: { scopeId_taskId_id: { ...key, id: receipt.requestId } } });
    if (!receipt || receipt.id !== run.inputReceiptId || receipt.scopeId !== key.scopeId || receipt.taskId !== key.taskId
      || receipt.actorKind !== run.actorKind || receipt.actorId !== run.actorId || !receipt.consumedAt || !receipt.consumedTaskRevision
      || !request || request.id !== receipt.requestId || request.scopeId !== key.scopeId || request.taskId !== key.taskId
      || request.status !== 'CONSUMED' || request.planHash !== receipt.planHash || request.waitingTaskRevision + 1 !== receipt.consumedTaskRevision) throw denied();
    const parent = await db.aiRun.findFirst({ where: { ...key, id: request.runId } });
    const origin = await db.aiRun.findFirst({ where: { ...key, id: run.resourceOriginRunId } });
    if (!parent || parent.id !== request.runId || parent.scopeId !== key.scopeId || parent.taskId !== key.taskId
      || parent.sequence + 1 !== run.sequence || parent.status !== 'SUCCEEDED'
      || (parent.resourceOriginRunId ?? parent.id) !== run.resourceOriginRunId
      || !origin || origin.id !== run.resourceOriginRunId || origin.scopeId !== key.scopeId || origin.taskId !== key.taskId
      || origin.sequence !== 1 || origin.inputReceiptId != null || origin.resourceOriginRunId != null || origin.status !== 'SUCCEEDED') throw denied();
    const stored = await db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { ...key, runId: origin.id } } });
    if (!stored || stored.scopeId !== key.scopeId || stored.taskId !== key.taskId || stored.runId !== origin.id
      || requestFingerprint(stored.payload) !== stored.planHash) throw denied();
    const original = aiTaskRunPlanSchema.parse(stored.payload);
    if (original.taskId !== key.taskId || original.runId !== origin.id
      || Object.entries(original.limits).some(([name, ceiling]) => plan.limits[name as keyof typeof plan.limits] > ceiling)) throw denied();
    await this.held(db, lease, access, false, mode, native);
    return original;
  }

  protected async currentPlan(db: Pick<PrismaClient, 'aiTaskRunPlan'>, lease: AiTaskRunnerLease, scopeId: string, originalOnly = false, transaction?: Tx) {
    const row = await db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { scopeId, taskId: lease.taskId, runId: lease.runId } } });
    if (!row) throw unavailable();
    if (row.scopeId !== scopeId || row.taskId !== lease.taskId || row.runId !== lease.runId
      || !/^[a-f0-9]{64}$/u.test(row.authorityHash) || !id.max(64).safeParse(row.policyVersion).success) throw denied();
    const plan = aiTaskRunPlanSchema.parse(structuredClone(row.payload));
    if (plan.taskId !== lease.taskId || plan.runId !== lease.runId || requestFingerprint(plan) !== row.planHash) throw denied();
    // The saved plan was authorized before publication. Reconciliation reads
    // that immutable provenance under current owner/action/lease checks; a
    // closed or replaced *new execution* policy must not erase old debt.
    // Only normal execution/capture reauthorizes a fresh plan here.
    if (!originalOnly) {
      const proof = planProofSchema.parse(await this.authorize(plan, lease, transaction));
      if (proof.authorityHash !== row.authorityHash || proof.policyVersion !== row.policyVersion || Date.parse(proof.expiresAt) <= this.wall().getTime()) throw denied();
    }
    return plan;
  }
}
