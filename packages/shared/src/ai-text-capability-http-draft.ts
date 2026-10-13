import { leafClosed as obj, leafEnum as choice, leafInt as int, leafText as text,
  leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

/** Opt-in request contract. Publication does not enable the HTTP module. */
export const AI_TEXT_CAPABILITY_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/text-capability', method: 'POST',
  prepare: 'prepare', publish: 'original/publish', readOriginal: 'original/read',
  createTask: 'task/create', readTask: 'task/read', start: 'task/start', inspect: 'task/inspect',
  cancel: 'task/cancel', reconcile: 'task/reconcile', readCapabilityReceipt: 'receipt/read', preflight: 'preflight', readHistory: 'history/read',
});
export type AiTextCapabilityRequestDraft = { requestKey: string };
export type AiTextCapabilityCancelRequestDraft = AiTextCapabilityRequestDraft & { expectedRevision: number };
type Task = { taskId: string; runId: string; status: string; revision: number; replayed: boolean };
type Run = { kind: 'not_started'; reason: string } | { kind: 'run_outcome'; outcome: {
  status: string; completedSteps: number; cleanupFailed: number;
} };
type RunResponse = AiTextCapabilityRequestDraft & Run & { retryable: false; semantics: 'task_outcome_not_capability_evidence' };
export type AiTextCapabilityHttpResponsesDraft = {
  prepare: AiTextCapabilityRequestDraft & { state: 'prepared'; capability: 'text' | 'streaming' | 'vision' | 'structured_output' | 'tools'; methodVersion: string;
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
  readCapabilityReceipt: AiTextCapabilityRequestDraft & { capability: 'text' | 'streaming' | 'vision' | 'structured_output' | 'tools'; status: 'supported' | 'unsupported' | 'unverified';
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
  preflight: AiTextCapabilityRequestDraft & { capability: 'text' | 'streaming' | 'vision' | 'structured_output' | 'tools'; allowed: boolean; missing: boolean; stale: boolean;
    semantics: 'current_preflight_not_dispatch_permission' };
};
export type AiTextCapabilityHttpErrorDraft = {
  code: 'AI_INVALID_INPUT' | 'AI_ACCESS_DENIED' | 'AI_SCOPE_CHANGED' | 'AI_RESOURCE_UNAVAILABLE'
    | 'AI_REVISION_CONFLICT' | 'AI_STORAGE_UNAVAILABLE' | 'AI_RESULT_UNKNOWN';
  retryable: false; nextAction?: 'readOriginal' | 'readTask' | 'inspect' | 'reconcile' | 'readCapabilityReceipt' | 'readHistory';
};
const id: AiLeafSchemaDraft = { ...text(128), pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const hash: AiLeafSchemaDraft = { ...text(64, 64), pattern: '^[a-f0-9]{64}$' };
const bool: AiLeafSchemaDraft = { type: 'boolean' }, no: AiLeafSchemaDraft = { type: 'boolean', const: false };
const revision = int(1, 4294967295), key = { requestKey: id };
const task = { taskId: id, runId: id, status: text(64), revision, replayed: bool };
const stored = { ...key, state: choice('stored'), inputRef: id, inputHash: hash, retryable: no };
const run = { oneOf: [
  obj({ ...key, kind: choice('not_started'), reason: text(64), retryable: no, semantics: choice('task_outcome_not_capability_evidence') }),
  obj({ ...key, kind: choice('run_outcome'), outcome: obj({ status: text(64), completedSteps: int(0, 10000), cleanupFailed: int(0, 10000) }),
    retryable: no, semantics: choice('task_outcome_not_capability_evidence') }),
] } satisfies AiLeafSchemaDraft;
export const AI_TEXT_CAPABILITY_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiTextCapabilityRequestDraft: obj(key),
  AiTextCapabilityCancelRequestDraft: obj({ ...key, expectedRevision: int(1, 4294967294) }),
  AiTextCapabilityPrepareResponseDraft: obj({ ...key, state: choice('prepared'), capability: choice('text', 'streaming', 'vision', 'structured_output', 'tools'), methodVersion: text(64),
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
  AiTextCapabilityReceiptResponseDraft: obj({ ...key, capability: choice('text', 'streaming', 'vision', 'structured_output', 'tools'), status: choice('supported', 'unsupported', 'unverified'),
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
      reportedUsage: { oneOf: [{ type: 'null' }, obj({ inputTokens: int(1, Number.MAX_SAFE_INTEGER), outputTokens: int(1, Number.MAX_SAFE_INTEGER) })] } })] },
  }),
  AiTextCapabilityPreflightResponseDraft: obj({ ...key, capability: choice('text', 'streaming', 'vision', 'structured_output', 'tools'), allowed: bool, missing: bool, stale: bool,
    semantics: choice('current_preflight_not_dispatch_permission') }),
  AiTextCapabilityHttpErrorDraft: obj({ code: choice('AI_INVALID_INPUT', 'AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED', 'AI_RESOURCE_UNAVAILABLE',
    'AI_REVISION_CONFLICT', 'AI_STORAGE_UNAVAILABLE', 'AI_RESULT_UNKNOWN'), retryable: no,
    nextAction: choice('readOriginal', 'readTask', 'inspect', 'reconcile', 'readCapabilityReceipt', 'readHistory') }, ['code', 'retryable']),
};
