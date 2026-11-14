import type { RentalFulfillmentMode, RentalOrderExtensionRequest, RENTAL_PRICING_UNIT_CODES } from './core';
import { AI_TASK_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT, type AiTaskStatusDraft, type AiStepStateDraft } from './ai-task-draft';
import type { AiUsageQuantityDraft, AiUsageRecordDraft } from './ai-usage-draft';
import type { AiWorkspaceScope } from './ai-native';
import type { AI_TASK_DRAFT_VERSION } from './ai-task-draft';
import type { AiTaskInputSubmissionDraft, AiTaskInputReceiptReferenceDraft } from './ai-task-input-draft';
import { RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES as pricingUnits } from './core';
import type { AiQuoteGoalInputDraft } from './ai-quote-goal-draft';

/** Reopen an existing answer by payload or exact receipt key, never both.
 * Reference recovery reads the stored binding; it cannot submit a new answer. */
export type AiSceneModelAnswerQueryDraft = { original: { draftVersion: typeof AI_SCENE_REQUEST_DRAFT_VERSION; inputRef: string } } & (
  { submission: AiTaskInputSubmissionDraft; reference?: never } |
  { reference: AiTaskInputReceiptReferenceDraft; submission?: never });
/** Human confirmation of the final reviewed parameters, not order approval. */
export type AiSceneModelQuoteConfirmDraft = AiSceneModelAnswerQueryDraft & {
  selectionRevision: string; inputFingerprint: string; confirmQuote: true;
};

export const AI_SCENE_REQUEST_DRAFT_VERSION = 'ain-scene-request-draft-1' as const;
export const AI_SCENE_REQUEST_MAX_BYTES = 32768;
export const AI_SCENE_CODES = ['order_explanation', 'opening_diagnosis', 'quote_clarification'] as const;
export type AiSceneCode = typeof AI_SCENE_CODES[number];
export interface AiSceneQuoteCandidate {
  customerType: 'personal' | 'corporate';
  customerId?: string;
  customerName?: string;
  bookingIdentity?: { bookingIdentity: 'personal' } | { bookingIdentity: 'enterprise_employee';
    corporateCustomerId?: string; enterpriseContractAndPayer?: boolean };
  deliveryAddressId?: string;
  items?: Array<{ productName?: string; itemGroupId?: string; quantity: number; pricingUnit?: typeof RENTAL_PRICING_UNIT_CODES[number]; usageQuantity?: number }>;
  start?: string;
  end?: string;
  fulfillmentMode?: RentalFulfillmentMode;
  locationName?: string;
  returnLocationName?: string;
  locationId?: string;
  returnLocationId?: string;
  selectionRevision?: string;
}
/** Candidate structure only. Names, identity, time, stock, qualification and
 * prices are resolved by the original authorized scene/Core, never this check. */
