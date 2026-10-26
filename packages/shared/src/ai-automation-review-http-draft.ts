/** Human review metadata and original receipts only; never an execution grant.
 * Existing resource authorization and persisted CAS remain in the service. */
import { leafClosed as object, leafEnum as choice, leafInt as integer, leafList as list,
  leafRef as ref, leafId as id, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
import { AI_TASK_STATUSES_DRAFT } from './ai-task-draft';

export const AI_AUTOMATION_REVIEW_HTTP_CONTRACTS = Object.freeze({
  read: { request: 'AiAutomationReviewReadDraft', response: 'AiAutomationReviewDraft' },
  readQueue: { request: 'AiAutomationReviewQueueRequestDraft', response: 'AiAutomationReviewQueueResponseDraft' },
  forEvent: { request: 'AiAutomationReviewsForEventRequestDraft', response: 'AiAutomationReviewsForEventDraft' },
  close: { request: 'AiAutomationReviewCloseDraft', response: 'AiAutomationReviewOperationDraft' },
  feedback: { request: 'AiAutomationReviewFeedbackDraft', response: 'AiAutomationReviewOperationDraft' },
  operation: { request: 'AiAutomationReviewOperationReadDraft', response: 'AiAutomationReviewOperationDraft' }
} as const);
export interface AiAutomationReviewReadDraft { inputRef: string }
export interface AiAutomationReviewsForEventRequestDraft { eventId: string; limit: number; after?: string }
export interface AiAutomationReviewOperationReadDraft extends AiAutomationReviewReadDraft { operationKey: string }
type Mutation = AiAutomationReviewOperationReadDraft & { expectedRevision: number; expectedEventFence: number; expectedTaskId: string | null };
export type AiAutomationReviewCloseReasonDraft = 'resolved' | 'dismissed' | 'duplicate' | 'not_applicable';
export type AiAutomationReviewFeedbackCodeDraft = 'helpful' | 'not_helpful' | 'incorrect' | 'not_applicable';
export type AiAutomationReviewCloseDraft = Mutation & { reason: AiAutomationReviewCloseReasonDraft };
export type AiAutomationReviewFeedbackDraft = Mutation & { code: AiAutomationReviewFeedbackCodeDraft };
type Semantics = { executionPermission: false; businessActionRequested: false };
type Source = { revision: number; failed: boolean; orderId: string | null; paymentIntentId?: string; sourceHash?: string };
type Task = { state: 'observed'; taskId: string; runId: string; status: string; revision: number; archived: boolean }
  | { state: 'not_observed'; taskId: null; runId: null };
type Event = { eventId: string; type: 'notification.failed' | 'refund.failed' | 'inspection.return_exception';
  status: string; fence: number; resourceRevision: number };
export type AiAutomationReviewDraft = Semantics & {
  inputRef: string; inputStatus: 'prepared' | 'creation_unknown' | 'linked'; inputHash: string;
  inputMode: 'shadow' | 'manual_confirmation'; policyReference: { policyId: string; revision: number };
  nextAction: 'read_review_operation' | 'read_original_resource' | 'read_original_creation' | 'human_review';
  review: { revision: number; status: 'open' | 'closed'; closeReason: AiAutomationReviewCloseReasonDraft | null;
    feedbackCode: AiAutomationReviewFeedbackCodeDraft | null };
  event: Event & { expiresAt: string }; task: Task; currentSource: Source; resourceHash: string;
  actionResource: { inputRef: string; inputHash: string; creationKey: string; eventId: string; resourceRevision: number;
    deduplicationKey: string; expectedRevision: number; eventFence: number; taskId: string | null; runId: string | null };
};
export type AiAutomationReviewOperationDraft = Semantics & ({ state: 'unknown' | 'not_observed'; inputRef: string;
  operationKey: string; retryable: false; nextAction: 'read_operation' } | {
  state: 'observed'; operationId: string; operationKey: string; action: 'close' | 'feedback'; inputRef: string; eventId: string;
  taskId: string | null; runId: string | null; revision: number; status: 'open' | 'closed';
  closeReason: AiAutomationReviewCloseReasonDraft | null; feedbackCode: AiAutomationReviewFeedbackCodeDraft | null;
  eventFence: number; inputStatusAtCommit: 'prepared' | 'creation_unknown' | 'linked'; recordedAt: string; retryable: false;
});
export type AiAutomationReviewsForEventDraft = Semantics & {
  event: Event; currentSource: Source; originalResource:
    | { kind: 'notification'; id: string; orderId: string | null }
    | { kind: 'inspection'; id: string; exceptionId: string | null; orderId: string | null }
    | { kind: 'refund'; id: string; orderId: string | null; paymentIntentId?: string };
  inputs: { state: 'observed' | 'not_observed'; items: AiAutomationReviewDraft[]; hasMore: boolean;
    nextAfter: string | null; coverage: 'bounded_authorized_event_window' };
  nextAction: 'read_original_resource' | 'human_business_review';
};

const uuid: AiLeafSchemaDraft = { type: 'string', format: 'uuid' };
const nullable = (value: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ oneOf: [value, { type: 'null' }] });
const no: AiLeafSchemaDraft = { type: 'boolean', const: false };
const bool: AiLeafSchemaDraft = { type: 'boolean' };
const hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const revision = integer(1, 4294967295), fence = integer(0, 4294967295);
const key: AiLeafSchemaDraft = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const closeReason = choice('resolved', 'dismissed', 'duplicate', 'not_applicable');
const feedbackCode = choice('helpful', 'not_helpful', 'incorrect', 'not_applicable');
const semantics = { executionPermission: no, businessActionRequested: no };
const inputStatus = choice('prepared', 'creation_unknown', 'linked');
const eventType = choice('notification.failed', 'refund.failed', 'inspection.return_exception');
const event = { eventId: uuid, type: eventType, status: choice('pending', 'claimed', 'retry_scheduled', 'ready', 'closed', 'expired', 'dead_letter'),
  fence, resourceRevision: revision };
