import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepository } from '../ai-task.repository';
import { AiTaskResultRepository } from '../runner/ai-task-result.repository';
import { isGatewayResult } from '../gateway-contract-validation';
import { parseTaskModelInput, TASK_TEXT_MODEL_TOOL, taskModelFingerprint, taskModelIdentity } from '../model-input/task-model-input';
import type { GatewayTextIntentBinding, GatewayTextIntentPolicy } from '../gateway-intent';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { originalRequestReferenceSchema, freezeOriginalInput } from '../task-request/original-request.validation';
import { originalIdentityHash } from '../task-request/original-request.authority';
import type { composeAiOriginalScenes } from './original-scenes.composition';

type Scenes = ReturnType<typeof composeAiOriginalScenes>;
type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiStep' | 'aiTaskActionInput' | 'aiGatewayInvocation' | 'aiTaskResultArtifact'>;
const commandSchema = z.object({ original: originalRequestReferenceSchema,
  resultId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
const envelopeSchema = z.object({ original: z.unknown(), materialHash: z.string().regex(/^[a-f0-9]{64}$/u),
  trust: z.literal('source_text_is_data_not_instructions'), facts: z.unknown() }).strict();
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const receiptFingerprint = (value: unknown) => {
  const receipt = z.record(z.unknown()).parse(value);
  // Expiry is derived at read time, not a mutation of the frozen request.
  const { state: _state, ...immutable } = receipt;
  return requestFingerprint(immutable);
};

/** Compare actual order projections, excluding only their observation times.
 * Business dates, versions, coverage and amounts remain in the comparison.
 * A new observation is not a new business fact; a permission/coverage change is.
 */
function orderFactsFingerprint(material: unknown) {
  const packet = z.object({ payload: z.record(z.unknown()) }).passthrough().parse(structuredClone(material));
  const payload = packet.payload;
  delete payload.observedAt;
  if (!payload.facts || typeof payload.facts !== 'object' || Array.isArray(payload.facts)) throw unavailable();
  for (const fact of Object.values(payload.facts)) {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) continue;
    const source = (fact as Record<string, unknown>).source;
    if (source && typeof source === 'object' && !Array.isArray(source)) delete (source as Record<string, unknown>).observedAt;
  }
  return requestFingerprint(payload);
}

/** Read-only AIN13 consumer of the mainline artifact reader. No model dispatch,
 * task transition or approval occurs here. Free text is never business evidence.
 */
export class AiOriginalSceneResultService {
  private readonly results: AiTaskResultRepository;
  private readonly policy: GatewayTextIntentPolicy;
  constructor(private readonly db: Db, private readonly tasks: Pick<AiTaskRepository, 'resolveAccess'>,
    private readonly scenes: Scenes, policy: GatewayTextIntentBinding, clock: () => Date = () => new Date()) {
    this.results = new AiTaskResultRepository(db, tasks, clock);
    this.policy = { sceneCode: policy.sceneCode, maxOutputTokens: policy.maxOutputTokens };
  }

  async read(value: unknown) {
    const parsed = commandSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), original = await this.scenes.requests.readHistorical(command.original);
    if (original.receipt.state === 'revoked') throw denied();
    if (original.request.sceneCode !== 'order_explanation' || this.policy.sceneCode !== original.request.sceneCode) throw unavailable();
    const task = await this.scenes.readTaskReceipt(command.original.inputRef);
    if (task.state !== 'observed') throw unavailable();
    const access = structuredClone(await this.tasks.resolveAccess(task.taskId, 'read_step_terminal'));
    const result = await this.results.read({ taskId: task.taskId, resultId: command.resultId });
    if (result.runId !== task.runId) throw denied();
    const base = { original: original.receipt, taskId: task.taskId, resultId: result.resultId,
      observedAt: result.observedAt, businessExecution: 'not_inferred_from_model_result' as const };
    let output: typeof base & { status: 'available' | 'stale' | 'unknown' | 'failed';
      text: { value: string; trust: 'unverified_model_text_not_execution_evidence' } | null;
      nextAction: string; automaticRetry?: false; materialHash?: string; callId?: string; facts?: unknown };
    if (result.status !== 'succeeded') {
      output = { ...base, status: result.status, text: null,
        nextAction: result.status === 'unknown' ? 'reconcile' : 'manual_review', automaticRetry: false };
    } else {
      const frozen = await this.db.$transaction(async tx => {
        const row = await tx.aiTask.findFirst({ where: access.where });
        if (!row || row.inputRef !== command.original.inputRef) throw denied();
        const step = await tx.aiStep.findFirst({ where: { scopeId: row.scopeId, taskId: row.id, id: result.stepId,
          runId: result.runId, actionId: result.actionId } });
        if (!step?.inputRef || step.resultRef !== result.resultId || step.status !== 'SUCCEEDED'
          || step.toolCode !== TASK_TEXT_MODEL_TOOL || step.toolVersion !== AI_TOOL_DRAFT_VERSION) throw denied();
        const stored = await tx.aiTaskActionInput.findFirst({ where: { scopeId: row.scopeId, taskId: row.id,
          runId: result.runId, id: step.inputRef, registrationRef: `scene-model:${command.original.inputRef}` } });
        if (!stored || stored.toolCode !== TASK_TEXT_MODEL_TOOL || stored.toolVersion !== AI_TOOL_DRAFT_VERSION) throw denied();
        const input = parseTaskModelInput(stored.payload, this.policy), fingerprint = taskModelFingerprint(input, this.policy);
        const invocation = await tx.aiGatewayInvocation.findUnique({ where: { scopeId_callId: {
          scopeId: row.scopeId, callId: input.intent.requestId } } });
        if (!invocation || invocation.taskId !== row.id || invocation.runId !== result.runId || invocation.stepId !== result.stepId
          || invocation.actionId !== result.actionId || invocation.actorId !== row.ownerId || invocation.sceneCode !== row.sceneCode
          || invocation.stepFingerprint !== fingerprint || stored.fingerprint !== fingerprint || step.requestFingerprint !== fingerprint
          || invocation.intentHash !== fingerprint || invocation.mode !== input.mode || invocation.priceVersion !== input.priceVersion
          || invocation.configurationHash !== requestFingerprint(input.configuration)
          || input.identityHash !== taskModelIdentity(original.context)) throw denied();
        const gateway = result.payload;
        if (!isGatewayResult(gateway) || gateway.status !== 'completed' || gateway.usage.kind !== 'reported'
          || gateway.requestId !== invocation.callId || requestFingerprint(gateway.actual) !== invocation.configurationHash
          || gateway.toolRequests.length !== 0 || Buffer.byteLength(gateway.text, 'utf8') > 131072) throw unavailable();
        const users = input.intent.messages.filter(message => message.role === 'user');
        if (users.length !== 1 || users[0].content.some(part => part.kind !== 'text')) throw unavailable();
        const text = users[0].content.map(part => part.kind === 'text' ? part.text : '').join('');
        const envelope = envelopeSchema.parse(JSON.parse(text));
        if (receiptFingerprint(envelope.original) !== receiptFingerprint(original.receipt)
          || requestFingerprint(envelope.facts) !== envelope.materialHash) throw denied();
        return { text: gateway.text, material: envelope.facts, materialHash: envelope.materialHash, callId: invocation.callId };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
      // Re-read through the actual order Guard, including independent finance
      // visibility. Never expose old finance text after finance is withdrawn.
      const current = await this.scenes.tools.orderExplanationPreparation(original.request.input.orderId)
        .prepare({ question: original.request.input.question });
      output = orderFactsFingerprint(current) === orderFactsFingerprint(frozen.material)
        ? { ...base, status: 'available', text: { value: frozen.text, trust: 'unverified_model_text_not_execution_evidence' },
          materialHash: frozen.materialHash, callId: frozen.callId, facts: current, nextAction: 'read_only' }
        : { ...base, status: 'stale', text: null, nextAction: 'reread_facts', automaticRetry: false };
    }
    const after = await this.scenes.requests.readHistorical(command.original);
    const finalAccess = await this.tasks.resolveAccess(task.taskId, 'read_step_terminal');
    const latestTask = await this.scenes.readTaskReceipt(command.original.inputRef);
    if (after.receipt.state === 'revoked' || receiptFingerprint(original.receipt) !== receiptFingerprint(after.receipt)
      || originalIdentityHash(original.context) !== originalIdentityHash(after.context) || access.bindingKey !== finalAccess.bindingKey
      || latestTask.state !== 'observed' || latestTask.taskId !== task.taskId || latestTask.runId !== task.runId
      || latestTask.revision !== task.revision) throw denied();
    return freezeOriginalInput(output);
  }
}
