import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Prisma, type PrismaClient, type AiStepStatus } from '@prisma/client';
import { z } from 'zod';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskExecutionBudgetError, type AiTaskExecutionEvidenceSource, type AiTaskExecutionSettlementRequest } from '../task-execution-budget.ports';
import type { AiTaskExecutionScopeSource } from './prisma-task-execution-budget.repository';
import type { AiTaskRunnerLease, AiTaskRunnerPlan, AiTaskRunnerTaskMetadata, AiTaskRunnerEffectResult } from './ai-task-runner.ports';
import type { PersistedBudgetEvidenceSource } from '../budget/budget-dependency-adapters';
import { isGatewayConfig } from '../gateway-contract-validation';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
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
type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskRunPlan' | 'aiTaskResultArtifact' | 'aiTaskExecutionCharge' | 'aiGatewayInvocation' | 'aiGatewayAccountingReceipt' | 'aiInvocationAdmission'>;
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
    private readonly financialEvidence?: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>) {
    if (typeof db?.$transaction !== 'function' || typeof db?.aiTaskRunPlan?.findUnique !== 'function'
      || typeof db?.aiTaskResultArtifact?.create !== 'function' || typeof scopes?.resolve !== 'function' || typeof planAuthority?.authorize !== 'function') throw unavailable();
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

  private async currentPlan(db: Pick<PrismaClient, 'aiTaskRunPlan'>, lease: AiTaskRunnerLease, scopeId: string) {
    const row = await db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { scopeId, taskId: lease.taskId, runId: lease.runId } } });
    if (!row) throw unavailable();
    const plan = planSchema.parse(structuredClone(row.payload));
    if (plan.taskId !== lease.taskId || plan.runId !== lease.runId || requestFingerprint(plan) !== row.planHash) throw denied();
    const proof = proofSchema.parse(structuredClone(await this.planAuthority.authorize(structuredClone(plan), structuredClone(lease))));
    if (proof.authorityHash !== row.authorityHash || proof.policyVersion !== row.policyVersion || Date.parse(proof.expiresAt) <= this.wall().getTime()) throw denied();
    return plan;
  }

  /** Internal registered-tool boundary. Callback data is saved, not its claimed
   * outputBytes/timing. No DB transaction is held during the tool wait. Callback
   * and signal come from the server's bounded runner, never an HTTP/model field.
   */
  async capture(lease: AiTaskRunnerLease, stepId: string, signal: AbortSignal,
    execute: () => Promise<{ kind: 'succeeded' | 'failed' | 'unknown'; payload: Prisma.InputJsonValue; errorCode?: string }>): Promise<AiTaskRunnerEffectResult> {
    lease = structuredClone(lease);
    if (!id.max(36).safeParse(stepId).success || typeof execute !== 'function' || signal.aborted) throw denied();
    const access = await this.access(lease); await this.held(this.db, lease, access);
    const step = await this.db.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: stepId, status: 'RUNNING', resultRef: null } });
    if (!step) throw denied();
    const charges = await this.db.aiTaskExecutionCharge.findMany({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId,
      actionId: step.actionId, stepFingerprint: step.requestFingerprint }, take: 5 });
    if (charges.length < 3 || charges.length > 4 || !['STEPS', 'ACTIVE_MS', 'OUTPUT_BYTES'].every(resource => charges.some(c => c.resource === resource))
      || charges.some(c => c.status !== 'RESERVED' || c.leaseOwnerId !== lease.holderId || c.fencingToken.toFixed(0) !== lease.fencingToken)
      || new Set(charges.map(c => c.resource)).size !== charges.length) throw unavailable();
    if (charges.some(c => c.resource === 'CALLS' || c.gatewayInvocationId)
      && typeof this.financialEvidence?.readDispatch !== 'function') throw unavailable();
    const prior = await this.db.aiTaskResultArtifact.findUnique({ where: { scopeId_taskId_runId_stepId_fencingToken: {
      scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId, fencingToken: new Prisma.Decimal(lease.fencingToken) } } });
    if (prior) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
    const ref = randomUUID();
    // A durable started marker precedes the callback. Its unique generation key
    // prevents two instances executing while neither has a completed artifact.
    // COMMIT acknowledgement loss leaves an incomplete marker, not retry permission.
    await this.locked(lease, async tx => {
      await this.currentPlan(tx, lease, access.scopeId);
      const current = await tx.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: stepId,
        status: 'RUNNING', resultRef: null, revision: step.revision, actionId: step.actionId, requestFingerprint: step.requestFingerprint } });
      if (!current) throw denied();
      // Re-read under the run lock rather than granting execution from the
      // pre-lock charge snapshot. Resource mutations use the same lock order.
      const lockedCharges = await tx.aiTaskExecutionCharge.findMany({ where: { scopeId: access.scopeId, taskId: lease.taskId,
        runId: lease.runId, stepId, actionId: current.actionId, stepFingerprint: current.requestFingerprint }, take: 5 });
      if (lockedCharges.length !== charges.length || lockedCharges.some(c => c.status !== 'RESERVED'
        || c.leaseOwnerId !== lease.holderId || c.fencingToken.toFixed(0) !== lease.fencingToken
        || !charges.some(before => before.chargeId === c.chargeId && before.resource === c.resource && before.requestFingerprint === c.requestFingerprint))) throw denied();
      await tx.aiTaskResultArtifact.create({ data: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId, id: ref,
        actionId: step.actionId, stepFingerprint: step.requestFingerprint, leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken),
        outcome: 'RUNNING', payload: {}, contentHash: requestFingerprint({}), outputBytes: 0n, activeMs: 0n, completeMeasurement: false } });
    });
    if (signal.aborted) throw unavailable();
    const started = this.monotonic(); const result = structuredClone(await execute()); const elapsed = this.monotonic() - started;
    if (signal.aborted || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 86400000
      || !['succeeded', 'failed', 'unknown'].includes(result.kind) || result.kind === 'failed' && !/^[A-Z][A-Z0-9_]{0,127}$/u.test(result.errorCode ?? '')) throw unavailable();
    const encoded = JSON.stringify(result.payload); if (typeof encoded !== 'string') throw unavailable();
    const outputBytes = Buffer.byteLength(encoded, 'utf8');
    if (outputBytes > 16777216) throw new AiTaskExecutionBudgetError('AI_RUN_LIMIT');
    const activeMs = BigInt(Math.ceil(elapsed));
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

  async read(input: AiTaskExecutionSettlementRequest, _reconcile: boolean) {
    input = structuredClone(input);
    const parts = input.evidenceRef.split(':');
    if (parts.length !== 2 || !z.string().uuid().safeParse(parts[0]).success || !['steps', 'calls', 'active_ms', 'output_bytes'].includes(parts[1])) throw denied();
    const lease = { ...input.lease, expiresAt: '' }; const access = await this.access(lease);
    await this.held(this.db, lease, access);
    await this.currentPlan(this.db, lease, access.scopeId);
    const charge = await this.db.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId: access.scopeId, taskId: input.taskId, chargeId: input.chargeId } } });
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
    await this.currentPlan(this.db, lease, access.scopeId);
    const step = await this.db.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: stepId } });
    if (!step) throw unavailable();
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