export function validateAiSceneQuoteCandidateDraft(value: unknown): value is AiSceneQuoteCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = ['customerType', 'customerId', 'customerName', 'bookingIdentity', 'deliveryAddressId', 'items', 'start', 'end',
    'fulfillmentMode', 'locationName', 'returnLocationName', 'locationId', 'returnLocationId', 'selectionRevision'];
  const text = (v: unknown, max = 191) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  const id = (v: unknown) => text(v) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(v as string);
  if (Object.keys(row).some(key => !keys.includes(key)) || !['personal', 'corporate'].includes(row.customerType as string)) return false;
  for (const key of ['customerId', 'deliveryAddressId', 'locationId', 'returnLocationId']) if (row[key] !== undefined && !id(row[key])) return false;
  for (const key of ['customerName', 'locationName', 'returnLocationName']) if (row[key] !== undefined && !text(row[key])) return false;
  if (['start', 'end'].some(key => row[key] !== undefined && !text(row[key], 80))
    || row.fulfillmentMode !== undefined && !RENTAL_FULFILLMENT_MODES.includes(row.fulfillmentMode as RentalFulfillmentMode)
    || row.selectionRevision !== undefined && (typeof row.selectionRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(row.selectionRevision))) return false;
  if (row.bookingIdentity !== undefined) {
    const identity = row.bookingIdentity;
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return false;
    const b = identity as Record<string, unknown>;
    if (b.bookingIdentity === 'personal') { if (Object.keys(b).length !== 1) return false; }
    else if (b.bookingIdentity !== 'enterprise_employee' || Object.keys(b).some(key => !['bookingIdentity', 'corporateCustomerId', 'enterpriseContractAndPayer'].includes(key))
      || b.corporateCustomerId !== undefined && !id(b.corporateCustomerId)
      || b.enterpriseContractAndPayer !== undefined && typeof b.enterpriseContractAndPayer !== 'boolean') return false;
  }
  if (row.items !== undefined) {
    if (!Array.isArray(row.items) || row.items.length < 1 || row.items.length > 50) return false;
    for (const item of row.items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const i = item as Record<string, unknown>;
      if (Object.keys(i).some(key => !['productName', 'itemGroupId', 'quantity', 'pricingUnit', 'usageQuantity'].includes(key))
        || typeof i.quantity !== 'number' || !Number.isSafeInteger(i.quantity) || i.quantity < 1 || i.quantity > 10000
        || i.productName !== undefined && !text(i.productName) || i.itemGroupId !== undefined && !id(i.itemGroupId)
        || i.pricingUnit !== undefined && !pricingUnits.includes(i.pricingUnit as typeof pricingUnits[number])
        || i.usageQuantity !== undefined && (typeof i.usageQuantity !== 'number' || !Number.isFinite(i.usageQuantity) || i.usageQuantity < 0 || i.usageQuantity > 1000000)) return false;
    }
  }
  return true;
}
export type AiSceneRequestBody =
  | { sceneCode: 'order_explanation'; input: { orderId: string; question: 'status' | 'fees' | 'payments' | 'next_steps' } }
  | { sceneCode: 'opening_diagnosis'; input: { sections: string[] } }
  | { sceneCode: 'quote_clarification'; input: { candidate: AiSceneQuoteCandidate; kind?: never; draftVersion?: never; goalText?: never }
      | (AiQuoteGoalInputDraft & { candidate?: never }) };
export type AiSceneRequestCreateDraft = AiSceneRequestBody & {
  draftVersion: typeof AI_SCENE_REQUEST_DRAFT_VERSION;
  requestKey: string;
};
export type AiSceneRequestReissueDraft = AiSceneRequestCreateDraft & { previousInputRef: string };
export interface AiSceneRequestReadDraft {
  draftVersion: typeof AI_SCENE_REQUEST_DRAFT_VERSION;
  inputRef: string;
}
/** Explicit current preview for the order selected by the stored original
 * next-steps request. No caller order/actor/scope, amount or execution grant. */
export interface AiSceneOrderExtensionPreviewDraft extends AiSceneRequestReadDraft {
  expectedOrderVersion: string;
  extension: RentalOrderExtensionRequest;
}
/** Reopen only a readiness section selected by the original request. This is
 * a current authorized observation, not a URL or historical configuration. */
export interface AiSceneOpeningModelSourceReadDraft {
  original: AiSceneRequestReadDraft;
  resultId: string;
  key: string;
}
export interface AiSceneTaskUsageReadDraft {
  original: AiSceneRequestReadDraft; taskId?: string; limit: number; after?: string;
}
/** Current authorized observation of one original invocation, not a new call,
 * arbitrary reservation selector or an assertion of zero consumption. */
