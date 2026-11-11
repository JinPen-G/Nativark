import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { Prisma, type PrismaClient, type AiStepStatus, type AiStep } from '@prisma/client';
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION, AI_PROPOSAL_DRAFT_VERSION, type AiGatewayConfigReferenceDraft } from '@rental-os/shared';
import { taskExecutionPhaseStore } from './task-execution-phase.store';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskExecutionBudgetError, type AiTaskExecutionEvidenceSource, type AiTaskExecutionSettlementRequest } from '../task-execution-budget.ports';
import type { AiTaskExecutionScopeSource } from './prisma-task-execution-budget.repository';
import type { AiTaskRunnerLease, AiTaskRunnerPlan, AiTaskRunnerTaskMetadata, AiTaskRunnerEffectResult, AiTaskRunnerObservedResult, AiTaskRunnerConfirmationContinuation } from './ai-task-runner.ports';
import type { PersistedBudgetEvidenceSource } from '../budget/budget-dependency-adapters';
import { isGatewayConfig } from '../gateway-contract-validation';
import { readModelNonDispatchEvidence } from '../model-input/prisma-model-nondispatch.evidence';
import { isTaskModelCountCharge, taskStepChargesValid } from './task-model-count-charge';
import { PrismaCountTokensReceipts, countTokensOperationId, countTokensCallId, countTokensSceneCode } from '../input-counting/input-count-tokens.receipt';
import type { composeControlledApprovedOrder } from '../approval-execution/controlled-approved-order.composition';
type OrderBusiness = ReturnType<typeof composeControlledApprovedOrder>['waiting'];
export type AiTaskOrderPhaseBusinessEvidence = {
  readWaiting(input: Parameters<OrderBusiness['readWaiting']>[0], tx?: Prisma.TransactionClient): ReturnType<OrderBusiness['readWaiting']>;
  reconcile(input: Parameters<OrderBusiness['reconcile']>[0], tx?: Prisma.TransactionClient): ReturnType<OrderBusiness['reconcile']>;
};
export type AiConfirmationTool = 'rental.order.commit' | 'tenant.notifications.commit' | 'membership.profile.commit';
/** Exact domain phase version, not a general-purpose confirmation registry. */
export function aiTaskConfirmationPhaseVersion(tool: string) {
  if (tool === 'rental.order.commit') return 'approved-order-wait-1';
  if (tool === 'tenant.notifications.commit') return 'approved-settings-wait-1';
  if (tool === 'membership.profile.commit') return 'approved-profile-wait-1';
  throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
}

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const confirmationContinuationSchema = z.object({ checkpointRef: id.max(36), stepId: id.max(36),
  stepRevision: z.number().int().positive().max(4294967294), decisionRef: id.max(36), decision: z.enum(['approved', 'rejected']),
  remainingActiveMs: z.number().int().min(1).max(86400000), remainingOutputBytes: z.number().int().min(1).max(16777216) }).strict();
const resumedConfirmationSchema = z.object({ data: z.object({ from: z.literal('waiting_confirmation'), to: z.literal('running'), reason: z.literal('resume') }).strict(),
  confirmation: confirmationContinuationSchema.extend({ phaseId: id.max(36), contentHash: hash, runId: id.max(36),
    runRevision: z.number().int().positive().max(4294967294), holderId: id, fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u) }).strict() }).passthrough();
const orderPhasePayloadSchema = z.object({ version: z.enum(['approved-order-wait-1', 'approved-settings-wait-1', 'approved-profile-wait-1']),
  binding: z.object({ scopeId: id.max(36), taskId: id.max(36), runId: id.max(36), stepId: id.max(36), actionId: id, inputRef: id.max(36), fingerprint: hash }).strict(),
  presentedLease: z.object({ taskId: id.max(36), runId: id.max(36), holderId: id, revision: z.number().int().positive().max(4294967294),
    fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u), expiresAt: z.string().datetime({ offset: true }) }).strict(),
  proposal: z.object({ contractVersion: z.literal(AI_PROPOSAL_DRAFT_VERSION), proposalId: id.max(36),
    proposalRevision: z.number().int().positive().max(4294967294), reviewedPayloadHash: hash }).strict().optional(),
  effectState: z.enum(['awaiting_decision', 'rejected', 'preparation_unknown', 'unresolved', 'committed']),
  proposalId: id.max(36).optional(), decisionRef: id.max(36).optional(), decision: z.enum(['approved', 'rejected']).optional(),
  businessResultRef: id.optional(), replayed: z.boolean().optional() }).strict();
export const aiTaskRunnerLimitsSchema = z.object({ maxSteps: z.number().int().min(1).max(1000), maxCalls: z.number().int().min(1).max(1000), maxConcurrent: z.literal(1),
  maxTotalMs: z.number().int().min(1).max(86400000), maxStepMs: z.number().int().min(1).max(86400000), maxOutputBytes: z.number().int().min(1).max(16777216) }).strict();
export function isAiTaskRunPlanBounded(plan: Pick<AiTaskRunnerPlan, 'steps' | 'limits'>) {
  return plan.steps.length <= plan.limits.maxSteps && plan.limits.maxStepMs <= plan.limits.maxTotalMs
    && new Set(plan.steps.map(step => step.registrationRef)).size === plan.steps.length;
}
const planSchema = z.object({ taskId: id.max(36), runId: id.max(36), taskRevision: z.number().int().min(1).max(4294967294),
  steps: z.array(z.object({ registrationRef: id, operation: z.enum(['readonly', 'idempotent', 'external_unknown']), toolCode: id, toolVersion: id }).strict()).max(1000),
  limits: aiTaskRunnerLimitsSchema
}).strict().refine(isAiTaskRunPlanBounded);
export { planSchema as aiTaskRunPlanSchema };
// Read-only original receipt consumers share the persisted validators, not
// the live execution/lease authorization performed by this repository.
export { orderPhasePayloadSchema as aiTaskConfirmationPhasePayloadSchema,
  resumedConfirmationSchema as aiTaskResumedConfirmationSchema };
const proofSchema = z.object({ authorityHash: z.string().regex(/^[a-f0-9]{64}$/u), policyVersion: id.max(64), expiresAt: z.string().datetime({ offset: true }) }).strict();
export interface AiTaskPlanEvidenceAuthority {
  /** Server-owned action/limits/configuration policy. A model cannot attest its own plan. */
  authorize(plan: Readonly<AiTaskRunnerPlan>, lease: Readonly<AiTaskRunnerLease>): Promise<z.infer<typeof proofSchema>>;
  /** Resource-definition admission before input publication, NOT plan authorization. */
  authorizePreparation?: (definition: import('./task-run-preparation.ports').AiTaskPreparationDefinition,
    lease: AiTaskRunnerLease, db?: Prisma.TransactionClient) => Promise<z.infer<typeof proofSchema>>;
  /** Current-authorized binding of an existing step, never a start grant. */
  resolveOriginal?: (command: import('../ai-step-registration.repository').AiStepRegistrationCommand,
    tx?: Prisma.TransactionClient) => Promise<import('../ai-step-registration.repository').AiStepOriginalRegistrationGrant>;
}
type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskRunPlan' | 'aiTaskInputRequest' | 'aiTaskInputReceipt' | 'aiTaskResultArtifact' | 'aiTaskExecutionCharge' | 'aiGatewayInvocation' | 'aiGatewayAccountingReceipt' | 'aiInvocationAdmission' | 'aiBudgetReservation'> & Partial<Pick<PrismaClient, 'operationLog'>>;
type Tx = Prisma.TransactionClient;
const unavailable = () => new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
const conflict = () => new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');

/** Immutable plans/artifacts, current-owner scoped. No worker registration, model
 * call, approval, dispatch or financial ledger. Missing policy remains unavailable.
 * Activity means the measured uninterrupted tool interval, not paused wall time.
 */
export class PrismaTaskRunEvidenceRepository implements AiTaskExecutionEvidenceSource {
  private toolActivityObserver?: (lease: AiTaskRunnerLease, chargeId: string, started: number, ended: number) => void;

  /** Composition-only timing handoff. Neither callback data nor a client field
   * can supply an interval; capture derives it from this process's clock and the
   * locked original ACTIVE_MS reservation. Bind once, before running work. */
  bindToolActivityObserver(observer: NonNullable<PrismaTaskRunEvidenceRepository['toolActivityObserver']>) {
    if (this.toolActivityObserver || typeof observer !== 'function') throw unavailable();
    this.toolActivityObserver = observer;
  }

  constructor(private readonly db: Db, private readonly scopes: AiTaskExecutionScopeSource,
    private readonly planAuthority: AiTaskPlanEvidenceAuthority, private readonly wall: () => Date = () => new Date(),
    private readonly monotonic: () => number = () => performance.now(),
    private readonly financialEvidence?: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>,
    private readonly orderEvidence?: AiTaskOrderPhaseBusinessEvidence,
    private readonly confirmationTool: AiConfirmationTool = 'rental.order.commit') {
    if (typeof db?.$transaction !== 'function' || typeof db?.aiTaskRunPlan?.findUnique !== 'function'
      || typeof db?.aiTaskResultArtifact?.create !== 'function' || typeof scopes?.resolve !== 'function' || typeof planAuthority?.authorize !== 'function'
      || !['rental.order.commit', 'tenant.notifications.commit', 'membership.profile.commit'].includes(confirmationTool)
      || (orderEvidence && (typeof orderEvidence.readWaiting !== 'function' || typeof orderEvidence.reconcile !== 'function'))) throw unavailable();
  }

