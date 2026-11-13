/** Conversation/turn contracts, separate from Task/Run and their budgets.
 * IDs locate owner-authorized records, never create grants. Contract publication
 * does not register a persistence provider, accept a message or start a model. */
import type { AiSceneCode, AiSceneRequestBody, AiSceneRequestReadDraft } from './ai-scene-request-draft';
import { AI_SCENE_CODES, AI_SCENE_REQUEST_DRAFT_VERSION } from './ai-scene-request-draft';
import type { AiSceneModelResultObservationDraft } from './ai-scene-model-observation-draft';
import { AI_TASK_DRAFT_VERSION, type AiTaskModelObservationDraft } from './ai-task-draft';
import { AI_WORKBENCH_DISPLAY_HTTP_SCHEMAS } from './ai-workbench-display-http-draft';
import { AI_WORKBENCH_MODEL_CONTROL_SCHEMAS } from './ai-workbench-model-control-draft';
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafList as list, leafRef as ref, leafText as text, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export const AI_CONVERSATION_DRAFT_VERSION = 'ain-conversation-draft-2' as const;
interface Version { draftVersion: typeof AI_CONVERSATION_DRAFT_VERSION }
export const AI_CONVERSATION_UNSTARTED_DRAFT_VERSION = 'ain-conversation-unstarted-draft-1' as const;
export interface AiConversationUnstartedCloseDraft {
  draftVersion: typeof AI_CONVERSATION_UNSTARTED_DRAFT_VERSION;
  conversationId: string; operationKey: string; expectedRevision: number; turnId: string; originalInputRef: string;
}
export interface AiConversationUnstartedReceiptDraft {
  draftVersion: typeof AI_CONVERSATION_UNSTARTED_DRAFT_VERSION; operationKey: string; retryable: false;
  status: 'observed'; conversationId: string; revision: number; operation: 'close_unstarted';
  creation: 'permanently_closed'; task: 'not_created'; taskCancellation: 'not_requested'; businessRecords: 'not_modified';
}
export interface AiConversationCreateDraft extends Version { operationKey: string; capabilityCode: AiSceneCode }
export interface AiConversationReferenceDraft extends Version { conversationId: string }
export interface AiConversationOperationRequestDraft extends Version { operationKey: string }
export interface AiConversationTurnListDraft extends AiConversationReferenceDraft { limit: number; beforeId?: string }
export interface AiConversationMutationDraft extends AiConversationReferenceDraft { operationKey: string; expectedRevision: number }
/** The capability filter narrows owned history before pagination; it is not a grant. */
export interface AiConversationListDraft extends Version { status: 'active' | 'archived'; limit: number; beforeId?: string; capabilityCode?: AiSceneCode }
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
/** An erased body is not reconstructed from metadata. A Task locator needs its
 * current task-read authority; a no-Task closure needs the permanent creation
 * fence and original closure/erasure receipts. Neither grants a new send. */