export interface AiOriginalTaskAccountingRequestDraft {
  original: AiSceneRequestReadDraft;
  callId: string;
}
/** Observe the exact recovery event, independently of current balance. */
export interface AiOriginalTaskAccountingOperationRequestDraft extends AiOriginalTaskAccountingRequestDraft {
  operation: 'releaseUnsent' | 'reconcile';
}
export interface AiOriginalTaskAccountingOperationResponseDraft extends AiOriginalTaskAccountingOperationRequestDraft {
  taskId: string; reservationId: string; status: 'observed' | 'not_observed';
  execution: 'read_only_no_dispatch_or_release'; automaticRetry: false;
  semantics: 'original_accounting_operation_not_current_balance';
}
export interface AiTaskBudgetUsageRecordDraft {
  invocationId: string; callId: string; accounting: 'recorded'; reservationId: string;
  sceneCode: string; runId: string; stepId: string; revision: number; observedVersionAt: string;
  status: Exclude<AiUsageRecordDraft['status'], 'estimated'>;
  reserved: AiUsageQuantityDraft; actual: AiUsageQuantityDraft | null; budgetDispatchMarked: boolean;
  modelPolicy: { mode: 'platform_managed'; serviceName: 'Rental OS AI' } | { mode: 'tenant_managed'; model: string };
}
export interface AiOriginalTaskAccountingResponseDraft {
  draftVersion: typeof AI_SCENE_REQUEST_DRAFT_VERSION;
  original: AiSceneRequestReadDraft; taskId: string; record: AiTaskBudgetUsageRecordDraft;
  accounting: 'observed' | 'original_operation_only'; execution: 'not_invoked'; automaticRetry: false;
  businessExecution: 'not_inferred_from_usage'; admission: 'not_granted';
}
export interface AiTaskBudgetUsagePageDraft {
  taskId: string;
  items: Array<{ invocationId: string; callId: string } & (
    | { accounting: 'not_recorded' }
    | AiTaskBudgetUsageRecordDraft
  )>;
  nextAfter: string | null; observedAt: string; coverage: 'page_not_total'; totals: 'not_computed';
  /** Integer atoms from this visible page only, not task totals or a provider
   * invoice. Money uses micro-units; currencies and units never coalesce. */
  pageAmounts?: {
    coverage: 'visible_page_only'; basis: 'persisted_budget_records_not_provider_invoice';
    recordedCount: number; notRecordedCount: number;
    groups: Array<({ unit: 'money'; currency: string; scale: 6 } | { unit: 'tokens' | 'calls'; currency: null; scale: 0 }) & {
      reservedAtoms: string; pendingAtoms: string; settledAtoms: string;
      releasedReservationAtoms: string; settledExcessAtoms: string;
    }>;
  };
  consistency: 'revalidated_reads_not_atomic_snapshot'; absenceSemantics: 'no_record_is_not_proof_of_no_consumption';
  businessExecution: 'not_inferred_from_usage'; admission: 'not_granted';
}
/** All registered calls within a fixed observation bound. Unrecorded calls
 * prevent a complete accounting total; this never certifies a provider bill. */
export type AiTaskBudgetUsageSummaryDraft = {
  taskId: string; observedAt: string; invocationLimit: 50;
  consistency: 'revalidated_reads_not_atomic_snapshot';
  execution: 'read_only_no_dispatch_or_release';
  basis: 'persisted_budget_records_not_provider_invoice';
  absenceSemantics: 'no_record_is_not_proof_of_no_consumption';
  businessExecution: 'not_inferred_from_usage'; admission: 'not_granted';
} & (
  | { state: 'limit_exceeded'; coverage: 'not_computed' }
  | { state: 'observed'; coverage: 'all_registered_invocations'; invocationCount: number;
    recordedCount: number; notRecordedCount: number; accountingComplete: boolean;
    groups: NonNullable<AiTaskBudgetUsagePageDraft['pageAmounts']>['groups'] }
);
/** Explicit same-owner recovery takeover. Revisions describe an observed
 * original run; they are not permission or a caller-selected worker lease. */
export interface AiSceneModelTakeoverDraft {
  original: AiSceneRequestReadDraft;
  expectedTaskRevision: number;
  expectedRunRevision: number;
  expectedFencingToken: string;
}
/** Exact previously observed run, including a prior clarification generation.
 * This reference is observation only and cannot select a run for execution. */
export interface AiSceneModelTakeoverReceiptReadDraft extends AiSceneModelTakeoverDraft {
  runId: string;
}
/** expectedRevision is the exact revision before the observed transition.
 * Cancellation intent and its later settlement are separate observations. */
export interface AiSceneModelCancellationReceiptReadDraft {
  original: AiSceneRequestReadDraft;
  expectedRevision: number;
}
/** A previously observed owned run, not a lease or authority to execute. */
export interface AiSceneModelRecoverySnapshotReadDraft {
  original: AiSceneRequestReadDraft;
  runId: string;
}
/** Confirms only the displayed Core quote parameters, not order creation or
 * approval. Hashes bind the current authorized preparation, not authority. */
