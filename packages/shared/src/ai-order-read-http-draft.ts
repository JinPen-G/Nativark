/** Public projections of the existing fixed model/order/answer chain. Original
 * readers own authority and recovery; model text is not a business receipt. */
import { AI_SCENE_REQUEST_DRAFT_VERSION, type AiSceneRequestReceiptDraft, type AiSceneRequestReadDraft } from './ai-scene-request-draft';
import type { AiConversationTurnObservationDraft } from './ai-conversation-draft';
import type { AiSceneOrderFactsObservationDraft, AiTaskSceneObservationDraft } from './ai-task-scene-observation-draft';
import type { AiOrderReadFactsDraft } from './ai-order-facts-draft';
import type { AiOrderNextCandidateDraft } from './ai-business-material-draft';
import { AI_CONTRACT_DRAFT_VERSION } from './ai-native';
import { AI_ORDER_FACTS_DRAFT_VERSION } from './ai-order-facts-draft';
import { RentalCoreOrderStatus } from './core';
import type { AiWorkspaceScope } from './ai-native';
import { AI_TASK_STATUSES_DRAFT, type AiTaskEventDraft, type AiTaskStatusDraft } from './ai-task-draft';
import { AI_TASK_RECOVERY_HTTP_SCHEMAS, type AiTaskRunnerOutcomeDraft, type AiModelCancellationTransitionReceiptDraft } from './ai-task-recovery-draft';
import { AI_TASK_SCENE_OBSERVATION_SCHEMAS } from './ai-task-scene-observation-draft-schemas';
import { AI_ORDER_FACTS_DRAFT_SCHEMAS } from './ai-order-facts-draft-schemas';
import { AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS } from './ai-business-material-draft-schemas';
import { AI_SCENE_REQUEST_DRAFT_SCHEMAS } from './ai-scene-request-draft-schemas';
import { AI_SCENE_MODEL_OBSERVATION_SCHEMAS } from './ai-scene-model-observation-draft-schemas';
import { AI_TASK_OBSERVATION_DRAFT_SCHEMAS } from './ai-task-observation-draft-schemas';
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafId as id, leafInt as integer,
  leafTime as time, leafList as list, leafText as text, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

type Original = Omit<AiSceneRequestReceiptDraft, 'sceneCode'> & { sceneCode: 'order_explanation' };
type AnswerFacts = Pick<AiOrderReadFactsDraft, 'audience' | 'scope' | 'order' | 'paymentEvidence' | 'historicalFeeEvidence'>;
export interface AiOrderReadPreparationResponseDraft {
  original: Original;
  preparation: { publishedInputs: number; requiredInputs: number; missing: Array<'model_request' | 'order_read' | 'model_answer'>;
    planPublished: boolean; execution: 'not_attested' };
  observation: 'revalidated_not_atomic'; automaticRetry: false;
}
export type AiOrderReadExecutionDraft =
  | { kind: 'not_started'; reason: 'host_aborted' | 'plan_unavailable' | 'task_not_runnable' | 'lease_held' | 'recovery_lease_unavailable' }
  | { kind: 'run_outcome'; outcome: AiTaskRunnerOutcomeDraft };
export type AiOrderReadStartResponseDraft = { outcome: { kind: 'not_started'; reason: 'host_aborted' } }
  | { original: Original; outcome: AiOrderReadExecutionDraft; businessExecution: 'readonly_not_business_commit' };
