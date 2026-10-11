import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Prisma, type PrismaClient, type AiStepStatus, type AiStep } from '@prisma/client';
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION, AI_PROPOSAL_DRAFT_VERSION } from '@rental-os/shared';
import { taskExecutionPhaseStore } from './task-execution-phase.store';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskExecutionBudgetError, type AiTaskExecutionEvidenceSource, type AiTaskExecutionSettlementRequest } from '../task-execution-budget.ports';
import type { AiTaskExecutionScopeSource } from './prisma-task-execution-budget.repository';
import type { AiTaskRunnerLease, AiTaskRunnerPlan, AiTaskRunnerTaskMetadata, AiTaskRunnerEffectResult, AiTaskRunnerObservedResult, AiTaskRunnerConfirmationContinuation } from './ai-task-runner.ports';
import type { PersistedBudgetEvidenceSource } from '../budget/budget-dependency-adapters';
import { isGatewayConfig } from '../gateway-contract-validation';
import type { composeControlledApprovedOrder } from '../approval-execution/controlled-approved-order.composition';
type OrderBusiness = ReturnType<typeof composeControlledApprovedOrder>['waiting'];
export type AiTaskOrderPhaseBusinessEvidence = {
  readWaiting(input: Parameters<OrderBusiness['readWaiting']>[0], tx?: Prisma.TransactionClient): ReturnType<OrderBusiness['readWaiting']>;
  reconcile(input: Parameters<OrderBusiness['reconcile']>[0], tx?: Prisma.TransactionClient): ReturnType<OrderBusiness['reconcile']>;
};
export type AiConfirmationTool = 'rental.order.commit' | 'tenant.notifications.commit';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const confirmationContinuationSchema = z.object({ checkpointRef: id.max(36), stepId: id.max(36),
  stepRevision: z.number().int().positive().max(4294967294), decisionRef: id.max(36), decision: z.enum(['approved', 'rejected']),
  remainingActiveMs: z.number().int().min(1).max(86400000), remainingOutputBytes: z.number().int().min(1).max(16777216) }).strict();
const resumedConfirmationSchema = z.object({ data: z.object({ from: z.literal('waiting_confirmation'), to: z.literal('running'), reason: z.literal('resume') }).strict(),
  confirmation: confirmationContinuationSchema.extend({ phaseId: id.max(36), contentHash: hash, runId: id.max(36),
    runRevision: z.number().int().positive().max(4294967294), holderId: id, fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u) }).strict() }).passthrough();