export type AiConversationTurnObservationDraft = {
  admissionKey: string; turnId: string; originalRequestKey: string;
  requestHash: string; capabilityCode: AiSceneCode; capabilityVersion: string;
  createdAt: string; automaticRetry: false;
  status: 'original_bound'; original: AiSceneRequestReadDraft;
  execution: 'not_inferred_from_association';
} & (
  | { material: 'retained'; task: { taskId: string; runId: string } | null }
  | { material: 'erased'; task: { taskId: string; runId: string } }
  | { material: 'retained' | 'erased'; task: null; creation: 'permanently_closed'; closeOperationKey: string }
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
export type AiConversationOperationObservationDraft = AiConversationUnstartedReceiptDraft | (Version & { operationKey: string; retryable: false } & (
  | { status: 'observed'; conversationId: string; revision: number; operation: 'create' | 'archive' | 'delete' | 'release_turn';
      taskCancellation: 'not_requested'; businessRecords: 'not_modified' }
  | { status: 'not_observed'; nextAction: 'read_original_operation'; absence: 'not_proof_of_no_commit' }
));
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
  display: { request: 'AiWorkbenchDisplayReadDraft', response: 'AiWorkbenchDisplayMaterialDraft', write: false },
  'display-revalidate': { request: 'AiWorkbenchDisplayRevalidateDraft', response: 'AiWorkbenchDisplayMaterialDraft', write: false },
  'display-source': { request: 'AiWorkbenchDisplaySourceReadDraft', response: 'AiWorkbenchDisplaySourceDraft', write: false },
  'model-control-prepare': { request: 'AiWorkbenchDisplayReadDraft', response: 'AiWorkbenchModelControlPreparation', write: false },
  'model-control': { request: 'AiWorkbenchModelControlCommand', response: 'AiWorkbenchModelControlObservation', write: true },
  'model-control-read': { request: 'AiWorkbenchModelControlReference', response: 'AiWorkbenchModelControlObservation', write: false },
  closeUnstarted: { request: 'AiConversationUnstartedCloseDraft', response: 'AiConversationUnstartedReceiptDraft', write: true },
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
const unstartedReceipt = object({ draftVersion: choice(AI_CONVERSATION_UNSTARTED_DRAFT_VERSION), operationKey: key, retryable: no,
  status: choice('observed'), conversationId: id(), revision, operation: choice('close_unstarted'),
  creation: choice('permanently_closed'), task: choice('not_created'), taskCancellation: choice('not_requested'), businessRecords: choice('not_modified') });
export const AI_CONVERSATION_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  ...AI_WORKBENCH_MODEL_CONTROL_SCHEMAS,
  ...AI_WORKBENCH_DISPLAY_HTTP_SCHEMAS,
  AiConversationUnstartedCloseDraft: object({ draftVersion: choice(AI_CONVERSATION_UNSTARTED_DRAFT_VERSION),
    conversationId: id(), operationKey: key, expectedRevision: revision, turnId: id(), originalInputRef: id() }),
  AiConversationUnstartedReceiptDraft: unstartedReceipt,
  AiConversationCreateDraft: object({ ...version, operationKey: key, capabilityCode: capability }),
  AiConversationReferenceDraft: object(reference),
  AiConversationOperationRequestDraft: object({ ...version, operationKey: { ...id(), maxLength: 128 } }),
  AiConversationTurnListDraft: object({ ...reference, limit: integer(1, 20), beforeId: id() }, ['draftVersion', 'conversationId', 'limit']),
  AiConversationMutationDraft: object(operation),
  AiConversationListDraft: object({ ...version, status: choice('active', 'archived'), limit: integer(1, 20), beforeId: id(), capabilityCode: capability }, ['draftVersion', 'status', 'limit']),
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
    object({ ...turn, status: choice('original_bound'), original: ref('AiSceneRequestReadDraft'), material: choice('retained', 'erased'), task: nil,
      creation: choice('permanently_closed'), closeOperationKey: key, execution: choice('not_inferred_from_association') }),
  ] },
  AiConversationAdmissionResponseDraft: object({ ...reference, admissionKey: key, result: { oneOf: [ref('AiConversationTurnObservationDraft'), nil] },
    absence: choice('not_proof_of_no_commit'), retryable: no }),
  AiConversationObservationDraft: object({ ...version, ...summary, currentTurn: { oneOf: [ref('AiConversationTurnObservationDraft'), nil] },
    taskCancellation: choice('separate_original_operation'), businessRecords: choice('not_modified') }),
  AiConversationOperationObservationDraft: { oneOf: [unstartedReceipt, object({ ...version, operationKey: key, retryable: no, status: choice('observed'),
    conversationId: id(), revision, operation: choice('create', 'archive', 'delete', 'release_turn'), taskCancellation: choice('not_requested'), businessRecords: choice('not_modified') }),
    object({ ...version, operationKey: key, retryable: no, status: choice('not_observed'), nextAction: choice('read_original_operation'),
      absence: choice('not_proof_of_no_commit') })] },
  AiConversationListResponseDraft: object({ ...version, items: list(object(summary), 20), nextBeforeId: { oneOf: [id(), nil] }, coverage: choice('page_not_total') }),
  AiConversationTurnPageDraft: object({ ...reference, items: list(ref('AiConversationTurnObservationDraft'), 20), nextBeforeId: { oneOf: [id(), nil] },
    coverage: choice('page_not_total'), execution: choice('not_started_by_read') }),
};

function conversationClosed(input: unknown, keys: readonly string[]): input is Record<string, unknown> {
  return !!input && typeof input === 'object' && !Array.isArray(input)
    && Object.keys(input).length === keys.length && Object.keys(input).every(key => keys.includes(key));
}
function conversationId(input: unknown): input is string {
  return typeof input === 'string' && input.length >= 1 && input.length <= 191 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(input);
}
function conversationTime(input: unknown): input is string {
  if (typeof input !== 'string' || input.length < 20 || input.length > 40 || !Number.isFinite(Date.parse(input))) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/u.exec(input);
  if (!match || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return false;
  const date = new Date(0); date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}
function conversationRevision(input: unknown): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 1 && input <= 4294967294;
}
/** Browser-safe validation of the closed history page. Schema validity does not
 * authorize a row: the server rechecks the current owner/scope before returning. */