export type AiOrderReadRecoverResponseDraft = { original: Original; outcome: AiOrderReadExecutionDraft; automaticRetry: false };
export type AiOrderReadResumeResponseDraft = AiOrderReadRecoverResponseDraft & {
  preparation: 'original_inputs_only'; businessExecution: 'readonly_not_business_commit';
};
export type AiOrderReadTakeoverResponseDraft = {
  original: Original; automaticRetry: false; takeover: 'same_owner_recovery_only'; businessExecution: 'readonly_not_business_commit';
  outcome: { kind: 'not_started'; reason: 'host_aborted' } | { kind: 'run_outcome'; outcome: AiTaskRunnerOutcomeDraft;
    takeover: 'same_owner_recovery_only'; automaticRetry: false; businessExecution: 'readonly_not_business_commit' };
};
export type AiOrderReadAnswerResponseDraft = { original: Original; result:
  | { status: 'not_observed'; text: null; automaticRetry: false }
  | { resultId: string; status: 'unknown' | 'failed'; text: null; automaticRetry: false; businessExecution: 'readonly_not_business_commit' }
  | { resultId: string; status: 'stale'; text: null; automaticRetry: false; nextAction: 'new_explicit_request'; businessExecution: 'readonly_not_business_commit' }
  | { resultId: string; status: 'available'; text: string; originalReadResultId: string; facts: AnswerFacts; snapshotObservedAt: string;
      automaticRetry: false; textSemantics: 'model_text_not_core_fact'; businessExecution: 'readonly_not_business_commit' }
};
export interface AiOrderNextStepsResponseDraft {
  original: Original;
  next: { requestId: string; scope: AiWorkspaceScope; orderId: string; observedAt: string; status: 'candidates_only';
    allowedActions: 'unavailable'; candidates: AiOrderNextCandidateDraft[];
    manual: { kind: 'order_resource'; scope: AiWorkspaceScope; orderId: string; navigation: 'host_existing_order_route';
      authorization: 'destination_rechecks_permissions' };
    forbiddenAutomation: readonly ['refund', 'funds_disposition', 'exception_confirmation'] };
  execution: 'not_attempted'; approval: 'not_granted';
}
export type AiOrderReadSceneResponseDraft = Extract<AiTaskSceneObservationDraft, { kind: 'original' }> & {
  handoff: AiOrderNextStepsResponseDraft; answer?: AiOrderReadAnswerResponseDraft;
};
export type AiOrderReadCancellationObservationDraft = {
  taskId: string; expectedRevision: number; snapshot: { revision: number; cursor: string; status: AiTaskStatusDraft };
  cancellation: 'request_not_rollback' | 'task_cancelled_not_business_rollback'; remoteCancellation: 'not_attested';
  automaticRetry: false; admission: 'not_granted'; absenceSemantics: 'not_observed_is_not_proof_of_uncommitted';
} & ({ status: 'observed'; event: Extract<AiTaskEventDraft, { type: 'task.transition' }> }
  | { status: 'not_observed'; event: null });
export type AiOrderReadTakeoverReceiptDraft = {
  taskId: string; runId: string; admission: 'not_granted'; automaticRetry: false; consistency: 'revalidated_reads_not_atomic_snapshot';
  remoteCancellation: 'not_attested'; absenceSemantics: 'not_observed_is_not_proof_of_rollback';
} & ({ status: 'observed'; receiptId: string; recordedRunRevision: number; recordedFencingToken: string;
      currentGeneration: 'recorded_generation' | 'not_attested' }
  | { status: 'not_observed'; currentGeneration: 'not_attested' });
export type AiOrderReadCancelResponseDraft = { original: Original; receipt: AiModelCancellationTransitionReceiptDraft;
  cancellation: 'requested_not_rollback'; automaticRetry: false };
export type AiOrderReadSettlementResponseDraft = { original: Original; receipt: AiModelCancellationTransitionReceiptDraft;
  cancellation: 'unstarted_task_cancelled_not_business_rollback'; automaticRetry: false };
export type AiOrderReadCancelReceiptResponseDraft = { original: Original; receipt: AiOrderReadCancellationObservationDraft; automaticRetry: false };
export type AiOrderReadTakeoverReceiptResponseDraft = { original: Original; receipt: AiOrderReadTakeoverReceiptDraft; automaticRetry: false };
export type AiOrderReadSettlementReceiptResponseDraft = AiOrderReadCancelReceiptResponseDraft;
export type AiOrderReadFactsResponseDraft = Omit<AiSceneOrderFactsObservationDraft, 'original'> & { original: Original };
export type AiOrderReadModelResponseDraft = import('./ai-scene-model-observation-draft').AiSceneModelResultObservationDraft & { sceneCode: 'order_explanation' };
export type AiOrderReadSourceResponseDraft = Exclude<import('./ai-scene-model-observation-draft').AiSceneModelSourceReadResponseDraft,
  { sourceKind: 'knowledge' }> & { sourceIndex: 0 };
