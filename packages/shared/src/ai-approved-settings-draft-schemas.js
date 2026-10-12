"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_APPROVED_SETTINGS_DRAFT_SCHEMAS = void 0;
const ai_approved_settings_draft_1 = require("./ai-approved-settings-draft");
const ai_proposal_draft_1 = require("./ai-proposal-draft");
const ai_native_1 = require("./ai-native");
const id = (maxLength = 191) => ({ type: 'string', minLength: 1, maxLength, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' });
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const revision = { type: 'integer', minimum: 1, maximum: 4294967294 };
const time = { type: 'string', format: 'date-time' };
const literal = (value) => ({ const: value });
const object = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const draftVersion = literal(ai_approved_settings_draft_1.AI_APPROVED_SETTINGS_DRAFT_VERSION);
const base = { draftVersion, taskId: id(36), proposalId: id(36), proposalRevision: revision };
const reference = { ...base, reviewedPayloadHash: hash };
const stringArray = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 191 }, maxItems: 64, uniqueItems: true };
const channels = { type: 'array', items: { enum: ['sms', 'app_push', 'wechat', 'email'] }, minItems: 1, maxItems: 4, uniqueItems: true };
const snapshot = object({ recordId: id(36), revision: literal(1), contentHash: hash });
exports.AI_APPROVED_SETTINGS_DRAFT_SCHEMAS = {
    AiApprovedSettingsReferenceDraft: object(reference),
    AiApprovedSettingsPrepareDraft: object({ ...base, runId: id(36), stepId: id(36), changeId: id(36), changeHash: hash }),
    AiApprovedSettingsPreparationReceiptDraft: { oneOf: [object({ draftVersion, state: literal('prepared'), reference: ref('AiApprovedSettingsReferenceDraft') }),
            object({ draftVersion, state: literal('not_observed'), nextAction: literal('read_preparation_receipt') })] },
    AiApprovedSettingsDecisionDraft: object({ ...reference, decision: { enum: ['approve', 'reject'] } }),
    AiApprovedSettingsCommitDraft: object({ ...reference, operationKey: id(), approvalId: id(36) }),
    AiApprovedSettingsReadOperationDraft: object({ draftVersion, operationKey: id() }),
    AiApprovedSettingsPayloadDraft: object({ contractVersion: literal(ai_proposal_draft_1.AI_PROPOSAL_DRAFT_VERSION), proposalId: id(36), taskId: id(36), revision,
        audience: { enum: ['operator', 'staff'] }, scope: object({ kind: literal('workspace'), tenantId: id(), workspaceId: id() }),
        actions: { type: 'array', minItems: 1, maxItems: 1, items: object({ actionId: id(), toolCode: literal(ai_approved_settings_draft_1.AI_APPROVED_SETTINGS_TOOL_CODE),
                toolVersion: literal(ai_native_1.AI_TOOL_DRAFT_VERSION), input: snapshot, preview: snapshot,
                target: object({ resourceType: literal('configuration'), resourceId: id(), version: { type: 'string', pattern: '^[1-9][0-9]*$' } }) }) },
        atomicity: literal('single_action'), failurePolicy: literal('stop_and_reconcile'), expiresAt: time }),
    AiApprovedSettingsChangeReviewDraft: object({ changeId: id(36), changeHash: hash, baseRevision: revision, expiresAt: time,
        diff: object({ 'notifications.enabledEvents': object({ before: stringArray, after: stringArray }),
            'notifications.editableChannels': object({ before: channels, after: channels }) }) }),
    AiApprovedSettingsReviewDraft: object({ draftVersion, proposal: object({ payload: ref('AiApprovedSettingsPayloadDraft'), payloadHash: hash,
            status: { enum: ['pending_confirmation', 'confirmed', 'superseded', 'cancelled', 'expired'] } }), change: ref('AiApprovedSettingsChangeReviewDraft'), generatedText: { type: 'null' } }),
    AiApprovedSettingsOperationReceiptDraft: object({ receiptId: id(36), operationKey: id(), changeId: id(36), changeHash: hash,
        baseRevision: revision, resultRevision: { type: 'integer', minimum: 2, maximum: 4294967295 }, resultHash: hash, committedAt: time }),
    AiApprovedSettingsOperationResultDraft: { oneOf: [object({ draftVersion, state: literal('committed'), receipt: ref('AiApprovedSettingsOperationReceiptDraft'), cacheRefreshed: { type: 'boolean' } }),
            object({ draftVersion, state: literal('not_observed'), nextAction: literal('read_operation') })] },
    AiApprovedSettingsDecisionReceiptDraft: { oneOf: [object({ draftVersion, state: literal('recorded'), approval: ref('AiApprovalRecordDraft') }),
            object({ draftVersion, state: literal('not_observed'), nextAction: literal('read_decision_receipt') })] },
    AiApprovedSettingsErrorDraft: object({ draftVersion, code: { enum: ['AI_INVALID_INPUT', 'AI_ACCESS_DENIED', 'AI_REVISION_CONFLICT', 'AI_RESOURCE_UNAVAILABLE', 'AI_RESULT_UNKNOWN', 'SETTINGS_RESULT_UNKNOWN'] },
        retryable: literal(false), nextAction: { enum: ['read_preparation_receipt', 'read_decision_receipt', 'read_operation', 'revalidate_or_manual'] } })
};
//# sourceMappingURL=ai-approved-settings-draft-schemas.js.map