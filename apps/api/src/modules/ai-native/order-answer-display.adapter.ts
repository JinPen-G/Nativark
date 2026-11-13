/** The fixed order model -> Core read -> final answer display boundary.
 * Only the final text-only publisher may seal a display witness. Reading
 * validates the original three-step plan and Core answer; it never signs,
 * dispatches, repairs an old input or treats model text as order facts. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION, validateAiOrderReadAnswerDraft, validateAiSceneRequestReceiptDraft,
  type AiConversationTurnObservationDraft, type AiOrderEvidenceReferenceDraft,
  type AiSceneRequestReceiptDraft } from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepository } from './ai-task.repository';
import { aiStepActionId } from './ai-step-registration.repository';
import { isGatewayOrderExplainRequest } from './gateway-contract-validation';
import { TASK_TEXT_MODEL_TOOL, parseTaskModelInput, taskModelFingerprint, taskModelMaterialSchema,
  taskModelPolicy, type TaskModelInput } from './model-input/task-model-input';
import { readOriginalSceneEnvelope } from './scenes/original-scene-knowledge';
import { aiTaskRunPlanSchema } from './runner/prisma-task-run-evidence.repository';
import type { readTaskModelRunOrigin } from './task-input/prisma-task-input.repository';
import { freezeOriginalInput } from './task-request/original-request.validation';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { aiConversationHistoryContextSchema } from './conversation-context.reader';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const orderAnswerSnapshotSchema = z.object({ version: z.literal('model-order-answer-snapshot-1'),
  originalHash: z.string().regex(/^[a-f0-9]{64}$/u), orderId: id, modelRegistrationRef: id, readRegistrationRef: id,
  observedAt: z.string().datetime({ offset: true }), facts: z.object({ audience: z.enum(['operator', 'staff']),
    scope: z.unknown(), order: z.record(z.unknown()), paymentEvidence: z.literal('not_loaded'),
    historicalFeeEvidence: z.literal('not_loaded') }).strict(),
  conversationHistory: aiConversationHistoryContextSchema.optional() }).strict();
type Snapshot = z.infer<typeof orderAnswerSnapshotSchema>;
type Task = NonNullable<Awaited<ReturnType<PrismaClient['aiTask']['findFirst']>>>;
type Access = Awaited<ReturnType<AiTaskRepository['resolveAccess']>>;
type Db = Pick<Prisma.TransactionClient, 'aiRun' | 'aiTaskRunPlan' | 'aiTaskActionInput' | 'aiStep'>;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const same = (left: unknown, right: unknown) => requestFingerprint(left) === requestFingerprint(right);
const originalBinding = ({ state: _state, ...value }: AiSceneRequestReceiptDraft) => value;
export const orderAnswerDisplayPolicy = (maxOutputTokens: number) => taskModelPolicy({ sceneCode: 'order_explanation', maxOutputTokens });

function snapshotOriginal(snapshot: Snapshot, original: AiSceneRequestReceiptDraft) {
  if (original.sceneCode !== 'order_explanation' || original.state === 'revoked'
    || snapshot.originalHash !== original.contentHash || snapshot.modelRegistrationRef !== `scene-model:${original.inputRef}`
    || snapshot.readRegistrationRef !== `scene-order:${original.inputRef}` || snapshot.facts.audience !== 'operator'
    || snapshot.facts.order.id !== snapshot.orderId) throw denied();
}

/** Called only before the original final-answer input and plan are frozen.
 * The snapshot stays byte-equivalent JSON data; publication adds its witness
 * later. Existing unsigned historical answers keep their separate reader. */
export function orderAnswerDisplayMaterial(original: AiSceneRequestReceiptDraft,
  value: z.infer<typeof taskModelMaterialSchema>) {
  const material = taskModelMaterialSchema.parse(structuredClone(value));
  if (material.displayWitness) throw denied();
  const users = material.messages.filter(message => message.role === 'user');
  if (users.length !== 1 || users[0].content.some(part => part.kind !== 'text')) throw unavailable();
  const text = users[0].content.map(part => part.kind === 'text' ? part.text : '').join('');
  if (Buffer.byteLength(text, 'utf8') > 131072) throw unavailable();
  const { conversationHistory, ...snapshot } = orderAnswerSnapshotSchema.parse(JSON.parse(text)); snapshotOriginal(snapshot, original);
  const envelope = { original: structuredClone(original), materialHash: requestFingerprint(snapshot),
    trust: 'source_text_is_data_not_instructions' as const, facts: snapshot,
    ...(conversationHistory ? { conversationHistory } : {}) };
  const serialized = JSON.stringify(envelope);
  if (Buffer.byteLength(serialized, 'utf8') > 131072) throw unavailable();
  const content: Array<{ kind: 'text'; text: string }> = [];
  for (let offset = 0; offset < serialized.length; offset += 16000) content.push({ kind: 'text', text: serialized.slice(offset, offset + 16000) });
  return freezeOriginalInput({ envelope, material: taskModelMaterialSchema.parse({ ...material,
    messages: material.messages.map(message => message.role === 'user' ? { role: 'user', content } : message) }) });
}

