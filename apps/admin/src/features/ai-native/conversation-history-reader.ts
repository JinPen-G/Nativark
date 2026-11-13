/** One explicit page of server-authorized history. No client-side capability
 * filtering, implicit retries, prefetch, local persistence or inferred execution. */
import { AI_CONVERSATION_DRAFT_VERSION, AI_SCENE_CODES,
  validateAiConversationListResponseDraft, validateAiConversationObservationDraft, validateAiConversationTurnPageDraft,
  validateAiConversationTurnDraft, validateAiConversationTaskModelDraft, validateAiOrderReadAnswerDraft,
  type AiConversationListDraft, type AiConversationReferenceDraft, type AiConversationTurnListDraft, type AiConversationTurnReferenceDraft,
  type AiConversationTurnObservationDraft, type AiSceneCode, type AiTaskSnapshotDraft, type AiTaskModelObservationDraft,
  type AiSceneRequestReadDraft, type AiOrderReadAnswerResponseDraft } from '@rental-os/shared';
import { validateTaskCenterSnapshot } from './task-center-reader';

type Read = (query: AiConversationListDraft, signal: AbortSignal) => Promise<unknown>;
const id = (value: unknown): value is string => typeof value === 'string'
  && value.length >= 1 && value.length <= 191 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);

export async function readConversationHistory(read: Read, input: AiConversationListDraft, signal: AbortSignal, current: () => boolean) {
  const check = () => { if (signal.aborted || !current()) throw Error('AI_SCOPE_CHANGED'); };
  check();
  const query = structuredClone(input);
  if (!query || Object.keys(query).some(key => !['draftVersion', 'status', 'limit', 'beforeId', 'capabilityCode'].includes(key))
    || query.draftVersion !== AI_CONVERSATION_DRAFT_VERSION || !['active', 'archived'].includes(query.status)
    || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 20
    || query.beforeId !== undefined && !id(query.beforeId)
    || query.capabilityCode !== undefined && !AI_SCENE_CODES.includes(query.capabilityCode)) throw Error('AI_INVALID_INPUT');
  // Keep validation bound to the sent request even if a transport mutates its argument.
  const value = await read(structuredClone(query), signal);
  check();
  if (!validateAiConversationListResponseDraft(value, query)) throw Error('AI_RESOURCE_UNAVAILABLE');
  return structuredClone(value);
}

const turnSignature = (turn: AiConversationTurnObservationDraft) => JSON.stringify([
  turn.turnId, turn.admissionKey, turn.originalRequestKey, turn.requestHash, turn.capabilityCode, turn.capabilityVersion,
  turn.createdAt, turn.original.inputRef, turn.material, turn.task?.taskId, turn.task?.runId,
  'creation' in turn ? turn.creation : null, 'closeOperationKey' in turn ? turn.closeOperationKey : null,
]);

/** One explicit original-turn result read. A fixed order chain uses its original
 * answer receipt to identify the final model; other Runs require one result.
 * Reads revalidate independently and never retry or start execution. */
