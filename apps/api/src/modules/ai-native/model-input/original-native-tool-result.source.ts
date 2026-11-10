/** Closed original model -> order-read -> native result continuation. Resolves
 * frozen selectors to completed original receipts, reopens the business source
 * through the existing Guard/Core, and rejects changed facts. Does not publish,
 * register, dispatch, approve, reprice or return native IDs to a public caller. */
import type { PrismaClient } from '@prisma/client';
import type { AiExecutionContext, AiGatewayToolResultReferenceDraft } from '@rental-os/shared';
import type { PrismaModelStepEvidenceAuthority } from './prisma-model-step-evidence.authority';
import type { PrismaTaskPlanInputSource } from '../runner/prisma-task-plan-input.source';
import type { AiTaskResultRepository } from '../runner/ai-task-result.repository';
import type { AiTaskRepository } from '../ai-task.repository';
import type { UnifiedGatewayRoutingPort } from '../unified-ai-gateway.ports';
import type { GatewayContext } from '../model-gateway.ports';
import { ModelGatewayError } from '../model-gateway.ports';
import { isGatewayResult, isGatewayOrderExplainRequest } from '../gateway-contract-validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { parseTaskModelInput, taskModelFingerprint, taskModelIdentity, taskModelConfiguration,
  TASK_TEXT_MODEL_TOOL, type TaskModelPolicy } from './task-model-input';
import { nativeToolResultReferenceSchema, type NativeToolCallBindingReader,
  type NativeToolResultResolver, type ResolvedNativeToolResult } from './native-tool-result.ports';

