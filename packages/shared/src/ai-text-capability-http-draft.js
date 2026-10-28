"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_TEXT_CAPABILITY_HTTP_SCHEMAS = exports.AI_TEXT_CAPABILITY_HTTP_DRAFT = void 0;
const ai_gateway_draft_schemas_1 = require("./ai-gateway-draft-schemas");
/** Opt-in request contract. Publication does not enable the HTTP module. */
exports.AI_TEXT_CAPABILITY_HTTP_DRAFT = Object.freeze({
    basePath: 'ai-native/text-capability', method: 'POST',
    prepare: 'prepare', publish: 'original/publish', readOriginal: 'original/read',
    createTask: 'task/create', readTask: 'task/read', start: 'task/start', inspect: 'task/inspect',
    cancel: 'task/cancel', reconcile: 'task/reconcile', readCapabilityReceipt: 'receipt/read', preflight: 'preflight', readHistory: 'history/read',
});
const id = { ...(0, ai_gateway_draft_schemas_1.leafText)(128), pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const hash = { ...(0, ai_gateway_draft_schemas_1.leafText)(64, 64), pattern: '^[a-f0-9]{64}$' };
const bool = { type: 'boolean' }, no = { type: 'boolean', const: false };
const revision = (0, ai_gateway_draft_schemas_1.leafInt)(1, 4294967295), key = { requestKey: id };
const task = { taskId: id, runId: id, status: (0, ai_gateway_draft_schemas_1.leafText)(64), revision, replayed: bool };
const stored = { ...key, state: (0, ai_gateway_draft_schemas_1.leafEnum)('stored'), inputRef: id, inputHash: hash, retryable: no };
const run = { oneOf: [
        (0, ai_gateway_draft_schemas_1.leafClosed)({ ...key, kind: (0, ai_gateway_draft_schemas_1.leafEnum)('not_started'), reason: (0, ai_gateway_draft_schemas_1.leafText)(64), retryable: no, semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('task_outcome_not_capability_evidence') }),
        (0, ai_gateway_draft_schemas_1.leafClosed)({ ...key, kind: (0, ai_gateway_draft_schemas_1.leafEnum)('run_outcome'), outcome: (0, ai_gateway_draft_schemas_1.leafClosed)({ status: (0, ai_gateway_draft_schemas_1.leafText)(64), completedSteps: (0, ai_gateway_draft_schemas_1.leafInt)(0, 10000), cleanupFailed: (0, ai_gateway_draft_schemas_1.leafInt)(0, 10000) }),
            retryable: no, semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('task_outcome_not_capability_evidence') }),
    ] };
exports.AI_TEXT_CAPABILITY_HTTP_SCHEMAS = {
    AiTextCapabilityRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)(key),
    AiTextCapabilityCancelRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...key, expectedRevision: (0, ai_gateway_draft_schemas_1.leafInt)(1, 4294967294) }),
    AiTextCapabilityPrepareResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...key, state: (0, ai_gateway_draft_schemas_1.leafEnum)('prepared'), capability: (0, ai_gateway_draft_schemas_1.leafEnum)('text'), methodVersion: (0, ai_gateway_draft_schemas_1.leafText)(64),
        configurationRevision: (0, ai_gateway_draft_schemas_1.leafInt)(0, 4294967295), execution: (0, ai_gateway_draft_schemas_1.leafEnum)('not_started') }),
    AiTextCapabilityPublishResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...stored, replayed: bool }),
    AiTextCapabilityReadOriginalResponseDraft: { oneOf: [(0, ai_gateway_draft_schemas_1.leafClosed)(stored), (0, ai_gateway_draft_schemas_1.leafClosed)({ ...key, state: (0, ai_gateway_draft_schemas_1.leafEnum)('not_observed'), retryable: no })] },
    AiTextCapabilityCreateTaskResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...key, ...task, retryable: no }),
    AiTextCapabilityReadTaskResponseDraft: { oneOf: [(0, ai_gateway_draft_schemas_1.leafClosed)({ ...key, state: (0, ai_gateway_draft_schemas_1.leafEnum)('observed'), task: (0, ai_gateway_draft_schemas_1.leafClosed)(task), retryable: no }),
            (0, ai_gateway_draft_schemas_1.leafClosed)({ ...key, state: (0, ai_gateway_draft_schemas_1.leafEnum)('unknown', 'not_observed'), task: { type: 'null' }, retryable: no })] },
    AiTextCapabilityRunResponseDraft: run,
    AiTextCapabilityInspectResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...key,
        task: (0, ai_gateway_draft_schemas_1.leafClosed)({ taskId: id, revision, status: (0, ai_gateway_draft_schemas_1.leafText)(64), cancelRequestedAt: { oneOf: [ai_gateway_draft_schemas_1.leafTime, { type: 'null' }] } }),
        run: (0, ai_gateway_draft_schemas_1.leafClosed)({ runId: id, status: (0, ai_gateway_draft_schemas_1.leafText)(64) }), semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('task_outcome_not_capability_evidence') }),
    AiTextCapabilityCancelResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...key, status: (0, ai_gateway_draft_schemas_1.leafEnum)('cancel_requested'), revision, retryable: no }),
    AiTextCapabilityReceiptResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...key, capability: (0, ai_gateway_draft_schemas_1.leafEnum)('text'), status: (0, ai_gateway_draft_schemas_1.leafEnum)('supported', 'unsupported', 'unverified'),
        receiptId: id, evidenceHash: hash, reason: (0, ai_gateway_draft_schemas_1.leafText)(64), observation: { oneOf: [{ type: 'null' }, (0, ai_gateway_draft_schemas_1.leafClosed)({
                    methodVersion: (0, ai_gateway_draft_schemas_1.leafText)(64), mode: (0, ai_gateway_draft_schemas_1.leafEnum)('mock', 'live'), configurationRevision: (0, ai_gateway_draft_schemas_1.leafInt)(1, 4294967295), checkedAt: ai_gateway_draft_schemas_1.leafTime, expiresAt: ai_gateway_draft_schemas_1.leafTime
                })] },
        retryable: no, semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('original_receipt_not_task_outcome') }, ['requestKey', 'capability', 'status', 'observation', 'retryable', 'semantics']),
    AiTextCapabilityHistoryResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...key, state: (0, ai_gateway_draft_schemas_1.leafEnum)('historical', 'not_observed'), applicability: (0, ai_gateway_draft_schemas_1.leafEnum)('historical_only'),
        currentCapability: (0, ai_gateway_draft_schemas_1.leafEnum)('not_assessed'), retryable: no,
        original: { oneOf: [{ type: 'null' }, (0, ai_gateway_draft_schemas_1.leafClosed)({ expiresAt: ai_gateway_draft_schemas_1.leafTime, validity: (0, ai_gateway_draft_schemas_1.leafEnum)('expired', 'historical_only') })] },
        task: { oneOf: [{ type: 'null' }, (0, ai_gateway_draft_schemas_1.leafClosed)({ taskId: id, status: (0, ai_gateway_draft_schemas_1.leafText)(64), revision,
                    cancelRequestedAt: { oneOf: [ai_gateway_draft_schemas_1.leafTime, { type: 'null' }] } })] },
        run: { oneOf: [{ type: 'null' }, (0, ai_gateway_draft_schemas_1.leafClosed)({ runId: id, status: (0, ai_gateway_draft_schemas_1.leafText)(64) })] },
        resultObserved: bool, configurationRevision: { oneOf: [{ type: 'null' }, (0, ai_gateway_draft_schemas_1.leafInt)(1, 4294967295)] },
        observation: { oneOf: [{ type: 'null' }, (0, ai_gateway_draft_schemas_1.leafClosed)({ receiptId: id, methodVersion: (0, ai_gateway_draft_schemas_1.leafText)(64), mode: (0, ai_gateway_draft_schemas_1.leafEnum)('mock', 'live'),
                    checkedAt: ai_gateway_draft_schemas_1.leafTime, expiresAt: ai_gateway_draft_schemas_1.leafTime, validity: (0, ai_gateway_draft_schemas_1.leafEnum)('expired', 'historical_only'), matched: bool,
                    reportedUsage: { oneOf: [{ type: 'null' }, (0, ai_gateway_draft_schemas_1.leafClosed)({ inputTokens: (0, ai_gateway_draft_schemas_1.leafInt)(1, Number.MAX_SAFE_INTEGER), outputTokens: (0, ai_gateway_draft_schemas_1.leafInt)(1, Number.MAX_SAFE_INTEGER) })] } })] },
    }),
    AiTextCapabilityPreflightResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...key, capability: (0, ai_gateway_draft_schemas_1.leafEnum)('text'), allowed: bool, missing: bool, stale: bool,
        semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('current_preflight_not_dispatch_permission') }),
    AiTextCapabilityHttpErrorDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ code: (0, ai_gateway_draft_schemas_1.leafEnum)('AI_INVALID_INPUT', 'AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED', 'AI_RESOURCE_UNAVAILABLE', 'AI_REVISION_CONFLICT', 'AI_STORAGE_UNAVAILABLE', 'AI_RESULT_UNKNOWN'), retryable: no,
        nextAction: (0, ai_gateway_draft_schemas_1.leafEnum)('readOriginal', 'readTask', 'inspect', 'reconcile', 'readCapabilityReceipt', 'readHistory') }, ['code', 'retryable']),
};
//# sourceMappingURL=ai-text-capability-http-draft.js.map