export async function readConversationTaskResult(reads: {
  admission(query: AiConversationTurnReferenceDraft, signal: AbortSignal): Promise<unknown>;
  snapshot(taskId: string, signal: AbortSignal): Promise<AiTaskSnapshotDraft>;
  result(taskId: string, resultId: string, signal: AbortSignal): Promise<unknown>;
  orderAnswer?(original: AiSceneRequestReadDraft, signal: AbortSignal): Promise<unknown>;
}, input: AiConversationTurnReferenceDraft, selected: AiConversationTurnObservationDraft, signal: AbortSignal, current: () => boolean) {
  const check = () => { if (signal.aborted || !current()) throw Error('AI_SCOPE_CHANGED'); };
  check(); const query = structuredClone(input), expected = structuredClone(selected);
  if (!query || Object.keys(query).length !== 3 || Object.keys(query).some(key => !['draftVersion', 'conversationId', 'admissionKey'].includes(key))
    || query.draftVersion !== AI_CONVERSATION_DRAFT_VERSION || !id(query.conversationId) || !id(query.admissionKey)
    || query.admissionKey.length > 128 || !validateAiConversationTurnDraft(expected) || expected.admissionKey !== query.admissionKey)
    throw Error('AI_INVALID_INPUT');
  const admission = async () => {
    check(); const value = await reads.admission(structuredClone(query), signal); check();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('AI_RESOURCE_UNAVAILABLE');
    const packet = value as Record<string, unknown>;
    if (Object.keys(packet).length !== 6 || Object.keys(packet).some(key => !['draftVersion', 'conversationId', 'admissionKey', 'result', 'absence', 'retryable'].includes(key))
      || packet.draftVersion !== query.draftVersion || packet.conversationId !== query.conversationId || packet.admissionKey !== query.admissionKey
      || packet.absence !== 'not_proof_of_no_commit' || packet.retryable !== false || !validateAiConversationTurnDraft(packet.result)
      || turnSignature(packet.result) !== turnSignature(expected)) throw Error('AI_REVISION_CONFLICT');
    return structuredClone(packet.result);
  };
  const turn = await admission();
  if (turn.material === 'erased') return { status: 'material_erased' as const, turn, result: null };
  if (!turn.task) return { status: 'no_task_observed' as const, turn, result: null };
  const { taskId, runId } = turn.task;
  const snapshot = async () => {
    check(); const value = validateTaskCenterSnapshot(await reads.snapshot(taskId, signal), taskId); check();
    if (value.sceneCode !== turn.capabilityCode) throw Error('AI_RESOURCE_UNAVAILABLE');
    return structuredClone(value);
  };
  const first = await snapshot();
  const candidates = [...new Set(first.steps.filter(step => step.runId === runId && step.kind === 'model')
    .flatMap(step => step.resultId ? [step.resultId] : []))];
  const runSteps = first.steps.filter(step => step.runId === runId).sort((a, b) => a.sequence - b.sequence);
  const orderChain = turn.capabilityCode === 'order_explanation' && candidates.length === 2 && runSteps.length === 3
    && runSteps.every((step, index) => step.sequence === index + 1 && step.status === 'succeeded')
    && runSteps[0].kind === 'model' && id(runSteps[0].resultId) && runSteps[1].kind === undefined
    && runSteps[2].kind === 'model' && id(runSteps[2].resultId);
  const answer = async (): Promise<AiOrderReadAnswerResponseDraft> => {
    check(); if (!reads.orderAnswer) throw Error('AI_RESOURCE_UNAVAILABLE');
    const value = await reads.orderAnswer(structuredClone(turn.original), signal); check();
    if (!validateAiOrderReadAnswerDraft(value, turn.original, turn) || value.result.status !== 'available'
      || value.result.resultId !== runSteps[2].resultId || candidates.includes(value.result.originalReadResultId)
      || runSteps[1].resultId !== undefined && value.result.originalReadResultId !== runSteps[1].resultId)
      throw Error('AI_RESOURCE_UNAVAILABLE');
    return structuredClone(value);
  };
  // A second model result alone is ambiguous. The dedicated original answer
  // reader proves the frozen plan, Core source and final result before use.
  // The ordinary snapshot exposes model result IDs only; it is not the Core
  // receipt. An optional Core reference must agree with the original reader.
  const firstAnswer = orderChain && reads.orderAnswer ? await answer() : null;
  const selectedResultId = firstAnswer?.result.status === 'available' ? firstAnswer.result.resultId
    : candidates.length === 1 ? candidates[0] : null;
  let result: AiTaskModelObservationDraft | null = null;
  if (selectedResultId) {
    const value = await reads.result(taskId, selectedResultId, signal); check();
    if (!validateAiConversationTaskModelDraft(value, turn) || value.resultId !== selectedResultId) throw Error('AI_RESOURCE_UNAVAILABLE');
    result = structuredClone(value);
  }
  if (firstAnswer && JSON.stringify(await answer()) !== JSON.stringify(firstAnswer)) throw Error('AI_REVISION_CONFLICT');
  const latest = await snapshot();
  const steps = (value: AiTaskSnapshotDraft) => JSON.stringify(value.steps.map(step => [step.stepId, step.runId, step.sequence,
    step.revision, step.status, step.kind ?? null, step.resultId ?? null]));
  if (first.revision !== latest.revision || first.cursor !== latest.cursor || steps(first) !== steps(latest))
    throw Error('AI_REVISION_CONFLICT');
  await admission(); check();
  return structuredClone(result === null ? { status: 'no_unique_result' as const, turn, result: null }
    : { status: 'observed' as const, turn, result });
}

/** Metadata -> one explicit turn page -> metadata recheck. These are independent
 * authorized reads, not an atomic snapshot or an invitation to start a Task. */
export async function readConversationDetail(reads: {
  read(query: AiConversationReferenceDraft, signal: AbortSignal): Promise<unknown>;
  turns(query: AiConversationTurnListDraft, signal: AbortSignal): Promise<unknown>;
}, input: AiConversationTurnListDraft, capabilityCode: AiSceneCode, signal: AbortSignal, current: () => boolean) {
  const check = () => { if (signal.aborted || !current()) throw Error('AI_SCOPE_CHANGED'); };
  check(); const query = structuredClone(input);
  if (!query || Object.keys(query).some(key => !['draftVersion', 'conversationId', 'limit', 'beforeId'].includes(key))
    || query.draftVersion !== AI_CONVERSATION_DRAFT_VERSION || !id(query.conversationId)
    || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 20
    || query.beforeId !== undefined && !id(query.beforeId) || !AI_SCENE_CODES.includes(capabilityCode)) throw Error('AI_INVALID_INPUT');
  const reference = { draftVersion: query.draftVersion, conversationId: query.conversationId };
  const metadata = async () => {
    check(); const value = await reads.read(structuredClone(reference), signal); check();
    if (!validateAiConversationObservationDraft(value, reference) || value.capabilityCode !== capabilityCode) throw Error('AI_RESOURCE_UNAVAILABLE');
    return value;
  };
  const first = await metadata();
  const turns = await reads.turns(structuredClone(query), signal); check();
  if (!validateAiConversationTurnPageDraft(turns, query, capabilityCode)) throw Error('AI_RESOURCE_UNAVAILABLE');
  const latest = await metadata();
  const signature = (value: typeof first) => {
    const turn = value.currentTurn;
    return JSON.stringify([value.conversationId, value.revision, value.capabilityCode, value.status, value.createdAt, value.updatedAt,
      turn && [turn.turnId, turn.admissionKey, turn.originalRequestKey, turn.requestHash, turn.capabilityCode, turn.capabilityVersion,
        turn.createdAt, turn.original.inputRef, turn.material, turn.task?.taskId, turn.task?.runId,
        'creation' in turn ? turn.creation : null, 'closeOperationKey' in turn ? turn.closeOperationKey : null]]);
  };
  if (signature(first) !== signature(latest)) throw Error('AI_REVISION_CONFLICT');
  return structuredClone({ conversation: latest, turns, consistency: 'revalidated_reads_not_atomic_snapshot' as const });
}
