import { leafClosed as obj, leafEnum as choice, leafInt as int, leafText as text,
  leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
import type { AiTaskBudgetUsageRecordDraft } from './ai-scene-request-draft';

/** Opt-in request contract. Publication does not enable the HTTP module. */
export const AI_TEXT_CAPABILITY_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/text-capability', method: 'POST',
  prepare: 'prepare', publish: 'original/publish', readOriginal: 'original/read',
  createTask: 'task/create', readTask: 'task/read', start: 'task/start', inspect: 'task/inspect',
  configureTaskAction: 'task/action/configure', readTaskAction: 'task/action/read',
  readTaskActionReceipt: 'task/action/receipt',
  cancel: 'task/cancel', reconcile: 'task/reconcile', readCapabilityReceipt: 'receipt/read', preflight: 'preflight', readHistory: 'history/read',
  readAccounting: 'accounting/read', releaseUnsent: 'accounting/release-unsent', reconcileAccounting: 'accounting/reconcile',
  readAccountingOperation: 'accounting/operation',
});
/** Independent SaaS/platform host, not tenant-management authority. The receipt
 * endpoint reconciles persisted capability evidence; history is read-only. */
export const AI_PLATFORM_CAPABILITY_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/platform-capability', method: 'POST',
  publish: 'original/publish', readOriginal: 'original/read', createTask: 'task/create', readTask: 'task/read',
  start: 'start', inspect: 'inspect', cancel: 'cancel', reconcile: 'reconcile',
  readCapabilityReceipt: 'receipt', readHistory: 'history', readAccounting: 'accounting/read',
  readAccountingOperation: 'accounting/operation', releaseUnsent: 'accounting/release-unsent', reconcileAccounting: 'accounting/reconcile'
});
export type AiTextCapabilityRequestDraft = { requestKey: string };
/** Selection is constrained by the server whitelist and current management
 * authorization; this field cannot select a provider or confer capability. */
export type AiTextCapabilityPrepareRequestDraft = AiTextCapabilityRequestDraft & {
  capability?: 'text' | 'streaming' | 'vision' | 'audio' | 'structured_output' | 'tools';
};
export type AiTextCapabilityCancelRequestDraft = AiTextCapabilityRequestDraft & { expectedRevision: number };
export type AiTextCapabilityActionRequestDraft = AiTextCapabilityRequestDraft & { operation: string };
export type AiTextCapabilityConfigureActionDraft = AiTextCapabilityActionRequestDraft & { expectedRevision: number | null };
/** Original request determines the call; no caller reservation, amount, usage
 * or dispatch evidence. Closing an old ledger grants no new execution. */