export interface AiSceneQuoteReceiptReadDraft extends AiSceneRequestReadDraft {
  /** Optional legacy display hints; historical lookup uses the server-owned
   * original reference, not today's candidates or these caller values. */
  selectionRevision?: string;
  inputFingerprint?: string;
}
export interface AiSceneQuoteConfirmDraft extends AiSceneQuoteReceiptReadDraft {
  selectionRevision: string;
  inputFingerprint: string;
  confirmQuote: true;
}
/** Two server-owned original operations, never caller quote bodies or prices.
 * Comparison preserves each receipt's unknown/expiry and grants no approval. */
export interface AiSceneOriginalQuotesCompareDraft {
  previous: AiSceneRequestReadDraft;
  current: AiSceneRequestReadDraft;
}
export interface AiSceneRequestReceiptDraft {
  draftVersion: typeof AI_SCENE_REQUEST_DRAFT_VERSION;
  inputRef: string;
  revision: number;
  contentHash: string;
  sceneCode: AiSceneCode;
  sceneVersion: string;
  requestKey: string;
  previousInputRef: string | null;
  expiresAt: string;
  createdAt: string;
  state: 'stored' | 'expired' | 'revoked';
}
/** Current authorized diagnostic projection. `ready` remains the Core
 * workspace aggregate, never a success recalculated from selected sections. */
export interface AiOpeningReadFactsDraft {
  requestId: string;
  scope: AiWorkspaceScope;
  observedAt: string;
  ready: boolean;
  readinessBasis: 'core_workspace_aggregate';
  coverage: 'requested_sections' | 'all_readiness_sections';
  items: Array<{ key: string; title: string; missing: string; optional: boolean;
    status: 'unavailable' | 'ready' | 'missing' }>;
}
/** No historical payload or execution/approval grant accompanies this source. */
export interface AiOriginalOpeningReadSourceDraft {
  original: AiSceneRequestReceiptDraft;
  source: {
    original: { contractVersion: typeof AI_TASK_DRAFT_VERSION; taskId: string; resultId: string;
      runId: string; stepId: string; actionId: string; status: 'succeeded'; errorCode: null;
      contentHash: string; outputBytes: string; activeMs: string; completeMeasurement: true; observedAt: string };
    facts: AiOpeningReadFactsDraft;
    observation: 'current_authorized_reobservation';
    originalPayload: 'not_returned';
    execution: 'not_invoked';
  };
}
export type AiSceneTaskReceiptDraft =
  | { state: 'not_observed'; retryable: false }
  | { state: 'observed'; taskId: string; runId: string; status: AiTaskStatusDraft; revision: number;
      plan: 'stored' | 'not_observed'; resultAvailable: boolean; execution: 'not_inferred_from_metadata' };
export interface AiSceneRecoveryStepDraft {
  stepId: string;
  runId: string;
  actionId: string;
  revision: number;
  status: AiStepStateDraft['outcome']['status'];
  effect: AiStepStateDraft['outcome']['effect'];
  resultAvailable: boolean;
  nextAction: 'reconcile_original_action' | 'read_authorized_result' | 'runner_owned';
}
export interface AiSceneCreatedTaskDraft { taskId: string; runId: string; status: AiTaskStatusDraft; revision: number; replayed: boolean }
export type AiSceneRequestCreationResponseDraft = { receipt: AiSceneRequestReceiptDraft; model: 'not_called' } & (
  | { stage: 'existing_request'; task: AiSceneTaskReceiptDraft }
  | { stage: 'task_metadata_created'; task: AiSceneCreatedTaskDraft; plan: 'not_started' }
  | { stage: 'request_stored'; creation: { retryable: false } & (
      | { code: 'AI_STORAGE_UNAVAILABLE'; state: 'requires_reconciliation' }
      | { code: 'AI_INVALID_INPUT' | 'AI_ACCESS_DENIED' | 'AI_RESOURCE_UNAVAILABLE' | 'AI_REVISION_CONFLICT'; state: 'blocked' }) });
export interface AiSceneRequestReadResponseDraft { receipt: AiSceneRequestReceiptDraft; request: AiSceneRequestBody }
export type AiSceneRequestReconcileResponseDraft = { state: 'not_observed'; retryable: false }
  | { state: 'observed'; receipt: AiSceneRequestReceiptDraft; task: AiSceneTaskReceiptDraft };
