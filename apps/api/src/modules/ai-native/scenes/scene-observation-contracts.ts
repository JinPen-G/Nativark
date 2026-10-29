/** Closed projections of existing authorized scene readers. Validation does not
 * read business data, authorize a caller, claim a lease or infer execution. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, AI_SCOPE_DRAFT_SCHEMAS, AI_SCENE_MODEL_OBSERVATION_SCHEMAS,
  AI_KNOWLEDGE_DRAFT_SCHEMAS, AI_TASK_SCENE_OBSERVATION_SCHEMAS, AI_TASK_OBSERVATION_DRAFT_SCHEMAS,
  AI_ORDER_FACTS_DRAFT_SCHEMAS, AI_QUOTE_SELECTION_DRAFT_SCHEMAS, AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS,
  AI_PROPOSAL_DRAFT_SCHEMAS, AI_APPROVED_SETTINGS_DRAFT_SCHEMAS, AI_TASK_RECOVERY_HTTP_SCHEMAS,
  AI_TASK_INPUT_DRAFT_SCHEMAS, AI_SCENE_REQUEST_DRAFT_SCHEMAS, AI_KNOWLEDGE_CONSUMPTION_HTTP_SCHEMAS,
  type AiSceneModelResultObservationDraft, type AiTaskSceneObservationDraft, type AiSceneModelSourceReadDraft,
  type AiSceneOpeningModelSourceReadDraft, type AiSceneModelSourceReadResponseDraft,
  type AiSceneOpeningModelSourceReadResponseDraft, AI_ORDER_READ_HTTP_SCHEMAS, AI_ORDER_READ_HTTP_CONTRACTS,
  type AiSceneRequestReadDraft, type AiOrderReadPreparationResponseDraft, type AiOrderReadAnswerResponseDraft,
  type AiOrderReadFactsResponseDraft, type AiOrderNextStepsResponseDraft, type AiOrderReadSceneResponseDraft,
  type AiSceneModelTakeoverDraft, type AiOrderReadTakeoverReceiptResponseDraft, type AiOrderReadCancelReceiptResponseDraft,
  type AiOrderReadHttpResponses, type AiSceneRequestReceiptDraft, type AiOrderReadCancelResponseDraft,
  AI_CONVERSATION_SCHEMAS, type AiConversationModelResultResponseDraft } from '@rental-os/shared';
import { AI_NATIVE_COMPONENT_SCHEMAS } from '../../../contracts/ai-native-schemas';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const definitions = JSON.parse(JSON.stringify({ ...AI_NATIVE_COMPONENT_SCHEMAS,
  ...AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, ...AI_SCOPE_DRAFT_SCHEMAS, ...AI_SCENE_MODEL_OBSERVATION_SCHEMAS,
  ...AI_KNOWLEDGE_DRAFT_SCHEMAS, ...AI_TASK_SCENE_OBSERVATION_SCHEMAS, ...AI_TASK_OBSERVATION_DRAFT_SCHEMAS,
  ...AI_ORDER_FACTS_DRAFT_SCHEMAS, ...AI_QUOTE_SELECTION_DRAFT_SCHEMAS, ...AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS,
  ...AI_PROPOSAL_DRAFT_SCHEMAS, ...AI_APPROVED_SETTINGS_DRAFT_SCHEMAS, ...AI_TASK_RECOVERY_HTTP_SCHEMAS,
  ...AI_TASK_INPUT_DRAFT_SCHEMAS, ...AI_SCENE_REQUEST_DRAFT_SCHEMAS,
  ...AI_KNOWLEDGE_CONSUMPTION_HTTP_SCHEMAS, ...AI_ORDER_READ_HTTP_SCHEMAS, ...AI_CONVERSATION_SCHEMAS }).replaceAll('#/components/schemas/', '#/$defs/'));
const model = ajv.compile<AiSceneModelResultObservationDraft>({ $ref: '#/$defs/AiSceneModelResultObservationDraft', $defs: definitions });
const scene = ajv.compile<AiTaskSceneObservationDraft>({ $ref: '#/$defs/AiTaskSceneObservationDraft', $defs: definitions });
const sourceRequest = ajv.compile<AiSceneModelSourceReadDraft>({ $ref: '#/$defs/AiSceneModelSourceReadDraft', $defs: definitions });
const openingRequest = ajv.compile<AiSceneOpeningModelSourceReadDraft>({ $ref: '#/$defs/AiSceneOpeningModelSourceReadDraft', $defs: definitions });
const sourceResponse = ajv.compile<AiSceneModelSourceReadResponseDraft>({ $ref: '#/$defs/AiSceneModelSourceReadResponseDraft', $defs: definitions });
const openingResponse = ajv.compile<AiSceneOpeningModelSourceReadResponseDraft>({ $ref: '#/$defs/AiSceneOpeningModelSourceReadResponseDraft', $defs: definitions });
const conversationModel = ajv.compile<AiConversationModelResultResponseDraft>({ $ref: '#/$defs/AiConversationModelResultResponseDraft', $defs: definitions });
export function validateAiConversationModelResponse(value: unknown): AiConversationModelResultResponseDraft {
  try {
    const copy = structuredClone(value);
    if (Buffer.byteLength(JSON.stringify(copy), 'utf8') <= 131072 && conversationModel(copy)) {
      if (copy.status === 'observed') validateAiSceneModelObservation(copy.result);
      return copy;
    }
  } catch { /* no partial conversation/model content escapes */ }
  throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
}
const same = (left: unknown, right: unknown) => requestFingerprint(left) === requestFingerprint(right);
const orderValidators = Object.fromEntries([...new Set(Object.values(AI_ORDER_READ_HTTP_CONTRACTS).map(contract => contract.response))]
  .map(name => [name, ajv.compile({ $ref: `#/$defs/${name}`, $defs: definitions })]));