export type AiTextCapabilityAccountingResponseDraft = AiTextCapabilityRequestDraft & {
  taskId: string; record: AiTaskBudgetUsageRecordDraft; accounting: 'observed' | 'original_operation_only';
  execution: 'not_invoked'; automaticRetry: false; businessExecution: 'not_inferred_from_usage'; admission: 'not_granted';
};
/** Original recovery event only, never today's balance or permission to replay. */
export type AiTextCapabilityAccountingOperationRequestDraft = AiTextCapabilityRequestDraft & {
  operation: 'releaseUnsent' | 'reconcileAccounting';
};
export type AiTextCapabilityAccountingOperationResponseDraft = AiTextCapabilityAccountingOperationRequestDraft & {
  taskId: string; callId: string; reservationId: string; status: 'observed' | 'not_observed';
  execution: 'read_only_no_dispatch_or_release'; automaticRetry: false;
  semantics: 'original_accounting_operation_not_current_balance';
};
type ActionPolicy = { taskId: string; operation: string; revision: number; requiredPermissions: readonly string[]; expiresAt: string };
type Task = { taskId: string; runId: string; status: string; revision: number; replayed: boolean };
type Run = { kind: 'not_started'; reason: string } | { kind: 'run_outcome'; outcome: {
  status: string; completedSteps: number; cleanupFailed: number;
} };
type RunResponse = AiTextCapabilityRequestDraft & Run & { retryable: false; semantics: 'task_outcome_not_capability_evidence' };
export type AiTextCapabilityHttpResponsesDraft = {
  readAccountingOperation: AiTextCapabilityAccountingOperationResponseDraft;
  readAccounting: AiTextCapabilityAccountingResponseDraft;
  releaseUnsent: AiTextCapabilityAccountingResponseDraft;
  reconcileAccounting: AiTextCapabilityAccountingResponseDraft;
  configureTaskAction: AiTextCapabilityRequestDraft & { state: 'configured'; policy: ActionPolicy; retryable: false;
    semantics: 'action_policy_not_dispatch_or_business_approval' };
  readTaskAction: AiTextCapabilityRequestDraft & { state: 'observed' | 'not_observed'; policy: ActionPolicy | null; retryable: false;
    semantics: 'action_policy_not_dispatch_or_business_approval' };
  readTaskActionReceipt: AiTextCapabilityConfigureActionDraft & { state: 'recorded' | 'not_observed'; policy: ActionPolicy | null;
    retryable: false; semantics: 'original_action_policy_save_not_current_permission' };
  prepare: AiTextCapabilityRequestDraft & { state: 'prepared'; capability: 'text' | 'streaming' | 'vision' | 'audio' | 'structured_output' | 'tools'; methodVersion: string;
    configurationRevision: number; execution: 'not_started' };
  publish: AiTextCapabilityRequestDraft & { state: 'stored'; inputRef: string; inputHash: string; replayed: boolean; retryable: false };
  readOriginal: AiTextCapabilityRequestDraft & ({ state: 'stored'; inputRef: string; inputHash: string; retryable: false }
    | { state: 'not_observed'; retryable: false });
  createTask: AiTextCapabilityRequestDraft & Task & { retryable: false };
  readTask: AiTextCapabilityRequestDraft & { state: 'observed'; task: Task; retryable: false }
    | AiTextCapabilityRequestDraft & { state: 'unknown' | 'not_observed'; task: null; retryable: false };
  start: RunResponse;
  inspect: AiTextCapabilityRequestDraft & { task: { taskId: string; revision: number; status: string; cancelRequestedAt: string | null };
    run: { runId: string; status: string }; semantics: 'task_outcome_not_capability_evidence' };
  cancel: AiTextCapabilityRequestDraft & { status: 'cancel_requested'; revision: number; retryable: false };
  reconcile: RunResponse;
  readCapabilityReceipt: AiTextCapabilityRequestDraft & { capability: 'text' | 'streaming' | 'vision' | 'audio' | 'structured_output' | 'tools'; status: 'supported' | 'unsupported' | 'unverified';
    receiptId?: string; evidenceHash?: string; reason?: string; observation: null | { methodVersion: string; mode: 'mock' | 'live';
      configurationRevision: number; checkedAt: string; expiresAt: string };
    retryable: false; semantics: 'original_receipt_not_task_outcome' };
  readHistory: AiTextCapabilityRequestDraft & {
    state: 'historical' | 'not_observed'; applicability: 'historical_only'; currentCapability: 'not_assessed'; retryable: false;
    original: null | { expiresAt: string; validity: 'expired' | 'historical_only' };
    task: null | { taskId: string; status: string; revision: number; cancelRequestedAt: string | null };
    run: null | { runId: string; status: string }; resultObserved: boolean; configurationRevision: number | null;
    /** A stored observation/usage is neither settlement proof nor current support. */
    observation: null | { receiptId: string; methodVersion: string; mode: 'mock' | 'live'; checkedAt: string; expiresAt: string;
      validity: 'expired' | 'historical_only'; matched: boolean; reportedUsage: null | { inputTokens: number; outputTokens: number } };
  };
  preflight: AiTextCapabilityRequestDraft & { capability: 'text' | 'streaming' | 'vision' | 'audio' | 'structured_output' | 'tools'; allowed: boolean; missing: boolean; stale: boolean;
    semantics: 'current_preflight_not_dispatch_permission' };
};
export type AiTextCapabilityHttpErrorDraft = {
  code: 'AI_INVALID_INPUT' | 'AI_ACCESS_DENIED' | 'AI_SCOPE_CHANGED' | 'AI_RESOURCE_UNAVAILABLE'
    | 'AI_REVISION_CONFLICT' | 'AI_STORAGE_UNAVAILABLE' | 'AI_RESULT_UNKNOWN';
  retryable: false; nextAction?: 'readOriginal' | 'readTask' | 'readTaskAction' | 'readTaskActionReceipt' | 'inspect' | 'reconcile' | 'readCapabilityReceipt' | 'readHistory' | 'readAccounting' | 'readAccountingOperation';
};
const id: AiLeafSchemaDraft = { ...text(128), pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const hash: AiLeafSchemaDraft = { ...text(64, 64), pattern: '^[a-f0-9]{64}$' };
const bool: AiLeafSchemaDraft = { type: 'boolean' }, no: AiLeafSchemaDraft = { type: 'boolean', const: false };
const revision = int(1, 4294967295), key = { requestKey: id };
const task = { taskId: id, runId: id, status: text(64), revision, replayed: bool };
const stored = { ...key, state: choice('stored'), inputRef: id, inputHash: hash, retryable: no };
const actionPolicy = obj({ taskId: id, operation: text(64), revision,
  requiredPermissions: { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: text(191) }, expiresAt: time });
const run = { oneOf: [
  obj({ ...key, kind: choice('not_started'), reason: text(64), retryable: no, semantics: choice('task_outcome_not_capability_evidence') }),
  obj({ ...key, kind: choice('run_outcome'), outcome: obj({ status: text(64), completedSteps: int(0, 10000), cleanupFailed: int(0, 10000) }),
    retryable: no, semantics: choice('task_outcome_not_capability_evidence') }),
] } satisfies AiLeafSchemaDraft;
export const AI_TEXT_CAPABILITY_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiTextCapabilityAccountingOperationRequestDraft: obj({ ...key, operation: choice('releaseUnsent', 'reconcileAccounting') }),
  AiTextCapabilityAccountingOperationResponseDraft: obj({ ...key, operation: choice('releaseUnsent', 'reconcileAccounting'),
    taskId: id, callId: id, reservationId: id, status: choice('observed', 'not_observed'),
    execution: choice('read_only_no_dispatch_or_release'), automaticRetry: no,
    semantics: choice('original_accounting_operation_not_current_balance') }),
  AiTextCapabilityAccountingResponseDraft: obj({ ...key, taskId: id,
    record: { $ref: '#/components/schemas/AiTaskBudgetUsageRecordDraft' }, accounting: choice('observed', 'original_operation_only'),
    execution: choice('not_invoked'), automaticRetry: no, businessExecution: choice('not_inferred_from_usage'), admission: choice('not_granted') }),
  AiTextCapabilityRequestDraft: obj(key),
  AiTextCapabilityActionRequestDraft: obj({ ...key, operation: text(64) }),
  AiTextCapabilityConfigureActionDraft: obj({ ...key, operation: text(64), expectedRevision: {
    oneOf: [int(1, 4294967293), { type: 'null' }] } }),
  AiTextCapabilityConfigureActionResponseDraft: obj({ ...key, state: choice('configured'), policy: actionPolicy,
    retryable: no, semantics: choice('action_policy_not_dispatch_or_business_approval') }),
  AiTextCapabilityReadActionResponseDraft: obj({ ...key, state: choice('observed', 'not_observed'),
    policy: { oneOf: [actionPolicy, { type: 'null' }] }, retryable: no,
    semantics: choice('action_policy_not_dispatch_or_business_approval') }),
  AiTextCapabilityActionReceiptResponseDraft: obj({ ...key, operation: text(64), expectedRevision: {
    oneOf: [int(1, 4294967293), { type: 'null' }] }, state: choice('recorded', 'not_observed'),
    policy: { oneOf: [actionPolicy, { type: 'null' }] }, retryable: no,
    semantics: choice('original_action_policy_save_not_current_permission') }),
  AiTextCapabilityPrepareRequestDraft: obj({ ...key, capability: choice('text', 'streaming', 'vision', 'audio', 'structured_output', 'tools') }, ['requestKey']),
  AiTextCapabilityCancelRequestDraft: obj({ ...key, expectedRevision: int(1, 4294967294) }),
  AiTextCapabilityPrepareResponseDraft: obj({ ...key, state: choice('prepared'), capability: choice('text', 'streaming', 'vision', 'audio', 'structured_output', 'tools'), methodVersion: text(64),
    configurationRevision: int(0, 4294967295), execution: choice('not_started') }),
  AiTextCapabilityPublishResponseDraft: obj({ ...stored, replayed: bool }),
  AiTextCapabilityReadOriginalResponseDraft: { oneOf: [obj(stored), obj({ ...key, state: choice('not_observed'), retryable: no })] },
  AiTextCapabilityCreateTaskResponseDraft: obj({ ...key, ...task, retryable: no }),
  AiTextCapabilityReadTaskResponseDraft: { oneOf: [obj({ ...key, state: choice('observed'), task: obj(task), retryable: no }),
    obj({ ...key, state: choice('unknown', 'not_observed'), task: { type: 'null' }, retryable: no })] },
  AiTextCapabilityRunResponseDraft: run,
  AiTextCapabilityInspectResponseDraft: obj({ ...key,
    task: obj({ taskId: id, revision, status: text(64), cancelRequestedAt: { oneOf: [time, { type: 'null' }] } }),
    run: obj({ runId: id, status: text(64) }), semantics: choice('task_outcome_not_capability_evidence') }),
  AiTextCapabilityCancelResponseDraft: obj({ ...key, status: choice('cancel_requested'), revision, retryable: no }),
  AiTextCapabilityReceiptResponseDraft: obj({ ...key, capability: choice('text', 'streaming', 'vision', 'audio', 'structured_output', 'tools'), status: choice('supported', 'unsupported', 'unverified'),
    receiptId: id, evidenceHash: hash, reason: text(64), observation: { oneOf: [{ type: 'null' }, obj({
      methodVersion: text(64), mode: choice('mock', 'live'), configurationRevision: int(1, 4294967295), checkedAt: time, expiresAt: time })] },
    retryable: no, semantics: choice('original_receipt_not_task_outcome') },
  ['requestKey', 'capability', 'status', 'observation', 'retryable', 'semantics']),
  AiTextCapabilityHistoryResponseDraft: obj({ ...key, state: choice('historical', 'not_observed'), applicability: choice('historical_only'),
    currentCapability: choice('not_assessed'), retryable: no,
    original: { oneOf: [{ type: 'null' }, obj({ expiresAt: time, validity: choice('expired', 'historical_only') })] },
    task: { oneOf: [{ type: 'null' }, obj({ taskId: id, status: text(64), revision,
      cancelRequestedAt: { oneOf: [time, { type: 'null' }] } })] },
    run: { oneOf: [{ type: 'null' }, obj({ runId: id, status: text(64) })] },
    resultObserved: bool, configurationRevision: { oneOf: [{ type: 'null' }, int(1, 4294967295)] },
    observation: { oneOf: [{ type: 'null' }, obj({ receiptId: id, methodVersion: text(64), mode: choice('mock', 'live'),
      checkedAt: time, expiresAt: time, validity: choice('expired', 'historical_only'), matched: bool,
      reportedUsage: { oneOf: [{ type: 'null' }, obj({ inputTokens: int(0, Number.MAX_SAFE_INTEGER), outputTokens: int(0, Number.MAX_SAFE_INTEGER) })] } })] },
  }),
  AiTextCapabilityPreflightResponseDraft: obj({ ...key, capability: choice('text', 'streaming', 'vision', 'audio', 'structured_output', 'tools'), allowed: bool, missing: bool, stale: bool,
    semantics: choice('current_preflight_not_dispatch_permission') }),
  AiTextCapabilityHttpErrorDraft: obj({ code: choice('AI_INVALID_INPUT', 'AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED', 'AI_RESOURCE_UNAVAILABLE',
    'AI_REVISION_CONFLICT', 'AI_STORAGE_UNAVAILABLE', 'AI_RESULT_UNKNOWN'), retryable: no,
    nextAction: choice('readOriginal', 'readTask', 'readTaskAction', 'readTaskActionReceipt', 'inspect', 'reconcile', 'readCapabilityReceipt', 'readHistory', 'readAccounting', 'readAccountingOperation') }, ['code', 'retryable']),
};
