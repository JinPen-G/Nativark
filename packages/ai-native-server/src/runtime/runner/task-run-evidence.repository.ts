/** Durable original tool measurement and result receipts. Business confirmation
 * and counting use their existing host participants. No provider dispatch here. */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma, PrismaClient, AiStepStatus } from '@prisma/client';
import { z } from 'zod';
import type { AiGatewayConfigReferenceDraft } from '@rental-os/platform-contracts/ai-gateway';
import { isGatewayConfig } from '@rental-os/platform-server/ai-gateway';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import type { AiTaskTransactionBoundary } from '../../task-transactions';
import { AiTaskExecutionBudgetError, type AiTaskExecutionEvidenceSource, type AiTaskExecutionSettlementRequest } from '../task-execution-budget.ports';
import type { AiTaskExecutionScopeSource } from './task-execution-budget.repository';
import type { AiTaskRunnerLease, AiTaskRunnerEffectResult, AiTaskRunnerConfirmationContinuation } from '@rental-os/platform-server/ai-runtime';
import type { AiTaskRunnerObservedResult } from './task-observed-result';
import type { GatewayDispatchEvidenceSource } from '../budget/gateway-dispatch-evidence.ports';
import { readModelNonDispatchEvidence } from '../model-input/prisma-model-nondispatch.evidence';
import { isTaskModelCountCharge, taskStepChargesValid } from './task-model-count-charge';
import { TaskRunPlanRepository, type TaskRunPlanAuthority, type AiTaskControlResourceOrigin } from './task-run-plan.repository';

export type TaskRunEvidenceDatabase = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskRunPlan' | 'aiTaskInputRequest' | 'aiTaskInputReceipt' | 'aiTaskResultArtifact' | 'aiTaskExecutionCharge' | 'aiGatewayInvocation' | 'aiGatewayAccountingReceipt' | 'aiInvocationAdmission' | 'aiBudgetReservation'>;
type Tx = Prisma.TransactionClient;
const unavailable = () => new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
const conflict = () => new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

/** Immutable plans/artifacts, current-owner scoped. No worker registration, model
 * call, approval, dispatch or financial ledger. Missing policy remains unavailable.
 * Activity means the measured uninterrupted tool interval, not paused wall time.
 */
export class TaskRunEvidenceRepository<Database extends TaskRunEvidenceDatabase = TaskRunEvidenceDatabase> extends TaskRunPlanRepository<Database> implements AiTaskExecutionEvidenceSource {
  protected toolActivityObserver?: (lease: AiTaskRunnerLease, chargeId: string, started: number, ended: number) => void;

  /** Composition-only timing handoff. Neither callback data nor a client field
   * can supply an interval; capture derives it from this process's clock and the
   * locked original ACTIVE_MS reservation. Bind once, before running work. */
  bindToolActivityObserver(observer: NonNullable<TaskRunEvidenceRepository['toolActivityObserver']>) {
    if (this.toolActivityObserver || typeof observer !== 'function') throw unavailable();
    this.toolActivityObserver = observer;
  }

  constructor(db: Database, scopes: AiTaskExecutionScopeSource, planAuthority: TaskRunPlanAuthority,
    wall: () => Date, protected readonly monotonic: () => number = () => performance.now(),
    protected readonly financialEvidence: GatewayDispatchEvidenceSource | undefined,
    controlResourceOrigin: AiTaskControlResourceOrigin | undefined,
    transactions: Pick<AiTaskTransactionBoundary<Tx>, 'withAiTaskTransaction'>, nativeScope = false) {
    super(db, scopes, planAuthority, wall, controlResourceOrigin, transactions, nativeScope);
    if (typeof db?.aiTaskResultArtifact?.create !== 'function') throw unavailable();
  }