export function parseAiSceneSourceRequest(value: unknown): AiSceneModelSourceReadDraft {
  try { const copy = structuredClone(value); if (sourceRequest(copy)) return copy; } catch { /* invalid request */ }
  throw new AiTaskRepositoryError('AI_INVALID_INPUT');
}
export function parseAiOpeningSourceRequest(value: unknown): AiSceneOpeningModelSourceReadDraft {
  try { const copy = structuredClone(value); if (openingRequest(copy)) return copy; } catch { /* invalid request */ }
  throw new AiTaskRepositoryError('AI_INVALID_INPUT');
}

/** Original materialHash refers to the frozen call input, not current facts.
 * Only the retained knowledge snapshot has an observation-stable hash. */
export function validateAiSceneModelObservation(value: unknown): AiSceneModelResultObservationDraft {
  try {
    const copy = structuredClone(value);
    if (model(copy) && (copy.status !== 'available'
      || (Buffer.byteLength(copy.text.value, 'utf8') <= 131072
        && (!copy.knowledge || (Buffer.byteLength(JSON.stringify(copy.knowledge.material), 'utf8') <= 16384
          && requestFingerprint(copy.knowledge.material) === copy.knowledge.contentHash))))) return copy;
  } catch { /* model text and producer details stay internal on malformed output */ }
  throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
}

/** Validate the existing source projection without refreshing it or deriving
 * authority from a citation. Observation times are not immutable versions. */
export function validateAiSceneSourceObservation(value: unknown, command: AiSceneModelSourceReadDraft): AiSceneModelSourceReadResponseDraft {
  try {
    const copy = structuredClone(value);
    if (!sourceResponse(copy) || copy.original.state === 'revoked' || copy.resultId !== command.resultId
      || copy.sourceIndex !== command.sourceIndex || copy.original.inputRef !== command.original.inputRef
      || copy.original.draftVersion !== command.original.draftVersion
      || (copy.sourceKind ?? 'order') !== (command.sourceKind ?? 'order')) throw new Error('source binding');
    if (copy.sourceKind === 'knowledge') {
      const { kind: _kind, ...reference } = copy.reference;
      const { draftVersion: _version, text: _text, trust: _trust, ...source } = copy.source;
      if (!same(reference, source)) throw new Error('knowledge binding');
    } else {
      const reference = copy.reference, source = copy.source;
      if (reference.field !== source.field) throw new Error('source field');
      if (source.status !== 'stale' && (!same(source.scope, reference.scope) || source.orderId !== reference.resourceId))
        throw new Error('order binding');
      if (source.status === 'available') {
        const { observedAt: _originalTime, ...original } = reference;
        const { observedAt: _currentTime, ...current } = source.value.source;
        if (!same(original, current)) throw new Error('evidence binding');
        const fact = source.value.value;
        if (source.field === 'order' && (source.value.value.id !== reference.resourceId || source.value.value.updatedAt !== reference.version))
          throw new Error('order version');
        if ('orderId' in fact && (fact.orderId !== reference.resourceId || !('scope' in fact) || !same(fact.scope, reference.scope)))
          throw new Error('nested order binding');
        if ('sourceOrderUpdatedAt' in fact && fact.sourceOrderUpdatedAt !== reference.version) throw new Error('nested order version');
      }
    }
    return copy;
  } catch { /* bad source data cannot escape through a successful read */ }
  throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
}

