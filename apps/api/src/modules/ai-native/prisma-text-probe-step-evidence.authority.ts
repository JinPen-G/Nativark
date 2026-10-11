import type { PrismaClient, AiStep, AiTaskResultArtifact, AiTaskExecutionCharge } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepositoryAuthority } from './ai-task.repository';
import type { PersistedBudgetEvidenceSource } from './budget/budget-dependency-adapters';
import type { AiTaskPlanEvidenceAuthority } from './runner/prisma-task-run-evidence.repository';
import { PrismaTaskStepEvidenceAuthority } from './runner/prisma-task-step-evidence.authority';
import { isGatewayConfig, isGatewayResult } from './gateway-contract-validation';
import { textProbeCommandSchema, textProbeIntent, TEXT_CAPABILITY_PROBE_TOOL, TEXT_PROBE_SCENE } from './text-capability-probe';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

type Db = Pick<PrismaClient, 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskRunPlan' | 'aiTaskResultArtifact'
  | 'aiTaskExecutionCharge' | 'aiTaskActionInput' | 'aiGatewayInvocation' | 'aiGatewayAccountingReceipt' | 'aiInvocationAdmission'>;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');

/** Evidence transition for the server-owned text challenge. This is deliberately
 * separate from model-step evidence: a probe proves only its own text receipt,
 * never a general model/media capability. */
export class PrismaTextProbeStepEvidenceAuthority extends PrismaTaskStepEvidenceAuthority {
  protected override readonly modelStep = true;
  constructor(private readonly probeDb: Db, authority: AiTaskRepositoryAuthority, plans: AiTaskPlanEvidenceAuthority,
    private readonly financial: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>,
    private readonly priceVersion: string, private readonly clock: () => Date = () => new Date()) {
    super(probeDb, authority, plans, clock);
    if (typeof financial?.readDispatch !== 'function' || !priceVersion
      || !['aiTaskActionInput', 'aiGatewayInvocation', 'aiGatewayAccountingReceipt', 'aiInvocationAdmission']
        .every(name => typeof (probeDb[name as keyof Db] as { findFirst?: unknown })?.findFirst === 'function')) throw unavailable();
  }
  protected override accepts(step: AiStep, operation: string) {
    return step.toolCode === TEXT_CAPABILITY_PROBE_TOOL && step.toolVersion === AI_TOOL_DRAFT_VERSION
      && operation === 'external_unknown';
  }
  protected override async additionalEvidence(step: AiStep, artifact: AiTaskResultArtifact | null,
    charges: AiTaskExecutionCharge[], context: AiExecutionContext) {
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || !step.inputRef) throw denied();
    const key = { scopeId: step.scopeId, taskId: step.taskId, runId: step.runId };
    const saved = await this.probeDb.aiTaskActionInput.findFirst({ where: { ...key, id: step.inputRef } });
    if (!saved || saved.id !== step.inputRef || saved.toolCode !== TEXT_CAPABILITY_PROBE_TOOL
      || saved.toolVersion !== AI_TOOL_DRAFT_VERSION || saved.fingerprint !== step.requestFingerprint || saved.expiresAt <= this.clock()) throw denied();
    const command = textProbeCommandSchema.parse(saved.payload);
    const prepared = textProbeIntent(command.operationId, step.scopeId);
    if (requestFingerprint(command) !== step.requestFingerprint) throw denied();
    if (!artifact) return { inputRef: saved.id, inputHash: saved.fingerprint };
    if (charges.length !== 4 || charges.filter(c => c.resource === 'CALLS').length !== 1) throw denied();
    const call = charges.find(c => c.resource === 'CALLS')!;
    const invocation = await this.probeDb.aiGatewayInvocation.findFirst({ where: { ...key, id: call.gatewayInvocationId!, stepId: step.id } });
    if (!invocation || invocation.id !== call.gatewayInvocationId || invocation.scopeId !== key.scopeId
      || invocation.taskId !== key.taskId || invocation.runId !== key.runId || invocation.stepId !== step.id
      || invocation.actionId !== step.actionId || invocation.stepFingerprint !== step.requestFingerprint
      || invocation.actorId !== context.actor.userId || invocation.callId !== prepared.intent.requestId
      || invocation.intentHash !== prepared.intentHash || invocation.sceneCode !== TEXT_PROBE_SCENE
      || invocation.maxOutputTokens !== 32 || invocation.mode !== 'invoke' || invocation.priceVersion !== this.priceVersion
      || !isGatewayConfig(invocation.configuration) || requestFingerprint(invocation.configuration) !== invocation.configurationHash
      || invocation.leaseOwnerId !== artifact.leaseOwnerId || invocation.fencingToken.toFixed(0) !== artifact.fencingToken.toFixed(0)) throw denied();
    const result = artifact.payload;
    if (!isGatewayResult(result) || result.requestId !== invocation.callId
      || requestFingerprint(result.actual) !== invocation.configurationHash) throw denied();
    if (!artifact.completeMeasurement) {
      if (artifact.outcome === 'UNKNOWN' && result.status !== 'unknown' && !(result.status === 'completed' && result.usage.kind === 'unknown')) throw denied();
      return { inputRef: saved.id, inputHash: saved.fingerprint, invocationId: invocation.id, unresolved: true };
    }
    if (artifact.outcome === 'SUCCEEDED' && (result.status !== 'completed' || result.usage.kind !== 'reported')) throw denied();
    if (artifact.outcome === 'FAILED' && result.status !== 'failed') throw denied();
    const receipt = await this.probeDb.aiGatewayAccountingReceipt.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, invocationId: invocation.id } });
    if (!receipt || receipt.scopeId !== key.scopeId || receipt.taskId !== key.taskId || receipt.invocationId !== invocation.id
      || receipt.tenantId !== context.scope.tenantId || receipt.workspaceId !== context.scope.workspaceId
      || receipt.state !== 'dispatched' || !receipt.dispatchToken) throw unavailable();
    const admission = await this.probeDb.aiInvocationAdmission.findFirst({ where: { id: receipt.admissionId,
      tenantId: receipt.tenantId, workspaceId: receipt.workspaceId, callId: invocation.callId,
      actorId: invocation.actorId, requestHash: receipt.requestHash, dispatchId: receipt.dispatchToken, revokedAt: null } });
    const financial = structuredClone(await this.financial.readDispatch(receipt.reservationId));
    if (!admission || !isGatewayConfig(invocation.configuration) || admission.profileId !== invocation.configuration.configId
      || financial.state !== 'dispatched' || financial.dispatchToken !== receipt.dispatchToken
      || financial.reservationId !== receipt.reservationId || financial.requestId !== invocation.callId
      || financial.callId !== invocation.callId || financial.actorId !== invocation.actorId
      || financial.scopeKey !== `WORKSPACE:${key.scopeId}` || financial.runId !== key.runId
      || financial.stepId !== step.id || financial.actionId !== step.actionId || financial.sceneCode !== TEXT_PROBE_SCENE
      || financial.priceVersion !== invocation.priceVersion || financial.configurationHash !== invocation.configurationHash) throw denied();
    return { inputRef: saved.id, inputHash: saved.fingerprint, invocationId: invocation.id,
      reservationId: receipt.reservationId, admissionId: admission.id, dispatchToken: receipt.dispatchToken };
  }
}
