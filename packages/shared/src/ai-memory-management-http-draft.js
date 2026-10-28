"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_MEMORY_MANAGEMENT_HTTP_SCHEMAS = exports.AI_MEMORY_MANAGEMENT_HTTP_DRAFT = void 0;
const ai_knowledge_draft_1 = require("./ai-knowledge-draft");
const ai_gateway_draft_schemas_1 = require("./ai-gateway-draft-schemas");
exports.AI_MEMORY_MANAGEMENT_HTTP_DRAFT = Object.freeze({ basePath: 'ai-native/memory-management', method: 'POST',
    list: 'list', state: 'state', read: 'read', propose: 'propose', confirm: 'confirm', resumeConfirmation: 'confirmation/resume',
    confirmation: 'confirmation/read', change: 'change', changeStatus: 'change/read', revoke: 'consent/revoke', operation: 'operations/read' });
const id = () => ({ type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' });
const operationId = () => ({ ...id(), maxLength: 110 });
const revision = (0, ai_gateway_draft_schemas_1.leafInt)(1, 4294967293), status = (0, ai_gateway_draft_schemas_1.leafEnum)('proposed', 'confirmed', 'deleted');
const confirmation = (0, ai_gateway_draft_schemas_1.leafClosed)({ memoryId: id(), expectedRevision: revision, operationId: operationId(), expiresAt: ai_gateway_draft_schemas_1.leafTime });
const mutation = (0, ai_gateway_draft_schemas_1.leafClosed)({ memory: (0, ai_gateway_draft_schemas_1.leafRef)('AiMemoryDraft'), semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('human_preference_not_business_approval') });
const change = { draftVersion: (0, ai_gateway_draft_schemas_1.leafEnum)(ai_knowledge_draft_1.AI_KNOWLEDGE_DRAFT_VERSION), memoryId: id(), expectedRevision: revision };
exports.AI_MEMORY_MANAGEMENT_HTTP_SCHEMAS = {
    AiMemoryManagementListRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ limit: (0, ai_gateway_draft_schemas_1.leafInt)(1, 30), after: id() }, ['limit']),
    AiMemoryManagementListResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ items: { type: 'array', items: (0, ai_gateway_draft_schemas_1.leafRef)('AiMemoryManagementStateDraft'), maxItems: 30 },
        nextAfter: { oneOf: [id(), { type: 'null' }] }, semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('owner_metadata_not_preference_reuse') }),
    AiMemoryManagementStateRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ memoryId: id() }),
    AiMemoryManagementReadRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ memoryId: id() }),
    AiMemoryManagementProposeRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ confirmation: (0, ai_gateway_draft_schemas_1.leafEnum)('propose_memory_preference'), command: (0, ai_gateway_draft_schemas_1.leafClosed)({ memoryId: id(), operationId: operationId(), expiresAt: ai_gateway_draft_schemas_1.leafTime, preference: (0, ai_gateway_draft_schemas_1.leafRef)('AiPreferenceValueDraft') }) }),
    AiMemoryManagementConfirmRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ confirmation: (0, ai_gateway_draft_schemas_1.leafEnum)('confirm_memory_preference'), command: confirmation }),
    AiMemoryManagementConfirmationRequestDraft: confirmation,
    AiMemoryManagementChangeRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ confirmation: (0, ai_gateway_draft_schemas_1.leafEnum)('change_memory_preference'), operationId: operationId(), command: { oneOf: [
                (0, ai_gateway_draft_schemas_1.leafClosed)({ ...change, operation: (0, ai_gateway_draft_schemas_1.leafEnum)('modify'), preference: (0, ai_gateway_draft_schemas_1.leafRef)('AiPreferenceValueDraft') }), (0, ai_gateway_draft_schemas_1.leafClosed)({ ...change, operation: (0, ai_gateway_draft_schemas_1.leafEnum)('delete') })
            ] } }),
    AiMemoryManagementChangeStatusRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ operationId: operationId(), command: { oneOf: [
                (0, ai_gateway_draft_schemas_1.leafClosed)({ ...change, operation: (0, ai_gateway_draft_schemas_1.leafEnum)('modify'), preference: (0, ai_gateway_draft_schemas_1.leafRef)('AiPreferenceValueDraft') }), (0, ai_gateway_draft_schemas_1.leafClosed)({ ...change, operation: (0, ai_gateway_draft_schemas_1.leafEnum)('delete') })
            ] } }),
    AiMemoryManagementRevokeRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ confirmation: (0, ai_gateway_draft_schemas_1.leafEnum)('revoke_memory_consent'), command: (0, ai_gateway_draft_schemas_1.leafClosed)({ memoryId: id(), expectedRevision: (0, ai_gateway_draft_schemas_1.leafInt)(2, 4294967294) }) }),
    AiMemoryManagementOperationRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ memoryId: id(), operationId: operationId(), expectedRevision: revision, operation: (0, ai_gateway_draft_schemas_1.leafEnum)('propose', 'modify', 'confirm', 'revoke', 'delete') }),
    AiMemoryManagementStateDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ memoryId: id(), revision: (0, ai_gateway_draft_schemas_1.leafInt)(1, 4294967294), aclRevision: (0, ai_gateway_draft_schemas_1.leafInt)(1, 4294967294), storageStatus: status,
        consentStatus: (0, ai_gateway_draft_schemas_1.leafEnum)('not_confirmed', 'confirmed', 'revoked', 'expired', 'invalidated'), expiresAt: ai_gateway_draft_schemas_1.leafTime, usable: { type: 'boolean' }, semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('preference_not_authority') }),
    AiMemoryManagementMutationDraft: mutation,
    AiMemoryManagementChangeStatusResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ memoryId: id(), operationId: operationId(), revision: (0, ai_gateway_draft_schemas_1.leafInt)(1, 4294967294),
        status: (0, ai_gateway_draft_schemas_1.leafEnum)('committed_current', 'committed_superseded', 'not_recorded'), nextStep: (0, ai_gateway_draft_schemas_1.leafEnum)('read_current', 'reconcile_original_operation') }),
    AiMemoryManagementRevokeResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ memoryId: id(), confirmationRecordId: id(), status: (0, ai_gateway_draft_schemas_1.leafEnum)('revoked'), semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('consent_revoked_not_memory_deleted') }),
    AiMemoryManagementConfirmationResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ memoryId: id(), operationId: operationId(), status: (0, ai_gateway_draft_schemas_1.leafEnum)('not_created', 'confirmation_saved', 'confirmed', 'invalidated', 'unknown'), confirmationRecordId: id() }, ['memoryId', 'operationId', 'status']),
    AiMemoryManagementOperationResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ memoryId: id(), operationId: operationId(), requestedOperation: (0, ai_gateway_draft_schemas_1.leafEnum)('propose', 'modify', 'confirm', 'revoke', 'delete'), receipt: (0, ai_gateway_draft_schemas_1.leafEnum)('recorded', 'unknown'), binding: (0, ai_gateway_draft_schemas_1.leafEnum)('key_only_not_command_attestation'),
        current: (0, ai_gateway_draft_schemas_1.leafClosed)({ status, revision: (0, ai_gateway_draft_schemas_1.leafInt)(1, 4294967294), expiresAt: ai_gateway_draft_schemas_1.leafTime }), nextStep: (0, ai_gateway_draft_schemas_1.leafEnum)('reconcile_recorded_operation', 'reconcile_same_operation'), absenceSemantics: (0, ai_gateway_draft_schemas_1.leafEnum)('no_receipt_is_not_proof_of_non_execution') }),
    AiMemoryManagementErrorDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ code: (0, ai_gateway_draft_schemas_1.leafEnum)('AI_INVALID_INPUT', 'AI_REVISION_CONFLICT', 'AI_NOT_READY', 'AI_RESULT_UNKNOWN', 'AI_RESOURCE_UNAVAILABLE'), retryable: { type: 'boolean', const: false }, nextAction: (0, ai_gateway_draft_schemas_1.leafEnum)('read_original_memory_operation') }),
};
//# sourceMappingURL=ai-memory-management-http-draft.js.map