export function validateAiOpeningSourceObservation(value: unknown, command: AiSceneOpeningModelSourceReadDraft): AiSceneOpeningModelSourceReadResponseDraft {
  try {
    const copy = structuredClone(value);
    if (!openingResponse(copy) || copy.original.state === 'revoked' || copy.resultId !== command.resultId
      || copy.key !== command.key || copy.original.inputRef !== command.original.inputRef
      || copy.original.draftVersion !== command.original.draftVersion) throw new Error('opening binding');
    const { observedAt: _time, ...reference } = copy.reference, section = copy.source;
    if (reference.resourceId !== copy.key || section.key !== copy.key || !same(copy.reference, section.evidence)
      || !same(reference, copy.frozenBasis.reference) || section.candidate.currentVersion !== reference.version
      || !same(section.materials, section.candidate.fieldsToReview)) throw new Error('section binding');
    if ('section' in section.manual && (section.manual.section !== copy.key || !same(section.manual.scope, reference.scope)))
      throw new Error('manual binding');
    const current = section.current;
    const expected = copy.key === 'item_groups' ? 'rows' : copy.key === 'pricing_groups_rates' ? 'groups'
      : copy.key === 'fulfillment_network' ? 'locations' : copy.key === 'workspace_profile' ? 'configVersion' : 'fields';
    if (!(expected in current) || (expected === 'fields' && Object.keys(current).length !== 1)) throw new Error('current section');
    if ('source' in current && (!same(current.source.scope, reference.scope) || current.source.version !== reference.version))
      throw new Error('current configuration');
    if ('configVersion' in current && current.configVersion !== reference.version) throw new Error('profile version');
    if ('fields' in current && !same(current.fields, section.materials)) throw new Error('current fields');
    return copy;
  } catch { /* no current configuration can replace a mismatched frozen source */ }
  throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
}

/** The dedicated chain has a different wire shape from the ordinary model
 * host. Snapshot the response and check its original request before exposure.
 * A malformed acknowledgement after a mutation remains the original unknown. */