const orderPhasePayloadSchema = z.object({ version: z.enum(['approved-order-wait-1', 'approved-settings-wait-1']),
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
const planSchema = z.object({ taskId: id.max(36), runId: id.max(36), taskRevision: z.number().int().min(1).max(4294967294),
  steps: z.array(z.object({ registrationRef: id, operation: z.enum(['readonly', 'idempotent', 'external_unknown']), toolCode: id, toolVersion: id }).strict()).max(1000),
  limits: aiTaskRunnerLimitsSchema
}).strict().refine(p => p.steps.length <= p.limits.maxSteps && p.steps.length <= p.limits.maxCalls && p.limits.maxStepMs <= p.limits.maxTotalMs
  && new Set(p.steps.map(s => s.registrationRef)).size === p.steps.length);
export { planSchema as aiTaskRunPlanSchema };
const proofSchema = z.object({ authorityHash: z.string().regex(/^[a-f0-9]{64}$/u), policyVersion: id.max(64), expiresAt: z.string().datetime({ offset: true }) }).strict();
export interface AiTaskPlanEvidenceAuthority {
  /** Server-owned action/limits/configuration policy. A model cannot attest its own plan. */
  authorize(plan: Readonly<AiTaskRunnerPlan>, lease: Readonly<AiTaskRunnerLease>): Promise<z.infer<typeof proofSchema>>;
}
type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskRunPlan' | 'aiTaskInputRequest' | 'aiTaskInputReceipt' | 'aiTaskResultArtifact' | 'aiTaskExecutionCharge' | 'aiGatewayInvocation' | 'aiGatewayAccountingReceipt' | 'aiInvocationAdmission'>;
type Tx = Prisma.TransactionClient;
const unavailable = () => new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
const conflict = () => new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');

/** Immutable plans/artifacts, current-owner scoped. No worker registration, model
 * call, approval, dispatch or financial ledger. Missing policy remains unavailable.
 * Activity means the measured uninterrupted tool interval, not paused wall time.
 */
export class PrismaTaskRunEvidenceRepository implements AiTaskExecutionEvidenceSource {
  constructor(private readonly db: Db, private readonly scopes: AiTaskExecutionScopeSource,
    private readonly planAuthority: AiTaskPlanEvidenceAuthority, private readonly wall: () => Date = () => new Date(),
    private readonly monotonic: () => number = () => performance.now(),
    private readonly financialEvidence?: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>,
    private readonly orderEvidence?: AiTaskOrderPhaseBusinessEvidence,
    private readonly confirmationTool: AiConfirmationTool = 'rental.order.commit') {
    if (typeof db?.$transaction !== 'function' || typeof db?.aiTaskRunPlan?.findUnique !== 'function'
      || typeof db?.aiTaskResultArtifact?.create !== 'function' || typeof scopes?.resolve !== 'function' || typeof planAuthority?.authorize !== 'function'
      || !['rental.order.commit', 'tenant.notifications.commit'].includes(confirmationTool)
      || (orderEvidence && (typeof orderEvidence.readWaiting !== 'function' || typeof orderEvidence.reconcile !== 'function'))) throw unavailable();
  }

  private phasePayload(value: unknown) {
    const parsed = orderPhasePayloadSchema.parse(value);
    if (parsed.version !== (this.confirmationTool === 'rental.order.commit' ? 'approved-order-wait-1' : 'approved-settings-wait-1')) throw denied();
    return parsed;
  }

  private async access(lease: AiTaskRunnerLease) {
    lease = structuredClone(lease);
    if (!lease || !id.max(36).safeParse(lease.taskId).success || !id.max(36).safeParse(lease.runId).success || !id.safeParse(lease.holderId).success
      || !/^[1-9][0-9]{0,19}$/u.test(lease.fencingToken) || !Number.isSafeInteger(lease.revision) || lease.revision < 1) throw denied();
    const access = structuredClone(await this.scopes.resolve(lease.taskId, lease, 'write'));
    if (!access?.scopeId || access.taskWhere?.id !== lease.taskId || !access.bindingKey) throw denied();
    return access;
  }

  private async held(db: Pick<PrismaClient, 'aiTask' | 'aiRun'>, lease: AiTaskRunnerLease, before: Awaited<ReturnType<PrismaTaskRunEvidenceRepository['access']>>, locked = false) {
    const current = await this.access(lease);
    if (current.bindingKey !== before.bindingKey || current.scopeId !== before.scopeId) throw denied();
    const task = await db.aiTask.findFirst({ where: { AND: [current.taskWhere, { scopeId: current.scopeId }] }, select: { id: true, scopeId: true } });
    const run = await db.aiRun.findFirst({ where: { scopeId: current.scopeId, taskId: lease.taskId, id: lease.runId, leaseOwnerId: lease.holderId,
      fencingToken: new Prisma.Decimal(lease.fencingToken), revision: lease.revision, status: { in: ['QUEUED', 'RUNNING'] }, leaseExpiresAt: { gt: this.wall() } },
      select: { id: true, scopeId: true, taskId: true, leaseOwnerId: true, fencingToken: true, revision: true, status: true, leaseExpiresAt: true } });
    // A collation match is not an exact logical identity/lease. Never accept
    // corrupt readback merely because the query and later CAS matched a row.
    if (!task || task.id !== lease.taskId || task.scopeId !== current.scopeId || !run || run.id !== lease.runId
      || run.scopeId !== current.scopeId || run.taskId !== lease.taskId || run.leaseOwnerId !== lease.holderId
      || run.fencingToken.toFixed(0) !== lease.fencingToken || run.revision !== lease.revision
      || !['QUEUED', 'RUNNING'].includes(run.status) || !run.leaseExpiresAt || run.leaseExpiresAt <= this.wall()) throw denied();
    if (locked && (await db.aiRun.updateMany({ where: { scopeId: current.scopeId, taskId: lease.taskId, id: lease.runId,
      leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken), revision: lease.revision,
      status: { in: ['QUEUED', 'RUNNING'] }, leaseExpiresAt: { gt: this.wall() } }, data: { revision: lease.revision } })).count !== 1) throw denied();
  }

  private async locked<T>(lease: AiTaskRunnerLease, consume: (tx: Tx, access: Awaited<ReturnType<PrismaTaskRunEvidenceRepository['access']>>) => Promise<T>) {
    lease = structuredClone(lease); const access = await this.access(lease);
    try {
      return await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${access.scopeId} AND id = ${lease.taskId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${access.scopeId} AND taskId = ${lease.taskId} AND id = ${lease.runId} FOR UPDATE`);
        await this.held(tx, lease, access, true);
        const result = await consume(tx, access);
        await this.held(tx, lease, access, true);
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

  async resolve(task: AiTaskRunnerTaskMetadata, lease: AiTaskRunnerLease, _recovery: boolean): Promise<AiTaskRunnerPlan> {
    task = structuredClone(task); lease = structuredClone(lease);
    const access = await this.access(lease); await this.held(this.db, lease, access);
    const row = await this.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId } } });
    if (!row) throw unavailable();
    const plan = planSchema.parse(structuredClone(row.payload));
    if (plan.taskId !== task.taskId || plan.taskId !== lease.taskId || plan.runId !== lease.runId || requestFingerprint(plan) !== row.planHash) throw denied();
    const proof = proofSchema.parse(await this.planAuthority.authorize(structuredClone(plan), structuredClone(lease)));
    if (proof.authorityHash !== row.authorityHash || proof.policyVersion !== row.policyVersion || Date.parse(proof.expiresAt) <= this.wall().getTime()) throw denied();
    await this.held(this.db, lease, access);
    return { ...plan, taskRevision: task.revision };
  }

  async resourceOrigin(plan: AiTaskRunnerPlan, lease: AiTaskRunnerLease): Promise<AiTaskRunnerPlan> {
    plan = planSchema.parse(structuredClone(plan)); lease = structuredClone(lease);
    const access = await this.access(lease); await this.held(this.db, lease, access);
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
    await this.held(this.db, lease, access);
    return original;
  }

  private async currentPlan(db: Pick<PrismaClient, 'aiTaskRunPlan'>, lease: AiTaskRunnerLease, scopeId: string) {
    const row = await db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { scopeId, taskId: lease.taskId, runId: lease.runId } } });
    if (!row) throw unavailable();
    const plan = planSchema.parse(structuredClone(row.payload));
    if (plan.taskId !== lease.taskId || plan.runId !== lease.runId || requestFingerprint(plan) !== row.planHash) throw denied();
    const proof = proofSchema.parse(structuredClone(await this.planAuthority.authorize(structuredClone(plan), structuredClone(lease))));
    if (proof.authorityHash !== row.authorityHash || proof.policyVersion !== row.policyVersion || Date.parse(proof.expiresAt) <= this.wall().getTime()) throw denied();
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
    execute: () => Promise<AiTaskRunnerObservedResult>, phase?: 'confirmation' | AiTaskRunnerConfirmationContinuation): Promise<AiTaskRunnerEffectResult> {
    lease = structuredClone(lease);
    const continuing = typeof phase === 'object' && phase !== null ? confirmationContinuationSchema.parse(structuredClone(phase)) : null;
    if (!id.max(36).safeParse(stepId).success || typeof execute !== 'function' || signal.aborted) throw denied();
    const access = await this.access(lease); await this.held(this.db, lease, access);
    const step = await this.db.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: stepId, status: 'RUNNING', resultRef: null } });
    if (!step) throw denied();
    if (phase !== undefined && ((!continuing && phase !== 'confirmation') || step.toolCode !== this.confirmationTool
      || step.toolVersion !== AI_TOOL_DRAFT_VERSION || step.effect !== 'POSSIBLE' || !step.inputRef)) throw denied();
    const charges = await this.db.aiTaskExecutionCharge.findMany({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId,
      actionId: step.actionId, stepFingerprint: step.requestFingerprint }, take: 5 });
    if (charges.length < 3 || charges.length > 4 || !['STEPS', 'ACTIVE_MS', 'OUTPUT_BYTES'].every(resource => charges.some(c => c.resource === resource))
      || charges.some(c => c.status !== 'RESERVED' || (!continuing && (c.leaseOwnerId !== lease.holderId || c.fencingToken.toFixed(0) !== lease.fencingToken)))
      || new Set(charges.map(c => c.resource)).size !== charges.length) throw unavailable();
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
    const firstPhase = await this.locked(lease, async tx => {
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
        runId: lease.runId, stepId, actionId: current.actionId, stepFingerprint: current.requestFingerprint }, take: 5 });
      if (lockedCharges.length !== charges.length || lockedCharges.some(c => c.status !== 'RESERVED'
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
    });
    if (signal.aborted) throw unavailable();
    const started = this.monotonic(); const result = structuredClone(await execute()); const elapsed = this.monotonic() - started;
    if (signal.aborted || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 86400000
      || !['succeeded', 'failed', 'unknown', ...(firstPhase ? ['paused'] : [])].includes(result.kind)
      || result.kind === 'paused' && (!firstPhase || result.pause !== 'confirmation')
      || result.kind === 'failed' && !/^[A-Z][A-Z0-9_]{0,127}$/u.test(result.errorCode ?? '')) throw unavailable();
    const encoded = JSON.stringify(result.payload); if (typeof encoded !== 'string') throw unavailable();
    const outputBytes = Buffer.byteLength(encoded, 'utf8');
    if (outputBytes > 16777216) throw new AiTaskExecutionBudgetError('AI_RUN_LIMIT');
    const activeMs = BigInt(Math.ceil(elapsed));
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
      await this.locked(lease, async tx => {
        const plan = await this.currentPlan(tx, lease, access.scopeId), phases = taskExecutionPhaseStore(tx);
        const key = { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId };
        const current = await tx.aiStep.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, runId: key.runId,
          id: stepId, status: 'RUNNING', resultRef: null, revision: step.revision, actionId: step.actionId, requestFingerprint: step.requestFingerprint } });
        const originalPhase = await phases.readStart({ ...key, id: firstPhase.id });
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
        if (!current || requestFingerprint(originalPhase) !== requestFingerprint(firstPhase) || existingReceipt
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
    await this.locked(lease, async tx => {
      await this.currentPlan(tx, lease, access.scopeId);
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
    if (snapshot.measurement && last?.kind === 'confirmation' && !snapshot.consumption
      && snapshot.task.cancelRequestedAt !== null && ['CANCEL_REQUESTED', 'CANCELLED'].includes(snapshot.task.status)) {
      // Preserve the immutable confirmation receipt. Only the original business
      // adapter may attest that no approval/submission phase ever followed it.
      const business = await this.orderEvidence.reconcile({ taskId: lease.taskId, runId: lease.runId, stepId,
        actionId: snapshot.step.actionId, inputRef: snapshot.step.inputRef!, fingerprint: snapshot.step.requestFingerprint,
        lease: structuredClone(lease) }, transaction);
      if (business.kind === 'failed' && business.errorCode === 'AI_CANCELLED')
        result = { kind: 'failed', resultRef: last.id, errorCode: 'AI_CANCELLED', outputBytes: Number(snapshot.measurement.outputBytes) };
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

  async read(input: AiTaskExecutionSettlementRequest, _reconcile: boolean) {
    input = structuredClone(input);
    const parts = input.evidenceRef.split(':');
    if (parts.length !== 2 || !z.string().uuid().safeParse(parts[0]).success || !['steps', 'calls', 'active_ms', 'output_bytes'].includes(parts[1])) throw denied();
    const lease = { ...input.lease, expiresAt: '' }; const access = await this.access(lease);
    await this.held(this.db, lease, access);
    if (!this.orderEvidence) await this.currentPlan(this.db, lease, access.scopeId);
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
    if (this.orderEvidence) await this.currentPlan(this.db, lease, access.scopeId);
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
    if (charge.gatewayInvocationId) {
      if (typeof this.financialEvidence?.readDispatch !== 'function') throw unavailable();
      const invocation = await this.db.aiGatewayInvocation.findFirst({ where: { id: charge.gatewayInvocationId, scopeId: access.scopeId,
        taskId: input.taskId, runId: lease.runId, stepId: artifact.stepId, actionId: artifact.actionId, stepFingerprint: artifact.stepFingerprint } });
      const receipt = await this.db.aiGatewayAccountingReceipt.findFirst({ where: { scopeId: access.scopeId, taskId: input.taskId, invocationId: charge.gatewayInvocationId } });
      if (!invocation || !receipt) throw unavailable();
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
        || financial.scopeKey !== `WORKSPACE:${access.scopeId}` || financial.runId !== lease.runId
        || financial.stepId !== artifact.stepId || financial.actionId !== artifact.actionId
        || financial.sceneCode !== invocation.sceneCode || financial.priceVersion !== invocation.priceVersion
        || financial.configRevision !== invocation.configuration.configRevision
        || financial.configurationHash !== invocation.configurationHash
        || requestFingerprint(invocation.configuration) !== invocation.configurationHash) throw denied();
      dispatchToken = receipt.dispatchToken;
    } else if (charge.resource === 'CALLS') throw denied();
    const actualAmount = charge.resource === 'ACTIVE_MS' ? artifact.activeMs : charge.resource === 'OUTPUT_BYTES' ? artifact.outputBytes : 1n;
    await this.held(this.db, lease, access);
    return { scopeId: access.scopeId, taskId: input.taskId, runId: lease.runId, chargeId: input.chargeId, requestFingerprint: charge.requestFingerprint,
      resource: charge.resource.toLowerCase() as 'steps' | 'calls' | 'active_ms' | 'output_bytes', actualAmount,
      evidenceHash: requestFingerprint({ ref: input.evidenceRef, charge: charge.requestFingerprint, contentHash: artifact.contentHash, amount: actualAmount.toString(), dispatchToken }),
      evidenceRef: input.evidenceRef, dispatchToken, gatewayInvocationId: charge.gatewayInvocationId };
  }

  /** Reconcile a result committed before a crash, not a provider call. Missing
   * or incomplete measurements remain unknown even after lease expiry/restart.
   */
  async recoverResult(lease: AiTaskRunnerLease, stepId: string): Promise<AiTaskRunnerEffectResult> {
    lease = structuredClone(lease); const access = await this.access(lease);
    await this.held(this.db, lease, access);
    if (!this.orderEvidence) await this.currentPlan(this.db, lease, access.scopeId);
    const step = await this.db.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: stepId } });
    if (!step) throw unavailable();
    if (this.orderEvidence && step.toolCode === this.confirmationTool) return (await this.readOrderPhaseResult(lease, stepId)).result;
    if (this.orderEvidence) await this.currentPlan(this.db, lease, access.scopeId);
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
      actionId: row.actionId, stepFingerprint: row.stepFingerprint }, take: 5 });
    if (charges.length < 3 || charges.length > 4
      || new Set(charges.map(charge => charge.resource)).size !== charges.length
      || !['STEPS', 'ACTIVE_MS', 'OUTPUT_BYTES'].every(resource => charges.some(charge => charge.resource === resource))
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