export function validateAiConversationListResponseDraft(value: unknown, query: AiConversationListDraft): value is AiConversationListResponseDraft {
  const closed = conversationClosed, identifier = conversationId, timestamp = conversationTime;
  if (!closed(value, ['draftVersion', 'items', 'nextBeforeId', 'coverage']) || value.draftVersion !== AI_CONVERSATION_DRAFT_VERSION
    || value.coverage !== 'page_not_total' || !Array.isArray(value.items) || value.items.length > 20 || value.items.length > query.limit
    || value.nextBeforeId !== null && !identifier(value.nextBeforeId)) return false;
  const seen = new Set<string>();
  for (const row of value.items) {
    if (!closed(row, ['conversationId', 'revision', 'capabilityCode', 'status', 'createdAt', 'updatedAt'])
      || !identifier(row.conversationId) || seen.has(row.conversationId)
      || typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision > 4294967294
      || !AI_SCENE_CODES.includes(row.capabilityCode as AiSceneCode) || row.status !== query.status
      || query.capabilityCode !== undefined && row.capabilityCode !== query.capabilityCode
      || !timestamp(row.createdAt) || !timestamp(row.updatedAt)) return false;
    seen.add(row.conversationId);
  }
  // A continuation must name the last returned row, not an arbitrary cursor.
  return value.nextBeforeId === null || value.items.length === query.limit && value.items.at(-1)?.conversationId === value.nextBeforeId;
}

/** A retained/erased locator is not an execution or re-send grant. Only the
 * closed original-reference fields may reach a history consumer. */
export function validateAiConversationTurnDraft(value: unknown): value is AiConversationTurnObservationDraft {
  const base = ['admissionKey', 'turnId', 'originalRequestKey', 'requestHash', 'capabilityCode', 'capabilityVersion',
    'createdAt', 'automaticRetry', 'status', 'original', 'execution', 'material', 'task'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>, closed = row.creation === 'permanently_closed';
  if (!conversationClosed(row, closed ? [...base, 'creation', 'closeOperationKey'] : base)
    || !conversationId(row.admissionKey) || row.admissionKey.length > 128 || !conversationId(row.turnId)
    || typeof row.originalRequestKey !== 'string' || !row.originalRequestKey.length || row.originalRequestKey.length > 128
    || typeof row.requestHash !== 'string' || !/^[a-f0-9]{64}$/u.test(row.requestHash)
    || !AI_SCENE_CODES.includes(row.capabilityCode as AiSceneCode) || !conversationId(row.capabilityVersion)
    || !conversationTime(row.createdAt) || row.automaticRetry !== false || row.status !== 'original_bound'
    || row.execution !== 'not_inferred_from_association' || !['retained', 'erased'].includes(row.material as string)
    || !conversationClosed(row.original, ['draftVersion', 'inputRef'])
    || row.original.draftVersion !== AI_SCENE_REQUEST_DRAFT_VERSION || !conversationId(row.original.inputRef)) return false;
  if (closed) return row.task === null && conversationId(row.closeOperationKey) && row.closeOperationKey.length <= 128;
  return row.task === null ? row.material === 'retained'
    : conversationClosed(row.task, ['taskId', 'runId']) && conversationId(row.task.taskId) && conversationId(row.task.runId);
}
/** Original admission lookup only; absence never authorizes another send. */
export function validateAiConversationAdmissionDraft(value: unknown, query: AiConversationTurnReferenceDraft): value is AiConversationAdmissionResponseDraft {
  if (!conversationClosed(value, ['draftVersion', 'conversationId', 'admissionKey', 'result', 'absence', 'retryable'])
    || value.draftVersion !== AI_CONVERSATION_DRAFT_VERSION || value.conversationId !== query.conversationId
    || value.admissionKey !== query.admissionKey || value.absence !== 'not_proof_of_no_commit' || value.retryable !== false) return false;
  return value.result === null || validateAiConversationTurnDraft(value.result) && value.result.admissionKey === query.admissionKey;
}

export function validateAiConversationObservationDraft(value: unknown, query: AiConversationReferenceDraft): value is AiConversationObservationDraft {
  if (!conversationClosed(value, ['draftVersion', 'conversationId', 'revision', 'capabilityCode', 'status', 'currentTurn',
    'createdAt', 'updatedAt', 'taskCancellation', 'businessRecords']) || value.draftVersion !== AI_CONVERSATION_DRAFT_VERSION
    || value.conversationId !== query.conversationId || !conversationId(value.conversationId) || !conversationRevision(value.revision)
    || !AI_SCENE_CODES.includes(value.capabilityCode as AiSceneCode) || !['active', 'archived'].includes(value.status as string)
    || !conversationTime(value.createdAt) || !conversationTime(value.updatedAt)
    || value.taskCancellation !== 'separate_original_operation' || value.businessRecords !== 'not_modified') return false;
  return value.currentTurn === null || validateAiConversationTurnDraft(value.currentTurn) && value.currentTurn.capabilityCode === value.capabilityCode;
}
export function validateAiConversationTurnPageDraft(value: unknown, query: AiConversationTurnListDraft, capabilityCode: AiSceneCode): value is AiConversationTurnPageDraft {
  if (!conversationClosed(value, ['draftVersion', 'conversationId', 'items', 'nextBeforeId', 'coverage', 'execution'])
    || value.draftVersion !== AI_CONVERSATION_DRAFT_VERSION || value.conversationId !== query.conversationId
    || value.coverage !== 'page_not_total' || value.execution !== 'not_started_by_read' || !Array.isArray(value.items)
    || value.items.length > 20 || value.items.length > query.limit || value.nextBeforeId !== null && !conversationId(value.nextBeforeId)) return false;
  const seen = new Set<string>();
  for (const row of value.items) {
    if (!validateAiConversationTurnDraft(row) || row.capabilityCode !== capabilityCode || seen.has(row.turnId)) return false;
    seen.add(row.turnId);
  }
  return value.nextBeforeId === null || value.items.length === query.limit && value.items.at(-1)?.turnId === value.nextBeforeId;
}

export function validateAiConversationOperationDraft(value: unknown, operationKey: string): value is AiConversationOperationObservationDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.operationKey !== operationKey || !conversationId(row.operationKey) || row.operationKey.length > 128 || row.retryable !== false) return false;
  if (row.draftVersion === AI_CONVERSATION_UNSTARTED_DRAFT_VERSION) return conversationClosed(row, ['draftVersion', 'operationKey', 'retryable',
    'status', 'conversationId', 'revision', 'operation', 'creation', 'task', 'taskCancellation', 'businessRecords'])
    && row.status === 'observed' && conversationId(row.conversationId) && conversationRevision(row.revision)
    && row.operation === 'close_unstarted' && row.creation === 'permanently_closed' && row.task === 'not_created'
    && row.taskCancellation === 'not_requested' && row.businessRecords === 'not_modified';
  if (row.draftVersion !== AI_CONVERSATION_DRAFT_VERSION) return false;
  if (row.status === 'not_observed') return conversationClosed(row, ['draftVersion', 'operationKey', 'retryable', 'status', 'nextAction', 'absence'])
    && row.nextAction === 'read_original_operation' && row.absence === 'not_proof_of_no_commit';
  return row.status === 'observed' && conversationClosed(row, ['draftVersion', 'operationKey', 'retryable', 'status', 'conversationId',
    'revision', 'operation', 'taskCancellation', 'businessRecords']) && conversationId(row.conversationId) && conversationRevision(row.revision)
    && ['create', 'archive', 'delete', 'release_turn'].includes(row.operation as string)
    && row.taskCancellation === 'not_requested' && row.businessRecords === 'not_modified';
}

