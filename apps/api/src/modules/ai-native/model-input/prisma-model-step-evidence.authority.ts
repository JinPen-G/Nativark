import type { PrismaClient, AiStep, AiTaskResultArtifact, AiTaskExecutionCharge } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, aiTaskAccessFromContext, type AiTaskRepositoryAuthority } from '../ai-task.repository';
import type { PersistedBudgetEvidenceSource } from '../budget/budget-dependency-adapters';
import type { AiTaskPlanEvidenceAuthority } from '../runner/prisma-task-run-evidence.repository';
import { PrismaTaskStepEvidenceAuthority } from '../runner/prisma-task-step-evidence.authority';
import { TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, parseTaskModelInput, taskModelFingerprint, taskModelIdentity, taskModelPolicy, type TaskModelPolicy } from './task-model-input';
import { isGatewayResult } from '../gateway-contract-validation';

type Db = Pick<PrismaClient, 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskRunPlan' | 'aiTaskResultArtifact'
  | 'aiTaskExecutionCharge' | 'aiTaskActionInput' | 'aiGatewayInvocation' | 'aiGatewayAccountingReceipt' | 'aiInvocationAdmission'>;
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
    const context = structuredClone(await this.modelAuthorization.resolve(taskId, 'read_step_terminal'));
    const access = aiTaskAccessFromContext(context, taskId, this.clock());
    const task = await this.modelDb.aiTask.findFirst({ where: access.where });
    if (!task) throw denied();
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
    const charges = await this.modelDb.aiTaskExecutionCharge.findMany({ where: { ...key, runId: step.runId, stepId }, take: 5 });
    if (charges.length !== 4 || new Set(charges.map(charge => charge.resource)).size !== 4
      || !['STEPS', 'CALLS', 'ACTIVE_MS', 'OUTPUT_BYTES'].every(resource => charges.some(charge => charge.resource === resource))
      || charges.some(charge => charge.scopeId !== key.scopeId || charge.taskId !== taskId || charge.runId !== step.runId
        || charge.stepId !== stepId || charge.actionId !== step.actionId || charge.stepFingerprint !== step.requestFingerprint
        || charge.status !== 'RECORDED' || charge.leaseOwnerId !== artifact.leaseOwnerId
        || charge.fencingToken.toFixed(0) !== artifact.fencingToken.toFixed(0))) throw denied();
    const evidence = await this.additionalEvidence(step, artifact, charges, context);
    const current = await this.modelAuthorization.resolve(taskId, 'read_step_terminal');
    const latest = await this.modelDb.aiTaskResultArtifact.findFirst({ where: { ...key, id: resultId } });
    const latestStep = await this.modelDb.aiStep.findFirst({ where: { ...key, id: stepId } });
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
      || requestFingerprint(stepBinding(latestStep)) !== requestFingerprint(stepBinding(step))) throw denied();
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
    const actorId = context.audience === 'client' && context.actor.kind === 'customer' ? context.actor.customerId
      : ['operator', 'staff'].includes(context.audience) && context.actor.kind === 'user' ? context.actor.userId : null;
    if (!actorId || context.scope.kind !== 'workspace' || !step.inputRef) throw denied();
    const key = { scopeId: step.scopeId, taskId: step.taskId, runId: step.runId };
    const saved = await this.modelDb.aiTaskActionInput.findFirst({ where: { ...key, id: step.inputRef } });
    if (!saved || saved.scopeId !== key.scopeId || saved.taskId !== key.taskId || saved.runId !== key.runId
      || saved.id !== step.inputRef || saved.toolCode !== step.toolCode || saved.toolVersion !== step.toolVersion
      || saved.fingerprint !== step.requestFingerprint || saved.expiresAt <= this.clock()) throw denied();
    const input = parseTaskModelInput(saved.payload, this.policy);
    if (taskModelFingerprint(input, this.policy) !== step.requestFingerprint || taskModelIdentity(context) !== input.identityHash) throw denied();
    const inputHash = requestFingerprint(input);
    if (!artifact) return { inputRef: saved.id, inputHash };
    if (charges.length !== 4 || charges.filter(c => c.resource === 'CALLS').length !== 1) throw denied();
    const call = charges.find(c => c.resource === 'CALLS')!;
    const invocation = await this.modelDb.aiGatewayInvocation.findFirst({ where: { ...key, id: call.gatewayInvocationId!, stepId: step.id } });
    if (!invocation || invocation.id !== call.gatewayInvocationId || invocation.scopeId !== key.scopeId
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