const review = object({ revision, status: choice('open', 'closed'), closeReason: nullable(closeReason), feedbackCode: nullable(feedbackCode) });
const task = { oneOf: [object({ state: choice('observed'), taskId: uuid, runId: uuid, status: choice(...AI_TASK_STATUSES_DRAFT), revision, archived: bool }),
  object({ state: choice('not_observed'), taskId: { type: 'null' }, runId: { type: 'null' } })] };
const source = object({ revision, failed: bool, orderId: nullable(id()), paymentIntentId: id(), sourceHash: hash }, ['revision', 'failed', 'orderId']);
const resource = { inputRef: uuid, operationKey: key };
const mutation = { ...resource, expectedRevision: integer(1, 4294967293), expectedEventFence: integer(0, 4294967293), expectedTaskId: nullable(uuid) };
const originalResource = (kind: string, extra: Record<string, AiLeafSchemaDraft> = {}, optional: string[] = []) => {
  const properties = { kind: choice(kind), id: id(), orderId: nullable(id()), ...extra };
  return object(properties, Object.keys(properties).filter(name => !optional.includes(name)));
};

export const AI_AUTOMATION_REVIEW_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiAutomationReviewReadDraft: object({ inputRef: uuid }),
  AiAutomationReviewsForEventRequestDraft: object({ eventId: uuid, limit: integer(1, 10), after: uuid }, ['eventId', 'limit']),
  AiAutomationReviewOperationReadDraft: object(resource),
  AiAutomationReviewCloseDraft: object({ ...mutation, reason: closeReason }),
  AiAutomationReviewFeedbackDraft: object({ ...mutation, code: feedbackCode }),
  AiAutomationReviewDraft: object({ ...semantics, inputRef: uuid, inputStatus, inputHash: hash,
    inputMode: choice('shadow', 'manual_confirmation'), policyReference: object({ policyId: id(), revision }),
    nextAction: choice('read_review_operation', 'read_original_resource', 'read_original_creation', 'human_review'),
    review, event: object({ ...event, expiresAt: time }), task, currentSource: source, resourceHash: hash,
    actionResource: object({ inputRef: uuid, inputHash: hash, creationKey: id(), eventId: uuid, resourceRevision: revision,
      deduplicationKey: id(), expectedRevision: revision, eventFence: fence, taskId: nullable(uuid), runId: nullable(uuid) }) }),
  AiAutomationReviewOperationDraft: { oneOf: [
    object({ ...semantics, ...resource, state: choice('unknown', 'not_observed'), retryable: no, nextAction: choice('read_operation') }),
    object({ ...semantics, ...resource, state: choice('observed'), operationId: uuid, action: choice('close', 'feedback'),
      eventId: uuid, taskId: nullable(uuid), runId: nullable(uuid), revision, status: choice('open', 'closed'),
      closeReason: nullable(closeReason), feedbackCode: nullable(feedbackCode), eventFence: fence, inputStatusAtCommit: inputStatus,
      recordedAt: time, retryable: no })] },
  AiAutomationReviewsForEventDraft: object({ ...semantics, event: object(event), currentSource: source,
    originalResource: { oneOf: [originalResource('notification'), originalResource('inspection', { exceptionId: nullable(id()) }),
      originalResource('refund', { paymentIntentId: id() }, ['paymentIntentId'])] },
    inputs: object({ state: choice('observed', 'not_observed'), items: list(ref('AiAutomationReviewDraft'), 10), hasMore: bool,
      nextAfter: nullable(uuid), coverage: choice('bounded_authorized_event_window') }),
    nextAction: choice('read_original_resource', 'human_business_review') }),
  AiAutomationReviewQueueRequestDraft: object({ limit: integer(1, 10),
    after: { type: 'string', minLength: 1, maxLength: 1536, pattern: '^[A-Za-z0-9_-]+$' },
    filters: object({ reviewStatus: choice('open', 'closed'), eventType }, []) }, ['limit']),
  AiAutomationReviewQueueResponseDraft: object({ items: list(object({ inputRef: uuid, mode: choice('shadow', 'manual_confirmation'),
    review, event: object({ ...event, expiresAt: time }), task, suggestionActive: bool,
    nextAction: choice('human_review', 'read_original_creation', 'read_original_resource', 'read_review_operation') }), 10),
    nextAfter: nullable({ type: 'string', minLength: 1, maxLength: 1536, pattern: '^[A-Za-z0-9_-]+$' }),
    coverage: choice('bounded_authorized_window'), continuation: choice('position_only_not_more_results'),
    readOnly: { type: 'boolean', const: true }, workerStarted: no, ...semantics })
};
