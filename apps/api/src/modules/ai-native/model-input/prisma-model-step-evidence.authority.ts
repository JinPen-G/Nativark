import type { PrismaClient, AiStep, AiTaskResultArtifact, AiTaskExecutionCharge } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, aiTaskAccessFromContext, type AiTaskRepositoryAuthority } from '../ai-task.repository';
import type { PersistedBudgetEvidenceSource } from '../budget/budget-dependency-adapters';
import type { AiTaskPlanEvidenceAuthority } from '../runner/prisma-task-run-evidence.repository';
import { PrismaTaskStepEvidenceAuthority } from '../runner/prisma-task-step-evidence.authority';
import { TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, parseTaskModelInput, taskModelFingerprint, taskModelIdentity, taskModelPolicy, type TaskModelPolicy } from './task-model-input';
import { isGatewayResult } from '../gateway-contract-validation';
import { readModelNonDispatchEvidence } from './prisma-model-nondispatch.evidence';
import { taskStepChargesValid, isTaskModelCountCharge } from '../runner/task-model-count-charge';
import { readOriginalTaskModelProvenance } from '../task-request/prisma-original-request.repository';

type Db = Pick<PrismaClient, 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskRunPlan' | 'aiTaskResultArtifact'
  | 'aiTaskExecutionCharge' | 'aiTaskActionInput' | 'aiGatewayInvocation' | 'aiGatewayAccountingReceipt' | 'aiInvocationAdmission' | 'aiBudgetReservation'>
  & Partial<Pick<PrismaClient, 'aiTaskOriginalRequest'>>;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');

/** Model lifecycle evidence only. Never authorizes dispatch, settles money,
 * retries a provider or reconciles an unknown result into success. */