export type AiSceneRequestRecoveryDraft =
  | { task: Extract<AiSceneTaskReceiptDraft, { state: 'not_observed' }>; nextAction: 'reconcile_request_or_explicit_create_task'; automaticExecution: false }
  | { task: Extract<AiSceneTaskReceiptDraft, { state: 'observed' }>; steps: AiSceneRecoveryStepDraft[]; hasMore: boolean; automaticExecution: false;
      nextAction: 'host_plan_handoff' | 'existing_runner_recovery'; observedResults: 'preserved_even_if_task_cancelled'; snapshot: 'bounded_sequential_read' };
function sceneMetadataClosed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
const sceneMetadataUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value);
const sceneMetadataId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const sceneMetadataRevision = (value: unknown, maximum = 4294967294) => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= 1 && value <= maximum;
const sceneReceiptTime = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/iu.exec(value);
  if (!match || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return false;
  const date = new Date(0); date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
};
/** Closed receipt binding for existing scene consumers. Expired/revoked is a
 * historical observation; only the original service can grant new execution. */
export function validateAiSceneRequestReceiptDraft(value: unknown, query: AiSceneRequestReadDraft,
  binding: { capabilityCode: AiSceneCode; capabilityVersion: string; originalRequestKey: string }): value is AiSceneRequestReceiptDraft {
  if (!sceneMetadataClosed(value, ['draftVersion', 'inputRef', 'revision', 'contentHash', 'sceneCode', 'sceneVersion',
    'requestKey', 'previousInputRef', 'expiresAt', 'createdAt', 'state'])) return false;
  return value.draftVersion === AI_SCENE_REQUEST_DRAFT_VERSION && query.draftVersion === value.draftVersion
    && value.inputRef === query.inputRef && sceneMetadataUuid(value.inputRef) && sceneMetadataRevision(value.revision)
    && typeof value.contentHash === 'string' && /^[a-f0-9]{64}$/u.test(value.contentHash)
    && value.sceneCode === binding.capabilityCode && AI_SCENE_CODES.includes(binding.capabilityCode)
    && value.sceneVersion === binding.capabilityVersion && sceneMetadataId(value.sceneVersion)
    && value.requestKey === binding.originalRequestKey && sceneMetadataId(value.requestKey) && (value.requestKey as string).length <= 128
    && (value.previousInputRef === null || sceneMetadataUuid(value.previousInputRef))
    && sceneReceiptTime(value.createdAt) && sceneReceiptTime(value.expiresAt)
    && ['stored', 'expired', 'revoked'].includes(value.state as string);
}
/** Observes the original creation key without creating metadata or dispatching.
 * A missing record is never proof that an earlier operation did not commit. */
export function validateAiSceneRequestReconcileDraft(value: unknown, query: AiSceneRequestReadDraft,
  binding: { capabilityCode: AiSceneCode; capabilityVersion: string; originalRequestKey: string }): value is AiSceneRequestReconcileResponseDraft {
  if (sceneMetadataClosed(value, ['state', 'retryable'])) return value.state === 'not_observed' && value.retryable === false;
  if (!sceneMetadataClosed(value, ['state', 'receipt', 'task']) || value.state !== 'observed'
    || !validateAiSceneRequestReceiptDraft(value.receipt, query, binding)) return false;
  const task = value.task;
  if (sceneMetadataClosed(task, ['state', 'retryable'])) return task.state === 'not_observed' && task.retryable === false;
  return sceneMetadataClosed(task, ['state', 'taskId', 'runId', 'status', 'revision', 'plan', 'resultAvailable', 'execution'])
    && task.state === 'observed' && sceneMetadataUuid(task.taskId) && sceneMetadataUuid(task.runId)
    && AI_TASK_STATUSES_DRAFT.includes(task.status as AiTaskStatusDraft) && sceneMetadataRevision(task.revision)
    && ['stored', 'not_observed'].includes(task.plan as string) && typeof task.resultAvailable === 'boolean'
    && task.execution === 'not_inferred_from_metadata';
}
/** Browser-safe closed metadata checks. They authorize no creation, dispatch or
 * business action; an original-request reader must still revalidate association. */
