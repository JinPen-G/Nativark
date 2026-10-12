import type { PrismaClient, AiStep, AiTaskResultArtifact, AiTaskExecutionCharge } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, type AiTaskRepositoryAuthority } from '../ai-task.repository';
import type { PersistedBudgetEvidenceSource } from '../budget/budget-dependency-adapters';
import type { AiTaskPlanEvidenceAuthority } from '../runner/prisma-task-run-evidence.repository';
import { PrismaTaskStepEvidenceAuthority } from '../runner/prisma-task-step-evidence.authority';
import { TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, parseTaskModelInput, taskModelFingerprint, taskModelIdentity, type TaskModelPolicy } from './task-model-input';
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
  constructor(private readonly modelDb: Db, authority: AiTaskRepositoryAuthority, plans: AiTaskPlanEvidenceAuthority,
    policy: TaskModelPolicy, private readonly financial: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>,
    private readonly clock: () => Date = () => new Date()) {
    super(modelDb, authority, plans, clock);
    if (typeof financial?.readDispatch !== 'function'
      || !['aiTaskActionInput', 'aiGatewayInvocation', 'aiGatewayAccountingReceipt', 'aiInvocationAdmission']
        .every(name => typeof (modelDb[name as keyof Db] as { findFirst?: unknown })?.findFirst === 'function')) throw unavailable();
    this.policy = { sceneCode: policy.sceneCode, maxOutputTokens: policy.maxOutputTokens, ...(policy.kind ? { kind: policy.kind } : {}) };
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