interface Dependencies {
  db: Pick<PrismaClient, 'aiTask' | 'aiTaskActionInput' | 'aiStep'>;
  tasks: Pick<AiTaskRepository, 'resolveAccess'>;
  execution: { authorize(taskId: string): Promise<AiExecutionContext> };
  modelEvidence: Pick<PrismaModelStepEvidenceAuthority, 'readCompletedEvidence'>;
  toolInputs: Pick<PrismaTaskPlanInputSource, 'readReadonlyResultInput'>;
  toolResults: Pick<AiTaskResultRepository, 'read'>;
  reopenBusinessSource(value: { taskId: string; resultId: string }, signal?: AbortSignal): Promise<{ facts: unknown }>;
  bindings: NativeToolCallBindingReader;
  routing: UnifiedGatewayRoutingPort;
  task: { taskId: string; runId: string; modelRegistrationRef: string; orderRegistrationRef: string };
  policy: TaskModelPolicy;
}
const denied = () => new ModelGatewayError('FORBIDDEN');
// Only the observation clock differs on a legitimate re-read. Every actual
// field, scope, coverage and unknown/missing marker must still be identical.
function comparable(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw denied();
  const { observedAt: _clock, requestId: _request, sources, ...facts } = value as Record<string, unknown>;
  if (!Array.isArray(sources)) throw denied();
  return { ...facts, sources: sources.map(source => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw denied();
    const { observedAt: _sourceClock, ...binding } = source as Record<string, unknown>;
    return binding;
  }) };
}
export class OriginalNativeToolResultSource implements NativeToolResultResolver {
  private readonly task: Dependencies['task'];
  constructor(private readonly input: Dependencies) {
    if (input?.policy.nativeToolResults !== true || input.policy.orderExplainTool !== true
      || typeof input.execution?.authorize !== 'function' || typeof input.tasks?.resolveAccess !== 'function'
      || typeof input.modelEvidence?.readCompletedEvidence !== 'function'
      || typeof input.toolInputs?.readReadonlyResultInput !== 'function' || typeof input.toolResults?.read !== 'function'
      || typeof input.reopenBusinessSource !== 'function' || typeof input.bindings?.readOriginal !== 'function'
      || typeof input.routing?.resolve !== 'function' || typeof input.routing.assertCurrent !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
    this.task = Object.freeze(structuredClone(input.task));
  }
  async resolve(value: GatewayContext, raw: AiGatewayToolResultReferenceDraft, signal: AbortSignal): Promise<ResolvedNativeToolResult> {
    const context = structuredClone(value), reference = nativeToolResultReferenceSchema.parse(structuredClone(raw));
    const active = () => { if (signal.aborted) throw new ModelGatewayError('CANCELLED'); };
    active();
    if (!('tenantId' in context) || reference.taskId !== this.task.taskId || reference.runId !== this.task.runId
      || reference.modelRegistrationRef !== this.task.modelRegistrationRef
      || reference.toolRegistrationRef !== this.task.orderRegistrationRef || reference.callIndex !== 0) throw denied();
    const current = await this.input.execution.authorize(reference.taskId);
    if (current.scope.kind !== 'workspace' || current.actor.kind !== 'user'
      || current.scope.tenantId !== context.tenantId || current.scope.workspaceId !== context.workspaceId
      || current.actor.userId !== context.actorId || !['operator', 'staff'].includes(current.audience)) throw denied();
    const access = await this.input.tasks.resolveAccess(reference.taskId, 'read_step_terminal');
    const task = await this.input.db.aiTask.findFirst({ where: access.where });
    if (!task || task.id !== reference.taskId) throw denied();
    const frozen = await this.input.db.aiTaskActionInput.findFirst({ where: { scopeId: task.scopeId, taskId: reference.taskId,
      runId: reference.runId, registrationRef: reference.modelRegistrationRef } });
    if (!frozen || frozen.toolCode !== TASK_TEXT_MODEL_TOOL) throw denied();
    const originalInput = parseTaskModelInput(frozen.payload, this.input.policy);
    if (originalInput.identityHash !== taskModelIdentity(current)
      || frozen.fingerprint !== taskModelFingerprint(originalInput, this.input.policy)
      || !originalInput.intent.requiredFeatures.includes('tools')
      || originalInput.intent.messages.some(message => message.content.some(part => part.kind !== 'text'))) throw denied();
    const key = { scopeId: frozen.scopeId, taskId: reference.taskId, runId: reference.runId };
    const parent = await this.input.db.aiStep.findFirst({ where: { ...key, inputRef: frozen.id,
      toolCode: TASK_TEXT_MODEL_TOOL, requestFingerprint: frozen.fingerprint, status: 'SUCCEEDED' } });
    if (!parent?.resultRef) throw denied();
    const model = await this.input.modelEvidence.readCompletedEvidence(reference.taskId, parent.id, parent.resultRef);
    const result = model.artifact.payload;
    if (!isGatewayResult(result) || result.status !== 'completed' || result.usage.kind !== 'reported'
      || result.requestId !== originalInput.intent.requestId
      || requestFingerprint(result.actual) !== requestFingerprint(originalInput.configuration)
      || result.toolRequests.length !== 1 || !isGatewayOrderExplainRequest(result.toolRequests[0])) throw denied();
    const selected = await this.input.db.aiTaskActionInput.findFirst({ where: { ...key,
      registrationRef: reference.toolRegistrationRef } });
    if (!selected || selected.toolCode !== 'rental.order.explain') throw denied();
    const read = await this.input.db.aiStep.findFirst({ where: { ...key, inputRef: selected.id,
      toolCode: 'rental.order.explain', status: 'SUCCEEDED' } });
    if (!read?.resultRef || read.sequence <= parent.sequence) throw denied();
    const original = await this.input.toolInputs.readReadonlyResultInput({ taskId: reference.taskId, runId: reference.runId, stepId: read.id });
    if (taskModelIdentity(original.context) !== taskModelIdentity(current)
      || original.registrationRef !== reference.toolRegistrationRef || original.inputRef !== selected.id
      || original.fingerprint !== read.requestFingerprint
      || requestFingerprint(original.input) !== requestFingerprint(result.toolRequests[0])) throw denied();
    const artifact = await this.input.toolResults.read({ taskId: reference.taskId, resultId: read.resultRef });
    if (artifact.status !== 'succeeded' || !artifact.completeMeasurement || !artifact.payload
      || artifact.runId !== reference.runId || artifact.stepId !== read.id || artifact.actionId !== read.actionId) throw denied();
    // Task ownership is not business read permission. Reopen through the same
    // original Core reader and require every retained field to remain visible.
    const reopened = await this.input.reopenBusinessSource({ taskId: reference.taskId, resultId: artifact.resultId }, signal);
    if (requestFingerprint(comparable(reopened.facts)) !== requestFingerprint(comparable(artifact.payload))) throw denied();
    const invocationId = 'invocationId' in model.evidence ? model.evidence.invocationId : undefined;
    if (typeof invocationId !== 'string') throw denied();
    const binding = await this.input.bindings.readOriginal(current, invocationId, reference.callIndex);
    if (binding.configurationHash !== requestFingerprint(originalInput.configuration)
      || binding.inputHash !== requestFingerprint(result.toolRequests[0])) throw denied();
    const route = await this.input.routing.resolve(context, ['text', 'tools']);
    if (requestFingerprint(taskModelConfiguration(route)) !== requestFingerprint(originalInput.configuration)) throw denied();
    await this.input.routing.assertCurrent(context, route); active();
    if (taskModelIdentity(await this.input.execution.authorize(reference.taskId)) !== taskModelIdentity(current)
      || (await this.input.tasks.resolveAccess(reference.taskId, 'read_step_terminal')).bindingKey !== access.bindingKey) throw denied();
    const latestModel = await this.input.modelEvidence.readCompletedEvidence(reference.taskId, parent.id, parent.resultRef);
    const latestTool = await this.input.toolResults.read({ taskId: reference.taskId, resultId: artifact.resultId });
    if (latestModel.artifact.contentHash !== model.artifact.contentHash || requestFingerprint(latestTool) !== requestFingerprint(artifact)) throw denied();
    const resultJson = JSON.stringify(artifact.payload);
    if (Buffer.byteLength(resultJson, 'utf8') > 131072) throw new ModelGatewayError('INVALID_REQUEST');
    const evidenceHash = requestFingerprint({ reference, identityHash: taskModelIdentity(current),
      modelResultId: model.artifact.id, modelResultHash: model.artifact.contentHash,
      toolResultId: artifact.resultId, toolResultHash: artifact.contentHash,
      toolInputHash: original.fingerprint, bindingHash: binding.bindingHash,
      sourceConfigurationHash: binding.configurationHash });
    return { version: 'native-tool-result-1', reference, originalIntent: structuredClone(originalInput.intent),
      sourceInvocationId: invocationId, sourceConfigurationHash: binding.configurationHash,
      modelResultId: model.artifact.id, modelResultHash: model.artifact.contentHash,
      toolResultId: artifact.resultId, toolResultHash: artifact.contentHash,
      bindingHash: binding.bindingHash, call: structuredClone(binding.call), resultJson, evidenceHash };
  }
  async assertCurrent(context: GatewayContext, value: ResolvedNativeToolResult, signal: AbortSignal) {
    const original = structuredClone(value), latest = await this.resolve(context, original.reference, signal);
    if (requestFingerprint(latest) !== requestFingerprint(original)) throw denied();
  }
}
