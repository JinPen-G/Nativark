"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_KNOWLEDGE_POLICY_MANAGEMENT_HTTP_SCHEMAS = exports.AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION = void 0;
const ai_gateway_draft_schemas_1 = require("./ai-gateway-draft-schemas");
exports.AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION = 'knowledge-policy-management-1';
const id = { ...(0, ai_gateway_draft_schemas_1.leafText)(128), pattern: '^[A-Za-z0-9_-]+$' };
const uuid = { type: 'string', format: 'uuid' };
const hash = { ...(0, ai_gateway_draft_schemas_1.leafText)(64, 64), pattern: '^[a-f0-9]{64}$' };
const revision = (0, ai_gateway_draft_schemas_1.leafInt)(1, 4294967294), no = { type: 'boolean', const: false };
const permissions = { ...(0, ai_gateway_draft_schemas_1.leafList)({ ...(0, ai_gateway_draft_schemas_1.leafText)(191), pattern: '^[A-Za-z0-9][A-Za-z0-9:._-]{0,190}$' }, 64, 1), uniqueItems: true };
const snapshot = (0, ai_gateway_draft_schemas_1.leafClosed)({ revision, enabled: { type: 'boolean' }, requiredPermissions: permissions, expiresAt: ai_gateway_draft_schemas_1.leafTime });
const change = (0, ai_gateway_draft_schemas_1.leafClosed)({ version: (0, ai_gateway_draft_schemas_1.leafEnum)(exports.AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION), authorityId: uuid, operationKey: id,
    expectedRevision: (0, ai_gateway_draft_schemas_1.leafInt)(0, 4294967293), action: (0, ai_gateway_draft_schemas_1.leafEnum)('create_disabled', 'update_disabled', 'enable', 'disable'),
    requiredPermissions: permissions, expiresAt: ai_gateway_draft_schemas_1.leafTime });
const head = (0, ai_gateway_draft_schemas_1.leafClosed)({ documentId: id, revision: (0, ai_gateway_draft_schemas_1.leafInt)(1, 4294967293), documentVersion: id, attachmentId: id, aclRevision: revision });
const target = { oneOf: [
        (0, ai_gateway_draft_schemas_1.leafClosed)({ version: (0, ai_gateway_draft_schemas_1.leafEnum)('knowledge-successor-target-1'), action: (0, ai_gateway_draft_schemas_1.leafEnum)('revise'), operationId: id, from: head,
            to: (0, ai_gateway_draft_schemas_1.leafClosed)({ documentVersion: id, attachmentId: id, uploadSessionId: id, title: (0, ai_gateway_draft_schemas_1.leafText)(256), validFrom: ai_gateway_draft_schemas_1.leafTime, validUntil: ai_gateway_draft_schemas_1.leafTime }, ['documentVersion', 'attachmentId', 'uploadSessionId', 'title', 'validFrom']), expiresAt: ai_gateway_draft_schemas_1.leafTime }),
        (0, ai_gateway_draft_schemas_1.leafClosed)({ version: (0, ai_gateway_draft_schemas_1.leafEnum)('knowledge-deletion-target-1'), action: (0, ai_gateway_draft_schemas_1.leafEnum)('delete'), operationId: id, receiptOperationId: id, from: head, expiresAt: ai_gateway_draft_schemas_1.leafTime }),
    ] };
const semantics = (0, ai_gateway_draft_schemas_1.leafEnum)('target_review_not_execution_permission');
const lifecycle = { oneOf: [(0, ai_gateway_draft_schemas_1.leafClosed)({ state: (0, ai_gateway_draft_schemas_1.leafEnum)('current'), target, semantics }),
        (0, ai_gateway_draft_schemas_1.leafClosed)({ state: (0, ai_gateway_draft_schemas_1.leafEnum)('unavailable', 'not_applicable'), semantics })] };
const unavailableLifecycle = (0, ai_gateway_draft_schemas_1.leafClosed)({ state: (0, ai_gateway_draft_schemas_1.leafEnum)('unavailable'), semantics });
const preparationFields = { preparationId: uuid, operationKey: id, changeHash: hash, policyKeyHash: hash,
    before: { oneOf: [snapshot, { type: 'null' }] }, proposal: change, expiresAt: ai_gateway_draft_schemas_1.leafTime, executionPermission: no };
const preparation = { oneOf: [
        (0, ai_gateway_draft_schemas_1.leafClosed)({ state: (0, ai_gateway_draft_schemas_1.leafEnum)('prepared'), ...preparationFields, lifecycle }),
        (0, ai_gateway_draft_schemas_1.leafClosed)({ state: (0, ai_gateway_draft_schemas_1.leafEnum)('expired', 'stale'), ...preparationFields, lifecycle: unavailableLifecycle }),
    ] };
const receipt = (0, ai_gateway_draft_schemas_1.leafClosed)({ state: (0, ai_gateway_draft_schemas_1.leafEnum)('observed'), operationKey: id, preparationId: uuid, changeHash: hash, policyKeyHash: hash,
    result: snapshot, recordedAt: ai_gateway_draft_schemas_1.leafTime, retryable: no, executionPermission: no, lifecycle });
const unknown = (0, ai_gateway_draft_schemas_1.leafClosed)({ state: (0, ai_gateway_draft_schemas_1.leafEnum)('unknown', 'not_observed'), operationKey: id, changeHash: hash, retryable: no,
    nextAction: (0, ai_gateway_draft_schemas_1.leafEnum)('read_preparation', 'read_operation'), executionPermission: no }, ['state', 'operationKey', 'retryable', 'nextAction', 'executionPermission']);
exports.AI_KNOWLEDGE_POLICY_MANAGEMENT_HTTP_SCHEMAS = {
    // Existing request leaves remain owned by AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS.
    AiKnowledgeLifecycleTargetDraft: target,
    AiKnowledgePolicyHttpLifecycleDraft: lifecycle,
    AiKnowledgePolicyHttpPreparationDraft: preparation,
    AiKnowledgePolicyHttpReceiptDraft: receipt,
    AiKnowledgePolicyPrepareHttpResponseDraft: { oneOf: [preparation, receipt, unknown] },
    AiKnowledgePolicyReviewHttpResponseDraft: { oneOf: [preparation, receipt, unknown] },
    AiKnowledgePolicyCommitHttpResponseDraft: { oneOf: [receipt, unknown] },
    AiKnowledgePolicyOperationHttpResponseDraft: { oneOf: [receipt, unknown] },
    AiKnowledgePolicyHttpErrorDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ code: (0, ai_gateway_draft_schemas_1.leafEnum)('AI_INVALID_INPUT', 'AI_REVISION_CONFLICT', 'AI_RESOURCE_UNAVAILABLE'), retryable: no }),
};
//# sourceMappingURL=ai-knowledge-policy-management-draft.js.map