/** Minimal task-center projection only; no full scene facts or raw artifact may
 * reach history. The admitted original Run, not the currently selected Task,
 * binds the result. Valid shape still requires the server's current read policy. */
export function validateAiConversationTaskModelDraft(value: unknown, turn: AiConversationTurnObservationDraft): value is AiTaskModelObservationDraft {
  if (!validateAiConversationTurnDraft(turn) || !turn.task || turn.material !== 'retained'
    || !conversationClosed(value, ['contractVersion', 'taskId', 'runId', 'resultId', 'sceneCode', 'status', 'text', 'sources',
      'observedAt', 'businessExecution', 'execution']) || value.contractVersion !== AI_TASK_DRAFT_VERSION
    || value.taskId !== turn.task.taskId || value.runId !== turn.task.runId || !conversationId(value.resultId)
    || value.sceneCode !== turn.capabilityCode || !['available', 'stale', 'unknown', 'failed'].includes(value.status as string)
    || !conversationTime(value.observedAt) || value.businessExecution !== 'not_inferred_from_model_result'
    || value.execution !== 'read_only_no_start_no_reconnect_side_effect' || !Array.isArray(value.sources) || value.sources.length > 9) return false;
  const seen = new Set<string>();
  for (const source of value.sources) {
    if (!conversationClosed(source, ['kind', 'index', 'referenceHash']) || !['order', 'knowledge'].includes(source.kind as string)
      || !Number.isSafeInteger(source.index) || (source.index as number) < 0 || (source.index as number) > (source.kind === 'order' ? 4 : 3)
      || typeof source.referenceHash !== 'string' || !/^[a-f0-9]{64}$/u.test(source.referenceHash)) return false;
    const key = `${source.kind}:${source.index}`; if (seen.has(key)) return false; seen.add(key);
  }
  if (value.status !== 'available') return value.text === null && value.sources.length === 0;
  return conversationClosed(value.text, ['value', 'trust']) && typeof value.text.value === 'string'
    && value.text.trust === 'unverified_model_text_not_execution_evidence'
    && value.text.value.length <= 131072 && new TextEncoder().encode(value.text.value).byteLength <= 131072;
}