export class PrismaModelStepEvidenceAuthority extends PrismaTaskStepEvidenceAuthority {
  protected override readonly modelStep = true;
  private readonly policy: TaskModelPolicy;
  constructor(private readonly modelDb: Db, private readonly modelAuthorization: AiTaskRepositoryAuthority, plans: AiTaskPlanEvidenceAuthority,
    policy: TaskModelPolicy, private readonly financial: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>,
    private readonly clock: () => Date = () => new Date()) {
    super(modelDb, modelAuthorization, plans, clock);
    if (typeof financial?.readDispatch !== 'function'
      || !['aiTaskActionInput', 'aiGatewayInvocation', 'aiGatewayAccountingReceipt', 'aiInvocationAdmission']
        .every(name => typeof (modelDb[name as keyof Db] as { findFirst?: unknown })?.findFirst === 'function')) throw unavailable();
    this.policy = taskModelPolicy(policy);
  }
  /** Reuse original model/financial evidence for a dependent read, without
   * turning terminal observation into dispatch or reconciliation permission. */
  async readCompletedEvidence(taskId: string, stepId: string, resultId: string) {
    return this.readCompleted(taskId, stepId, resultId, false);
  }
  /** Original completed evidence only: current read permission plus immutable
   * original identity, not the expired dispatch grant or today's permission set.
   * This method cannot register, dispatch, settle, release or approve anything. */
  async readOriginalCompletedEvidence(taskId: string, stepId: string, resultId: string) {
    return this.readCompleted(taskId, stepId, resultId, true);
  }
  private async readCompleted(taskId: string, stepId: string, resultId: string, originalObservation: boolean) {
    const context = structuredClone(await this.modelAuthorization.resolve(taskId, 'read_step_terminal'));
    const access = aiTaskAccessFromContext(context, taskId, this.clock());
    const task = await this.modelDb.aiTask.findFirst({ where: access.where });
    if (!task) throw denied();
    if (originalObservation && typeof this.modelDb.aiTaskOriginalRequest?.findFirst !== 'function') throw unavailable();
    const original = originalObservation ? await readOriginalTaskModelProvenance({
      aiTaskOriginalRequest: this.modelDb.aiTaskOriginalRequest! }, task) : undefined;
    const key = { scopeId: task.scopeId, taskId };
    const step = await this.modelDb.aiStep.findFirst({ where: { ...key, id: stepId, resultRef: resultId, status: 'SUCCEEDED' } });
    if (!step || step.id !== stepId || step.scopeId !== key.scopeId || step.taskId !== taskId
      || !this.accepts(step, 'external_unknown') || step.status !== 'SUCCEEDED' || step.resultRef !== resultId) throw denied();
    const artifact = await this.modelDb.aiTaskResultArtifact.findFirst({ where: { ...key, runId: step.runId, stepId, id: resultId } });
    if (!artifact || artifact.id !== resultId || artifact.scopeId !== key.scopeId || artifact.taskId !== taskId
      || artifact.runId !== step.runId || artifact.stepId !== stepId || artifact.actionId !== step.actionId
      || artifact.stepFingerprint !== step.requestFingerprint || artifact.outcome !== 'SUCCEEDED' || !artifact.completeMeasurement
      || artifact.errorCode !== null || requestFingerprint(artifact.payload) !== artifact.contentHash
      || BigInt(Buffer.byteLength(JSON.stringify(artifact.payload), 'utf8')) !== artifact.outputBytes) throw denied();
    const charges = await this.modelDb.aiTaskExecutionCharge.findMany({ where: { ...key, runId: step.runId, stepId }, take: 6 });
    if (!taskStepChargesValid(charges, true)
      || charges.some(charge => charge.scopeId !== key.scopeId || charge.taskId !== taskId || charge.runId !== step.runId
        || charge.stepId !== stepId || charge.actionId !== step.actionId || charge.stepFingerprint !== step.requestFingerprint
        || charge.status !== 'RECORDED' || charge.leaseOwnerId !== artifact.leaseOwnerId
        || charge.fencingToken.toFixed(0) !== artifact.fencingToken.toFixed(0)
        || charge.actualAmount !== (charge.resource === 'ACTIVE_MS' ? artifact.activeMs
          : charge.resource === 'OUTPUT_BYTES' ? artifact.outputBytes : 1n))) throw denied();
    const chargeBinding = (rows: AiTaskExecutionCharge[]) => requestFingerprint(rows.map(charge => ({
      id: charge.chargeId, scopeId: charge.scopeId, taskId: charge.taskId, runId: charge.runId, stepId: charge.stepId,
      actionId: charge.actionId, fingerprint: charge.stepFingerprint, resource: charge.resource, status: charge.status,
      amount: charge.actualAmount?.toString(), invocation: charge.gatewayInvocationId,
      owner: charge.leaseOwnerId, fence: charge.fencingToken.toFixed(0), revision: charge.revision
    })).sort((left, right) => left.id.localeCompare(right.id)));
    const chargeHash = chargeBinding(charges);
    const evidence = await this.modelEvidence(step, artifact, charges, context, original?.authorizationHash);
    const current = await this.modelAuthorization.resolve(taskId, 'read_step_terminal');
    const latest = await this.modelDb.aiTaskResultArtifact.findFirst({ where: { ...key, id: resultId } });
    const latestStep = await this.modelDb.aiStep.findFirst({ where: { ...key, id: stepId } });
    const latestCharges = await this.modelDb.aiTaskExecutionCharge.findMany({ where: { ...key, runId: step.runId, stepId }, take: 6 });
    const stepBinding = (row: AiStep) => ({ id: row.id, scopeId: row.scopeId, taskId: row.taskId, runId: row.runId,
      revision: row.revision, status: row.status, inputRef: row.inputRef, resultRef: row.resultRef,
      actionId: row.actionId, fingerprint: row.requestFingerprint, toolCode: row.toolCode, toolVersion: row.toolVersion });
    if (taskModelIdentity(context) !== taskModelIdentity(current) || !latest || !latestStep
      || latest.contentHash !== artifact.contentHash || requestFingerprint(latest.payload) !== artifact.contentHash
      || latest.scopeId !== key.scopeId || latest.taskId !== taskId || latest.runId !== step.runId || latest.stepId !== stepId
      || latest.actionId !== step.actionId || latest.stepFingerprint !== step.requestFingerprint
      || latest.outcome !== 'SUCCEEDED' || !latest.completeMeasurement || latest.errorCode !== null
      || latest.outputBytes !== artifact.outputBytes || latest.activeMs !== artifact.activeMs
      || latest.leaseOwnerId !== artifact.leaseOwnerId || latest.fencingToken.toFixed(0) !== artifact.fencingToken.toFixed(0)
      || requestFingerprint(stepBinding(latestStep)) !== requestFingerprint(stepBinding(step))
      || chargeBinding(latestCharges) !== chargeHash) throw denied();
    if (original) {
      const currentTask = await this.modelDb.aiTask.findFirst({ where: aiTaskAccessFromContext(current, taskId, this.clock()).where });
      if (!currentTask || (await readOriginalTaskModelProvenance({ aiTaskOriginalRequest: this.modelDb.aiTaskOriginalRequest! },
        currentTask)).bindingHash !== original.bindingHash) throw denied();
    }
    // Keep Prisma Decimal/BigInt implementation objects behind the repository
    // boundary. Consumers need the immutable result binding, not raw rows.
    return { context: structuredClone(current), step: stepBinding(step), artifact: {
      id: artifact.id, contentHash: artifact.contentHash, payload: structuredClone(artifact.payload)
    }, evidence: structuredClone(evidence) };
  }
  protected override accepts(step: AiStep, operation: string) {
    return step.toolCode === (this.policy.kind === 'image' ? TASK_IMAGE_MODEL_TOOL : this.policy.kind === 'audio' ? TASK_AUDIO_MODEL_TOOL : TASK_TEXT_MODEL_TOOL)
      && step.toolVersion === AI_TOOL_DRAFT_VERSION && operation === 'external_unknown';
  }
  protected override async additionalEvidence(step: AiStep, artifact: AiTaskResultArtifact | null,
    charges: AiTaskExecutionCharge[], context: AiExecutionContext) {
    // Preserve an original result under today's independent task permission;
    // removing an unrelated execution permission must not erase its frozen
    // caller binding or metering. Starts and other task producers retain the
    // strict current-identity path. This never grants another invocation.
    if (artifact && typeof this.modelDb.aiTaskOriginalRequest?.findFirst === 'function') {
      const access = aiTaskAccessFromContext(context, step.taskId, this.clock());
      const task = await this.modelDb.aiTask.findFirst({ where: access.where });
      if (!task || task.scopeId !== step.scopeId) throw denied();
      if (task.inputRef && task.creationKey === `scene-request:${task.inputRef}`) {
        const db = { aiTaskOriginalRequest: this.modelDb.aiTaskOriginalRequest };
        const original = await readOriginalTaskModelProvenance(db, task);
        const evidence = await this.modelEvidence(step, artifact, charges, context, original.authorizationHash);
        const current = await this.modelAuthorization.resolve(step.taskId, 'transition_task');
        const latest = await this.modelDb.aiTask.findFirst({ where: aiTaskAccessFromContext(current, step.taskId, this.clock()).where });
        if (taskModelIdentity(current) !== taskModelIdentity(context) || !latest
          || (await readOriginalTaskModelProvenance(db, latest)).bindingHash !== original.bindingHash) throw denied();
        return evidence;
      }
    }
    return this.modelEvidence(step, artifact, charges, context);
  }
  private async modelEvidence(step: AiStep, artifact: AiTaskResultArtifact | null,
    charges: AiTaskExecutionCharge[], context: AiExecutionContext, originalAuthorizationHash?: string) {
    const actorId = context.audience === 'client' && context.actor.kind === 'customer' ? context.actor.customerId
      : ['operator', 'staff'].includes(context.audience) && context.actor.kind === 'user' ? context.actor.userId
        : context.audience === 'automation' && context.actor.kind === 'automation' ? context.actor.subjectId : null;
    if (!actorId || context.scope.kind !== 'workspace' || !step.inputRef) throw denied();
    const key = { scopeId: step.scopeId, taskId: step.taskId, runId: step.runId };
    const saved = await this.modelDb.aiTaskActionInput.findFirst({ where: { ...key, id: step.inputRef } });
    if (!saved || saved.scopeId !== key.scopeId || saved.taskId !== key.taskId || saved.runId !== key.runId
      || saved.id !== step.inputRef || saved.toolCode !== step.toolCode || saved.toolVersion !== step.toolVersion
      || saved.fingerprint !== step.requestFingerprint || !originalAuthorizationHash && saved.expiresAt <= this.clock()) throw denied();
    const input = parseTaskModelInput(saved.payload, this.policy);
    if (taskModelFingerprint(input, this.policy) !== step.requestFingerprint
      || (originalAuthorizationHash ?? taskModelIdentity(context)) !== input.identityHash) throw denied();
    const inputHash = requestFingerprint(input);
    if (!artifact) return { inputRef: saved.id, inputHash };
    const startedBeforeInvocation = artifact.outcome === 'RUNNING' && !artifact.completeMeasurement
      && charges.length === 3 && taskStepChargesValid(charges) && charges.every(c => c.gatewayInvocationId === null);
    if (!startedBeforeInvocation && !taskStepChargesValid(charges, true)) throw denied();
    const call = charges.find(c => c.resource === 'CALLS' && !isTaskModelCountCharge(c));
    // Registration can commit before its CALLS reservation is acknowledged.
    // Bind any original invocation already present, but never infer dispatch,
    // zero consumption or permission to redo preparation from a missing row.
    const registered = startedBeforeInvocation ? await this.modelDb.aiGatewayInvocation.findMany({
      where: { ...key, stepId: step.id }, take: 2 }) : [];
    if (registered.length > 1) throw denied();
    const invocation = startedBeforeInvocation ? registered[0]
      : await this.modelDb.aiGatewayInvocation.findFirst({ where: { ...key, id: call!.gatewayInvocationId!, stepId: step.id } });
    if (startedBeforeInvocation && !invocation) return { inputRef: saved.id, inputHash, unresolved: true };
    if (!invocation || !startedBeforeInvocation && invocation.id !== call!.gatewayInvocationId || invocation.scopeId !== key.scopeId
      || invocation.taskId !== key.taskId || invocation.runId !== key.runId || invocation.stepId !== step.id
      || invocation.actionId !== step.actionId || invocation.stepFingerprint !== step.requestFingerprint
      || invocation.actorId !== actorId || invocation.callId !== input.intent.requestId
      || invocation.intentHash !== step.requestFingerprint || invocation.mode !== input.mode
      || invocation.sceneCode !== input.intent.sceneCode || invocation.priceVersion !== input.priceVersion
      || invocation.configurationHash !== requestFingerprint(input.configuration)
      || requestFingerprint(invocation.configuration) !== invocation.configurationHash
      || invocation.leaseOwnerId !== artifact.leaseOwnerId || invocation.fencingToken.toFixed(0) !== artifact.fencingToken.toFixed(0)) throw denied();
    // Unknown may precede financial admission. Preserve it without inventing a
    // no-dispatch fact. Known completion requires same-ledger dispatch evidence.
    if (!artifact.completeMeasurement) {
      const result = artifact.payload;
      if (artifact.outcome === 'UNKNOWN' && (!isGatewayResult(result)
        || (result.status !== 'unknown' && !(result.status === 'completed' && result.usage.kind === 'unknown'))
        || result.requestId !== invocation.callId || requestFingerprint(result.actual) !== invocation.configurationHash)) throw denied();
      return { inputRef: saved.id, inputHash, invocationId: invocation.id, unresolved: true };
    }
    const result = artifact.payload;
    if (!isGatewayResult(result) || result.requestId !== invocation.callId
      || requestFingerprint(result.actual) !== invocation.configurationHash
      || (artifact.outcome === 'SUCCEEDED' ? result.status !== 'completed' || result.usage.kind !== 'reported'
        : artifact.outcome !== 'FAILED' || result.status !== 'failed')) throw denied();
    if (artifact.outcome === 'FAILED') {
      const unsent = await readModelNonDispatchEvidence(this.modelDb, {
        scopeId: key.scopeId, tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId, actorId }, invocation);
      if (!unsent) throw unavailable();
      return { inputRef: saved.id, inputHash, ...unsent };
    }
    const receipt = await this.modelDb.aiGatewayAccountingReceipt.findFirst({ where: {
      scopeId: key.scopeId, taskId: key.taskId, invocationId: invocation.id } });
    if (!receipt || receipt.scopeId !== key.scopeId || receipt.taskId !== key.taskId || receipt.invocationId !== invocation.id
      || receipt.tenantId !== context.scope.tenantId || receipt.workspaceId !== context.scope.workspaceId
      || receipt.state !== 'dispatched' || !receipt.dispatchToken) throw unavailable();
    const admission = await this.modelDb.aiInvocationAdmission.findFirst({ where: { id: receipt.admissionId,
      tenantId: receipt.tenantId, workspaceId: receipt.workspaceId, callId: invocation.callId,
      actorId: invocation.actorId, requestHash: receipt.requestHash, dispatchId: receipt.dispatchToken, revokedAt: null } });
    const financial = structuredClone(await this.financial.readDispatch(receipt.reservationId));
    if (!admission || admission.id !== receipt.admissionId || admission.actorId !== invocation.actorId
      || admission.callId !== invocation.callId || admission.tenantId !== receipt.tenantId || admission.workspaceId !== receipt.workspaceId
      || admission.profileId !== input.configuration.configId || admission.requestHash !== receipt.requestHash
      || admission.dispatchId !== receipt.dispatchToken || admission.revokedAt !== null
      || !['dispatching', 'completed', 'unknown'].includes(admission.status)
      || financial.state !== 'dispatched' || financial.dispatchToken !== receipt.dispatchToken
      || financial.reservationId !== receipt.reservationId || financial.requestId !== invocation.callId
      || financial.callId !== invocation.callId || financial.actorId !== invocation.actorId
      || financial.scopeKey !== `WORKSPACE:${key.scopeId}` || financial.runId !== key.runId
      || financial.stepId !== step.id || financial.actionId !== step.actionId || financial.sceneCode !== invocation.sceneCode
      || financial.priceVersion !== invocation.priceVersion || financial.configRevision !== input.configuration.configRevision
      || financial.configurationHash !== invocation.configurationHash) throw denied();
    return { inputRef: saved.id, inputHash, invocationId: invocation.id, reservationId: receipt.reservationId,
      admissionId: admission.id, dispatchToken: receipt.dispatchToken };
  }
}