export function validateAiSceneCreatedTaskDraft(value: unknown): value is AiSceneCreatedTaskDraft {
  return sceneMetadataClosed(value, ['taskId', 'runId', 'status', 'revision', 'replayed'])
    && sceneMetadataUuid(value.taskId) && sceneMetadataUuid(value.runId)
    && AI_TASK_STATUSES_DRAFT.includes(value.status as AiTaskStatusDraft)
    && sceneMetadataRevision(value.revision, 4294967295) && typeof value.replayed === 'boolean';
}
export function validateAiSceneRequestRecoveryDraft(value: unknown): value is AiSceneRequestRecoveryDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>, task = row.task;
  if (!task || typeof task !== 'object' || Array.isArray(task) || row.automaticExecution !== false) return false;
  const metadata = task as Record<string, unknown>;
  if (metadata.state === 'not_observed') return sceneMetadataClosed(row, ['task', 'nextAction', 'automaticExecution'])
    && sceneMetadataClosed(metadata, ['state', 'retryable']) && metadata.retryable === false
    && row.nextAction === 'reconcile_request_or_explicit_create_task';
  if (!sceneMetadataClosed(row, ['task', 'steps', 'hasMore', 'automaticExecution', 'nextAction', 'observedResults', 'snapshot'])
    || !sceneMetadataClosed(metadata, ['state', 'taskId', 'runId', 'status', 'revision', 'plan', 'resultAvailable', 'execution'])
    || metadata.state !== 'observed' || !sceneMetadataUuid(metadata.taskId) || !sceneMetadataUuid(metadata.runId)
    || !AI_TASK_STATUSES_DRAFT.includes(metadata.status as AiTaskStatusDraft) || !sceneMetadataRevision(metadata.revision)
    || !['stored', 'not_observed'].includes(metadata.plan as string) || typeof metadata.resultAvailable !== 'boolean'
    || metadata.execution !== 'not_inferred_from_metadata' || !Array.isArray(row.steps) || row.steps.length > 50
    || typeof row.hasMore !== 'boolean' || !['host_plan_handoff', 'existing_runner_recovery'].includes(row.nextAction as string)
    || row.observedResults !== 'preserved_even_if_task_cancelled' || row.snapshot !== 'bounded_sequential_read') return false;
  const seen = new Set<string>();
  for (const step of row.steps) {
    if (!sceneMetadataClosed(step, ['stepId', 'runId', 'actionId', 'revision', 'status', 'effect', 'resultAvailable', 'nextAction'])
      || !sceneMetadataId(step.stepId) || seen.has(step.stepId as string) || !sceneMetadataId(step.runId) || !sceneMetadataId(step.actionId)
      || !sceneMetadataRevision(step.revision) || !AI_STEP_STATUSES_DRAFT.includes(step.status as typeof AI_STEP_STATUSES_DRAFT[number])
      || !['none', 'possible', 'committed'].includes(step.effect as string) || typeof step.resultAvailable !== 'boolean'
      || !['reconcile_original_action', 'read_authorized_result', 'runner_owned'].includes(step.nextAction as string)) return false;
    seen.add(step.stepId as string);
  }
  return true;
}
/** Original request/Task metadata only, not dispatch or business execution.
 * Status 201 preserves the existing Nest POST transport, including its reads. */