export function validateAiOrderReadResponse<K extends keyof AiOrderReadHttpResponses>(action: K, value: unknown,
  command: AiSceneRequestReadDraft | AiSceneModelTakeoverDraft | { original: AiSceneRequestReadDraft; expectedRevision: number }): AiOrderReadHttpResponses[K] {
  const contract = AI_ORDER_READ_HTTP_CONTRACTS[action];
  try {
    const copy = structuredClone(value), expected = 'original' in command ? command.original : command;
    if (!orderValidators[contract.response](copy)) throw new Error('order response');
    const record = copy as Record<string, unknown>;
    const matchOriginal = (receipt: AiSceneRequestReceiptDraft) => {
      if (receipt.sceneCode !== 'order_explanation' || receipt.state === 'revoked'
        || receipt.inputRef !== expected.inputRef || receipt.draftVersion !== expected.draftVersion) throw new Error('original binding');
    };
    if ('original' in record) matchOriginal(record.original as AiSceneRequestReceiptDraft);
    if (action === 'readPreparation') {
      const preparation = (copy as AiOrderReadPreparationResponseDraft).preparation;
      const refs = ['model_request', 'order_read', ...(preparation.requiredInputs === 3 ? ['model_answer'] : [])];
      if (preparation.publishedInputs > preparation.requiredInputs
        || !same(preparation.missing, refs.slice(preparation.publishedInputs))
        || preparation.planPublished && preparation.missing.length) throw new Error('preparation prefix');
    }
    if (action === 'readOrderResult') {
      const response = copy as AiOrderReadFactsResponseDraft, result = response.result;
      if ('taskId' in result && (result.taskId !== response.taskId || result.runId !== response.runId)) throw new Error('result binding');
      if (result.status === 'available') {
        const facts = result.facts;
        if (!same(facts.scope, facts.sources[0].scope) || facts.order.id !== facts.sources[0].resourceId
          || facts.observedAt !== facts.sources[0].observedAt) throw new Error('facts source');
      }
    }
    if (action === 'readAnswer' && (copy as AiOrderReadAnswerResponseDraft).result.status === 'available') {
      const result = (copy as AiOrderReadAnswerResponseDraft).result;
      if (result.status === 'available' && Buffer.byteLength(result.text, 'utf8') > 131072) throw new Error('answer limit');
    }
    if (action === 'readNextSteps') {
      const next = (copy as AiOrderNextStepsResponseDraft).next;
      if (next.orderId !== next.manual.orderId || !same(next.scope, next.manual.scope)
        || next.candidates.some(candidate => candidate.code !== candidate.source.code || candidate.version !== candidate.source.version)
        || !same(next.forbiddenAutomation, ['refund', 'funds_disposition', 'exception_confirmation'])) throw new Error('handoff binding');
    }
    if (action === 'readModelResult') validateAiSceneModelObservation(copy);
    if (action === 'reopenModelSource') {
      if (record.sourceKind !== undefined || record.sourceIndex !== 0) throw new Error('fixed source');
      validateAiSceneSourceObservation(copy, { original: expected, resultId: (copy as AiSceneModelSourceReadResponseDraft).resultId, sourceIndex: 0 });
    }
    if (action === 'readTaskScene') {
      const response = copy as AiOrderReadSceneResponseDraft, { handoff, answer, ...scene } = response;
      validateAiTaskSceneObservation(scene);
      validateAiOrderReadResponse('readNextSteps', handoff, expected);
      const taskReceipt = response.task.task;
      const taskOriginal = 'receipt' in response.task.original ? response.task.original.receipt : response.task.original;
      if (!same(response.originalInput.receipt, handoff.original) || !same(taskOriginal, handoff.original)
        || taskReceipt.state !== 'observed' || taskReceipt.taskId !== response.taskId || taskReceipt.runId !== response.originRunId
        || response.originRunId !== response.runId
        || response.snapshot.availability === 'available' && response.snapshot.value.taskId !== response.taskId) throw new Error('scene original');
      if ('status' in response.model && (response.model.sceneCode !== 'order_explanation' || response.model.taskId !== response.taskId
        || response.model.runId !== response.runId || !same(response.model.original, handoff.original))) throw new Error('scene model');
      if (answer) {
        validateAiOrderReadResponse('readAnswer', answer, expected);
        if (!same(answer.original, handoff.original)) throw new Error('answer original');
        if (answer.result.status === 'available' && (answer.result.facts.order.id !== handoff.next.orderId
          || !same(answer.result.facts.scope, handoff.next.scope))) throw new Error('answer order');
      }
      if (response.orderFacts && 'result' in response.orderFacts) {
        validateAiOrderReadResponse('readOrderResult', response.orderFacts, expected);
        if (response.orderFacts.taskId !== response.taskId || response.orderFacts.runId !== response.runId
          || !same(response.orderFacts.original, handoff.original)) throw new Error('scene facts');
        const facts = response.orderFacts.result;
        if (facts.status === 'available' && (facts.facts.order.id !== handoff.next.orderId
          || !same(facts.facts.scope, handoff.next.scope))) throw new Error('scene order');
        if (answer?.result.status === 'available' && facts.status === 'available'
          && (answer.result.originalReadResultId !== facts.resultId || !same(answer.result.facts.order, facts.facts.order)
            || !same(answer.result.facts.scope, facts.facts.scope) || answer.result.facts.audience !== facts.facts.audience)) throw new Error('scene answer facts');
      }
    }
    if (action === 'readTakeoverReceipt') {
      const receipt = (copy as AiOrderReadTakeoverReceiptResponseDraft).receipt, takeover = command as AiSceneModelTakeoverDraft;
      if (receipt.status === 'observed' && (receipt.recordedRunRevision !== takeover.expectedRunRevision + 1
        || receipt.recordedFencingToken !== (BigInt(takeover.expectedFencingToken) + 1n).toString())) throw new Error('takeover generation');
    }
    if (['requestCancel', 'settleUnstartedCancellation', 'readCancellationReceipt', 'readCancellationSettlementReceipt'].includes(action)) {
      const cancel = command as { expectedRevision: number };
      const receipt = (copy as AiOrderReadCancelReceiptResponseDraft | AiOrderReadCancelResponseDraft).receipt;
      if ('expectedRevision' in receipt && receipt.expectedRevision !== cancel.expectedRevision) throw new Error('cancel revision');
      if (receipt.event && (receipt.event.taskRevision !== cancel.expectedRevision + 1
        || 'taskId' in receipt && receipt.event.taskId !== receipt.taskId)) throw new Error('cancel event');
      if ('snapshot' in receipt && receipt.event && (receipt.event.taskRevision > receipt.snapshot.revision
        || BigInt(receipt.event.cursor) > BigInt(receipt.snapshot.cursor)
        || receipt.event.taskRevision === receipt.snapshot.revision && receipt.snapshot.status !== receipt.event.data.to)) throw new Error('cancel snapshot');
    }
    return copy as AiOrderReadHttpResponses[K];
  } catch { /* The public error never contains a malformed producer payload. */ }
  if (contract.write) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
  throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
}

export function validateAiTaskSceneObservation(value: unknown): AiTaskSceneObservationDraft {
  try {
    const copy = structuredClone(value);
    if (scene(copy)) {
      if (copy.kind === 'original' && 'status' in copy.model) validateAiSceneModelObservation(copy.model);
      return copy;
    }
  } catch { /* undeclared nested data must not escape a failed aggregate */ }
  throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
}
