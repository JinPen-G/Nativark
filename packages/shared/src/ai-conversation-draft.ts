/** Conversation/turn contracts, separate from Task/Run and their budgets.
 * IDs locate owner-authorized records, never create grants. Contract publication
 * does not register a persistence provider, accept a message or start a model. */
import type { AiSceneCode, AiSceneRequestBody, AiSceneRequestReadDraft } from './ai-scene-request-draft';
import { AI_SCENE_CODES } from './ai-scene-request-draft';
import type { AiSceneModelResultObservationDraft } from './ai-scene-model-observation-draft';
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafList as list, leafRef as ref, leafText as text, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export const AI_CONVERSATION_DRAFT_VERSION = 'ain-conversation-draft-2' as const;
interface Version { draftVersion: typeof AI_CONVERSATION_DRAFT_VERSION }
export interface AiConversationCreateDraft extends Version { operationKey: string; capabilityCode: AiSceneCode }
export interface AiConversationReferenceDraft extends Version { conversationId: string }
export interface AiConversationOperationRequestDraft extends Version { operationKey: string }
export interface AiConversationTurnListDraft extends AiConversationReferenceDraft { limit: number; beforeId?: string }
export interface AiConversationMutationDraft extends AiConversationReferenceDraft { operationKey: string; expectedRevision: number }
export interface AiConversationListDraft extends Version { status: 'active' | 'archived'; limit: number; beforeId?: string }
/** No message text duplication: the original typed request owns its body and
 * retention. admissionKey identifies the attempted round even if its reply is
 * lost. Recovery must never silently choose a new original request key. */
export interface AiConversationTurnAdmissionDraft extends AiConversationReferenceDraft {
  expectedRevision: number; admissionKey: string; request: AiSceneRequestBody;
}
export interface AiConversationTurnReferenceDraft extends AiConversationReferenceDraft { admissionKey: string }
/** A result ID is only a lookup candidate. The original result reader must bind
 * it to this admitted request and task; no caller supplies a model or reader. */
export interface AiConversationModelResultReadDraft extends AiConversationTurnReferenceDraft { resultId: string }
export type AiConversationModelResultResponseDraft = AiConversationTurnReferenceDraft & {
  turn: AiConversationTurnObservationDraft; execution: 'read_only_no_start_no_dispatch';
} & (
  | { status: 'observed'; result: AiSceneModelResultObservationDraft }
  | { status: 'material_erased'; result: null; nextAction: 'original_task_center' }
);
/** An erased body is not reconstructed from metadata. The original erasure and
 * current task-read authority must attest its retained locator; the hash is only
 * the immutable admission reference, never available plaintext or a send grant. */
export type AiConversationTurnObservationDraft = {
  admissionKey: string; turnId: string; originalRequestKey: string;
  requestHash: string; capabilityCode: AiSceneCode; capabilityVersion: string;
  createdAt: string; automaticRetry: false;
  status: 'original_bound'; original: AiSceneRequestReadDraft;
  execution: 'not_inferred_from_association';
} & (
  | { material: 'retained'; task: { taskId: string; runId: string } | null }
  | { material: 'erased'; task: { taskId: string; runId: string } }
);
export interface AiConversationAdmissionResponseDraft extends AiConversationTurnReferenceDraft {
  result: AiConversationTurnObservationDraft | null; absence: 'not_proof_of_no_commit'; retryable: false;
}
export interface AiConversationObservationDraft extends AiConversationReferenceDraft {
  revision: number; capabilityCode: AiSceneCode; status: 'active' | 'archived';
  currentTurn: AiConversationTurnObservationDraft | null;
  createdAt: string; updatedAt: string;
  taskCancellation: 'separate_original_operation'; businessRecords: 'not_modified';
}
export type AiConversationOperationObservationDraft = Version & { operationKey: string; retryable: false } & (
  | { status: 'observed'; conversationId: string; revision: number; operation: 'create' | 'archive' | 'delete' | 'release_turn';
      taskCancellation: 'not_requested'; businessRecords: 'not_modified' }
  | { status: 'not_observed'; nextAction: 'read_original_operation'; absence: 'not_proof_of_no_commit' }
);
export interface AiConversationListResponseDraft extends Version {
  items: Array<Pick<AiConversationObservationDraft, 'conversationId' | 'revision' | 'capabilityCode' | 'status' | 'createdAt' | 'updatedAt'>>;
  nextBeforeId: string | null; coverage: 'page_not_total';
}
export interface AiConversationTurnPageDraft extends Version {
  conversationId: string; items: AiConversationTurnObservationDraft[]; nextBeforeId: string | null;
  coverage: 'page_not_total'; execution: 'not_started_by_read';
}