  /** Internal registered-tool boundary. Callback data is saved, not its claimed
   * outputBytes/timing. No DB transaction is held during the tool wait. Callback
   * and signal come from the server's bounded runner, never an HTTP/model field.
   */
  async capture(lease: AiTaskRunnerLease, stepId: string, signal: AbortSignal,
    execute: () => Promise<AiTaskRunnerObservedResult>, phase?: 'confirmation' | AiTaskRunnerConfirmationContinuation,
    prepare?: () => Promise<void>): Promise<AiTaskRunnerEffectResult> {
    if (phase !== undefined) throw unavailable();
    // Current authorization, charge reads and the original marker COMMIT are
    // active work too. Start before those waits so recreation cannot make this
    // prefix free; a new confirmation invocation still excludes human waiting.
    const started = this.monotonic();
    if (!Number.isFinite(started)) throw unavailable();
    lease = structuredClone(lease);
    if (!id.max(36).safeParse(stepId).success || typeof execute !== 'function' || signal.aborted) throw denied();
    const access = await this.access(lease); await this.held(this.db, lease, access);
    const step = await this.db.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: stepId, status: 'RUNNING', resultRef: null } });
    if (!step) throw denied();
    if (prepare && (typeof prepare !== 'function' || step.effect !== 'POSSIBLE')) throw denied();
    const readyCharge = (charge: { status: string; actualAmount: bigint | null; evidenceRef: string | null } & Parameters<typeof isTaskModelCountCharge>[0]) =>
      isTaskModelCountCharge(charge) ? charge.status === 'RECORDED' && charge.actualAmount === 1n
        && charge.evidenceRef === `count:${charge.gatewayInvocationId}` : charge.status === 'RESERVED';
    const charges = await this.db.aiTaskExecutionCharge.findMany({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId,
      actionId: step.actionId, stepFingerprint: step.requestFingerprint }, take: 6 });
    if (!taskStepChargesValid(charges) || prepare && (charges.length !== 3 || charges.some(c => c.gatewayInvocationId !== null))
      || charges.some(c => !readyCharge(c)
        || c.leaseOwnerId !== lease.holderId || c.fencingToken.toFixed(0) !== lease.fencingToken)) throw unavailable();
    if (charges.some(c => c.resource === 'CALLS' || c.gatewayInvocationId)
      && typeof this.financialEvidence?.readDispatch !== 'function') throw unavailable();
    const prior = await this.db.aiTaskResultArtifact.findUnique({ where: { scopeId_taskId_runId_stepId_fencingToken: {
      scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId, fencingToken: new prismaRuntime.Decimal(lease.fencingToken) } } });
    if (prior) throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
    const ref = randomUUID();
    // A durable started marker precedes the callback. Its unique generation key
    // prevents two instances executing while neither has a completed artifact.
    // COMMIT acknowledgement loss leaves an incomplete marker, not retry permission.
    await this.locked(lease, async (tx, currentAccess) => {
      if (currentAccess.scopeId !== access.scopeId || currentAccess.bindingKey !== access.bindingKey) throw denied();
      await this.currentPlan(tx, lease, access.scopeId, false, tx);
      const current = await tx.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: stepId,
        status: 'RUNNING', resultRef: null, revision: step.revision, actionId: step.actionId, requestFingerprint: step.requestFingerprint } });
      if (!current) throw denied();
      // Re-read under the run lock rather than granting execution from the
      // pre-lock charge snapshot. Resource mutations use the same lock order.
      const lockedCharges = await tx.aiTaskExecutionCharge.findMany({ where: { scopeId: access.scopeId, taskId: lease.taskId,
        runId: lease.runId, stepId, actionId: current.actionId, stepFingerprint: current.requestFingerprint }, take: 6 });
      if (lockedCharges.length !== charges.length || !taskStepChargesValid(lockedCharges) || lockedCharges.some(c => !readyCharge(c)
        || c.leaseOwnerId !== lease.holderId || c.fencingToken.toFixed(0) !== lease.fencingToken
        || !charges.some(before => before.chargeId === c.chargeId && before.resource === c.resource && before.requestFingerprint === c.requestFingerprint))) throw denied();
      await tx.aiTaskResultArtifact.create({ data: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId, id: ref,
        actionId: step.actionId, stepFingerprint: step.requestFingerprint, leaseOwnerId: lease.holderId, fencingToken: new prismaRuntime.Decimal(lease.fencingToken),
        outcome: 'RUNNING', payload: {}, contentHash: requestFingerprint({}), outputBytes: 0n, activeMs: 0n, completeMeasurement: false } });
    });
    if (signal.aborted) throw unavailable();
    if (prepare) {
      // Count is an external request too. Its preparation runs only after the
      // original marker committed, so a crash can always reopen that marker.
      await prepare();
      if (signal.aborted) throw unavailable();
      await this.locked(lease, async (tx, currentAccess) => {
        if (currentAccess.scopeId !== access.scopeId || currentAccess.bindingKey !== access.bindingKey) throw denied();
        await this.currentPlan(tx, lease, access.scopeId, false, tx);
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
      || !['succeeded', 'failed', 'unknown'].includes(result.kind)
      || result.kind === 'failed' && !/^[A-Z][A-Z0-9_]{0,127}$/u.test(result.errorCode ?? '')) throw unavailable();
    const encoded = JSON.stringify(result.payload); if (typeof encoded !== 'string') throw unavailable();
    const outputBytes = Buffer.byteLength(encoded, 'utf8');
    if (outputBytes > 16777216) throw new AiTaskExecutionBudgetError('AI_RUN_LIMIT');
    const activeMs = BigInt(Math.ceil(elapsed));
    const timeCharge = charges.find(charge => charge.resource === 'ACTIVE_MS');
    if (!timeCharge || activeMs > timeCharge.amount) throw unavailable();
    if (result.kind === 'paused') throw unavailable();
    this.toolActivityObserver?.(structuredClone(lease), timeCharge.chargeId, started, ended);
    await this.locked(lease, async (tx, currentAccess) => {
      if (currentAccess.scopeId !== access.scopeId || currentAccess.bindingKey !== access.bindingKey) throw denied();
      await this.currentPlan(tx, lease, access.scopeId, true);
      const current = await tx.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: stepId,
        status: 'RUNNING', resultRef: null, revision: step.revision, actionId: step.actionId, requestFingerprint: step.requestFingerprint } });
      if (!current) throw denied();
      const saved = await tx.aiTaskResultArtifact.updateMany({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId, id: ref,
        outcome: 'RUNNING', completeMeasurement: false, leaseOwnerId: lease.holderId, fencingToken: new prismaRuntime.Decimal(lease.fencingToken) }, data: {
        outcome: result.kind.toUpperCase() as AiStepStatus, errorCode: result.kind === 'failed' ? result.errorCode : null, payload: result.payload, contentHash: requestFingerprint(result.payload),
        outputBytes: BigInt(outputBytes), activeMs, completeMeasurement: result.kind !== 'unknown' } });
      if (saved.count !== 1) throw conflict();
    }, 'settle');
    if (this.nativeScope) {
      try { await this.held(this.db, lease, access, false, 'settle'); }
      catch { throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN'); }
    }
    return result.kind === 'failed' ? { kind: 'failed', errorCode: result.errorCode!, resultRef: ref, outputBytes }
      : { kind: result.kind, resultRef: ref, outputBytes };
  }

  async read(input: AiTaskExecutionSettlementRequest, _reconcile: boolean) {
    input = structuredClone(input);
    const parts = input.evidenceRef.split(':');
    if (parts.length !== 2 || !z.string().uuid().safeParse(parts[0]).success || !['steps', 'calls', 'active_ms', 'output_bytes'].includes(parts[1])) throw denied();
    const lease = { ...input.lease, expiresAt: '' }; const access = await this.access(lease, 'settle');
    if (input.taskId !== lease.taskId) throw denied();
    await this.held(this.db, lease, access, false, 'settle');
    await this.currentPlan(this.db, lease, access.scopeId, true);
    const charge = await this.db.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId: access.scopeId, taskId: input.taskId, chargeId: input.chargeId } } });
    const artifact = await this.db.aiTaskResultArtifact.findUnique({ where: { scopeId_taskId_id: { scopeId: access.scopeId, taskId: input.taskId, id: parts[0] } } });
    if (!charge || !artifact || !artifact.completeMeasurement || !['SUCCEEDED', 'FAILED'].includes(artifact.outcome) || artifact.runId !== lease.runId || charge.runId !== lease.runId
      || artifact.scopeId !== access.scopeId || artifact.taskId !== input.taskId || artifact.id !== parts[0]
      || charge.scopeId !== access.scopeId || charge.taskId !== input.taskId || charge.chargeId !== input.chargeId
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
      const tenantOnly = this.nativeScope && task.scopeKind === 'TENANT';
      const configuration: AiGatewayConfigReferenceDraft = structuredClone(invocation.configuration);
      if (platform ? task.ownerKind !== 'SAAS_ADMIN' || task.audience !== 'OPERATOR'
        || task.scope.tenantId !== null || task.scope.workspaceId !== null
        || !('consumerScope' in configuration) || configuration.consumerScope.kind !== 'platform'
        : !task.scope.tenantId || !('tenantId' in configuration) || configuration.tenantId !== task.scope.tenantId
          || (tenantOnly ? task.scope.workspaceId !== null || task.ownerKind !== 'USER' || task.audience !== 'OPERATOR'
            : task.scopeKind !== 'WORKSPACE' || !task.scope.workspaceId
              || !((task.ownerKind === 'USER' && ['OPERATOR', 'STAFF'].includes(task.audience))
            || (task.ownerKind === 'CUSTOMER' && task.audience === 'CLIENT')
            || (task.ownerKind === 'AUTOMATION' && task.audience === 'AUTOMATION')))) throw denied();
      if (artifact.outcome === 'FAILED') {
        const owner = platform ? { scopeId: task.scopeId, scopeKind: 'PLATFORM' as const, actorId: task.ownerId }
          : tenantOnly ? { scopeId: task.scopeId, scopeKind: 'TENANT' as const, tenantId: task.scope.tenantId!, actorId: task.ownerId }
            : { scopeId: task.scopeId, tenantId: task.scope.tenantId!, workspaceId: task.scope.workspaceId!, actorId: task.ownerId };
        const unsent = await readModelNonDispatchEvidence(this.db, owner, invocation);
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
    await this.held(this.db, lease, access, false, 'settle');
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
    lease = structuredClone(lease); const access = await this.access(lease, 'settle');
    await this.held(this.db, lease, access, false, 'settle');
    await this.currentPlan(this.db, lease, access.scopeId, true);
    const step = await this.db.aiStep.findFirst({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, id: stepId } });
    if (!step) throw unavailable();
    const rows = await this.db.aiTaskResultArtifact.findMany({ where: { scopeId: access.scopeId, taskId: lease.taskId, runId: lease.runId, stepId,
      actionId: step.actionId, stepFingerprint: step.requestFingerprint }, take: 2 });
    // Never manufacture a terminal reference when no durable receipt exists.
    // An incomplete started receipt is a real unknown reference, not evidence
    // of zero consumption or permission to execute again.
    if (rows.length !== 1) throw unavailable();
    if (!rows[0].completeMeasurement || !['SUCCEEDED', 'FAILED'].includes(rows[0].outcome)) {
      await this.held(this.db, lease, access, false, 'settle');
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
    await this.held(this.db, lease, access, false, 'settle');
    if (row.outcome === 'FAILED') {
      if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(row.errorCode ?? '')) throw unavailable();
      return { kind: 'failed', errorCode: row.errorCode!, resultRef: row.id, outputBytes: bytes };
    }
    return { kind: 'succeeded', resultRef: row.id, outputBytes: bytes };
  }
}
