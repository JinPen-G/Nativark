/** Read the final answer of the original model → Core read → model plan.
 * Current Task/Core access and original measured/financial evidence remain
 * mandatory. This factory has no Gateway, lease, publisher or write operation. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION, AI_TASK_DRAFT_VERSION,
  AI_TOOL_DRAFT_VERSION, AI_GATEWAY_TOOL_RESULT_REFERENCE_VERSION, type AiOrderReadAnswerResponseDraft,
  type AiOrderReadFactsDraft } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, aiTaskAccessFromContext, type AiTaskRepository } from '../ai-task.repository';
import { aiStepActionId } from '../ai-step-registration.repository';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import { composePersistedTaskDispatchEvidence } from '../task-model-gateway.composition';
import { AiTaskResultRepository } from '../runner/ai-task-result.repository';
import { aiTaskRunPlanSchema } from '../runner/prisma-task-run-evidence.repository';
import { PrismaTaskPlanInputSource } from '../runner/prisma-task-plan-input.source';
import { waitForTaskApplicationDependency } from '../runner/prisma-task-application';
import { PrismaModelStepEvidenceAuthority } from './prisma-model-step-evidence.authority';
import { TASK_TEXT_MODEL_TOOL, parseTaskModelInput, taskModelFingerprint, taskModelPolicy } from './task-model-input';
import { isGatewayResult, isGatewayOrderExplainRequest } from '../gateway-contract-validation';
import { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import { AiOrderReadFactsService } from '../order-read-facts.service';
import { renderOrderReadAnswer } from '../tools/order-explanation-renderer';
import { originalRequestReferenceSchema, freezeOriginalInput } from '../task-request/original-request.validation';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { readOriginalTaskModelProvenance, type PrismaOriginalRequestRepository } from '../task-request/prisma-original-request.repository';
import { readOriginalSceneEnvelope } from '../scenes/original-scene-knowledge';
import { orderAnswerSnapshotSchema, orderAnswerDisplayPolicy, readOrderAnswerDisplayEnvelope } from '../order-answer-display.adapter';
import type { AiConversationContextReader } from '../conversation-context.reader';

export interface OriginalOrderAnswerReaderDependencies extends PersistedTaskAuthorizationDependencies {
  db: PrismaClient;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  core: Pick<RentalCoreService, 'readOrderFacts'>;
  originals: Pick<PrismaOriginalRequestRepository, 'readHistorical' | 'readTaskReceipt'>;
  tasks: Pick<AiTaskRepository, 'resolveAccess'>;
  /** Revalidate only a package already frozen in the original input. Missing
   * history infrastructure never becomes an empty or newly collected history. */
  history?: Pick<AiConversationContextReader, 'revalidate'>;
}
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
class OrderAnswerSnapshotChangedError extends Error {}
type StoredInput = Prisma.AiTaskActionInputGetPayload<{}>;
type Snapshot = z.infer<typeof orderAnswerSnapshotSchema>;
const answerFacts = (facts: AiOrderReadFactsDraft) => ({ audience: facts.audience, scope: facts.scope, order: facts.order,
  paymentEvidence: facts.paymentEvidence, historicalFeeEvidence: facts.historicalFeeEvidence });
const immutableReceipt = ({ state: _state, ...receipt }: Awaited<ReturnType<PrismaOriginalRequestRepository['readHistorical']>>['receipt']) => receipt;