export const AI_SCENE_REQUEST_HTTP_CONTRACTS = Object.freeze({
  create: { request: 'AiSceneRequestCreateDraft', response: 'AiSceneRequestCreationResponseDraft', successStatus: 201 },
  reissue: { request: 'AiSceneRequestReissueDraft', response: 'AiSceneRequestCreationResponseDraft', successStatus: 201 },
  read: { request: 'AiSceneRequestReadDraft', response: 'AiSceneRequestReadResponseDraft', successStatus: 201 },
  reconcile: { request: 'AiSceneRequestCreateDraft', response: 'AiSceneRequestReconcileResponseDraft', successStatus: 201 },
  reconcileReissue: { request: 'AiSceneRequestReissueDraft', response: 'AiSceneRequestReconcileResponseDraft', successStatus: 201 },
  createTask: { request: 'AiSceneRequestReadDraft', response: 'AiSceneCreatedTaskDraft', successStatus: 201 },
  material: { request: 'AiSceneRequestReadDraft', response: 'AiSceneTaskMaterialResponseDraft', successStatus: 201 },
  recovery: { request: 'AiSceneRequestReadDraft', response: 'AiSceneRequestRecoveryDraft', successStatus: 201 }
} as const);
export const AI_SCENE_REQUEST_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/scene-requests', method: 'POST',
  create: '', read: 'read', reissue: 'reissue', reconcile: 'reconcile', reconcileReissue: 'reconcile-reissue',
  createTask: 'create-task', material: 'material', recovery: 'recovery', quoteReview: 'quote-review',
  quoteConfirm: 'quote-confirm', quoteReceipt: 'quote-receipt', compareOriginalQuotes: 'quote-compare',
  previewOrderExtension: 'order-extension-preview', queryOrders: 'order-candidates/read'
} as const);
/** Owner-only operator policy management; never execution or business approval. */
export const AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/task-actions`, method: 'POST',
  configure: 'configure', read: 'read', clear: 'clear'
} as const);
/** Current workspace manager, with a closed server-selected scene/tool registry. */
export const AI_SCENE_PLAN_POLICY_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/plan-policies`, method: 'POST', read: 'read', change: 'change'
} as const);
/** Server opt-in only. Bodies reuse original references and the existing input
 * submission contract; callers never supply leases, prompts or model settings. */
export const AI_SCENE_MODEL_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/model`, method: 'POST',
  start: 'start', readInput: 'input', refreshInput: 'input/refresh', submitAnswer: 'input/submit', resume: 'resume', reconcile: 'reconcile',
  readExecution: 'execution', readRecoverySnapshot: 'execution/snapshot', recover: 'recover', takeover: 'takeover', readTakeoverReceipt: 'takeover/receipt',
  readAnswer: 'input/receipt', continueAnswer: 'input/continue',
  readQuotePreparation: 'input/quote-preparation',
  confirmClarifiedQuote: 'input/quote-confirm', readClarifiedQuoteReceipt: 'input/quote-receipt',
  requestCancel: 'cancel', requestCancellationIntent: 'cancel/intent', readCancellationReceipt: 'cancel/receipt',
  settleUnstartedCancellation: 'cancel/settle-unstarted',
  settleReleasedInputCancellation: 'cancel/settle-input-wait',
  readCancellationSettlementReceipt: 'cancel/settlement-receipt', readModelResult: 'result', readQuoteGoalCandidates: 'quote-goal/candidates', reopenModelSource: 'source',
  reopenOpeningModelSource: 'source/opening-section',
  readTaskPage: 'tasks', readTaskEvents: 'events', readTaskUsage: 'usage', readTaskPerformance: 'performance', readTaskScene: 'scene',
  startSettingsTask: 'settings/start', readSettingsConfirmation: 'settings/confirmation',
  createSettingsTask: 'settings/create-task', readSettingsTaskCreation: 'settings/create-task/receipt',
  readCurrentSettings: 'settings/current', prepareOriginalSettingsChange: 'settings/change/prepare',
  readOriginalSettingsChange: 'settings/change/receipt',
  readSettingsReconfirmationDifference: 'settings/reconfirmation/difference',
  prepareReconfirmedSettingsChange: 'settings/reconfirmation/prepare',
  readReconfirmedSettingsChange: 'settings/reconfirmation/receipt',
  readOriginalSettingsSnapshot: 'settings/original/snapshot', readOriginalSettingsEvents: 'settings/original/events',
  readOriginalSettingsConfirmation: 'settings/original/confirmation',
  readOriginalSettingsResult: 'settings/original/result',
  readSettingsTaskPolicy: 'settings/task-policy/read', configureSettingsTaskPolicy: 'settings/task-policy/configure',
  readSettingsTaskPolicyOperation: 'settings/task-policy/operation',
  clearSettingsTaskPolicy: 'settings/task-policy/clear', startOriginalSettingsTask: 'settings/start-original',
  requestOriginalSettingsCancellation: 'settings/original/cancel', readOriginalSettingsCancellation: 'settings/original/cancel/receipt',
  settleUnstartedSettingsCancellation: 'settings/original/cancel/settle-unstarted',
  readOriginalSettingsCancellationSettlement: 'settings/original/cancel/settlement-receipt',
  decideSettingsProposal: 'settings/decision', readSettingsDecision: 'settings/decision-receipt', continueSettingsConfirmation: 'settings/continue',
  reconcileSettingsTask: 'settings/reconcile', cancelSettingsTask: 'settings/cancel'
} as const);

/** Original model observations reuse the same metadata/event wire contracts
 * as the task center. A list or event cursor is never execution authority. */
export const AI_SCENE_MODEL_OBSERVATION_HTTP_CONTRACTS = Object.freeze({
  readTaskPage: { request: 'AiTaskMetadataQueryDraft', response: 'AiTaskMetadataPageDraft', successStatus: 200 },
  readTaskEvents: { request: 'AiOriginalTaskEventsReadDraft', response: 'AiTaskEventsObservationDraft', successStatus: 200 },
  readModelResult: { request: 'AiSceneModelResultReadDraft', response: 'AiSceneModelResultObservationDraft', successStatus: 200 },
  readQuoteGoalCandidates: { request: 'AiSceneModelResultReadDraft', response: 'AiQuoteGoalProjectionDraft', successStatus: 200 },
  readTaskScene: { request: 'AiSceneModelTaskSceneDraft', response: 'AiTaskSceneObservationDraft', successStatus: 200 },
  reopenModelSource: { request: 'AiSceneModelSourceReadDraft', response: 'AiSceneModelSourceReadResponseDraft', successStatus: 200 },
  reopenOpeningModelSource: { request: 'AiSceneOpeningModelSourceReadDraft', response: 'AiSceneOpeningModelSourceReadResponseDraft', successStatus: 200 }
} as const);

/** Separate opt-in accounting host. No model/runner routes are registered,
 * and no transport action may select a tenant, actor or current model price. */
export const AI_ORIGINAL_TASK_ACCOUNTING_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/accounting`, method: 'POST',
  read: 'read', releaseUnsent: 'release-unsent', reconcile: 'reconcile', readOperation: 'operation'
} as const);