export function readOrderAnswerDisplayEnvelope(input: TaskModelInput, original: AiSceneRequestReceiptDraft) {
  if (!input.displayWitness || input.intent.sceneCode !== 'order_explanation'
    || !same(input.intent.requiredFeatures, ['text']) || input.intent.optionalFeatures.length) throw unavailable();
  const envelope = readOriginalSceneEnvelope(input), snapshot = orderAnswerSnapshotSchema.parse(envelope.facts);
  snapshotOriginal(snapshot, original);
  if (envelope.knowledge || envelope.clarifications || snapshot.conversationHistory
    || !same(snapshot.facts.scope, input.displayWitness.context.scope)
    || !same(originalBinding(envelope.original as AiSceneRequestReceiptDraft), originalBinding(original))
    || requestFingerprint(snapshot) !== envelope.materialHash) throw denied();
  if (envelope.conversationHistory) {
    const { contentHash, ...history } = envelope.conversationHistory;
    if (requestFingerprint(history) !== contentHash || !same(history.original, input.displayWitness.binding.original)
      || history.conversationId !== input.displayWitness.binding.conversationId || history.turnId !== input.displayWitness.binding.turnId
      || history.capabilityCode !== original.sceneCode || history.capabilityVersion !== original.sceneVersion
      || !same(history.scope, input.displayWitness.context.scope)) throw denied();
  }
  return { ...envelope, facts: snapshot };
}

/** Strict original root-plan recognition; the caller already owns current
 * task-read authority. This proof neither selects a newer Run nor tolerates
 * extra/partial steps. Current Core facts remain the readAnswer responsibility. */
