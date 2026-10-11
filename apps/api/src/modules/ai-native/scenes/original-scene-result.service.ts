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
import { continueOriginalSceneMaterial, readOriginalSceneEnvelope, type AiOriginalSceneKnowledge, type AiOriginalSceneKnowledgeSnapshot } from './original-scene-knowledge';
import { readTaskModelRunOrigin } from '../task-input/prisma-task-input.repository';

type Scenes = ReturnType<typeof composeAiOriginalScenes>;
type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiStep' | 'aiTaskActionInput' | 'aiGatewayInvocation' | 'aiTaskResultArtifact'>;
const commandSchema = z.object({ original: originalRequestReferenceSchema,
  resultId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
const sourceSchema = z.object({ resourceType: z.literal('order'), resourceId: z.string().min(1).max(191),
  scope: z.object({ kind: z.literal('workspace'), tenantId: z.string().min(1).max(191), workspaceId: z.string().min(1).max(191) }).strict(),
  version: z.string().min(1).max(191), field: z.enum(['order', 'amounts', 'saved_basis', 'payment_records', 'rental_period', 'inspection_records']),
  observedAt: z.string().datetime({ offset: true }) }).strict();
const reopenSchema = commandSchema.extend({ sourceIndex: z.number().int().min(0).max(4),
  sourceKind: z.enum(['order', 'knowledge']).optional() }).strict();
function orderSources(material: unknown) {
  const packet = z.object({ payload: z.object({ facts: z.record(z.unknown()) }).passthrough() }).passthrough().parse(material);
  const sources: z.infer<typeof sourceSchema>[] = [];
  for (const fact of Object.values(packet.payload.facts)) {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact) || !('source' in fact)) continue;
    const source = sourceSchema.parse(fact.source);
    if (!sources.some(existing => requestFingerprint(existing) === requestFingerprint(source))) sources.push(source);
  }
  if (sources.length > 5) throw unavailable();
  return sources;
}
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
  // The local payment reader carries its own observation metadata. Its actual
  // record status, amounts and IDs must still match; request IDs are not facts.
  const payment = (payload.facts as Record<string, unknown>).payments;
  if (payment && typeof payment === 'object' && !Array.isArray(payment) && 'value' in payment) {
    const value = payment.value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      delete (value as Record<string, unknown>).requestId;
      delete (value as Record<string, unknown>).observedAt;
    }
  }
  const inspections = (payload.facts as Record<string, unknown>).inspections;
  if (inspections && typeof inspections === 'object' && !Array.isArray(inspections) && 'value' in inspections
    && inspections.value && typeof inspections.value === 'object' && !Array.isArray(inspections.value)) {
    delete (inspections.value as Record<string, unknown>).observedAt;
  }
  return requestFingerprint(payload);
}

function openingFactsFingerprint(material: unknown) {
  const current = z.object({ scope: z.unknown(), audience: z.string(), configVersion: z.string(),
    observedAt: z.string(), sections: z.array(z.unknown()).max(9), configuration: z.unknown() })
    .passthrough().parse(structuredClone(material));
  const { observedAt: _observation, ...facts } = current;
  // Strip only the observation metadata of the actual opening projections,
  // not their configuration versions, coverage or readiness decisions.
  for (const section of facts.sections) {
    if (section && typeof section === 'object' && !Array.isArray(section) && 'evidence' in section) {
      const evidence = section.evidence;
      if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) delete (evidence as Record<string, unknown>).observedAt;
    }
  }
  if (!facts.configuration || typeof facts.configuration !== 'object' || Array.isArray(facts.configuration)) throw unavailable();
  for (const projection of Object.values(facts.configuration)) {
    if (projection && typeof projection === 'object' && !Array.isArray(projection) && 'source' in projection) {
      const source = projection.source;
      if (source && typeof source === 'object' && !Array.isArray(source)) delete (source as Record<string, unknown>).observedAt;
    }
  }
  return requestFingerprint(facts);
}