export type AiOrderReadSnapshotResponseDraft = import('./ai-task-draft').AiTaskSnapshotDraft & { sceneCode: 'order_explanation' };
export interface AiOrderReadHttpResponses {
  start: AiOrderReadStartResponseDraft; recover: AiOrderReadRecoverResponseDraft; resumePrepared: AiOrderReadResumeResponseDraft;
  readPreparation: AiOrderReadPreparationResponseDraft; readAnswer: AiOrderReadAnswerResponseDraft;
  readOrderResult: AiOrderReadFactsResponseDraft; readNextSteps: AiOrderNextStepsResponseDraft; readTaskScene: AiOrderReadSceneResponseDraft;
  readModelResult: AiOrderReadModelResponseDraft;
  reopenModelSource: AiOrderReadSourceResponseDraft;
  readTaskSnapshot: AiOrderReadSnapshotResponseDraft;
  takeover: AiOrderReadTakeoverResponseDraft; readTakeoverReceipt: AiOrderReadTakeoverReceiptResponseDraft;
  requestCancel: AiOrderReadCancelResponseDraft; readCancellationReceipt: AiOrderReadCancelReceiptResponseDraft;
  settleUnstartedCancellation: AiOrderReadSettlementResponseDraft; readCancellationSettlementReceipt: AiOrderReadSettlementReceiptResponseDraft;
}

const no: AiLeafSchemaDraft = { type: 'boolean', const: false }, nil: AiLeafSchemaDraft = { type: 'null' };
const original = { ...AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReceiptDraft,
  properties: { ...AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReceiptDraft.properties!, sceneCode: choice('order_explanation') } };
const execution = AI_TASK_RECOVERY_HTTP_SCHEMAS.AiSceneModelExecutionDraft.oneOf!;
const readonlyBusiness = choice('readonly_not_business_commit');
const answerFactProperties = AI_ORDER_FACTS_DRAFT_SCHEMAS.AiOrderReadFactsDraft.properties!;
const answerBase = { resultId: id(), automaticRetry: no, businessExecution: readonlyBusiness };
const wrapped = (properties: Record<string, AiLeafSchemaDraft>) => obj({ original, ...properties });
const cancellationReceipt = AI_TASK_RECOVERY_HTTP_SCHEMAS.AiSceneModelCancelResponseDraft.properties!.receipt;
const cancellationEvent = cancellationReceipt.properties!.event;
const cancellationTransition = (settled: boolean) => ({ ...cancellationReceipt,
  properties: { ...cancellationReceipt.properties!, event: { ...cancellationEvent,
    properties: { ...cancellationEvent.properties!, data: obj({ from: choice(...AI_TASK_STATUSES_DRAFT),
      to: choice(settled ? 'cancelled' : 'cancel_requested'), reason: choice(settled ? 'cancel_settled' : 'cancel_requested') }) } } } });