  private phasePayload(value: unknown) {
    const parsed = orderPhasePayloadSchema.parse(value);
    if (parsed.version !== aiTaskConfirmationPhaseVersion(this.confirmationTool)) throw denied();
    return parsed;
  }

  private async access(lease: AiTaskRunnerLease, accountingOnly = false) {
    lease = structuredClone(lease);
    if (!lease || !id.max(36).safeParse(lease.taskId).success || !id.max(36).safeParse(lease.runId).success || !id.safeParse(lease.holderId).success
      || !/^[1-9][0-9]{0,19}$/u.test(lease.fencingToken) || !Number.isSafeInteger(lease.revision) || lease.revision < 1) throw denied();
    const operation = accountingOnly && lease.expiresAt === '' ? 'settle_released_run' : 'write';
    const access = structuredClone(await this.scopes.resolve(lease.taskId, lease, operation));
    if (!access?.scopeId || access.taskWhere?.id !== lease.taskId || !access.bindingKey) throw denied();
    return access;
  }

  private async held(db: Pick<PrismaClient, 'aiTask' | 'aiRun'>, lease: AiTaskRunnerLease, before: Awaited<ReturnType<PrismaTaskRunEvidenceRepository['access']>>, locked = false, accountingOnly = false) {
    const statuses: import('@prisma/client').AiTaskStatus[] = accountingOnly
      ? ['QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'] : ['QUEUED', 'RUNNING'];
    const current = await this.access(lease, accountingOnly);
    if (current.bindingKey !== before.bindingKey || current.scopeId !== before.scopeId) throw denied();
    const task = await db.aiTask.findFirst({ where: { AND: [current.taskWhere, { scopeId: current.scopeId }] }, select: { id: true, scopeId: true } });
    const receiptOnly = accountingOnly && lease.expiresAt === '';
    const run = await db.aiRun.findFirst({ where: { scopeId: current.scopeId, taskId: lease.taskId, id: lease.runId,
      fencingToken: new Prisma.Decimal(lease.fencingToken), revision: lease.revision, status: { in: statuses },
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
      leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken), revision: lease.revision,
      status: { in: statuses }, leaseExpiresAt: { gt: this.wall() } }, data: { revision: lease.revision } })).count !== 1) throw denied();
  }

  private async locked<T>(lease: AiTaskRunnerLease, consume: (tx: Tx, access: Awaited<ReturnType<PrismaTaskRunEvidenceRepository['access']>>) => Promise<T>, accountingOnly = false) {
    lease = structuredClone(lease); const access = await this.access(lease);
    try {
      return await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${access.scopeId} AND id = ${lease.taskId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${access.scopeId} AND taskId = ${lease.taskId} AND id = ${lease.runId} FOR UPDATE`);
        await this.held(tx, lease, access, true, accountingOnly);
        const result = await consume(tx, access);
        await this.held(tx, lease, access, true, accountingOnly);
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
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
  async assertAccountingRun(lease: AiTaskRunnerLease) {
    const access = await this.access(lease, true);
    await this.held(this.db, lease, access, false, true);
    return access.scopeId;
  }

  async withAccountingRun<T>(lease: AiTaskRunnerLease, participant: (tx: Prisma.TransactionClient, scopeId: string) => Promise<T>) {
    if (!lease.expiresAt) throw denied();
    return this.locked(lease, (tx, access) => participant(tx, access.scopeId), true);
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
    const lease = { ...before, revision: receipt.revision, expiresAt: '' }, access = await this.access(lease, true);
    const key = { scopeId: access.scopeId, taskId: lease.taskId, id: lease.runId, revision: lease.revision,
      fencingToken: new Prisma.Decimal(lease.fencingToken), leaseOwnerId: null, leaseExpiresAt: null };
    try {
      return await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${access.scopeId} AND id = ${lease.taskId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${access.scopeId} AND taskId = ${lease.taskId} AND id = ${lease.runId} FOR UPDATE`);
        await this.held(tx, lease, access, false, true);
        // The FOR UPDATE lock already fences this observation. A no-op Prisma
        // update would still change AiRun.updatedAt during original-time closure.
        if (!await tx.aiRun.findFirst({ where: key })) throw denied();
        const result = await participant(tx, access.scopeId);
        await this.held(tx, lease, access, false, true);
        if (!await tx.aiRun.findFirst({ where: key })) throw denied();
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
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

  async savePlan(value: AiTaskRunnerPlan, lease: AiTaskRunnerLease) {
    const plan = planSchema.parse(structuredClone(value)); lease = structuredClone(lease);
    if (plan.taskId !== lease.taskId || plan.runId !== lease.runId) throw denied();
    const proof = proofSchema.parse(structuredClone(await this.planAuthority.authorize(structuredClone(plan), structuredClone(lease))));
    if (Date.parse(proof.expiresAt) <= this.wall().getTime()) throw denied();
    return this.locked(lease, async (tx, access) => {
      const key = { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId };
      const hash = requestFingerprint(plan);
      const prior = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
      if (prior && (prior.planHash !== hash || prior.authorityHash !== proof.authorityHash || prior.policyVersion !== proof.policyVersion)) throw conflict();
      const current = proofSchema.parse(await this.planAuthority.authorize(structuredClone(plan), structuredClone(lease)));
      if (current.authorityHash !== proof.authorityHash || current.policyVersion !== proof.policyVersion || Date.parse(current.expiresAt) <= this.wall().getTime()) throw denied();
      if (!prior) {
        const task = await tx.aiTask.updateMany({ where: { AND: [access.taskWhere, { revision: plan.taskRevision, cancelRequestedAt: null }] }, data: { revision: plan.taskRevision } });
        if (task.count !== 1) throw conflict();
        await tx.aiTaskRunPlan.create({ data: { ...key, planHash: hash, authorityHash: proof.authorityHash, policyVersion: proof.policyVersion, payload: plan } });
      }
      return { planHash: hash, replayed: prior !== null };
    });
  }

  async resolve(task: AiTaskRunnerTaskMetadata, lease: AiTaskRunnerLease, recovery: boolean, accountingOnly = false): Promise<AiTaskRunnerPlan> {
    task = structuredClone(task); lease = structuredClone(lease);
    if (accountingOnly && !recovery) throw denied();
    const access = await this.access(lease, accountingOnly); await this.held(this.db, lease, access, false, accountingOnly);
    const plan = await this.currentPlan(this.db, lease, access.scopeId, recovery);
    if (plan.taskId !== task.taskId) throw denied();
    await this.held(this.db, lease, access, false, accountingOnly);
    return { ...plan, taskRevision: task.revision };
  }

  async resourceOrigin(plan: AiTaskRunnerPlan, lease: AiTaskRunnerLease, accountingOnly = false): Promise<AiTaskRunnerPlan> {
    plan = planSchema.parse(structuredClone(plan)); lease = structuredClone(lease);
    const access = await this.access(lease, accountingOnly); await this.held(this.db, lease, access, false, accountingOnly);
    const key = { scopeId: access.scopeId, taskId: lease.taskId };
    const run = await this.db.aiRun.findFirst({ where: { ...key, id: lease.runId } });
    if (!run || run.id !== lease.runId || run.scopeId !== key.scopeId || run.taskId !== key.taskId
      || plan.runId !== run.id || plan.taskId !== key.taskId) throw denied();
    if (run.inputReceiptId == null && run.resourceOriginRunId == null) return plan;
    if (!run.inputReceiptId || !run.resourceOriginRunId || run.sequence < 2) throw denied();
    const receipt = await this.db.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_id: { ...key, id: run.inputReceiptId } } });
    const request = receipt && await this.db.aiTaskInputRequest.findUnique({ where: { scopeId_taskId_id: { ...key, id: receipt.requestId } } });
    if (!receipt || receipt.id !== run.inputReceiptId || receipt.scopeId !== key.scopeId || receipt.taskId !== key.taskId
      || receipt.actorKind !== run.actorKind || receipt.actorId !== run.actorId || !receipt.consumedAt || !receipt.consumedTaskRevision
      || !request || request.id !== receipt.requestId || request.scopeId !== key.scopeId || request.taskId !== key.taskId
      || request.status !== 'CONSUMED' || request.planHash !== receipt.planHash || request.waitingTaskRevision + 1 !== receipt.consumedTaskRevision) throw denied();
    const parent = await this.db.aiRun.findFirst({ where: { ...key, id: request.runId } });
    const origin = await this.db.aiRun.findFirst({ where: { ...key, id: run.resourceOriginRunId } });
    if (!parent || parent.id !== request.runId || parent.scopeId !== key.scopeId || parent.taskId !== key.taskId
      || parent.sequence + 1 !== run.sequence || parent.status !== 'SUCCEEDED'
      || (parent.resourceOriginRunId ?? parent.id) !== run.resourceOriginRunId
      || !origin || origin.id !== run.resourceOriginRunId || origin.scopeId !== key.scopeId || origin.taskId !== key.taskId
      || origin.sequence !== 1 || origin.inputReceiptId != null || origin.resourceOriginRunId != null || origin.status !== 'SUCCEEDED') throw denied();
    const stored = await this.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { ...key, runId: origin.id } } });
    if (!stored || stored.scopeId !== key.scopeId || stored.taskId !== key.taskId || stored.runId !== origin.id
      || requestFingerprint(stored.payload) !== stored.planHash) throw denied();
    const original = planSchema.parse(stored.payload);
    if (original.taskId !== key.taskId || original.runId !== origin.id
      || Object.entries(original.limits).some(([name, ceiling]) => plan.limits[name as keyof typeof plan.limits] > ceiling)) throw denied();
    await this.held(this.db, lease, access, false, accountingOnly);
    return original;
  }

  private async currentPlan(db: Pick<PrismaClient, 'aiTaskRunPlan'>, lease: AiTaskRunnerLease, scopeId: string, originalOnly = false) {
    const row = await db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { scopeId, taskId: lease.taskId, runId: lease.runId } } });
    if (!row) throw unavailable();
    if (row.scopeId !== scopeId || row.taskId !== lease.taskId || row.runId !== lease.runId
      || !/^[a-f0-9]{64}$/u.test(row.authorityHash) || !id.max(64).safeParse(row.policyVersion).success) throw denied();
    const plan = planSchema.parse(structuredClone(row.payload));
    if (plan.taskId !== lease.taskId || plan.runId !== lease.runId || requestFingerprint(plan) !== row.planHash) throw denied();
    // The saved plan was authorized before publication. Reconciliation reads
    // that immutable provenance under current owner/action/lease checks; a
    // closed or replaced *new execution* policy must not erase old debt.
    // Only normal execution/capture reauthorizes a fresh plan here.
    if (!originalOnly) {
      const proof = proofSchema.parse(structuredClone(await this.planAuthority.authorize(structuredClone(plan), structuredClone(lease))));
      if (proof.authorityHash !== row.authorityHash || proof.policyVersion !== row.policyVersion || Date.parse(proof.expiresAt) <= this.wall().getTime()) throw denied();
    }
    return plan;
  }

  private async continuationBasis(tx: Tx, scopeId: string, lease: AiTaskRunnerLease, step: AiStep, continuation: AiTaskRunnerConfirmationContinuation) {
    const key = { scopeId, taskId: lease.taskId, runId: lease.runId, stepId: step.id }, phases = taskExecutionPhaseStore(tx);
    const starts = await phases.readStarts(key), receipt = await phases.readReceipt({ ...key, id: continuation.checkpointRef });
    const first = starts[0];
    if (starts.length !== 1 || first.sequence !== 1 || !receipt || receipt.kind !== 'confirmation' || receipt.id !== continuation.checkpointRef
      || receipt.phaseId !== first.id || Object.entries(key).some(([k, v]) => first[k as keyof typeof first] !== v || receipt[k as keyof typeof receipt] !== v)
      || first.actionId !== step.actionId || first.inputRef !== step.inputRef || first.stepFingerprint !== step.requestFingerprint
      || first.stepRevision !== step.revision || continuation.stepId !== step.id || continuation.stepRevision !== step.revision
      || BigInt(first.fencingToken) > BigInt(lease.fencingToken) || first.runRevision > lease.revision
      || (first.fencingToken === lease.fencingToken && first.leaseOwnerId !== lease.holderId)
      || requestFingerprint(receipt.payload) !== receipt.contentHash || BigInt(Buffer.byteLength(JSON.stringify(receipt.payload), 'utf8')) !== receipt.outputBytes) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
    const task = await tx.aiTask.findFirst({ where: { scopeId, id: lease.taskId } });
    if (!task || task.id !== lease.taskId || task.scopeId !== scopeId || task.status !== 'RUNNING' || task.cancelRequestedAt !== null) throw denied();
    const event = await tx.aiTaskEvent.findFirst({ where: { scopeId, taskId: lease.taskId, taskRevision: task.revision, cursor: task.eventCursor, type: 'task.transition' } });
    const resumed = resumedConfirmationSchema.parse(event?.payload);
    if (!event || event.scopeId !== scopeId || event.taskId !== task.id || event.taskRevision !== task.revision || event.cursor !== task.eventCursor
      || requestFingerprint(resumed.confirmation) !== requestFingerprint({ ...continuation, phaseId: first.id, contentHash: receipt.contentHash,
        runId: lease.runId, runRevision: lease.revision, holderId: lease.holderId, fencingToken: lease.fencingToken })) throw denied();
    const approval = await tx.aiApproval.findFirst({ where: { scopeId, taskId: lease.taskId, id: continuation.decisionRef } });
    const proposal = await tx.aiProposal.findFirst({ where: { scopeId, taskId: lease.taskId, id: receipt.proposalId! } });
    if (!approval || approval.id !== continuation.decisionRef || approval.scopeId !== scopeId || approval.taskId !== task.id
      || approval.proposalId !== receipt.proposalId || approval.proposalRevision !== receipt.proposalRevision || approval.payloadHash !== receipt.reviewedPayloadHash
      || approval.actorKind !== task.ownerKind || approval.actorId !== task.ownerId || approval.audience !== task.audience
      || approval.decision !== continuation.decision.toUpperCase() || !(approval.issuedAt instanceof Date) || !(approval.expiresAt instanceof Date)
      || approval.issuedAt > this.wall() || approval.issuedAt >= approval.expiresAt || approval.expiresAt <= this.wall()
      || !proposal || proposal.id !== receipt.proposalId || proposal.scopeId !== scopeId || proposal.taskId !== task.id
      || proposal.currentRevision !== receipt.proposalRevision || proposal.status !== (continuation.decision === 'approved' ? 'CONFIRMED' : 'CANCELLED')
      || await tx.aiApprovalConsumption.findFirst({ where: { scopeId, taskId: lease.taskId, actionId: step.actionId } })) throw denied();
    const artifacts = await tx.aiTaskResultArtifact.findMany({ where: key, take: 2 }), artifact = artifacts[0];
    if (artifacts.length !== 1 || artifact.id !== first.originalArtifactId || artifact.actionId !== first.actionId || artifact.stepFingerprint !== first.stepFingerprint
      || artifact.leaseOwnerId !== first.leaseOwnerId || artifact.fencingToken.toFixed(0) !== first.fencingToken
      || artifact.outcome !== 'RUNNING' || artifact.completeMeasurement || artifact.outputBytes !== 0n || artifact.activeMs !== 0n
      || requestFingerprint(artifact.payload) !== requestFingerprint({}) || artifact.contentHash !== requestFingerprint({})) throw denied();
    return { first, receipt, artifact };
  }

  /** Internal registered-tool boundary. Callback data is saved, not its claimed
   * outputBytes/timing. No DB transaction is held during the tool wait. Callback
   * and signal come from the server's bounded runner, never an HTTP/model field.
   */
  async capture(lease: AiTaskRunnerLease, stepId: string, signal: AbortSignal,
    execute: () => Promise<AiTaskRunnerObservedResult>, phase?: 'confirmation' | AiTaskRunnerConfirmationContinuation,
    prepare?: () => Promise<void>): Promise<AiTaskRunnerEffectResult> {
    // Current authorization, charge reads and the original marker COMMIT are
    // active work too. Start before those waits so recreation cannot make this
    // prefix free; a new confirmation invocation still excludes human waiting.
    const started = this.monotonic();
    if (!Number.isFinite(started)) throw unavailable();
    lease = structuredClone(lease);
    const continuing = typeof phase === 'object' && phase !== null ? confirmationContinuationSchema.parse(structuredClone(phase)) : null;
    if (!id.max(36).safeParse(stepId).success || typeof execute !== 'function' || signal.aborted) throw denied();
    const access = await this.access(lease); await this.held(this.db, lease, access);
    const step = await this.db.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: stepId, status: 'RUNNING', resultRef: null } });
    if (!step) throw denied();
    if (prepare && (typeof prepare !== 'function' || phase !== undefined || step.effect !== 'POSSIBLE')) throw denied();
    const readyCharge = (charge: { status: string; actualAmount: bigint | null; evidenceRef: string | null } & Parameters<typeof isTaskModelCountCharge>[0]) =>
      isTaskModelCountCharge(charge) ? charge.status === 'RECORDED' && charge.actualAmount === 1n
        && charge.evidenceRef === `count:${charge.gatewayInvocationId}` : charge.status === 'RESERVED';
    if (phase !== undefined && ((!continuing && phase !== 'confirmation') || step.toolCode !== this.confirmationTool
      || step.toolVersion !== AI_TOOL_DRAFT_VERSION || step.effect !== 'POSSIBLE' || !step.inputRef)) throw denied();
    const charges = await this.db.aiTaskExecutionCharge.findMany({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId,
      actionId: step.actionId, stepFingerprint: step.requestFingerprint }, take: 6 });
    if (!taskStepChargesValid(charges) || prepare && (charges.length !== 3 || charges.some(c => c.gatewayInvocationId !== null))
      || charges.some(c => !readyCharge(c)
        || (!continuing && (c.leaseOwnerId !== lease.holderId || c.fencingToken.toFixed(0) !== lease.fencingToken)))) throw unavailable();
    if (phase && (charges.length !== 3 || charges.some(c => c.gatewayInvocationId !== null || c.resource === 'CALLS'))) throw unavailable();
    if (charges.some(c => c.resource === 'CALLS' || c.gatewayInvocationId)
      && typeof this.financialEvidence?.readDispatch !== 'function') throw unavailable();
    const prior = await this.db.aiTaskResultArtifact.findUnique({ where: { scopeId_taskId_runId_stepId_fencingToken: {
      scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId, fencingToken: new Prisma.Decimal(lease.fencingToken) } } });
    if (prior && !continuing) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
    const ref = randomUUID();
    // A durable started marker precedes the callback. Its unique generation key
    // prevents two instances executing while neither has a completed artifact.
    // COMMIT acknowledgement loss leaves an incomplete marker, not retry permission.
    const firstPhase = structuredClone(await this.locked(lease, async tx => {
      const plan = await this.currentPlan(tx, lease, access.scopeId);
      const phases = phase ? taskExecutionPhaseStore(tx) : null;
      if (phases && !continuing && ((await phases.readStarts({ scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId })).length !== 0
        || await tx.aiTaskResultArtifact.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId } }))) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
      const basis = continuing ? await this.continuationBasis(tx, access.scopeId, lease, step, continuing) : null;
      if (basis && basis.first.planHash !== requestFingerprint(plan)) throw denied();
      const current = await tx.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: stepId,
        status: 'RUNNING', resultRef: null, revision: step.revision, actionId: step.actionId, requestFingerprint: step.requestFingerprint } });
      if (!current) throw denied();
      // Re-read under the run lock rather than granting execution from the
      // pre-lock charge snapshot. Resource mutations use the same lock order.
      const lockedCharges = await tx.aiTaskExecutionCharge.findMany({ where: { scopeId: access.scopeId, taskId: lease.taskId,
        runId: lease.runId, stepId, actionId: current.actionId, stepFingerprint: current.requestFingerprint }, take: 6 });
      if (lockedCharges.length !== charges.length || !taskStepChargesValid(lockedCharges) || lockedCharges.some(c => !readyCharge(c)
        || c.leaseOwnerId !== (basis?.artifact.leaseOwnerId ?? lease.holderId) || c.fencingToken.toFixed(0) !== (basis?.first.fencingToken ?? lease.fencingToken)
        || !charges.some(before => before.chargeId === c.chargeId && before.resource === c.resource && before.requestFingerprint === c.requestFingerprint))) throw denied();
      if (basis && continuing && (lockedCharges.some(c => c.chargeId !== (c.resource === 'STEPS' ? basis.first.stepsChargeId
        : c.resource === 'ACTIVE_MS' ? basis.first.activeMsChargeId : basis.first.outputBytesChargeId))
        || continuing.remainingActiveMs > Math.min(plan.limits.maxStepMs, Number(lockedCharges.find(c => c.resource === 'ACTIVE_MS')!.amount)) - Number(basis.receipt.activeMs)
        || continuing.remainingOutputBytes > Math.min(plan.limits.maxOutputBytes, Number(lockedCharges.find(c => c.resource === 'OUTPUT_BYTES')!.amount)) - Number(basis.receipt.outputBytes))) throw denied();
      if (phases && (current.inputRef !== step.inputRef || current.toolCode !== this.confirmationTool
        || current.toolVersion !== AI_TOOL_DRAFT_VERSION || current.effect !== 'POSSIBLE')) throw denied();
      if (!basis) await tx.aiTaskResultArtifact.create({ data: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId, id: ref,
        actionId: step.actionId, stepFingerprint: step.requestFingerprint, leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken),
        outcome: 'RUNNING', payload: {}, contentHash: requestFingerprint({}), outputBytes: 0n, activeMs: 0n, completeMeasurement: false } });
      if (!phases) return null;
      return phases.createStart({ scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId, id: randomUUID(),
        originalArtifactId: basis?.artifact.id ?? ref, inputRef: current.inputRef!, actionId: current.actionId, stepFingerprint: current.requestFingerprint,
        planHash: requestFingerprint(plan), leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken),
        runRevision: lease.revision, stepRevision: current.revision, sequence: basis ? 2 : 1,
        previousReceiptId: basis?.receipt.id ?? null, decisionRef: continuing?.decisionRef ?? null,
        stepsChargeId: lockedCharges.find(c => c.resource === 'STEPS')!.chargeId,
        activeMsChargeId: lockedCharges.find(c => c.resource === 'ACTIVE_MS')!.chargeId,
        outputBytesChargeId: lockedCharges.find(c => c.resource === 'OUTPUT_BYTES')!.chargeId, createdAt: this.wall() });
    }));
    if (signal.aborted) throw unavailable();
    if (prepare) {
      // Count is an external request too. Its preparation runs only after the
      // original marker committed, so a crash can always reopen that marker.
      await prepare();
      if (signal.aborted) throw unavailable();
      await this.locked(lease, async tx => {
        await this.currentPlan(tx, lease, access.scopeId);
        const marker = await tx.aiTaskResultArtifact.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId,
          runId: lease.runId, stepId, id: ref, outcome: 'RUNNING', completeMeasurement: false } });
        const preparedCharges = await tx.aiTaskExecutionCharge.findMany({ where: { scopeId: access.scopeId,
          taskId: lease.taskId, runId: lease.runId, stepId, actionId: step.actionId, stepFingerprint: step.requestFingerprint }, take: 6 });
        if (!marker || marker.leaseOwnerId !== lease.holderId || marker.fencingToken.toFixed(0) !== lease.fencingToken
          || !taskStepChargesValid(preparedCharges, true) || typeof this.financialEvidence?.readDispatch !== 'function'
          || preparedCharges.some(c => !readyCharge(c) || c.leaseOwnerId !== lease.holderId || c.fencingToken.toFixed(0) !== lease.fencingToken)
          || charges.some(before => !preparedCharges.some(c => c.chargeId === before.chargeId && c.requestFingerprint === before.requestFingerprint))) throw denied();
      });
      if (signal.aborted) throw unavailable();
    }
    const result = structuredClone(await execute()), ended = this.monotonic(), elapsed = ended - started;
    if (signal.aborted || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 86400000
      || !['succeeded', 'failed', 'unknown', ...(firstPhase ? ['paused'] : [])].includes(result.kind)
      || result.kind === 'paused' && (!firstPhase || result.pause !== 'confirmation')
      || result.kind === 'failed' && !/^[A-Z][A-Z0-9_]{0,127}$/u.test(result.errorCode ?? '')) throw unavailable();
    const encoded = JSON.stringify(result.payload); if (typeof encoded !== 'string') throw unavailable();
    const outputBytes = Buffer.byteLength(encoded, 'utf8');
    if (outputBytes > 16777216) throw new AiTaskExecutionBudgetError('AI_RUN_LIMIT');
    const activeMs = BigInt(Math.ceil(elapsed));
    const timeCharge = charges.find(charge => charge.resource === 'ACTIVE_MS');
    if (!timeCharge || activeMs > timeCharge.amount) throw unavailable();
    if (firstPhase) {
      const payload = this.phasePayload(result.payload);
      if (requestFingerprint(payload.binding) !== requestFingerprint({ scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId,
        stepId, actionId: step.actionId, inputRef: step.inputRef, fingerprint: step.requestFingerprint })
        || requestFingerprint(payload.presentedLease) !== requestFingerprint(lease)
        || (result.kind === 'paused' && (firstPhase.sequence !== 1 || payload.effectState !== 'awaiting_decision' || !payload.proposal || payload.decisionRef || payload.decision || payload.businessResultRef))
        || (continuing && ((payload.decisionRef !== undefined && payload.decisionRef !== continuing.decisionRef)
          || (payload.decision !== undefined && payload.decision !== continuing.decision)))
        || (result.kind === 'succeeded' && (payload.effectState !== 'committed' || !payload.proposal || !payload.decisionRef || payload.decision !== 'approved' || !payload.businessResultRef))
        || (result.kind === 'failed' && (payload.effectState !== 'rejected' || !payload.proposal || !payload.decisionRef || payload.decision !== 'rejected' || payload.businessResultRef))
        || (result.kind === 'unknown' && (!['preparation_unknown', 'unresolved'].includes(payload.effectState) || payload.businessResultRef))) throw denied();
      const receiptId = randomUUID();
      this.toolActivityObserver?.(structuredClone(lease), timeCharge.chargeId, started, ended);
      await this.locked(lease, async tx => {
        // This records the result of the already-started phase; it grants no
        // next action. Closing new execution must not erase its measurement.
        const plan = await this.currentPlan(tx, lease, access.scopeId, true), phases = taskExecutionPhaseStore(tx);
        const key = { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId };
        const current = await tx.aiStep.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, runId: key.runId,
          id: stepId, status: 'RUNNING', resultRef: null, revision: step.revision, actionId: step.actionId, requestFingerprint: step.requestFingerprint } });
        const originalPhase = structuredClone(await phases.readStart({ ...key, id: firstPhase.id }));
        const existingReceipt = await phases.readReceipt({ ...key, phaseId: firstPhase.id });
        const previousReceipt = firstPhase.sequence === 2 ? await phases.readReceipt({ ...key, id: firstPhase.previousReceiptId! }) : null;
        if (firstPhase.sequence === 2 && (!previousReceipt || previousReceipt.kind !== 'confirmation'
          || previousReceipt.id !== firstPhase.previousReceiptId || requestFingerprint(previousReceipt.payload) !== previousReceipt.contentHash
          || BigInt(Buffer.byteLength(JSON.stringify(previousReceipt.payload), 'utf8')) !== previousReceipt.outputBytes
          || (payload.proposal && (payload.proposal.proposalId !== previousReceipt.proposalId || payload.proposal.proposalRevision !== previousReceipt.proposalRevision
            || payload.proposal.reviewedPayloadHash !== previousReceipt.reviewedPayloadHash)))) throw unavailable();
        const totalActiveMs = previousReceipt ? previousReceipt.activeMs + activeMs : activeMs;
        const totalOutputBytes = previousReceipt ? previousReceipt.outputBytes + BigInt(outputBytes) : BigInt(outputBytes);
        const origin = await tx.aiTaskResultArtifact.findFirst({ where: { ...key, id: firstPhase.originalArtifactId } });
        if (!origin || origin.id !== firstPhase.originalArtifactId || origin.outcome !== 'RUNNING' || origin.completeMeasurement) throw denied();
        const heldCharges = await tx.aiTaskExecutionCharge.findMany({ where: { ...key, actionId: step.actionId, stepFingerprint: step.requestFingerprint }, take: 5 });
        if (!current || !isDeepStrictEqual(originalPhase, firstPhase) || existingReceipt
          || heldCharges.length !== 3 || heldCharges.some(c => c.status !== 'RESERVED' || c.gatewayInvocationId !== null
            || c.leaseOwnerId !== origin.leaseOwnerId || c.fencingToken.toFixed(0) !== origin.fencingToken.toFixed(0)
            || !charges.some(before => before.chargeId === c.chargeId && before.resource === c.resource && before.requestFingerprint === c.requestFingerprint)
            || c.amount < (c.resource === 'ACTIVE_MS' ? totalActiveMs : c.resource === 'OUTPUT_BYTES' ? totalOutputBytes : 1n))
          || totalActiveMs > BigInt(plan.limits.maxStepMs) || totalOutputBytes > BigInt(plan.limits.maxOutputBytes)) throw denied();
        await phases.createReceipt({ ...key, id: receiptId, phaseId: firstPhase.id,
          kind: result.kind === 'paused' ? 'confirmation' : result.kind, errorCode: result.kind === 'failed' ? result.errorCode! : null,
          payload, contentHash: requestFingerprint(payload), activeMs, outputBytes: BigInt(outputBytes),
          proposalId: payload.proposal?.proposalId ?? null, proposalRevision: payload.proposal?.proposalRevision ?? null,
          reviewedPayloadHash: payload.proposal?.reviewedPayloadHash ?? null, decisionRef: payload.decisionRef ?? null,
          businessResultRef: payload.businessResultRef ?? null, createdAt: this.wall() });
      });
      return result.kind === 'paused' ? { kind: 'paused', pause: 'confirmation', resultRef: receiptId, outputBytes }
        : result.kind === 'failed' ? { kind: 'failed', errorCode: result.errorCode === 'AI_APPROVAL_REJECTED' ? 'AI_BUSINESS_REJECTED' : result.errorCode!, resultRef: receiptId, outputBytes }
          : { kind: result.kind, resultRef: receiptId, outputBytes };
    }
    if (result.kind === 'paused') throw unavailable();
    this.toolActivityObserver?.(structuredClone(lease), timeCharge.chargeId, started, ended);
    await this.locked(lease, async tx => {
      await this.currentPlan(tx, lease, access.scopeId, true);
      const current = await tx.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: stepId,
        status: 'RUNNING', resultRef: null, revision: step.revision, actionId: step.actionId, requestFingerprint: step.requestFingerprint } });
      if (!current) throw denied();
      const saved = await tx.aiTaskResultArtifact.updateMany({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId, id: ref,
        outcome: 'RUNNING', completeMeasurement: false, leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken) }, data: {
        outcome: result.kind.toUpperCase() as AiStepStatus, errorCode: result.kind === 'failed' ? result.errorCode : null, payload: result.payload, contentHash: requestFingerprint(result.payload),
        outputBytes: BigInt(outputBytes), activeMs, completeMeasurement: result.kind !== 'unknown' } });
      if (saved.count !== 1) throw conflict();
    });
    return result.kind === 'failed' ? { kind: 'failed', errorCode: result.errorCode!, resultRef: ref, outputBytes }
      : { kind: result.kind, resultRef: ref, outputBytes };
  }

  async readOrderPhaseResult(lease: AiTaskRunnerLease, stepId: string, reference?: string, transaction?: Prisma.TransactionClient) {
    if (!this.orderEvidence) throw unavailable();
    lease = structuredClone(lease); const access = await this.access(lease);
    await this.held(transaction ?? this.db, lease, access);
    const readSnapshot = async (tx: Prisma.TransactionClient) => {
      const key = { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId };
      const task = await tx.aiTask.findFirst({ where: { AND: [access.taskWhere, { scopeId: access.scopeId }] } });
      const step = await tx.aiStep.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, runId: key.runId, id: stepId } });
      const saved = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { scopeId: key.scopeId, taskId: key.taskId, runId: key.runId } } });
      if (!task || task.id !== lease.taskId || task.scopeId !== access.scopeId || !step || step.id !== stepId || step.scopeId !== key.scopeId
        || step.taskId !== key.taskId || step.runId !== key.runId || step.toolCode !== this.confirmationTool || step.toolVersion !== AI_TOOL_DRAFT_VERSION || !step.inputRef
        || !saved || saved.scopeId !== key.scopeId || saved.taskId !== key.taskId || saved.runId !== key.runId || requestFingerprint(saved.payload) !== saved.planHash) throw denied();
      const plan = planSchema.parse(saved.payload);
      if (plan.taskId !== key.taskId || plan.runId !== key.runId) throw denied();
      const phases = taskExecutionPhaseStore(tx), starts = await phases.readStarts(key), receipts = await phases.readReceipts(key);
      const artifacts = await tx.aiTaskResultArtifact.findMany({ where: key, take: 2 }), artifact = artifacts[0];
      if (!starts.length || artifacts.length !== 1 || artifact.id !== starts[0].originalArtifactId || artifact.actionId !== step.actionId
        || artifact.stepFingerprint !== step.requestFingerprint || Object.entries(key).some(([k, v]) => artifact[k as keyof typeof artifact] !== v)
        || artifact.leaseOwnerId !== starts[0].leaseOwnerId || artifact.fencingToken.toFixed(0) !== starts[0].fencingToken
        || artifact.outcome !== 'RUNNING' || artifact.completeMeasurement || artifact.activeMs !== 0n || artifact.outputBytes !== 0n
        || artifact.contentHash !== requestFingerprint({}) || requestFingerprint(artifact.payload) !== artifact.contentHash) throw denied();
      const charges = await tx.aiTaskExecutionCharge.findMany({ where: { ...key, actionId: step.actionId, stepFingerprint: step.requestFingerprint }, take: 5 });
      const original = starts[0], expected = { STEPS: original.stepsChargeId, ACTIVE_MS: original.activeMsChargeId, OUTPUT_BYTES: original.outputBytesChargeId };
      if (charges.length !== 3 || new Set(charges.map(c => c.resource)).size !== 3 || charges.some(c => !(c.resource in expected)
        || expected[c.resource as keyof typeof expected] !== c.chargeId || Object.entries(key).some(([k, v]) => c[k as keyof typeof c] !== v)
        || c.actionId !== step.actionId || c.stepFingerprint !== step.requestFingerprint || c.leaseOwnerId !== artifact.leaseOwnerId
        || c.fencingToken.toFixed(0) !== artifact.fencingToken.toFixed(0) || c.gatewayInvocationId !== null
        || !['RESERVED', 'UNKNOWN', 'RECORDED'].includes(c.status))) throw denied();
      for (const [index, start] of starts.entries()) {
        if (start.sequence !== index + 1 || Object.entries(key).some(([k, v]) => start[k as keyof typeof start] !== v)
          || start.originalArtifactId !== artifact.id || start.inputRef !== step.inputRef || start.actionId !== step.actionId
          || start.stepFingerprint !== step.requestFingerprint || start.planHash !== saved.planHash
          || start.stepsChargeId !== original.stepsChargeId || start.activeMsChargeId !== original.activeMsChargeId || start.outputBytesChargeId !== original.outputBytesChargeId
          || BigInt(start.fencingToken) > BigInt(lease.fencingToken) || start.runRevision > lease.revision || start.createdAt > this.wall()
          || (start.fencingToken === lease.fencingToken && start.leaseOwnerId !== lease.holderId)) throw denied();
        if (start.sequence === 2) {
          const prior = receipts.find(r => r.phaseId === original.id);
          if (!prior || prior.kind !== 'confirmation' || start.previousReceiptId !== prior.id || !start.decisionRef) throw unavailable();
        }
      }
      if (new Set(receipts.map(r => r.phaseId)).size !== receipts.length) throw denied();
      for (const receipt of receipts) {
        const start = starts.find(s => s.id === receipt.phaseId), payload = this.phasePayload(receipt.payload);
        if (!start || Object.entries(key).some(([k, v]) => receipt[k as keyof typeof receipt] !== v)
          || receipt.createdAt < start.createdAt || receipt.createdAt > this.wall() || requestFingerprint(receipt.payload) !== receipt.contentHash
          || BigInt(Buffer.byteLength(JSON.stringify(receipt.payload), 'utf8')) !== receipt.outputBytes
          || requestFingerprint(payload.binding) !== requestFingerprint({ ...key, actionId: step.actionId, inputRef: step.inputRef, fingerprint: step.requestFingerprint })
          || payload.presentedLease.taskId !== lease.taskId || payload.presentedLease.runId !== lease.runId || payload.presentedLease.holderId !== start.leaseOwnerId
          || payload.presentedLease.fencingToken !== start.fencingToken || payload.presentedLease.revision !== start.runRevision
          || (payload.proposal?.proposalId ?? null) !== receipt.proposalId || (payload.proposal?.proposalRevision ?? null) !== receipt.proposalRevision
          || (payload.proposal?.reviewedPayloadHash ?? null) !== receipt.reviewedPayloadHash || (payload.decisionRef ?? null) !== receipt.decisionRef
          || (payload.businessResultRef ?? null) !== receipt.businessResultRef || (start.sequence === 2 && receipt.decisionRef !== null && receipt.decisionRef !== start.decisionRef)
          || (receipt.kind === 'confirmation' && (start.sequence !== 1 || payload.effectState !== 'awaiting_decision'))
          || (receipt.kind === 'succeeded' && (payload.effectState !== 'committed' || payload.decision !== 'approved' || !receipt.decisionRef))
          || (receipt.kind === 'failed' && (payload.effectState !== 'rejected' || payload.decision !== 'rejected' || !receipt.decisionRef))
          || (receipt.kind === 'unknown' && !['unresolved', 'preparation_unknown'].includes(payload.effectState))) throw denied();
      }
      if (reference && reference !== artifact.id && !receipts.some(r => r.id === reference)) throw unavailable();
      const measurement = receipts.length === starts.length ? { activeMs: receipts.reduce((n, r) => n + r.activeMs, 0n),
        outputBytes: receipts.reduce((n, r) => n + r.outputBytes, 0n) } : null;
      if (measurement && (measurement.activeMs > BigInt(plan.limits.maxStepMs) || measurement.outputBytes > BigInt(plan.limits.maxOutputBytes)
        || charges.some(c => c.amount < (c.resource === 'ACTIVE_MS' ? measurement.activeMs : c.resource === 'OUTPUT_BYTES' ? measurement.outputBytes : 1n)))) throw denied();
      const run = await tx.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId,
        revision: lease.revision, leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken) } });
      if (!run || run.id !== lease.runId || run.scopeId !== key.scopeId || run.taskId !== key.taskId || run.revision !== lease.revision
        || run.leaseOwnerId !== lease.holderId || run.fencingToken.toFixed(0) !== lease.fencingToken || !run.leaseExpiresAt
        || run.leaseExpiresAt <= this.wall() || (lease.expiresAt && Date.parse(lease.expiresAt) !== run.leaseExpiresAt.getTime())) throw denied();
      const consumption = await tx.aiApprovalConsumption.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, actionId: step.actionId } });
      return { key, task, run, step, plan, planHash: saved.planHash, artifact, starts, receipts, charges, measurement, consumption };
    };
    const snapshot = transaction ? await readSnapshot(transaction) : await this.db.$transaction(readSnapshot,
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
    lease = { ...lease, expiresAt: snapshot.run.leaseExpiresAt!.toISOString() };
    const last = snapshot.receipts.find(r => r.phaseId === snapshot.starts[snapshot.starts.length - 1].id);
    let result: AiTaskRunnerEffectResult = { kind: 'unknown', resultRef: last?.id ?? snapshot.artifact.id,
      outputBytes: snapshot.measurement ? Number(snapshot.measurement.outputBytes) : 0 };
    let businessResultRef: string | null = null, observedAt: string | null = null;
    if (snapshot.measurement && last?.kind === 'confirmation' && !snapshot.consumption) {
      // Preserve the immutable confirmation receipt. Only the original business
      // adapter may attest cancellation or a recorded rejection plus the complete
      // no-submission witness; pending/approved decisions remain unknown.
      const business = await this.orderEvidence.reconcile({ taskId: lease.taskId, runId: lease.runId, stepId,
        actionId: snapshot.step.actionId, inputRef: snapshot.step.inputRef!, fingerprint: snapshot.step.requestFingerprint,
        lease: structuredClone(lease) }, transaction);
      if (business.kind === 'failed' && business.errorCode === 'AI_CANCELLED'
        && snapshot.task.cancelRequestedAt !== null && ['CANCEL_REQUESTED', 'CANCELLED'].includes(snapshot.task.status))
        result = { kind: 'failed', resultRef: last.id, errorCode: 'AI_CANCELLED', outputBytes: Number(snapshot.measurement.outputBytes) };
      else if (business.kind === 'failed' && business.errorCode === 'AI_APPROVAL_REJECTED')
        result = { kind: 'failed', resultRef: last.id, errorCode: 'AI_BUSINESS_REJECTED', outputBytes: Number(snapshot.measurement.outputBytes) };
    }
    if (snapshot.measurement && last && last.kind !== 'confirmation') {
      const binding = { taskId: lease.taskId, runId: lease.runId, stepId, actionId: snapshot.step.actionId, inputRef: snapshot.step.inputRef!,
        fingerprint: snapshot.step.requestFingerprint, lease: structuredClone(lease) };
      const business = await this.orderEvidence.reconcile(binding, transaction);
      if (business.kind === 'succeeded') {
        const payload = this.phasePayload(business.payload), consumption = snapshot.consumption;
        if (!payload.businessResultRef || payload.effectState !== 'committed' || !consumption || consumption.status !== 'COMMITTED'
          || consumption.scopeId !== snapshot.key.scopeId || consumption.taskId !== lease.taskId || consumption.actionId !== snapshot.step.actionId
          || consumption.actionFingerprint !== snapshot.step.requestFingerprint || consumption.approvalId !== payload.decisionRef
          || consumption.resultRef !== payload.businessResultRef || consumption.proposalId !== last.proposalId || consumption.proposalRevision !== last.proposalRevision
          || !(consumption.updatedAt instanceof Date) || consumption.updatedAt > this.wall()
          || (last.businessResultRef !== null && last.businessResultRef !== consumption.resultRef)) throw denied();
        businessResultRef = consumption.resultRef; observedAt = consumption.updatedAt.toISOString();
        result = { kind: 'succeeded', resultRef: last.id, outputBytes: Number(snapshot.measurement.outputBytes) };
      } else if (last.kind === 'failed' && last.errorCode === 'AI_APPROVAL_REJECTED' && !snapshot.consumption) {
        const waiting = await this.orderEvidence.readWaiting(binding, transaction);
        if (waiting.kind === 'waiting_reference' && waiting.receipt.kind === 'recorded' && waiting.receipt.record.decision === 'rejected'
          && waiting.receipt.record.approvalId === last.decisionRef && waiting.proposal.proposalId === last.proposalId
          && waiting.proposal.proposalRevision === last.proposalRevision && waiting.proposal.reviewedPayloadHash === last.reviewedPayloadHash) {
          result = { kind: 'failed', resultRef: last.id, errorCode: 'AI_BUSINESS_REJECTED', outputBytes: Number(snapshot.measurement.outputBytes) };
        }
      }
    }
    await this.held(transaction ?? this.db, lease, access);
    const evidenceKey = requestFingerprint({ planHash: snapshot.planHash, artifactId: snapshot.artifact.id,
      phases: snapshot.starts.map(s => ({ id: s.id, sequence: s.sequence, previousReceiptId: s.previousReceiptId, decisionRef: s.decisionRef, fence: s.fencingToken })),
      receipts: snapshot.receipts.map(r => ({ id: r.id, hash: r.contentHash, activeMs: r.activeMs.toString(), outputBytes: r.outputBytes.toString() })).sort((a, b) => a.id.localeCompare(b.id)),
      charges: snapshot.charges.map(c => ({ id: c.chargeId, fingerprint: c.requestFingerprint })).sort((a, b) => a.id.localeCompare(b.id)), businessResultRef, observedAt });
    return { ...snapshot, result, businessResultRef, observedAt, evidenceKey };
  }

  private async readCount(input: AiTaskExecutionSettlementRequest) {
    const lease = { ...input.lease, expiresAt: '' }, access = await this.access(lease);
    if (input.taskId !== lease.taskId) throw denied();
    await this.held(this.db, lease, access);
    await this.currentPlan(this.db, lease, access.scopeId, true);
    const charge = await this.db.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: {
      scopeId: access.scopeId, taskId: input.taskId, chargeId: input.chargeId } } });
    if (!charge || !isTaskModelCountCharge(charge) || charge.runId !== lease.runId
      || input.evidenceRef !== `count:${charge.gatewayInvocationId}`) throw denied();
    const invocation = await this.db.aiGatewayInvocation.findFirst({ where: { id: charge.gatewayInvocationId!,
      scopeId: access.scopeId, taskId: input.taskId, runId: lease.runId, stepId: charge.stepId!,
      actionId: charge.actionId!, stepFingerprint: charge.stepFingerprint! } });
    const task = await this.db.aiTask.findFirst({ where: access.taskWhere, include: { scope: true } });
    if (!invocation || !task || task.scopeId !== access.scopeId || !task.scope || task.scope.kind !== 'WORKSPACE'
      || !task.scope.tenantId || !task.scope.workspaceId || task.ownerId !== invocation.actorId
      || task.ownerKind !== 'USER' || !['OPERATOR', 'STAFF'].includes(task.audience)
      || !isGatewayConfig(invocation.configuration) || requestFingerprint(invocation.configuration) !== invocation.configurationHash
      || invocation.leaseOwnerId !== charge.leaseOwnerId || invocation.fencingToken.toFixed(0) !== charge.fencingToken.toFixed(0)) throw denied();
    const configuration: AiGatewayConfigReferenceDraft = structuredClone(invocation.configuration);
    if (!this.db.operationLog) throw unavailable();
    const receipts = new PrismaCountTokensReceipts({ operationLog: this.db.operationLog });
    const key = { tenantId: task.scope.tenantId, workspaceId: task.scope.workspaceId, actorId: task.ownerId, callId: invocation.callId };
    const read = async () => {
      const receipt = await receipts.read(countTokensOperationId(key));
      const reservation = await this.db.aiBudgetReservation.findUnique({ where: { id: receipt.admission.reservationId }, select: {
        id: true, scopeId: true, scopeKind: true, actorId: true, callId: true, requestId: true, idempotencyKey: true,
        tenantId: true, workspaceId: true, runId: true, stepId: true, actionId: true, sceneCode: true,
        unitKind: true, configurationHash: true, configRevision: true, priceVersion: true, dispatchState: true, status: true,
        reservedCalls: true, reservedTokens: true, reservedMoney: true, moneyCurrency: true } });
      if (!['observed', 'failed'].includes(receipt.state) || receipt.invocationId !== invocation.id
        || receipt.registrationHash !== invocation.registrationHash || receipt.intentHash !== invocation.intentHash
        || receipt.configurationHash !== invocation.configurationHash || receipt.countCallId !== countTokensCallId(invocation.callId)
        || receipt.scopeId !== access.scopeId || Object.entries(key).some(([name, value]) => receipt[name as keyof typeof receipt] !== value)
        || !reservation || reservation.id !== receipt.admission.reservationId || reservation.scopeId !== access.scopeId
        || reservation.scopeKind !== 'WORKSPACE' || reservation.status === 'released'
        || reservation.actorId !== task.ownerId || reservation.callId !== receipt.countCallId
        || reservation.runId !== lease.runId || reservation.stepId !== charge.stepId || reservation.actionId !== charge.actionId
        || reservation.sceneCode !== countTokensSceneCode(invocation.sceneCode)
        || !['dispatched', 'completed', 'unknown'].includes(reservation.dispatchState)
        || reservation.tenantId !== key.tenantId || reservation.workspaceId !== key.workspaceId
        || reservation.requestId !== receipt.countCallId || reservation.idempotencyKey !== receipt.countCallId
        || reservation.unitKind !== 'calls' || reservation.reservedCalls !== 1 || reservation.reservedTokens !== null
        || reservation.reservedMoney !== null || reservation.moneyCurrency !== null
        || reservation.configurationHash !== invocation.configurationHash
        || reservation.configRevision !== configuration.configRevision
        || receipt.priceVersion !== invocation.priceVersion || receipt.sceneCode !== invocation.sceneCode
        || receipt.protocol !== configuration.protocol || receipt.model !== configuration.model
        || receipt.maxOutputTokens !== invocation.maxOutputTokens || receipt.admission.sceneCode !== reservation.sceneCode
        || !await receipts.hasDispatchClaim({ ...key, reservationId: reservation.id, registrationHash: receipt.registrationHash,
          intentHash: receipt.intentHash, configurationHash: receipt.configurationHash, countRequestHash: receipt.countRequestHash })) throw unavailable();
      return { receipt, reservationId: reservation.id };
    };
    const before = await read(), after = await read();
    const latest = await this.db.aiGatewayInvocation.findFirst({ where: { id: invocation.id, scopeId: access.scopeId,
      taskId: input.taskId, runId: lease.runId, stepId: charge.stepId! }, select: { id: true, actorId: true,
      callId: true, actionId: true, stepFingerprint: true, registrationHash: true, intentHash: true,
      configurationHash: true, priceVersion: true, sceneCode: true, maxOutputTokens: true } });
    if (requestFingerprint(before) !== requestFingerprint(after) || !latest
      || Object.entries(latest).some(([key, value]) => invocation[key as keyof typeof invocation] !== value)) throw denied();
    await this.held(this.db, lease, access);
    return { scopeId: access.scopeId, taskId: input.taskId, runId: lease.runId, chargeId: charge.chargeId,
      requestFingerprint: charge.requestFingerprint, resource: 'calls' as const, actualAmount: 1n,
      evidenceHash: requestFingerprint({ charge: charge.requestFingerprint, receipt: before.receipt, reservationId: before.reservationId }),
      evidenceRef: input.evidenceRef, gatewayInvocationId: invocation.id, dispatchToken: countTokensOperationId(before.receipt) };
  }

  async read(input: AiTaskExecutionSettlementRequest, _reconcile: boolean) {
    input = structuredClone(input);
    if (/^count:[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(input.evidenceRef)) return this.readCount(input);
    const parts = input.evidenceRef.split(':');
    if (parts.length !== 2 || !z.string().uuid().safeParse(parts[0]).success || !['steps', 'calls', 'active_ms', 'output_bytes'].includes(parts[1])) throw denied();
    const lease = { ...input.lease, expiresAt: '' }; const access = await this.access(lease);
    await this.held(this.db, lease, access);
    if (!this.orderEvidence) await this.currentPlan(this.db, lease, access.scopeId, true);
    const charge = await this.db.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId: access.scopeId, taskId: input.taskId, chargeId: input.chargeId } } });
    if (this.orderEvidence && charge?.stepId) {
      const step = await this.db.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: charge.stepId } });
      if (step?.toolCode === this.confirmationTool) {
        if (input.taskId !== lease.taskId) throw denied();
        const facts = await this.readOrderPhaseResult(lease, step.id, parts[0]), currentCharge = facts.charges.find(c => c.chargeId === input.chargeId);
        if (!currentCharge || !facts.measurement || !['succeeded', 'failed'].includes(facts.result.kind)
          || facts.result.resultRef !== parts[0] || facts.step.resultRef !== parts[0] || facts.step.status !== facts.result.kind.toUpperCase()
          || currentCharge.resource.toLowerCase() !== parts[1]) throw unavailable();
        const actualAmount = currentCharge.resource === 'ACTIVE_MS' ? facts.measurement.activeMs
          : currentCharge.resource === 'OUTPUT_BYTES' ? facts.measurement.outputBytes : 1n;
        return { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, chargeId: currentCharge.chargeId,
          requestFingerprint: currentCharge.requestFingerprint, resource: currentCharge.resource.toLowerCase() as 'steps' | 'active_ms' | 'output_bytes',
          actualAmount, evidenceRef: input.evidenceRef, dispatchToken: null, gatewayInvocationId: null,
          evidenceHash: requestFingerprint({ ref: input.evidenceRef, charge: currentCharge.requestFingerprint, phase: facts.evidenceKey, amount: actualAmount.toString() }) };
      }
    }
    if (this.orderEvidence) await this.currentPlan(this.db, lease, access.scopeId, true);
    const artifact = await this.db.aiTaskResultArtifact.findUnique({ where: { scopeId_taskId_id: { scopeId: access.scopeId, taskId: input.taskId, id: parts[0] } } });
    if (!charge || !artifact || !artifact.completeMeasurement || artifact.outcome === 'UNKNOWN' || artifact.runId !== lease.runId || charge.runId !== lease.runId
      || charge.stepId !== artifact.stepId || charge.actionId !== artifact.actionId || charge.stepFingerprint !== artifact.stepFingerprint
      || charge.leaseOwnerId !== artifact.leaseOwnerId || charge.fencingToken.toFixed(0) !== artifact.fencingToken.toFixed(0)
      || charge.resource.toLowerCase() !== parts[1] || requestFingerprint(artifact.payload) !== artifact.contentHash
      || BigInt(Buffer.byteLength(JSON.stringify(artifact.payload), 'utf8')) !== artifact.outputBytes) throw denied();
    const step = await this.db.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: input.taskId, runId: lease.runId, id: artifact.stepId,
      resultRef: artifact.id, actionId: artifact.actionId, requestFingerprint: artifact.stepFingerprint, status: artifact.outcome } });
    if (!step) throw unavailable();
    let dispatchToken: string | null = null;
    let nonDispatchProof: string | null = null;
    if (charge.gatewayInvocationId) {
      if (typeof this.financialEvidence?.readDispatch !== 'function') throw unavailable();
      const invocation = await this.db.aiGatewayInvocation.findFirst({ where: { id: charge.gatewayInvocationId, scopeId: access.scopeId,
        taskId: input.taskId, runId: lease.runId, stepId: artifact.stepId, actionId: artifact.actionId, stepFingerprint: artifact.stepFingerprint } });
      if (!invocation || invocation.id !== charge.gatewayInvocationId || invocation.scopeId !== access.scopeId
        || invocation.taskId !== input.taskId || invocation.runId !== lease.runId || invocation.stepId !== artifact.stepId
        || invocation.actionId !== artifact.actionId || invocation.stepFingerprint !== artifact.stepFingerprint
        || invocation.leaseOwnerId !== artifact.leaseOwnerId || invocation.fencingToken.toFixed(0) !== artifact.fencingToken.toFixed(0)) throw denied();
      const task = await this.db.aiTask.findFirst({ where: { AND: [access.taskWhere, { scopeId: access.scopeId }] },
        select: { id: true, scopeId: true, scopeKind: true, ownerKind: true, ownerId: true, audience: true,
          scope: { select: { id: true, kind: true, tenantId: true, workspaceId: true } } } });
      if (!task || task.id !== input.taskId || task.scopeId !== access.scopeId || !task.scope || task.scope.id !== access.scopeId
        || task.scopeKind !== task.scope.kind || task.ownerId !== invocation.actorId
        || !isGatewayConfig(invocation.configuration) || requestFingerprint(invocation.configuration) !== invocation.configurationHash)
        throw denied();
      const platform = task.scopeKind === 'PLATFORM';
      const configuration: AiGatewayConfigReferenceDraft = structuredClone(invocation.configuration);
      if (platform ? task.ownerKind !== 'SAAS_ADMIN' || task.audience !== 'OPERATOR'
        || task.scope.tenantId !== null || task.scope.workspaceId !== null
        || !('consumerScope' in configuration) || configuration.consumerScope.kind !== 'platform'
        : task.scopeKind !== 'WORKSPACE' || !task.scope.tenantId || !task.scope.workspaceId
          || !('tenantId' in configuration) || configuration.tenantId !== task.scope.tenantId
          || !((task.ownerKind === 'USER' && ['OPERATOR', 'STAFF'].includes(task.audience))
            || (task.ownerKind === 'CUSTOMER' && task.audience === 'CLIENT'))) throw denied();
      if (artifact.outcome === 'FAILED' && !platform) {
        if (!task.scope.tenantId || !task.scope.workspaceId) throw unavailable();
        const unsent = await readModelNonDispatchEvidence(this.db, { scopeId: task.scopeId,
          tenantId: task.scope.tenantId, workspaceId: task.scope.workspaceId, actorId: task.ownerId }, invocation);
        if (!unsent) throw unavailable();
        dispatchToken = unsent.dispatchToken;
        nonDispatchProof = unsent.proofHash;
        // Task calls count the original bounded attempt (one), not provider
        // usage or a monetary debit. Cancellation never grants a fresh call.
      } else {
        const receipt = await this.db.aiGatewayAccountingReceipt.findFirst({ where: { scopeId: access.scopeId, taskId: input.taskId, invocationId: charge.gatewayInvocationId } });
        if (!receipt) throw unavailable();
        const admission = await this.db.aiInvocationAdmission.findFirst({ where: { id: receipt.admissionId, tenantId: receipt.tenantId, workspaceId: receipt.workspaceId,
          callId: invocation.callId, actorId: invocation.actorId, requestHash: receipt.requestHash, dispatchId: receipt.dispatchToken, revokedAt: null } });
        if (!admission || !receipt.dispatchToken || !['dispatching', 'completed', 'unknown'].includes(admission.status)) throw denied();
        // Consume the same authorized persistent accounting facts as the monetary
        // budget. Do not create a second ledger or infer dispatch from a local flag.
        const financial = structuredClone(await this.financialEvidence.readDispatch(receipt.reservationId));
        if (!isGatewayConfig(invocation.configuration) || receipt.state !== 'dispatched'
          || receipt.scopeId !== access.scopeId || receipt.taskId !== input.taskId || receipt.invocationId !== invocation.id
          || invocation.id !== charge.gatewayInvocationId || invocation.scopeId !== access.scopeId
          || invocation.taskId !== input.taskId || invocation.runId !== lease.runId || invocation.stepId !== artifact.stepId
          || invocation.actionId !== artifact.actionId || invocation.stepFingerprint !== artifact.stepFingerprint
          || admission.id !== receipt.admissionId || admission.actorId !== invocation.actorId || admission.callId !== invocation.callId
          || admission.profileId !== invocation.configuration.configId || admission.dispatchId !== receipt.dispatchToken
          || admission.requestHash !== receipt.requestHash || admission.tenantId !== receipt.tenantId || admission.workspaceId !== receipt.workspaceId
          || financial.state !== 'dispatched' || financial.dispatchToken !== receipt.dispatchToken
          || financial.reservationId !== receipt.reservationId || financial.requestId !== invocation.callId
          || financial.callId !== invocation.callId || financial.actorId !== invocation.actorId
          || receipt.scopeKind !== task.scopeKind || admission.scopeKind !== task.scopeKind
          || receipt.tenantId !== task.scope.tenantId || receipt.workspaceId !== task.scope.workspaceId
          || financial.scopeKey !== `${task.scopeKind}:${access.scopeId}` || financial.runId !== lease.runId
          || financial.stepId !== artifact.stepId || financial.actionId !== artifact.actionId
          || financial.sceneCode !== invocation.sceneCode || financial.priceVersion !== invocation.priceVersion
          || financial.configRevision !== invocation.configuration.configRevision
          || financial.configurationHash !== invocation.configurationHash
          || requestFingerprint(invocation.configuration) !== invocation.configurationHash) throw denied();
        dispatchToken = receipt.dispatchToken;
      }
    } else if (charge.resource === 'CALLS') throw denied();
    const actualAmount = charge.resource === 'ACTIVE_MS' ? artifact.activeMs : charge.resource === 'OUTPUT_BYTES' ? artifact.outputBytes : 1n;
    await this.held(this.db, lease, access);
    return { scopeId: access.scopeId, taskId: input.taskId, runId: lease.runId, chargeId: input.chargeId, requestFingerprint: charge.requestFingerprint,
      resource: charge.resource.toLowerCase() as 'steps' | 'calls' | 'active_ms' | 'output_bytes', actualAmount,
      evidenceHash: requestFingerprint({ ref: input.evidenceRef, charge: charge.requestFingerprint, contentHash: artifact.contentHash, amount: actualAmount.toString(), dispatchToken,
        ...(nonDispatchProof ? { nonDispatchProof } : {}) }),
      evidenceRef: input.evidenceRef, dispatchToken, gatewayInvocationId: charge.gatewayInvocationId };
  }

  /** Reconcile a result committed before a crash, not a provider call. Missing
   * or incomplete measurements remain unknown even after lease expiry/restart.
   */
  async recoverResult(lease: AiTaskRunnerLease, stepId: string): Promise<AiTaskRunnerEffectResult> {
    lease = structuredClone(lease); const access = await this.access(lease);
    await this.held(this.db, lease, access);
    if (!this.orderEvidence) await this.currentPlan(this.db, lease, access.scopeId, true);
    const step = await this.db.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: stepId } });
    if (!step) throw unavailable();
    if (this.orderEvidence && step.toolCode === this.confirmationTool) return (await this.readOrderPhaseResult(lease, stepId)).result;
    if (this.orderEvidence) await this.currentPlan(this.db, lease, access.scopeId, true);
    const rows = await this.db.aiTaskResultArtifact.findMany({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId,
      actionId: step.actionId, stepFingerprint: step.requestFingerprint }, take: 2 });
    // Never manufacture a terminal reference when no durable receipt exists.
    // An incomplete started receipt is a real unknown reference, not evidence
    // of zero consumption or permission to execute again.
    if (rows.length !== 1) throw unavailable();
    if (!rows[0].completeMeasurement || !['SUCCEEDED', 'FAILED'].includes(rows[0].outcome)) {
      await this.held(this.db, lease, access);
      return { kind: 'unknown', resultRef: rows[0].id, outputBytes: 0 };
    }
    const row = rows[0], bytes = Buffer.byteLength(JSON.stringify(row.payload), 'utf8');
    if (row.contentHash !== requestFingerprint(row.payload) || row.outputBytes !== BigInt(bytes) || bytes > 16777216
      || (step.resultRef !== null && step.resultRef !== row.id)) throw denied();
    const charges = await this.db.aiTaskExecutionCharge.findMany({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId,
      actionId: row.actionId, stepFingerprint: row.stepFingerprint }, take: 6 });
    if (!taskStepChargesValid(charges)
      || charges.some(charge => charge.scopeId !== access.scopeId || charge.taskId !== lease.taskId
        || charge.runId !== lease.runId || charge.stepId !== stepId || charge.actionId !== row.actionId
        || charge.stepFingerprint !== row.stepFingerprint || charge.leaseOwnerId !== row.leaseOwnerId
        || charge.fencingToken.toFixed(0) !== row.fencingToken.toFixed(0)
        || !['RESERVED', 'RECORDED', 'UNKNOWN'].includes(charge.status)
        || (charge.resource === 'CALLS' && !charge.gatewayInvocationId))) throw denied();
    await this.held(this.db, lease, access);
    if (row.outcome === 'FAILED') {
      if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(row.errorCode ?? '')) throw unavailable();
      return { kind: 'failed', errorCode: row.errorCode!, resultRef: row.id, outputBytes: bytes };
    }
    return { kind: 'succeeded', resultRef: row.id, outputBytes: bytes };
  }
}