export function quoteFactsFingerprint(material: unknown) {
  const packet = z.object({ payload: z.object({ facts: z.record(z.unknown()) }).passthrough() })
    .passthrough().parse(structuredClone(material));
  const facts = packet.payload.facts;
  delete packet.payload.observedAt;
  delete facts.observedAt;
  const availability = facts.availability;
  if (availability && typeof availability === 'object' && !Array.isArray(availability)) {
    delete (availability as Record<string, unknown>).observedAt;
    if ('source' in availability && availability.source && typeof availability.source === 'object' && !Array.isArray(availability.source)) {
      delete (availability.source as Record<string, unknown>).observedAt;
    }
  }
  const review = facts.review;
  if (review && typeof review === 'object' && !Array.isArray(review)) delete (review as Record<string, unknown>).availabilityObservedAt;
  // Selection/config fingerprints, exact inputs, availability result and every
  // missing field remain binding. No normalization of money or business dates.
  return requestFingerprint(packet.payload);
}

/** Read-only scene consumer of the mainline artifact reader. No model dispatch,
 * task transition or approval occurs here. Free text is never business evidence.
 */
export class AiOriginalSceneResultService {
  private readonly results: AiTaskResultRepository;
  private readonly policy: GatewayTextIntentPolicy;
  constructor(private readonly db: Db, private readonly tasks: Pick<AiTaskRepository, 'resolveAccess'>,
    private readonly scenes: Scenes, policy: GatewayTextIntentBinding, clock: () => Date = () => new Date(),
    private readonly knowledge?: AiOriginalSceneKnowledge) {
    this.results = new AiTaskResultRepository(db, tasks, clock);
    this.policy = { sceneCode: policy.sceneCode, maxOutputTokens: policy.maxOutputTokens };
  }

