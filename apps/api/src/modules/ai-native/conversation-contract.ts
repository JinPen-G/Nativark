/** Owned conversation metadata contracts. No identity fields in commands,
 * copied business state, task execution or authorization from schema validity. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_CONVERSATION_SCHEMAS, AI_SCENE_REQUEST_DRAFT_SCHEMAS,
  type AiConversationCreateDraft, type AiConversationReferenceDraft, type AiConversationMutationDraft,
  type AiConversationListDraft, type AiConversationTurnAdmissionDraft, type AiConversationTurnReferenceDraft,
  type AiConversationOperationRequestDraft, type AiConversationTurnListDraft, type AiConversationModelResultReadDraft,
  type AiConversationUnstartedCloseDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from './ai-task.repository';
import { parseOriginalRequest, originalBody } from './task-request/original-request.validation';
import { AI_SCENE_REQUEST_DRAFT_VERSION, AI_CONVERSATION_HTTP_DRAFT, validateAiConversationListResponseDraft,
  type AiConversationOperationObservationDraft, type AiConversationAdmissionResponseDraft,
  type AiConversationObservationDraft, type AiConversationListResponseDraft, type AiConversationTurnPageDraft } from '@rental-os/shared';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiOriginalRequestResultUnknownError } from './task-request/prisma-original-request.repository';
import { validateAiConversationModelResponse } from './scenes/scene-observation-contracts';
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
for (const [name, schema] of Object.entries({ ...AI_CONVERSATION_SCHEMAS,
  AiSceneRequestBodyDraft: AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestBodyDraft,
  AiSceneRequestReadDraft: AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReadDraft })) {
  if (name !== 'AiConversationModelResultResponseDraft') ajv.addSchema(schema, `#/components/schemas/${name}`);
}
interface Requests {
  AiConversationCreateDraft: AiConversationCreateDraft; AiConversationReferenceDraft: AiConversationReferenceDraft;
  AiConversationMutationDraft: AiConversationMutationDraft; AiConversationListDraft: AiConversationListDraft;
  AiConversationTurnAdmissionDraft: AiConversationTurnAdmissionDraft; AiConversationTurnReferenceDraft: AiConversationTurnReferenceDraft;
  AiConversationOperationRequestDraft: AiConversationOperationRequestDraft; AiConversationTurnListDraft: AiConversationTurnListDraft;
  AiConversationModelResultReadDraft: AiConversationModelResultReadDraft;
  AiConversationUnstartedCloseDraft: AiConversationUnstartedCloseDraft;
}
export function conversationResponse<T>(action: keyof typeof AI_CONVERSATION_HTTP_DRAFT.operations, value: T, command: Requests[keyof Requests]): T {
  const contract = AI_CONVERSATION_HTTP_DRAFT.operations[action];
  try {
    const copy = structuredClone(value);
    if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > 131072) throw Error();
    if (action === 'modelResult') {
      const result = validateAiConversationModelResponse(copy);
      if (!('resultId' in command) || result.conversationId !== command.conversationId || result.admissionKey !== command.admissionKey
        || result.turn.admissionKey !== command.admissionKey) throw Error();
      if (result.status === 'material_erased') {
        if (result.turn.material !== 'erased') throw Error();
      } else if (result.turn.material !== 'retained' || !result.turn.task || result.result.resultId !== command.resultId
        || result.result.original.inputRef !== result.turn.original.inputRef || result.result.original.requestKey !== result.turn.originalRequestKey
        || result.result.sceneCode !== result.turn.capabilityCode || result.result.original.sceneVersion !== result.turn.capabilityVersion
        || result.result.taskId !== result.turn.task.taskId) throw Error();
    } else if (!ajv.getSchema(`#/components/schemas/${contract.response}`)!(copy)) throw Error();
    if (['create', 'archive', 'delete', 'operation', 'release', 'closeUnstarted'].includes(action)) {
      const result = copy as AiConversationOperationObservationDraft;
      if (!('operationKey' in command) || result.operationKey !== command.operationKey || contract.write && result.status !== 'observed') throw Error();
      if (result.status === 'observed' && action !== 'operation') {
        if (result.operation !== (action === 'release' ? 'release_turn' : action === 'closeUnstarted' ? 'close_unstarted' : action)) throw Error();
        if ('conversationId' in command && result.conversationId !== command.conversationId) throw Error();
        if (result.revision !== ('expectedRevision' in command ? command.expectedRevision + 1 : 1)) throw Error();
      }
    } else if (action === 'admit' || action === 'admission') {
      const result = copy as AiConversationAdmissionResponseDraft;
      if (contract.write && !result.result) throw Error();
      if (!('admissionKey' in command) || result.conversationId !== command.conversationId || result.admissionKey !== command.admissionKey
        || result.result && result.result.admissionKey !== command.admissionKey) throw Error();
      if ('request' in command && result.result && (result.result.requestHash !== requestFingerprint(command.request)
        || result.result.capabilityCode !== command.request.sceneCode)) throw Error();
    } else if (action === 'read' || action === 'turns') {
      const result = copy as AiConversationObservationDraft | AiConversationTurnPageDraft;
      if (!('conversationId' in command) || result.conversationId !== command.conversationId) throw Error();
      if ('items' in result && 'limit' in command && result.items.length > command.limit) throw Error();
    } else if (action === 'list') {
      if (!('status' in command) || !validateAiConversationListResponseDraft(copy, command)) throw Error();
    }
    return copy;
  } catch { /* damaged observations never escape with internal content */ }
  if (contract.write) throw new AiOriginalRequestResultUnknownError();
  throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
}
export function conversationCommand<K extends keyof Requests>(name: K, value: unknown): Requests[K] {
  try {
    const copy = structuredClone(value);
    if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > 32768 || !ajv.getSchema(`#/components/schemas/${name}`)!(copy)) throw Error();
    if (name === 'AiConversationTurnAdmissionDraft') {
      const command = copy as AiConversationTurnAdmissionDraft;
      command.request = originalBody(parseOriginalRequest({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION,
        requestKey: 'conversation-validation', ...command.request }));
    }
    return copy as Requests[K];
  } catch { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); }
}