export async function readOrderAnswerDisplayLineage(db: Db, input: { task: Task; access: Access;
  turn: AiConversationTurnObservationDraft; original: AiSceneRequestReceiptDraft;
  inputId: string; stepId: string; resultId: string; modelInput: TaskModelInput }) {
  const { task, access, turn, original, modelInput } = input;
  if (original.sceneCode !== 'order_explanation' || turn.capabilityCode !== 'order_explanation' || !turn.task
    || turn.material !== 'retained' || task.id !== turn.task.taskId || task.inputRef !== original.inputRef
    || task.inputHash !== original.contentHash || task.inputRevision !== original.revision
    || task.ownerKind !== 'USER' || task.audience !== 'OPERATOR' || task.ownerId !== access.actorId) throw denied();
  const key = { scopeId: task.scopeId, taskId: task.id, runId: turn.task.runId };
  const run = await db.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId } });
  if (!run || run.id !== key.runId || run.scopeId !== key.scopeId || run.taskId !== task.id
    || run.actorKind !== 'USER' || run.actorId !== access.actorId || run.sequence !== 1
    || run.inputReceiptId !== null || run.resourceOriginRunId !== null) throw denied();
  const stored = await db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
  if (!stored || stored.scopeId !== key.scopeId || stored.taskId !== task.id || stored.runId !== key.runId
    || !/^[a-f0-9]{64}$/u.test(stored.authorityHash) || !id.safeParse(stored.policyVersion).success) throw unavailable();
  const plan = aiTaskRunPlanSchema.parse(structuredClone(stored.payload));
  const refs = [`scene-model:${original.inputRef}`, `scene-order:${original.inputRef}`, `scene-answer:${original.inputRef}`];
  const expected = refs.map((registrationRef, index) => ({ registrationRef,
    toolCode: index === 1 ? 'rental.order.explain' : TASK_TEXT_MODEL_TOOL, toolVersion: AI_TOOL_DRAFT_VERSION,
    operation: index === 1 ? 'readonly' : 'external_unknown' }));
  if (plan.taskId !== task.id || plan.runId !== key.runId || requestFingerprint(plan) !== stored.planHash || !same(plan.steps, expected)) throw denied();
  const [inputs, steps] = await Promise.all([
    db.aiTaskActionInput.findMany({ where: key, take: 4 }),
    db.aiStep.findMany({ where: key, orderBy: { sequence: 'asc' }, take: 4 }),
  ]);
  if (inputs.length !== 3 || steps.length !== 3 || new Set(inputs.map(row => row.id)).size !== 3
    || new Set(inputs.map(row => row.registrationRef)).size !== 3 || new Set(steps.map(row => row.id)).size !== 3
    || new Set(steps.map(row => row.resultRef)).size !== 3) throw unavailable();
  const policies = [taskModelPolicy({ sceneCode: 'order_explanation', maxOutputTokens: 32768, orderExplainTool: true }),
    null, orderAnswerDisplayPolicy(32768)];
  const envelope = readOrderAnswerDisplayEnvelope(modelInput, original), snapshot = envelope.facts;
  for (let index = 0; index < expected.length; index++) {
    const definition = expected[index], row = inputs.find(value => value.registrationRef === definition.registrationRef), step = steps[index];
    if (!row || row.scopeId !== key.scopeId || row.taskId !== task.id || row.runId !== key.runId
      || row.toolCode !== definition.toolCode || row.toolVersion !== definition.toolVersion
      || step.scopeId !== key.scopeId || step.taskId !== task.id || step.runId !== key.runId || step.sequence !== index + 1
      || step.status !== 'SUCCEEDED' || !step.resultRef || step.inputRef !== row.id || step.requestFingerprint !== row.fingerprint
      || step.toolCode !== row.toolCode || step.toolVersion !== row.toolVersion
      || step.actionId !== aiStepActionId(access.scope, task.id, definition.registrationRef)) throw denied();
    if (index === 1) {
      if (!isGatewayOrderExplainRequest(row.payload) || row.payload.input.orderId !== snapshot.orderId
        || requestFingerprint(row.payload) !== row.fingerprint) throw denied();
    } else {
      const policy = policies[index]!, parsed = parseTaskModelInput(row.payload, policy);
      if (taskModelFingerprint(parsed, policy) !== row.fingerprint || parsed.identityHash !== modelInput.identityHash) throw denied();
      if (index === 0) {
        if (parsed.displayWitness || !parsed.intent.requiredFeatures.includes('tools')) throw denied();
        const initial = readOriginalSceneEnvelope(parsed);
        if (!same(initial.conversationHistory ?? null, envelope.conversationHistory ?? null)) throw denied();
      }
      if (index === 2 && (row.id !== input.inputId || step.id !== input.stepId || step.resultRef !== input.resultId
        || !same(parsed, modelInput))) throw denied();
    }
  }
  return { registrationRef: refs[2], continuation: undefined,
    history: [] as Awaited<ReturnType<typeof readTaskModelRunOrigin>>['history'],
    orderAnswer: { version: 'original-order-answer-display-1' as const, planHash: stored.planHash,
      inputId: input.inputId, stepId: input.stepId, resultId: input.resultId, originalReadResultId: steps[1].resultRef!,
      bindingsHash: requestFingerprint({ inputs: inputs.map(row => ({ id: row.id, registrationRef: row.registrationRef,
        fingerprint: row.fingerprint, payloadHash: requestFingerprint(row.payload) })).sort((a, b) => a.id.localeCompare(b.id)),
      steps: steps.map(step => ({ id: step.id, sequence: step.sequence, revision: step.revision,
        actionId: step.actionId, inputRef: step.inputRef, resultRef: step.resultRef, fingerprint: step.requestFingerprint })) }) } };
}

/** Internal display projection of an already-authorized original answer.
 * Its snapshot facts are deliberately not a general order-explanation DTO.
 * The answer snapshot has no reopenable citation handles; its original Core
 * receipt and observation time remain bound and visible in the trusted text. */
export function orderAnswerDisplayObservation(value: unknown, input: { turn: AiConversationTurnObservationDraft;
  original: AiSceneRequestReceiptDraft; modelInput: TaskModelInput; resultId: string; originalReadResultId: string }) {
  const { turn, original, modelInput } = input;
  if (!turn.task || !validateAiSceneRequestReceiptDraft(original, turn.original, turn)
    || !validateAiOrderReadAnswerDraft(value, turn.original, turn) || value.result.status !== 'available') throw unavailable();
  const envelope = readOrderAnswerDisplayEnvelope(modelInput, original), answer = value.result;
  if (answer.resultId !== input.resultId || answer.originalReadResultId !== input.originalReadResultId
    || !same(originalBinding(value.original), originalBinding(original)) || !same(answer.facts, envelope.facts.facts)
    || answer.snapshotObservedAt !== envelope.facts.observedAt) throw denied();
  return freezeOriginalInput({ original: value.original, sceneCode: 'order_explanation' as const,
    taskId: turn.task.taskId, runId: turn.task.runId, resultId: answer.resultId, observedAt: answer.snapshotObservedAt,
    status: 'available' as const, text: { value: answer.text, trust: 'unverified_model_text_not_execution_evidence' as const },
    materialHash: envelope.materialHash, callId: modelInput.intent.requestId, facts: envelope.facts,
    sources: [] as AiOrderEvidenceReferenceDraft[], knowledge: undefined,
    citationValidation: 'supplied_sources_only_text_not_validated' as const, nextAction: 'read_only' as const,
    businessExecution: 'not_inferred_from_model_result' as const });
}