  async read(value: unknown) {
    const parsed = commandSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), original = await this.scenes.requests.readHistorical(command.original);
    if (original.receipt.state === 'revoked') throw denied();
    if (!['order_explanation', 'opening_diagnosis', 'quote_clarification'].includes(original.request.sceneCode)
      || this.policy.sceneCode !== original.request.sceneCode) throw unavailable();
    const task = await this.scenes.readTaskReceipt(command.original.inputRef);
    if (task.state !== 'observed') throw unavailable();
    const access = structuredClone(await this.tasks.resolveAccess(task.taskId, 'read_step_terminal'));
    const result = await this.results.read({ taskId: task.taskId, resultId: command.resultId });
    const provenance = await this.db.$transaction(async tx => {
      const row = await tx.aiTask.findFirst({ where: access.where });
      if (!row || row.inputRef !== command.original.inputRef) throw denied();
      return readTaskModelRunOrigin(tx, access, { scopeId: row.scopeId, taskId: row.id, runId: result.runId,
        originRunId: task.runId, registrationRef: `scene-model:${command.original.inputRef}` });
    });
    const base = { original: original.receipt, sceneCode: original.request.sceneCode, taskId: task.taskId,
      runId: result.runId, resultId: result.resultId,
      observedAt: result.observedAt, businessExecution: 'not_inferred_from_model_result' as const };
    let output: typeof base & { status: 'available' | 'stale' | 'unknown' | 'failed';
      text: { value: string; trust: 'unverified_model_text_not_execution_evidence' } | null;
      nextAction: string; automaticRetry?: false; materialHash?: string; callId?: string; facts?: unknown;
      sources?: z.infer<typeof sourceSchema>[]; knowledge?: AiOriginalSceneKnowledgeSnapshot;
      citationValidation?: 'supplied_sources_only_text_not_validated' };
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
          runId: result.runId, id: step.inputRef, registrationRef: provenance.registrationRef } });
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
        const envelope = readOriginalSceneEnvelope(input);
        if (!provenance.continuation && envelope.clarifications) throw denied();
        if (provenance.continuation) {
          const continuation = provenance.continuation, previous = parseTaskModelInput(continuation.input, this.policy), priorResult = continuation.result;
          if (taskModelFingerprint(previous, this.policy) !== continuation.inputHash || !isGatewayResult(priorResult)
            || priorResult.status !== 'completed' || priorResult.usage.kind !== 'reported' || priorResult.requestId !== previous.intent.requestId
            || requestFingerprint(input.intent.messages) !== requestFingerprint(continueOriginalSceneMaterial(previous,
              { ...continuation, result: priorResult }, continuation.questionRevision > 1 ? envelope : undefined).messages)) throw denied();
        }
        if (receiptFingerprint(envelope.original) !== receiptFingerprint(original.receipt)
          || requestFingerprint(envelope.facts) !== envelope.materialHash) throw denied();
        return { text: gateway.text, material: envelope.facts, materialHash: envelope.materialHash,
          callId: invocation.callId, knowledge: envelope.knowledge };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
      // Re-read through the actual scene's authority, including independent
      // finance visibility or user-selected opening sections. Never reuse an
      // old diagnosis after configuration/coverage or current permissions change.
      const isOrder = original.request.sceneCode === 'order_explanation';
      const current = original.request.sceneCode === 'order_explanation'
        ? await this.scenes.tools.orderExplanationPreparation(original.request.input.orderId)
          .prepare({ question: original.request.input.question })
        : (await this.scenes.prepareTaskMaterial(command.original)).material;
      const fingerprint = isOrder ? orderFactsFingerprint
        : original.request.sceneCode === 'opening_diagnosis' ? openingFactsFingerprint : quoteFactsFingerprint;
      if (frozen.knowledge) {
        if (!this.knowledge) throw unavailable();
        await this.knowledge.revalidate(frozen.knowledge, command.original.inputRef);
      }
      output = fingerprint(current) === fingerprint(frozen.material)
        ? { ...base, status: 'available', text: { value: frozen.text, trust: 'unverified_model_text_not_execution_evidence' },
          materialHash: frozen.materialHash, callId: frozen.callId, facts: current, sources: isOrder ? orderSources(frozen.material) : [],
          ...(frozen.knowledge ? { knowledge: frozen.knowledge } : {}),
          citationValidation: 'supplied_sources_only_text_not_validated', nextAction: 'read_only' }
        : { ...base, status: 'stale', text: null, nextAction: 'reread_facts', automaticRetry: false };
    }
    const after = await this.scenes.requests.readHistorical(command.original);
    const finalAccess = await this.tasks.resolveAccess(task.taskId, 'read_step_terminal');
    const latestTask = await this.scenes.readTaskReceipt(command.original.inputRef);
    if (after.receipt.state === 'revoked' || receiptFingerprint(original.receipt) !== receiptFingerprint(after.receipt)
      || originalIdentityHash(original.context) !== originalIdentityHash(after.context) || access.bindingKey !== finalAccess.bindingKey
      || latestTask.state !== 'observed' || latestTask.taskId !== task.taskId || latestTask.runId !== task.runId
      || latestTask.revision !== task.revision) throw denied();
    if (output.knowledge) await this.knowledge!.revalidate(output.knowledge, command.original.inputRef);
    const finalProvenance = await this.db.$transaction(async tx => {
      const row = await tx.aiTask.findFirst({ where: finalAccess.where });
      if (!row || row.inputRef !== command.original.inputRef) throw denied();
      return readTaskModelRunOrigin(tx, finalAccess, { scopeId: row.scopeId, taskId: row.id, runId: result.runId,
        originRunId: task.runId, registrationRef: `scene-model:${command.original.inputRef}` });
    });
    if (requestFingerprint(provenance) !== requestFingerprint(finalProvenance)) throw denied();
    if ((await this.tasks.resolveAccess(task.taskId, 'read_step_terminal')).bindingKey !== finalAccess.bindingKey) throw denied();
    return freezeOriginalInput(output);
  }

  async reopenSource(value: unknown) {
    const parsed = reopenSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const { sourceIndex, sourceKind, ...command } = parsed.data;
    const result = await this.read(command);
    if (result.status !== 'available') throw unavailable();
    if (sourceKind === 'knowledge') {
      if (!this.knowledge || !result.knowledge) throw unavailable();
      const opened = await this.knowledge.open(result.knowledge, command.original.inputRef, sourceIndex);
      const after = await this.read(command);
      if (after.status !== 'available' || after.materialHash !== result.materialHash
        || after.knowledge?.contentHash !== result.knowledge.contentHash) throw unavailable();
      return freezeOriginalInput({ original: result.original, resultId: result.resultId, sourceKind,
        sourceIndex, reference: opened.reference, source: opened.content, execution: 'not_attempted' as const });
    }
    if (result.sceneCode !== 'order_explanation' || !result.sources?.[sourceIndex]) throw unavailable();
    const source = result.sources[sourceIndex];
    const opened = await this.scenes.reopenOrderCitation({ ...command.original, version: source.version, field: source.field });
    // Re-check the same artifact and supplied fact set after the source await.
    // A stale/unknown result must not reopen previously visible information.
    const after = await this.read(command);
    if (after.status !== 'available' || after.materialHash !== result.materialHash) throw unavailable();
    return freezeOriginalInput({ original: result.original, resultId: result.resultId,
      sourceIndex, reference: source, source: opened.source, execution: 'not_attempted' as const });
  }
}