export function composeOriginalOrderAnswerReader(input: OriginalOrderAnswerReaderDependencies) {
  if (typeof input?.guard?.canActivate !== 'function' || typeof input.core?.readOrderFacts !== 'function'
    || typeof input.originals?.readHistorical !== 'function' || typeof input.originals.readTaskReceipt !== 'function'
    || typeof input.tasks?.resolveAccess !== 'function' || input.history !== undefined && typeof input.history.revalidate !== 'function') throw unavailable();
  const clock = input.clock ?? (() => new Date()), authorization = composePersistedTaskAuthorization(input);
  const originalRead = input.originals.readHistorical.bind(input.originals), taskReceipt = input.originals.readTaskReceipt.bind(input.originals);
  const accessRead = input.tasks.resolveAccess.bind(input.tasks);
  // These are parser ceilings for already frozen inputs, never output quotas
  // or permission to create a replacement invocation. The tools and display
  // inputs keep their separate policies, including old unsigned answers.
  const modelPolicy = taskModelPolicy({ sceneCode: 'order_explanation', maxOutputTokens: 32768, orderExplainTool: true, nativeToolResults: true });
  const displayPolicy = orderAnswerDisplayPolicy(32768);
  const modelPlans = new PrismaTaskPlanInputSource(input.db, authorization.authority, authorization.execution, clock,
    TASK_TEXT_MODEL_TOOL, undefined, modelPolicy);
  const displayPlans = new PrismaTaskPlanInputSource(input.db, authorization.authority, authorization.execution, clock,
    TASK_TEXT_MODEL_TOOL, undefined, displayPolicy);
  const orderInputs = new PrismaTaskPlanInputSource(input.db, authorization.authority, authorization.execution, clock, 'rental.order.explain');
  const financial = composePersistedTaskDispatchEvidence(input);
  const modelEvidence = new PrismaModelStepEvidenceAuthority(input.db, authorization.authority, modelPlans, modelPolicy, financial, clock);
  const displayEvidence = new PrismaModelStepEvidenceAuthority(input.db, authorization.authority, displayPlans, displayPolicy, financial, clock);
  const results = new AiTaskResultRepository(input.db, input.tasks, clock);

  const read = async (value: unknown, signal?: AbortSignal): Promise<AiOrderReadAnswerResponseDraft> => {
    const parsed = originalRequestReferenceSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const reference = freezeOriginalInput(parsed.data);
    const observe = <T>(work: () => Promise<T>) => waitForTaskApplicationDependency(work, false, signal);
    const live = () => { if (signal?.aborted) throw denied(); };
    const refs = [`scene-model:${reference.inputRef}`, `scene-order:${reference.inputRef}`, `scene-answer:${reference.inputRef}`];
    const expected = refs.map((registrationRef, index) => ({ registrationRef, toolCode: index === 1 ? 'rental.order.explain' : TASK_TEXT_MODEL_TOOL,
      toolVersion: AI_TOOL_DRAFT_VERSION, operation: index === 1 ? 'readonly' : 'external_unknown' }));
    const bound = async () => {
      live();
      const original = await observe(() => originalRead(reference)), receipt = await observe(() => taskReceipt(reference.inputRef));
      if (original.receipt.state === 'revoked' || original.receipt.sceneCode !== 'order_explanation'
        || original.request.sceneCode !== 'order_explanation' || receipt.state !== 'observed') throw denied();
      const access = await observe(() => accessRead(receipt.taskId, 'read_step_terminal'));
      if (access.actorKind !== 'USER' || access.audience !== 'OPERATOR' || access.scope.kind !== 'WORKSPACE'
        || access.bindingKey !== aiTaskAccessFromContext(original.context, receipt.taskId, clock()).bindingKey) throw denied();
      const task = await observe(() => input.db.aiTask.findFirst({ where: access.where }));
      if (!task || task.id !== receipt.taskId || task.scopeKind !== 'WORKSPACE' || task.ownerKind !== 'USER'
        || task.ownerId !== access.actorId || task.audience !== 'OPERATOR' || task.archivedAt !== null
        || task.contractVersion !== AI_TASK_DRAFT_VERSION || task.creationKey !== `scene-request:${reference.inputRef}`
        || task.inputRef !== reference.inputRef || task.inputHash !== original.receipt.contentHash
        || task.inputRevision !== original.receipt.revision || task.sceneCode !== original.receipt.sceneCode
        || task.sceneVersion !== original.receipt.sceneVersion) throw denied();
      const provenance = await observe(() => readOriginalTaskModelProvenance(input.db, task));
      const key = { scopeId: task.scopeId, taskId: task.id, runId: receipt.runId };
      const run = await observe(() => input.db.aiRun.findFirst({ where: { id: key.runId, taskId: key.taskId, scopeId: key.scopeId,
        actorKind: access.actorKind, actorId: access.actorId } }));
      if (!run || run.id !== key.runId || run.taskId !== key.taskId || run.scopeId !== key.scopeId
        || run.actorKind !== access.actorKind || run.actorId !== access.actorId || run.sequence !== 1
        || run.inputReceiptId != null || run.resourceOriginRunId != null) throw denied();
      const storedPlan = await observe(() => input.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } }));
      if (!storedPlan || storedPlan.scopeId !== key.scopeId || storedPlan.taskId !== key.taskId || storedPlan.runId !== key.runId
        || !/^[a-f0-9]{64}$/u.test(storedPlan.authorityHash) || !id.safeParse(storedPlan.policyVersion).success) throw unavailable();
      const plan = aiTaskRunPlanSchema.parse(structuredClone(storedPlan.payload));
      if (plan.taskId !== key.taskId || plan.runId !== key.runId || requestFingerprint(plan) !== storedPlan.planHash
        || requestFingerprint(plan.steps) !== requestFingerprint(expected) || plan.taskRevision > task.revision) throw denied();
      const inputs = await observe(() => input.db.aiTaskActionInput.findMany({ where: key, take: 4 }));
      const steps = await observe(() => input.db.aiStep.findMany({ where: key, orderBy: { sequence: 'asc' }, take: 4 }));
      if (inputs.length !== 3 || steps.length > 3 || new Set(inputs.map(row => row.id)).size !== inputs.length
        || new Set(inputs.map(row => row.registrationRef)).size !== inputs.length || new Set(steps.map(row => row.id)).size !== steps.length) throw unavailable();
      const orderRequest = { contractVersion: AI_CONTRACT_DRAFT_VERSION, toolCode: 'rental.order.explain',
        toolVersion: AI_TOOL_DRAFT_VERSION, input: { orderId: original.request.input.orderId } };
      const selectModel = (row: StoredInput) => {
        if (row.scopeId !== key.scopeId || row.taskId !== key.taskId || row.runId !== key.runId
          || row.toolCode !== TASK_TEXT_MODEL_TOOL || row.toolVersion !== AI_TOOL_DRAFT_VERSION || ![refs[0], refs[2]].includes(row.registrationRef)) throw denied();
        const display = row.registrationRef === refs[2] && row.payload !== null && typeof row.payload === 'object' && Object.hasOwn(row.payload, 'displayWitness');
        const policy = display ? displayPolicy : modelPolicy, model = parseTaskModelInput(row.payload, policy);
        if (model.identityHash !== provenance.authorizationHash || taskModelFingerprint(model, policy) !== row.fingerprint
          || row.registrationRef === refs[0] && (model.displayWitness || !model.intent.requiredFeatures.includes('tools'))) throw denied();
        return { input: model, display, evidence: display ? displayEvidence : modelEvidence };
      };
      for (let index = 0; index < expected.length; index++) {
        const definition = expected[index], row = inputs.find(row => row.registrationRef === definition.registrationRef);
        if (!row || row.scopeId !== key.scopeId || row.taskId !== key.taskId || row.runId !== key.runId
          || row.toolCode !== definition.toolCode || row.toolVersion !== definition.toolVersion) throw denied();
        if (index === 1) { if (!isGatewayOrderExplainRequest(row.payload) || requestFingerprint(row.payload) !== requestFingerprint(orderRequest)
          || row.fingerprint !== requestFingerprint(orderRequest)) throw denied(); }
        else selectModel(row);
      }
      for (const [index, step] of steps.entries()) {
        const definition = expected[index], row = inputs.find(row => row.registrationRef === definition.registrationRef)!;
        if (step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== key.runId || step.sequence !== index + 1
          || step.toolCode !== definition.toolCode || step.toolVersion !== definition.toolVersion || step.inputRef !== row.id
          || step.requestFingerprint !== row.fingerprint || step.actionId !== aiStepActionId(access.scope, task.id, definition.registrationRef)) throw denied();
      }
      if ((await observe(() => accessRead(task.id, 'read_step_terminal'))).bindingKey !== access.bindingKey
        || (await observe(() => authorization.tasks.resolveAccess(task.id, 'read_step_terminal'))).bindingKey !== access.bindingKey) throw denied();
      const originalReceipt = freezeOriginalInput({ ...original.receipt, sceneCode: original.receipt.sceneCode });
      return { original, originalReceipt, originalInput: original.request.input, access, task, receipt, run, key, storedPlan, inputs, steps, orderRequest, selectModel };
    };
    type Bound = Awaited<ReturnType<typeof bound>>;
    const binding = (before: Bound) => requestFingerprint({ original: immutableReceipt(before.original.receipt),
      request: before.original.request, identity: originalIdentityHash(before.original.context), key: before.key,
      task: { revision: before.task.revision, status: before.task.status, eventCursor: before.task.eventCursor.toString(),
        inputRef: before.task.inputRef, inputHash: before.task.inputHash, inputRevision: before.task.inputRevision },
      run: { revision: before.run.revision, status: before.run.status, fence: before.run.fencingToken.toFixed(0) },
      plan: { hash: before.storedPlan.planHash, authority: before.storedPlan.authorityHash, policy: before.storedPlan.policyVersion },
      inputs: before.inputs.map(row => ({ id: row.id, registration: row.registrationRef, fingerprint: row.fingerprint,
        payloadHash: requestFingerprint(row.payload), policyRevision: row.policyRevision, expiresAt: row.expiresAt.toISOString() })).sort((a, b) => a.id.localeCompare(b.id)),
      steps: before.steps.map(step => ({ id: step.id, revision: step.revision, sequence: step.sequence, status: step.status,
        effect: step.effect, actionId: step.actionId, inputRef: step.inputRef, resultRef: step.resultRef, fingerprint: step.requestFingerprint })) });
    const verify = async (before: Bound) => { const after = await bound(); if (binding(after) !== binding(before)) throw denied(); return after; };
    const revalidateHistory = async (before: Bound) => {
      const parent = before.selectModel(before.inputs.find(row => row.registrationRef === refs[0])!).input;
      const envelope = readOriginalSceneEnvelope(parent);
      if (requestFingerprint(immutableReceipt(envelope.original as typeof before.original.receipt)) !== requestFingerprint(immutableReceipt(before.original.receipt))
        || requestFingerprint(envelope.facts) !== envelope.materialHash || envelope.knowledge || envelope.clarifications) throw denied();
      const answer = before.selectModel(before.inputs.find(row => row.registrationRef === refs[2])!);
      const user = answer.input.intent.messages.filter(message => message.role === 'user');
      if (user.length !== 1) throw denied();
      const native = user[0].content.some(part => part.kind === 'tool_result_reference');
      const finalEnvelope = answer.display ? readOrderAnswerDisplayEnvelope(answer.input, before.original.receipt) : null;
      let legacy: Snapshot | null = null;
      if (!answer.display && !native) {
        if (user[0].content.some(part => part.kind !== 'text')) throw denied();
        const text = user[0].content.map(part => part.kind === 'text' ? part.text : '').join('');
        if (Buffer.byteLength(text, 'utf8') > 131072) throw unavailable();
        legacy = orderAnswerSnapshotSchema.parse(JSON.parse(text));
      }
      const history = envelope.conversationHistory, answerHistory = finalEnvelope?.conversationHistory ?? legacy?.conversationHistory;
      if (requestFingerprint(history ?? null) !== requestFingerprint(answerHistory ?? null) || native && history) throw denied();
      if (history) {
        if (!input.history) throw unavailable();
        const current = await observe(() => input.history!.revalidate(history, reference, before.original.context, 'observation'));
        if (requestFingerprint(current) !== requestFingerprint(history)) throw denied();
      }
      return { answer, snapshot: finalEnvelope?.facts ?? legacy, native };
    };
    const candidate = async (before: Bound) => {
      const orderStep = before.steps.find(step => step.sequence === 2), orderInput = before.inputs.find(row => row.registrationRef === refs[1])!;
      if (!orderStep) throw unavailable();
      const stored = await observe(() => orderInputs.readReadonlyResultInput({ taskId: before.key.taskId, runId: before.key.runId, stepId: orderStep.id }));
      if (stored.inputRef !== orderInput.id || stored.fingerprint !== orderInput.fingerprint || stored.registrationRef !== refs[1]
        || !isGatewayOrderExplainRequest(stored.input) || requestFingerprint(stored.input) !== requestFingerprint(before.orderRequest)) throw denied();
      const parent = before.steps[0], frozen = before.inputs.find(row => row.registrationRef === refs[0])!, published = before.selectModel(frozen).input;
      if (parent?.status !== 'SUCCEEDED' || !parent.resultRef) throw unavailable();
      const proof = await observe(() => modelEvidence.readOriginalCompletedEvidence(before.key.taskId, parent.id, parent.resultRef!));
      const result = proof.artifact.payload;
      if (!isGatewayResult(result) || result.status !== 'completed' || result.usage.kind !== 'reported'
        || result.requestId !== published.intent.requestId || requestFingerprint(result.actual) !== requestFingerprint(published.configuration)
        || result.toolRequests.length !== 1 || !isGatewayOrderExplainRequest(result.toolRequests[0])
        || requestFingerprint(result.toolRequests[0]) !== requestFingerprint(stored.input)) throw denied();
    };
    const source = async (before: Bound, snapshot: Snapshot | null, native: boolean, published: ReturnType<typeof parseTaskModelInput>) => {
      if (snapshot && (snapshot.originalHash !== before.original.receipt.contentHash || snapshot.orderId !== before.originalInput.orderId
        || snapshot.modelRegistrationRef !== refs[0] || snapshot.readRegistrationRef !== refs[1])) throw denied();
      if (native) {
        const user = published.intent.messages.filter(message => message.role === 'user')[0], expectedReference = {
          referenceVersion: AI_GATEWAY_TOOL_RESULT_REFERENCE_VERSION, taskId: before.key.taskId, runId: before.key.runId,
          modelRegistrationRef: refs[0], toolRegistrationRef: refs[1], callIndex: 0 };
        if (user.content.length !== 1 || user.content[0].kind !== 'tool_result_reference'
          || requestFingerprint(user.content[0].reference) !== requestFingerprint(expectedReference)) throw denied();
      }
      await candidate(before);
      const step = before.steps[1];
      if (step?.status !== 'SUCCEEDED' || !step.resultRef) throw unavailable();
      const artifactRead = () => input.db.aiTaskResultArtifact.findFirst({ where: { ...before.key, id: step.resultRef!, stepId: step.id } });
      const chargesRead = () => input.db.aiTaskExecutionCharge.findMany({ where: { ...before.key, stepId: step.id }, take: 4 });
      const artifact = await observe(artifactRead), charges = await observe(chargesRead);
      if (!artifact || artifact.scopeId !== before.key.scopeId || artifact.taskId !== before.key.taskId || artifact.runId !== before.key.runId
        || artifact.stepId !== step.id || artifact.actionId !== step.actionId || artifact.stepFingerprint !== step.requestFingerprint
        || artifact.outcome !== 'SUCCEEDED' || artifact.errorCode !== null || !artifact.completeMeasurement
        || requestFingerprint(artifact.payload) !== artifact.contentHash || BigInt(Buffer.byteLength(JSON.stringify(artifact.payload), 'utf8')) !== artifact.outputBytes
        || charges.length !== 3 || new Set(charges.map(charge => charge.resource)).size !== 3
        || !['STEPS', 'ACTIVE_MS', 'OUTPUT_BYTES'].every(resource => charges.some(charge => charge.resource === resource))
        || charges.some(charge => charge.scopeId !== before.key.scopeId || charge.taskId !== before.key.taskId || charge.runId !== before.key.runId
          || charge.stepId !== step.id || charge.actionId !== step.actionId || charge.stepFingerprint !== step.requestFingerprint
          || charge.status !== 'RECORDED' || charge.leaseOwnerId !== artifact.leaseOwnerId || !charge.fencingToken.equals(artifact.fencingToken)
          || charge.actualAmount !== (charge.resource === 'ACTIVE_MS' ? artifact.activeMs : charge.resource === 'OUTPUT_BYTES' ? artifact.outputBytes : 1n))) throw denied();
      const artifactHash = (row: NonNullable<typeof artifact>) => requestFingerprint({ id: row.id, contentHash: row.contentHash,
        payloadHash: requestFingerprint(row.payload), scopeId: row.scopeId, taskId: row.taskId, runId: row.runId, stepId: row.stepId,
        actionId: row.actionId, fingerprint: row.stepFingerprint, outcome: row.outcome, complete: row.completeMeasurement,
        outputBytes: row.outputBytes.toString(), activeMs: row.activeMs.toString(), owner: row.leaseOwnerId, fence: row.fencingToken.toFixed(0) });
      const chargeHash = (rows: typeof charges) => requestFingerprint(rows.map(charge => ({ id: charge.chargeId, scopeId: charge.scopeId,
        taskId: charge.taskId, runId: charge.runId, stepId: charge.stepId, actionId: charge.actionId, fingerprint: charge.stepFingerprint,
        status: charge.status, resource: charge.resource, amount: charge.actualAmount?.toString(), owner: charge.leaseOwnerId,
        fence: charge.fencingToken.toFixed(0) })).sort((a, b) => a.id.localeCompare(b.id)));
      const original = await observe(() => results.read({ taskId: before.key.taskId, resultId: step.resultRef! }));
      if (original.status !== 'succeeded' || original.runId !== before.key.runId || original.stepId !== step.id || original.actionId !== step.actionId) throw denied();
      const authority = new AiOrderRouteContextAuthority(input.guard, input.credentials, before.originalInput.orderId, clock);
      const currentContext = await observe(() => authority.resolve());
      const current = await observe(() => new AiOrderReadFactsService(input.core, authority, clock).read(currentContext));
      const saved = z.object({ audience: z.string(), scope: z.unknown(), order: z.record(z.unknown()), sources: z.array(z.unknown()).max(1),
        paymentEvidence: z.literal('not_loaded'), historicalFeeEvidence: z.literal('not_loaded') }).passthrough().parse(original.payload);
      if (saved.order.id !== before.originalInput.orderId || saved.audience !== current.audience
        || requestFingerprint(saved.scope) !== requestFingerprint(current.scope)) throw denied();
      const latest = await observe(() => results.read({ taskId: before.key.taskId, resultId: original.resultId }));
      const latestArtifact = await observe(artifactRead), latestCharges = await observe(chargesRead);
      if (latest.status !== 'succeeded' || latest.contentHash !== original.contentHash || latest.actionId !== original.actionId || latest.stepId !== original.stepId
        || !latestArtifact || artifactHash(latestArtifact) !== artifactHash(artifact) || chargeHash(latestCharges) !== chargeHash(charges)
        || taskModelFingerprint(published, snapshot && published.displayWitness ? displayPolicy : modelPolicy) !== before.inputs.find(row => row.registrationRef === refs[2])!.fingerprint
        || originalIdentityHash(await observe(() => authority.resolve())) !== originalIdentityHash(currentContext)) throw denied();
      if (requestFingerprint(saved.order) !== requestFingerprint(current.order)
        || snapshot && requestFingerprint(answerFacts(current)) !== requestFingerprint(snapshot.facts)) throw new OrderAnswerSnapshotChangedError();
      return { facts: answerFacts(current), observedAt: snapshot?.observedAt ?? current.observedAt, resultId: step.resultRef };
    };
    try {
      const before = await bound(), retained = await revalidateHistory(before), step = before.steps.find(step => step.sequence === 3);
      if (!step?.resultRef) { await verify(before); return freezeOriginalInput({ original: before.originalReceipt,
        result: { status: 'not_observed' as const, text: null, automaticRetry: false as const } }); }
      const result = await observe(() => results.read({ taskId: before.key.taskId, resultId: step.resultRef! }));
      if (result.runId !== before.key.runId || result.stepId !== step.id || result.actionId !== step.actionId) throw denied();
      if (result.status !== 'succeeded') { await verify(before); return freezeOriginalInput({ original: before.originalReceipt,
        result: { resultId: result.resultId, status: result.status, text: null, automaticRetry: false as const, businessExecution: 'readonly_not_business_commit' as const } }); }
      const proof = await observe(() => retained.answer.evidence.readOriginalCompletedEvidence(before.key.taskId, step.id, result.resultId));
      const payload = proof.artifact.payload, published = retained.answer.input;
      if (!isGatewayResult(payload) || payload.status !== 'completed' || payload.usage.kind !== 'reported' || payload.toolRequests.length
        || payload.requestId !== published.intent.requestId || requestFingerprint(payload.actual) !== requestFingerprint(published.configuration)) throw denied();
      let current;
      try { current = await source(before, retained.snapshot, retained.native, published); }
      catch (error) {
        if (!(error instanceof OrderAnswerSnapshotChangedError)) throw error;
        await revalidateHistory(before); await verify(before);
        return freezeOriginalInput({ original: before.originalReceipt, result: { resultId: result.resultId, status: 'stale' as const,
          text: null, automaticRetry: false as const, nextAction: 'new_explicit_request' as const, businessExecution: 'readonly_not_business_commit' as const } });
      }
      const latest = await observe(() => results.read({ taskId: before.key.taskId, resultId: result.resultId }));
      if (latest.status !== 'succeeded' || latest.contentHash !== result.contentHash) throw denied();
      await revalidateHistory(before); const final = await verify(before); live();
      return freezeOriginalInput({ original: final.originalReceipt, result: { resultId: result.resultId, status: 'available' as const,
        text: renderOrderReadAnswer(current.facts, current.observedAt, final.originalInput.question),
        originalReadResultId: current.resultId, facts: current.facts, snapshotObservedAt: current.observedAt,
        automaticRetry: false as const, textSemantics: 'model_text_not_core_fact' as const, businessExecution: 'readonly_not_business_commit' as const } });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw unavailable();
    }
  };
  return Object.freeze({ read });
}
