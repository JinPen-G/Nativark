/** Current-human automation review transport. Published schemas validate both
 * directions; the original server owns resource access, grants and CAS. No
 * request starts a model or follows an AUTOMATION task through TaskCenter. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  AI_AUTOMATION_EVENT_TASK_HTTP_DRAFT,
  AI_AUTOMATION_EVENT_TASK_HTTP_SCHEMAS,
  AI_AUTOMATION_REVIEW_GRANT_HTTP_DRAFT,
  AI_AUTOMATION_REVIEW_HTTP_CONTRACTS,
  AI_AUTOMATION_REVIEW_HTTP_SCHEMAS,
  AI_AUTOMATION_REVIEW_QUEUE_HTTP_DRAFT,
  AI_AUTOMATION_PENDING_BATCH_HTTP_DRAFT,
  AI_EVENTS_DRAFT_SCHEMAS,
  AI_SCOPE_DRAFT_SCHEMAS,
  type ApiResult,
  type AiAutomationCandidateDraft,
  type AiAutomationPendingCandidatesRequestDraft,
  type AiAutomationPendingCandidatesDraft,
  type AiAutomationPendingBatchReferenceDraft,
  type AiAutomationPendingBatchContinueDraft,
  type AiAutomationPendingBatchObservationDraft,
  type AiAutomationEventTaskResponseDraft,
  type AiAutomationReviewCloseDraft,
  type AiAutomationReviewDraft,
  type AiAutomationReviewFeedbackDraft,
  type AiAutomationReviewGrantQueryDraft,
  type AiAutomationReviewGrantReadDraft,
  type AiAutomationReviewGrantPreparationDraft,
  type AiAutomationReviewGrantEnableDraft,
  type AiAutomationReviewGrantObservationDraft,
  type AiAutomationReviewOperationDraft,
  type AiAutomationReviewQueueRequestDraft,
  type AiAutomationReviewQueueResponseDraft,
  type AiAutomationReviewsForEventRequestDraft,
  type AiAutomationReviewsForEventDraft,
  type AiAutomationTaskCreationObservationDraft,
} from '@rental-os/shared';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { http } from './http';

const definitions = JSON.parse(JSON.stringify({
  ...AI_SCOPE_DRAFT_SCHEMAS, ...AI_EVENTS_DRAFT_SCHEMAS,
  ...AI_AUTOMATION_REVIEW_HTTP_SCHEMAS, ...AI_AUTOMATION_EVENT_TASK_HTTP_SCHEMAS,
}).replaceAll('#/components/schemas/', '#/$defs/'));
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const validators = Object.fromEntries(Object.keys({
  ...AI_AUTOMATION_REVIEW_HTTP_SCHEMAS, ...AI_AUTOMATION_EVENT_TASK_HTTP_SCHEMAS,
}).map(name => [name, ajv.compile({ $ref: `#/$defs/${name}`, $defs: definitions })]));

export class AutomationReviewApiError extends Error {
  constructor(readonly code: 'AI_INVALID_INPUT' | 'AI_RESOURCE_UNAVAILABLE' | 'AI_SCOPE_CHANGED' | 'AI_RESULT_UNKNOWN') {
    super(code);
  }
}

/** Also used after journal recovery. This checks the wire, never authorization. */
export function validateAutomationReview<T>(name: string, value: unknown, maximum = 262144): T {
  try {
    const copy = structuredClone(value);
    const encoded = JSON.stringify(copy);
    if (!encoded || new TextEncoder().encode(encoded).byteLength > maximum || !validators[name]?.(copy)) throw Error();
    return copy as T;
  } catch { throw new AutomationReviewApiError('AI_RESOURCE_UNAVAILABLE'); }
}

const paths = Object.freeze({
  readCandidate: 'candidates/read',
  ...AI_AUTOMATION_PENDING_BATCH_HTTP_DRAFT,
  readQueue: AI_AUTOMATION_REVIEW_QUEUE_HTTP_DRAFT.operation,
  forEvent: 'reviews/for-event', read: 'reviews/read',
  close: 'reviews/close', feedback: 'reviews/feedback', operation: 'reviews/operation',
  readCreation: 'tasks/read-creation',
  ...AI_AUTOMATION_REVIEW_GRANT_HTTP_DRAFT.operations,
});
type Action = keyof typeof paths | 'fromEvent';
const writes = new Set<Action>(['fromEvent', 'close', 'feedback', 'readCandidate', 'preparePending', 'continuePendingBatch', 'enableGrant']);