/** Opening diagnosis model actions reuse original-reference/run contracts.
 * Configuration writes and approvals remain on their existing independent host. */
export const AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/opening-model`, method: 'POST',
  start: 'start', recover: 'recover', reconcile: 'reconcile', takeover: 'takeover',
  requestCancel: 'cancel', readExecution: 'execution'
} as const);

/** Explicit original opening READ host, not model execution or production
 * activation. Inputs reuse the original request, takeover, cancellation and
 * result-reference drafts above; clients cannot choose a Task or tool. */
export const AI_OPENING_READ_TASK_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/opening-read`, method: 'POST',
  start: 'start', recover: 'recover', reconcile: 'reconcile', inspect: 'execution',
  takeover: 'takeover', readTakeoverReceipt: 'takeover/receipt', reopenSource: 'source',
  requestCancellationIntent: 'cancel/intent', readCancellationReceipt: 'cancel/receipt',
  settleUnstartedCancellation: 'cancel/settle-unstarted', readCancellationSettlementReceipt: 'cancel/settlement-receipt'
} as const);

/** Distinct server-opt-in fixed order read chain. Every operation resolves
 * the original task/run/result on the server; never a client-selected resultId. */
export const AI_SCENE_ORDER_READ_HTTP_DRAFT = Object.freeze({
  basePath: `${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/order-read`, method: 'POST',
  start: 'start', recover: 'recover', readOrderResult: 'order-result',
  readPreparation: 'preparation', resumePrepared: 'preparation/resume', readAnswer: 'answer',
  readModelResult: 'model-result', readTaskScene: 'scene', readNextSteps: 'next-steps',
  readTaskSnapshot: 'snapshot', reopenModelSource: 'source', requestCancel: 'cancel', takeover: 'takeover',
  readTakeoverReceipt: 'takeover/receipt', readCancellationReceipt: 'cancel/receipt',
  settleUnstartedCancellation: 'cancel/settle-unstarted', readCancellationSettlementReceipt: 'cancel/settlement-receipt'
} as const);