export const AI_CONVERSATION_HTTP_DRAFT = Object.freeze({ basePath: 'ai-native/conversations', operations: {
  create: { request: 'AiConversationCreateDraft', response: 'AiConversationOperationObservationDraft', write: true },
  read: { request: 'AiConversationReferenceDraft', response: 'AiConversationObservationDraft', write: false },
  list: { request: 'AiConversationListDraft', response: 'AiConversationListResponseDraft', write: false },
  archive: { request: 'AiConversationMutationDraft', response: 'AiConversationOperationObservationDraft', write: true },
  delete: { request: 'AiConversationMutationDraft', response: 'AiConversationOperationObservationDraft', write: true },
  operation: { request: 'AiConversationOperationRequestDraft', response: 'AiConversationOperationObservationDraft', write: false },
  admit: { request: 'AiConversationTurnAdmissionDraft', response: 'AiConversationAdmissionResponseDraft', write: true },
  admission: { request: 'AiConversationTurnReferenceDraft', response: 'AiConversationAdmissionResponseDraft', write: false },
  turns: { request: 'AiConversationTurnListDraft', response: 'AiConversationTurnPageDraft', write: false },
  release: { request: 'AiConversationMutationDraft', response: 'AiConversationOperationObservationDraft', write: true },
  modelResult: { request: 'AiConversationModelResultReadDraft', response: 'AiConversationModelResultResponseDraft', write: false },
} } as const);
const key = { ...id(), maxLength: 128 };
const version = { draftVersion: choice(AI_CONVERSATION_DRAFT_VERSION) }, revision = integer(1, 4294967294);
const reference = { ...version, conversationId: id() }, operation = { ...reference, operationKey: key, expectedRevision: revision };
const nil: AiLeafSchemaDraft = { type: 'null' }, no: AiLeafSchemaDraft = { type: 'boolean', const: false };
const hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const capability = choice(...AI_SCENE_CODES);
const turn = { admissionKey: key, turnId: id(), originalRequestKey: text(128), requestHash: hash,
  capabilityCode: capability, capabilityVersion: id(), createdAt: time, automaticRetry: no };
const summary = { conversationId: id(), revision, capabilityCode: capability, status: choice('active', 'archived'), createdAt: time, updatedAt: time };
export const AI_CONVERSATION_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiConversationCreateDraft: object({ ...version, operationKey: key, capabilityCode: capability }),
  AiConversationReferenceDraft: object(reference),
  AiConversationOperationRequestDraft: object({ ...version, operationKey: { ...id(), maxLength: 128 } }),
  AiConversationTurnListDraft: object({ ...reference, limit: integer(1, 20), beforeId: id() }, ['draftVersion', 'conversationId', 'limit']),
  AiConversationMutationDraft: object(operation),
  AiConversationListDraft: object({ ...version, status: choice('active', 'archived'), limit: integer(1, 20), beforeId: id() }, ['draftVersion', 'status', 'limit']),
  AiConversationTurnAdmissionDraft: object({ ...reference, expectedRevision: revision, admissionKey: { ...id(), maxLength: 128 }, request: ref('AiSceneRequestBodyDraft') }),
  AiConversationTurnReferenceDraft: object({ ...reference, admissionKey: key }),
  AiConversationModelResultReadDraft: object({ ...reference, admissionKey: key, resultId: id() }),
  AiConversationModelResultResponseDraft: { oneOf: [
    object({ ...reference, admissionKey: key, turn: ref('AiConversationTurnObservationDraft'), status: choice('observed'),
      result: ref('AiSceneModelResultObservationDraft'), execution: choice('read_only_no_start_no_dispatch') }),
    object({ ...reference, admissionKey: key, turn: ref('AiConversationTurnObservationDraft'), status: choice('material_erased'),
      result: nil, nextAction: choice('original_task_center'), execution: choice('read_only_no_start_no_dispatch') }),
  ] },
  AiConversationTurnObservationDraft: { oneOf: [
    object({ ...turn, status: choice('original_bound'), original: ref('AiSceneRequestReadDraft'), material: choice('retained'),
      task: { oneOf: [object({ taskId: id(), runId: id() }), nil] }, execution: choice('not_inferred_from_association') }),
    object({ ...turn, status: choice('original_bound'), original: ref('AiSceneRequestReadDraft'), material: choice('erased'),
      task: object({ taskId: id(), runId: id() }), execution: choice('not_inferred_from_association') }),
  ] },
  AiConversationAdmissionResponseDraft: object({ ...reference, admissionKey: key, result: { oneOf: [ref('AiConversationTurnObservationDraft'), nil] },
    absence: choice('not_proof_of_no_commit'), retryable: no }),
  AiConversationObservationDraft: object({ ...version, ...summary, currentTurn: { oneOf: [ref('AiConversationTurnObservationDraft'), nil] },
    taskCancellation: choice('separate_original_operation'), businessRecords: choice('not_modified') }),
  AiConversationOperationObservationDraft: { oneOf: [object({ ...version, operationKey: key, retryable: no, status: choice('observed'),
    conversationId: id(), revision, operation: choice('create', 'archive', 'delete', 'release_turn'), taskCancellation: choice('not_requested'), businessRecords: choice('not_modified') }),
    object({ ...version, operationKey: key, retryable: no, status: choice('not_observed'), nextAction: choice('read_original_operation'),
      absence: choice('not_proof_of_no_commit') })] },
  AiConversationListResponseDraft: object({ ...version, items: list(object(summary), 20), nextBeforeId: { oneOf: [id(), nil] }, coverage: choice('page_not_total') }),
  AiConversationTurnPageDraft: object({ ...reference, items: list(ref('AiConversationTurnObservationDraft'), 20), nextBeforeId: { oneOf: [id(), nil] },
    coverage: choice('page_not_total'), execution: choice('not_started_by_read') }),
};
