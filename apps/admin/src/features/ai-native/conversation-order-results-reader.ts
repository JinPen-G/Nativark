/** Explicit source-bound order results. Never reads raw artifacts, starts models
 * or trusts model facts as business receipts. Independent rechecks are not an
 * atomic snapshot; any changed source or Task retracts the complete result. */
import { AI_CONVERSATION_DRAFT_VERSION, validateAiConversationAdmissionDraft, validateAiConversationTurnDraft,
  validateAiSceneRequestRecoveryDraft, validateAiOrderReadFactsDraft, validateAiOrderReadAnswerDraft,
  type AiConversationTurnObservationDraft, type AiConversationTurnReferenceDraft, type AiSceneRequestReadDraft } from '@rental-os/shared';

type Reads = {
  admission(query: AiConversationTurnReferenceDraft, signal: AbortSignal): Promise<unknown>;
  recovery(query: AiSceneRequestReadDraft, signal: AbortSignal): Promise<unknown>;
  orderFacts(query: AiSceneRequestReadDraft, signal: AbortSignal): Promise<unknown>;
  orderAnswer(query: AiSceneRequestReadDraft, signal: AbortSignal): Promise<unknown>;
};
const signature = (turn: AiConversationTurnObservationDraft) => JSON.stringify([turn.turnId, turn.admissionKey, turn.requestHash,
  turn.originalRequestKey, turn.capabilityCode, turn.capabilityVersion, turn.original, turn.material, turn.task]);
export async function readConversationOrderResults(reads: Reads, conversationId: string, selected: AiConversationTurnObservationDraft,
  signal: AbortSignal, current: () => boolean) {
  const check = () => { if (signal.aborted || !current()) throw Error('AI_SCOPE_CHANGED'); };
  check(); const turn = structuredClone(selected);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(conversationId) || !validateAiConversationTurnDraft(turn)
    || turn.capabilityCode !== 'order_explanation' || turn.material !== 'retained' || !turn.task || 'creation' in turn) throw Error('AI_RESOURCE_UNAVAILABLE');
  const query = { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId, admissionKey: turn.admissionKey };
  const admission = async () => {
    check(); const packet = await reads.admission(structuredClone(query), signal); check();
    if (!validateAiConversationAdmissionDraft(packet, query) || !packet.result || signature(packet.result) !== signature(turn)) throw Error('AI_REVISION_CONFLICT');
  };
  const recovery = async () => {
    check(); const value = await reads.recovery(structuredClone(turn.original), signal); check();
    if (!validateAiSceneRequestRecoveryDraft(value) || value.task.state !== 'observed'
      || value.task.taskId !== turn.task!.taskId || value.task.runId !== turn.task!.runId) throw Error('AI_RESOURCE_UNAVAILABLE');
    return structuredClone(value);
  };
  const results = async () => {
    check(); const facts = await reads.orderFacts(structuredClone(turn.original), signal); check();
    if (!validateAiOrderReadFactsDraft(facts, turn.original, turn)) throw Error('AI_RESOURCE_UNAVAILABLE');
    const answer = await reads.orderAnswer(structuredClone(turn.original), signal); check();
    if (!validateAiOrderReadAnswerDraft(answer, turn.original, turn)) throw Error('AI_RESOURCE_UNAVAILABLE');
    // A final answer only describes its own original order-read snapshot. Both
    // projections must agree before their text and amounts can appear together.
    if (answer.result.status === 'available') {
      const a = answer.result, f = facts.result;
      if (f.status !== 'available' || a.originalReadResultId !== f.resultId
        || JSON.stringify(answer.original) !== JSON.stringify(facts.original)
        || JSON.stringify(a.facts) !== JSON.stringify({ audience: f.facts.audience, scope: f.facts.scope,
          order: f.facts.order, paymentEvidence: f.facts.paymentEvidence, historicalFeeEvidence: f.facts.historicalFeeEvidence })) throw Error('AI_REVISION_CONFLICT');
    }
    return structuredClone({ facts, answer });
  };
  await admission(); const firstTask = await recovery(), first = await results();
  await admission(); const second = await results(), latestTask = await recovery();
  if (JSON.stringify(first) !== JSON.stringify(second) || JSON.stringify(firstTask) !== JSON.stringify(latestTask)) throw Error('AI_REVISION_CONFLICT');
  await admission(); check();
  return { ...second, consistency: 'revalidated_reads_not_atomic_snapshot' as const };
}