export const AI_ORDER_READ_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiOrderReadModelResponseDraft: { oneOf: AI_SCENE_MODEL_OBSERVATION_SCHEMAS.AiSceneModelResultObservationDraft.oneOf!
    .filter(branch => (branch.properties!.sceneCode.enum as readonly string[]).includes('order_explanation')) },
  AiOrderReadSourceResponseDraft: { ...AI_SCENE_MODEL_OBSERVATION_SCHEMAS.AiSceneModelSourceReadResponseDraft.oneOf![0],
    properties: { ...AI_SCENE_MODEL_OBSERVATION_SCHEMAS.AiSceneModelSourceReadResponseDraft.oneOf![0].properties!, sourceIndex: integer(0, 0) } },
  AiOrderReadSnapshotResponseDraft: { ...AI_TASK_OBSERVATION_DRAFT_SCHEMAS.AiTaskSnapshotDraft,
    properties: { ...AI_TASK_OBSERVATION_DRAFT_SCHEMAS.AiTaskSnapshotDraft.properties!, sceneCode: choice('order_explanation') } },
  AiOrderReadFactsResponseDraft: { ...AI_TASK_SCENE_OBSERVATION_SCHEMAS.AiSceneOrderFactsObservationDraft,
    properties: { ...AI_TASK_SCENE_OBSERVATION_SCHEMAS.AiSceneOrderFactsObservationDraft.properties!, original } },
  AiOrderReadExecutionDraft: { oneOf: [execution[0], execution[1]] },
  AiOrderReadStartResponseDraft: { oneOf: [obj({ outcome: obj({ kind: choice('not_started'), reason: choice('host_aborted') }) }),
    wrapped({ outcome: ref('AiOrderReadExecutionDraft'), businessExecution: readonlyBusiness })] },
  AiOrderReadRecoverResponseDraft: wrapped({ outcome: ref('AiOrderReadExecutionDraft'), automaticRetry: no }),
  AiOrderReadResumeResponseDraft: wrapped({ outcome: ref('AiOrderReadExecutionDraft'), automaticRetry: no,
    preparation: choice('original_inputs_only'), businessExecution: readonlyBusiness }),
  AiOrderReadTakeoverResponseDraft: wrapped({ outcome: { oneOf: [obj({ kind: choice('not_started'), reason: choice('host_aborted') }),
    obj({ kind: choice('run_outcome'), outcome: ref('AiTaskRunnerOutcomeDraft'), takeover: choice('same_owner_recovery_only'),
      automaticRetry: no, businessExecution: readonlyBusiness })] }, automaticRetry: no,
    takeover: choice('same_owner_recovery_only'), businessExecution: readonlyBusiness }),
  AiOrderReadPreparationResponseDraft: wrapped({ preparation: obj({ publishedInputs: integer(0, 3), requiredInputs: integer(2, 3),
    missing: { ...list(choice('model_request', 'order_read', 'model_answer'), 3), uniqueItems: true },
    planPublished: { type: 'boolean' }, execution: choice('not_attested') }), observation: choice('revalidated_not_atomic'), automaticRetry: no }),
  AiOrderReadAnswerResponseDraft: wrapped({ result: { oneOf: [obj({ status: choice('not_observed'), text: nil, automaticRetry: no }),
    obj({ ...answerBase, status: choice('unknown', 'failed'), text: nil }),
    obj({ ...answerBase, status: choice('stale'), text: nil, nextAction: choice('new_explicit_request') }),
    obj({ ...answerBase, status: choice('available'), text: text(131072, 0), originalReadResultId: id(), snapshotObservedAt: time,
      facts: obj(Object.fromEntries(['audience', 'scope', 'order', 'paymentEvidence', 'historicalFeeEvidence'].map(key => [key, answerFactProperties[key]]))),
      textSemantics: choice('model_text_not_core_fact') })] } }),
  AiOrderNextStepsResponseDraft: wrapped({ next: obj({ requestId: id(), scope: ref('AiWorkspaceScope'), orderId: id(), observedAt: time,
    status: choice('candidates_only'), allowedActions: choice('unavailable'),
    candidates: AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS.AiOrderExplanationMaterialDraft.properties!.payload.oneOf![0].properties!.handoff.properties!.candidates,
    manual: obj({ kind: choice('order_resource'), scope: ref('AiWorkspaceScope'), orderId: id(), navigation: choice('host_existing_order_route'),
      authorization: choice('destination_rechecks_permissions') }),
    forbiddenAutomation: { ...list(choice('refund', 'funds_disposition', 'exception_confirmation'), 3, 3), uniqueItems: true } }),
    execution: choice('not_attempted'), approval: choice('not_granted') }),
  AiOrderReadCancelResponseDraft: wrapped({ receipt: cancellationTransition(false), cancellation: choice('requested_not_rollback'), automaticRetry: no }),
  AiOrderReadSettlementResponseDraft: wrapped({ receipt: cancellationTransition(true), cancellation: choice('unstarted_task_cancelled_not_business_rollback'), automaticRetry: no }),
  AiOrderReadTakeoverReceiptResponseDraft: wrapped({ receipt: { oneOf: [
    ...['observed', 'not_observed'].map(status => obj({ taskId: id(), runId: id(), status: choice(status),
      ...(status === 'observed' ? { receiptId: id(), recordedRunRevision: integer(2, 4294967295),
        recordedFencingToken: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' } } : {}),
      currentGeneration: status === 'observed' ? choice('recorded_generation', 'not_attested') : choice('not_attested'),
      admission: choice('not_granted'), automaticRetry: no, consistency: choice('revalidated_reads_not_atomic_snapshot'),
      remoteCancellation: choice('not_attested'), absenceSemantics: choice('not_observed_is_not_proof_of_rollback') }))
  ] }, automaticRetry: no })
};
const cancelObservation = (settled: boolean) => wrapped({ receipt: { oneOf: ['observed', 'not_observed'].map(status => obj({
  taskId: id(), expectedRevision: integer(1, 4294967294), status: choice(status),
  event: status === 'observed' ? cancellationTransition(settled).properties.event : nil,
  snapshot: obj({ revision: integer(1, 4294967295), cursor: { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' }, status: choice(...AI_TASK_STATUSES_DRAFT) }),
  cancellation: choice(settled ? 'task_cancelled_not_business_rollback' : 'request_not_rollback'), remoteCancellation: choice('not_attested'),
  automaticRetry: no, admission: choice('not_granted'), absenceSemantics: choice('not_observed_is_not_proof_of_uncommitted')
})) }, automaticRetry: no });
AI_ORDER_READ_HTTP_SCHEMAS.AiOrderReadCancelReceiptResponseDraft = cancelObservation(false);
AI_ORDER_READ_HTTP_SCHEMAS.AiOrderReadSettlementReceiptResponseDraft = cancelObservation(true);
const originalScene = AI_TASK_SCENE_OBSERVATION_SCHEMAS.AiTaskSceneObservationDraft.oneOf![0];
AI_ORDER_READ_HTTP_SCHEMAS.AiOrderReadSceneResponseDraft = {
  ...originalScene, properties: { ...originalScene.properties!, handoff: ref('AiOrderNextStepsResponseDraft'), answer: ref('AiOrderReadAnswerResponseDraft') },
  required: [...originalScene.required!, 'handoff']
};

const orderClosed = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const orderId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const orderInteger = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const orderTime = (v: unknown) => {
  if (typeof v !== 'string' || v.length < 20 || v.length > 40 || !Number.isFinite(Date.parse(v))) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/iu.exec(v);
  if (!match || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return false;
  const date = new Date(0); date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
};
function orderOriginal(value: unknown, query: AiSceneRequestReadDraft, turn: AiConversationTurnObservationDraft): value is Original {
  if (!orderClosed(value, ['draftVersion', 'inputRef', 'revision', 'contentHash', 'sceneCode', 'sceneVersion', 'requestKey', 'previousInputRef', 'expiresAt', 'createdAt', 'state'])) return false;
  const uuid = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(v);
  return value.draftVersion === AI_SCENE_REQUEST_DRAFT_VERSION && value.draftVersion === query.draftVersion
    && value.inputRef === query.inputRef && uuid(value.inputRef) && orderInteger(value.revision, 1, 4294967294)
    && typeof value.contentHash === 'string' && /^[a-f0-9]{64}$/u.test(value.contentHash)
    && value.sceneCode === 'order_explanation' && value.sceneVersion === turn.capabilityVersion
    && value.requestKey === turn.originalRequestKey && orderId(value.requestKey) && (value.requestKey as string).length <= 128
    && (value.previousInputRef === null || uuid(value.previousInputRef)) && orderTime(value.expiresAt) && orderTime(value.createdAt)
    && ['stored', 'expired'].includes(value.state as string);
}
/** Closed original preparation only. Published input is not execution authority;
 * the host must separately recheck Task state and the original admission. */
export function validateAiOrderReadPreparationDraft(value: unknown, query: AiSceneRequestReadDraft, turn: AiConversationTurnObservationDraft): value is AiOrderReadPreparationResponseDraft {
  if (!orderClosed(value, ['original', 'preparation', 'observation', 'automaticRetry']) || !orderOriginal(value.original, query, turn)
    || value.observation !== 'revalidated_not_atomic' || value.automaticRetry !== false
    || !orderClosed(value.preparation, ['publishedInputs', 'requiredInputs', 'missing', 'planPublished', 'execution'])) return false;
  const p = value.preparation;
  if (!orderInteger(p.requiredInputs, 2, 3) || !orderInteger(p.publishedInputs, 0, p.requiredInputs as number)
    || !Array.isArray(p.missing) || typeof p.planPublished !== 'boolean' || p.execution !== 'not_attested') return false;
  const refs = ['model_request', 'order_read', ...(p.requiredInputs === 3 ? ['model_answer'] : [])];
  return JSON.stringify(p.missing) === JSON.stringify(refs.slice(p.publishedInputs as number)) && (!p.planPublished || !p.missing.length);
}
/** A valid acknowledgement never authorizes replay. Unknown outcome/absence is
 * distinct from rollback, and business completion cannot be inferred here. */
export function validateAiOrderReadStartDraft(value: unknown, query: AiSceneRequestReadDraft, turn: AiConversationTurnObservationDraft): value is AiOrderReadStartResponseDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const aborted = Object.keys(row).length === 1 && Object.hasOwn(row, 'outcome');
  if (!aborted && (!orderClosed(row, ['original', 'outcome', 'businessExecution']) || !orderOriginal(row.original, query, turn)
    || row.businessExecution !== 'readonly_not_business_commit')) return false;
  const outcome = row.outcome;
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) return false;
  const result = outcome as Record<string, unknown>;
  if (result.kind === 'not_started') return orderClosed(result, ['kind', 'reason'])
    && (aborted ? result.reason === 'host_aborted' : ['host_aborted', 'plan_unavailable', 'task_not_runnable', 'lease_held', 'recovery_lease_unavailable'].includes(result.reason as string));
  if (aborted || !orderClosed(result, ['kind', 'outcome']) || result.kind !== 'run_outcome') return false;
  const run = result.outcome;
  if (!run || typeof run !== 'object' || Array.isArray(run)) return false;
  const r = run as Record<string, unknown>, keys = ['status', 'completedSteps', 'cleanupFailed'];
  if (!orderInteger(r.completedSteps, 0, 4294967295) || !orderInteger(r.cleanupFailed, 0, 4294967295)) return false;
  if (r.status === 'failed') return orderClosed(r, [...keys, 'errorCode']) && orderId(r.errorCode);
  if (r.status === 'unavailable') return Object.keys(r).every(k => [...keys, 'stopReason', 'nextAction'].includes(k))
    && keys.every(k => k in r) && (r.stopReason === undefined || r.stopReason === 'input_limit_reached')
    && (r.nextAction === undefined || r.nextAction === 'manual_handoff');
  return orderClosed(r, keys) && ['succeeded', 'partially_succeeded', 'paused', 'cancel_requested', 'cancelled', 'unknown'].includes(r.status as string);
}

const orderScope = (v: unknown): v is AiWorkspaceScope => orderClosed(v, ['kind', 'tenantId', 'workspaceId'])
  && v.kind === 'workspace' && orderId(v.tenantId) && orderId(v.workspaceId);
const sameOrderScope = (a: AiWorkspaceScope, b: AiWorkspaceScope) => a.tenantId === b.tenantId && a.workspaceId === b.workspaceId;
function orderFactBody(v: unknown): v is AnswerFacts {
  if (!orderClosed(v, ['audience', 'scope', 'order', 'paymentEvidence', 'historicalFeeEvidence'])
    || v.audience !== 'operator' || !orderScope(v.scope) || v.paymentEvidence !== 'not_loaded' || v.historicalFeeEvidence !== 'not_loaded'
    || !orderClosed(v.order, ['id', 'orderNo', 'status', 'updatedAt', 'startAt', 'originalEndAt', 'effectiveEndAt', 'effectiveEndBasis', 'currency', 'amounts'])) return false;
  const o = v.order;
  return orderId(o.id) && typeof o.orderNo === 'string' && o.orderNo.length >= 1 && o.orderNo.length <= 191
    && Object.values(RentalCoreOrderStatus).includes(o.status as RentalCoreOrderStatus)
    && ['updatedAt', 'startAt', 'originalEndAt', 'effectiveEndAt'].every(k => orderTime(o[k]))
    && ['effectiveEndAt', 'endAt_fallback'].includes(o.effectiveEndBasis as string) && typeof o.currency === 'string' && /^[A-Z]{3}$/u.test(o.currency)
    && orderClosed(o.amounts, ['rental', 'service', 'discount', 'coupon', 'deposit', 'preAuthorization', 'finalPayable'])
    && Object.values(o.amounts).every(a => a === null || typeof a === 'number' && Number.isFinite(a) && a >= 0 && a <= Number.MAX_SAFE_INTEGER);
}
/** Closed original order facts, not a payment receipt or arbitrary scene body. */
export function validateAiOrderReadFactsDraft(v: unknown, query: AiSceneRequestReadDraft, turn: AiConversationTurnObservationDraft): v is AiOrderReadFactsResponseDraft {
  if (!turn.task || !orderClosed(v, ['original', 'taskId', 'runId', 'result']) || !orderOriginal(v.original, query, turn)
    || v.taskId !== turn.task.taskId || v.runId !== turn.task.runId || !v.result || typeof v.result !== 'object' || Array.isArray(v.result)) return false;
  const r = v.result as Record<string, unknown>;
  if (r.automaticRetry !== false || r.businessExecution !== 'readonly_not_business_commit') return false;
  if (!('taskId' in r)) return orderClosed(r, ['status', 'facts', 'automaticRetry', 'businessExecution'])
    && ['unknown', 'failed', 'candidate_not_executed'].includes(r.status as string) && r.facts === null;
  const base = ['taskId', 'runId', 'resultId', 'observedAt', 'automaticRetry', 'businessExecution', 'status', 'facts', 'nextAction'];
  if (r.taskId !== turn.task.taskId || r.runId !== turn.task.runId || !orderId(r.resultId) || !orderTime(r.observedAt)) return false;
  if (r.status !== 'available') return orderClosed(r, r.status === 'stale' ? [...base, 'modelText'] : base)
    && r.facts === null && (r.status === 'stale' ? r.nextAction === 'reread_current_facts' && r.modelText === 'not_used_as_business_evidence'
      : r.status === 'unknown' ? r.nextAction === 'reconcile_original_task' : r.status === 'failed' && r.nextAction === 'manual_review');
  if (!orderClosed(r, [...base, 'modelText']) || r.nextAction !== 'read_only' || r.modelText !== 'not_used_as_business_evidence'
    || !orderClosed(r.facts, ['draftVersion', 'contractVersion', 'requestId', 'audience', 'scope', 'observedAt', 'order', 'sources', 'paymentEvidence', 'historicalFeeEvidence'])) return false;
  const f = r.facts;
  if (f.draftVersion !== AI_ORDER_FACTS_DRAFT_VERSION || f.contractVersion !== AI_CONTRACT_DRAFT_VERSION || !orderId(f.requestId)
    || !orderTime(f.observedAt) || !orderFactBody({ audience: f.audience, scope: f.scope, order: f.order, paymentEvidence: f.paymentEvidence, historicalFeeEvidence: f.historicalFeeEvidence })
    || !Array.isArray(f.sources) || f.sources.length !== 1) return false;
  const s = f.sources[0];
  return orderClosed(s, ['scope', 'resourceType', 'resourceId', 'observedAt', 'basis']) && orderScope(s.scope)
    && sameOrderScope(s.scope, f.scope as AiWorkspaceScope) && s.resourceType === 'order'
    && s.resourceId === (f.order as AnswerFacts['order']).id && s.observedAt === f.observedAt
    && orderClosed(s.basis, ['kind']) && s.basis.kind === 'current';
}
/** Snapshot-bound answer text only; source facts remain a separately read result. */
export function validateAiOrderReadAnswerDraft(v: unknown, query: AiSceneRequestReadDraft, turn: AiConversationTurnObservationDraft): v is AiOrderReadAnswerResponseDraft {
  if (!orderClosed(v, ['original', 'result']) || !orderOriginal(v.original, query, turn) || !v.result || typeof v.result !== 'object' || Array.isArray(v.result)) return false;
  const r = v.result as Record<string, unknown>;
  if (r.automaticRetry !== false) return false;
  if (r.status === 'not_observed') return orderClosed(r, ['status', 'text', 'automaticRetry']) && r.text === null;
  const base = ['resultId', 'status', 'text', 'automaticRetry', 'businessExecution'];
  if (!orderId(r.resultId) || r.businessExecution !== 'readonly_not_business_commit') return false;
  if (r.status !== 'available') return orderClosed(r, r.status === 'stale' ? [...base, 'nextAction'] : base) && r.text === null
    && (r.status === 'stale' ? r.nextAction === 'new_explicit_request' : ['unknown', 'failed'].includes(r.status as string));
  return orderClosed(r, [...base, 'originalReadResultId', 'facts', 'snapshotObservedAt', 'textSemantics'])
    && typeof r.text === 'string' && new TextEncoder().encode(r.text).byteLength <= 131072
    && orderId(r.originalReadResultId) && orderTime(r.snapshotObservedAt) && orderFactBody(r.facts) && r.textSemantics === 'model_text_not_core_fact';
}

/** One operation registry for the explicit controller and OpenAPI. It does not
 * register routes or enable execution; request schemas preserve the old wire. */
export const AI_ORDER_READ_HTTP_CONTRACTS = Object.freeze({
  start: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadStartResponseDraft', write: true, unknownAction: 'read_execution' },
  recover: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadRecoverResponseDraft', write: true, unknownAction: 'read_execution' },
  resumePrepared: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadResumeResponseDraft', write: true, unknownAction: 'read_execution' },
  readPreparation: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadPreparationResponseDraft', write: false },
  readAnswer: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadAnswerResponseDraft', write: false },
  readOrderResult: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadFactsResponseDraft', write: false },
  readModelResult: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadModelResponseDraft', write: false },
  readTaskScene: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadSceneResponseDraft', write: false },
  readNextSteps: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderNextStepsResponseDraft', write: false },
  readTaskSnapshot: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadSnapshotResponseDraft', write: false },
  reopenModelSource: { request: 'AiSceneOrderReadReferenceDraft', response: 'AiOrderReadSourceResponseDraft', write: false },
  takeover: { request: 'AiSceneOrderReadTakeoverDraft', response: 'AiOrderReadTakeoverResponseDraft', write: true, unknownAction: 'read_takeover_receipt' },
  readTakeoverReceipt: { request: 'AiSceneOrderReadTakeoverDraft', response: 'AiOrderReadTakeoverReceiptResponseDraft', write: false, unknownAction: 'read_takeover_receipt' },
  requestCancel: { request: 'AiSceneOrderReadCancelDraft', response: 'AiOrderReadCancelResponseDraft', write: true, unknownAction: 'read_cancellation_receipt' },
  readCancellationReceipt: { request: 'AiSceneOrderReadCancelDraft', response: 'AiOrderReadCancelReceiptResponseDraft', write: false, unknownAction: 'read_cancellation_receipt' },
  settleUnstartedCancellation: { request: 'AiSceneOrderReadCancelDraft', response: 'AiOrderReadSettlementResponseDraft', write: true, unknownAction: 'read_cancellation_settlement_receipt' },
  readCancellationSettlementReceipt: { request: 'AiSceneOrderReadCancelDraft', response: 'AiOrderReadSettlementReceiptResponseDraft', write: false, unknownAction: 'read_cancellation_settlement_receipt' }
} as const);