function identity() {
  const auth = useAuthStore.getState();
  if (!auth.sessionVerified || !auth.token || !auth.user?.id || !auth.tenant?.tenantId || !auth.currentWorkspaceId) {
    throw new AutomationReviewApiError('AI_SCOPE_CHANGED');
  }
  return JSON.stringify([auth.tenant.tenantId, auth.currentWorkspaceId, auth.user, currentSessionEpoch()]);
}

async function post<T>(action: Action, body: unknown, signal: AbortSignal): Promise<T> {
  const contract = action === 'fromEvent'
    ? { request: 'AiAutomationEventTaskRequestDraft', response: 'AiAutomationEventTaskResponseDraft' }
    : AI_AUTOMATION_REVIEW_HTTP_CONTRACTS[action];
  let command: unknown;
  try { command = validateAutomationReview(contract.request, body, 65536); }
  catch { throw new AutomationReviewApiError('AI_INVALID_INPUT'); }
  const epoch = currentSessionEpoch(), binding = identity();
  const active = AbortSignal.any([signal, currentSessionSignal()]);
  const check = () => {
    if (active.aborted || currentSessionEpoch() !== epoch || identity() !== binding) {
      throw new AutomationReviewApiError('AI_SCOPE_CHANGED');
    }
  };
  check();
  const path = action === 'fromEvent' ? AI_AUTOMATION_EVENT_TASK_HTTP_DRAFT.operation : paths[action];
  // Canonical Axios normally refreshes and replays a POST on 401. An uncertain
  // metadata write must instead keep its original journal and receipt locator.
  const config = { signal: active, timeout: action === 'fromEvent' ? 30000 : 12000, _authRetry: true };
  const response = await http.post<ApiResult<unknown>>(`/${AI_AUTOMATION_REVIEW_QUEUE_HTTP_DRAFT.operatorBasePath}/${path}`, command, config);
  check();
  try { return validateAutomationReview<T>(contract.response, response.data.data); }
  catch { throw new AutomationReviewApiError(writes.has(action) ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE'); }
}

export const aiAutomationReviewsApi = Object.freeze({
  queue: (input: AiAutomationReviewQueueRequestDraft, signal: AbortSignal) =>
    post<AiAutomationReviewQueueResponseDraft>('readQueue', input, signal),
  forEvent: (input: AiAutomationReviewsForEventRequestDraft, signal: AbortSignal) =>
    post<AiAutomationReviewsForEventDraft>('forEvent', input, signal),
  candidate: (eventId: string, signal: AbortSignal) => post<AiAutomationCandidateDraft>('readCandidate', { eventId }, signal),
  preparePending: (input: AiAutomationPendingCandidatesRequestDraft, signal: AbortSignal) =>
    post<AiAutomationPendingCandidatesDraft>('preparePending', input, signal),
  readPendingBatch: (input: AiAutomationPendingBatchReferenceDraft, signal: AbortSignal) =>
    post<AiAutomationPendingBatchObservationDraft>('readPendingBatch', input, signal),
  continuePendingBatch: (input: AiAutomationPendingBatchContinueDraft, signal: AbortSignal) =>
    post<AiAutomationPendingBatchObservationDraft>('continuePendingBatch', input, signal),
  review: (inputRef: string, signal: AbortSignal) => post<AiAutomationReviewDraft>('read', { inputRef }, signal),
  fromEvent: (eventId: string, signal: AbortSignal) => post<AiAutomationEventTaskResponseDraft>('fromEvent', { eventId }, signal),
  creation: (inputRef: string, signal: AbortSignal) => post<AiAutomationTaskCreationObservationDraft>('readCreation', { inputRef }, signal),
  prepareGrant: (input: AiAutomationReviewGrantQueryDraft, signal: AbortSignal) =>
    post<AiAutomationReviewGrantPreparationDraft>('prepareGrant', input, signal),
  enableGrant: (input: AiAutomationReviewGrantPreparationDraft, signal: AbortSignal) =>
    post<AiAutomationReviewGrantEnableDraft>('enableGrant', input, signal),
  readGrant: (input: AiAutomationReviewGrantReadDraft, signal: AbortSignal) =>
    post<AiAutomationReviewGrantObservationDraft>('readGrant', input, signal),
  close: (input: AiAutomationReviewCloseDraft, signal: AbortSignal) => post<AiAutomationReviewOperationDraft>('close', input, signal),
  feedback: (input: AiAutomationReviewFeedbackDraft, signal: AbortSignal) => post<AiAutomationReviewOperationDraft>('feedback', input, signal),
  operation: (input: { inputRef: string; operationKey: string }, signal: AbortSignal) =>
    post<AiAutomationReviewOperationDraft>('operation', input, signal),
});

export type AutomationReviewsApi = typeof aiAutomationReviewsApi;
