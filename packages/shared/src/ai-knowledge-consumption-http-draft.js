"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_KNOWLEDGE_CONSUMPTION_HTTP_SCHEMAS = exports.AI_KNOWLEDGE_CONSUMPTION_HTTP_DRAFT = void 0;
const ai_knowledge_draft_1 = require("./ai-knowledge-draft");
const ai_knowledge_draft_schemas_1 = require("./ai-knowledge-draft-schemas");
const ai_gateway_draft_schemas_1 = require("./ai-gateway-draft-schemas");
exports.AI_KNOWLEDGE_CONSUMPTION_HTTP_DRAFT = Object.freeze({
    basePath: 'ai-native/knowledge-consumption', method: 'POST',
    readDocument: 'documents/read', openSource: 'sources/read',
    readMemory: 'memories/read', readPreferences: 'preferences/read',
});
const id = { ...(0, ai_gateway_draft_schemas_1.leafText)(128), pattern: '^[A-Za-z0-9_-]+$' };
const revision = (0, ai_gateway_draft_schemas_1.leafInt)(1, 4294967294), boolean = { type: 'boolean' };
const yes = { type: 'boolean', const: true }, no = { type: 'boolean', const: false };
const scope = { oneOf: [(0, ai_gateway_draft_schemas_1.leafClosed)({ kind: (0, ai_gateway_draft_schemas_1.leafEnum)('platform') }), (0, ai_gateway_draft_schemas_1.leafClosed)({ kind: (0, ai_gateway_draft_schemas_1.leafEnum)('tenant'), tenantId: id }),
        (0, ai_gateway_draft_schemas_1.leafClosed)({ kind: (0, ai_gateway_draft_schemas_1.leafEnum)('workspace'), tenantId: id, workspaceId: id })] };
const locator = { oneOf: [(0, ai_gateway_draft_schemas_1.leafClosed)({ kind: (0, ai_gateway_draft_schemas_1.leafEnum)('page'), page: (0, ai_gateway_draft_schemas_1.leafInt)(1, 100000), paragraph: (0, ai_gateway_draft_schemas_1.leafInt)(1, 100000) }),
        (0, ai_gateway_draft_schemas_1.leafClosed)({ kind: (0, ai_gateway_draft_schemas_1.leafEnum)('section'), sectionId: id, paragraph: (0, ai_gateway_draft_schemas_1.leafInt)(1, 100000) })] };
const preference = ai_knowledge_draft_schemas_1.AI_KNOWLEDGE_DRAFT_SCHEMAS.AiPreferenceValueDraft;
const reference = { kind: (0, ai_gateway_draft_schemas_1.leafEnum)('document'), documentId: id, documentVersion: id, chunkId: id,
    aclRevision: { type: 'integer', minimum: 1 }, locator };
const source = (0, ai_gateway_draft_schemas_1.leafClosed)({ ...reference, scope });
const metadata = { documentId: id, title: (0, ai_gateway_draft_schemas_1.leafText)(256), documentVersion: id, revision, aclRevision: revision,
    publication: (0, ai_gateway_draft_schemas_1.leafEnum)('draft', 'published', 'withdrawn', 'deleted'), parsing: (0, ai_gateway_draft_schemas_1.leafEnum)('pending', 'parsed', 'failed', 'rejected'),
    indexing: (0, ai_gateway_draft_schemas_1.leafEnum)('not_indexed', 'indexing', 'indexed', 'failed') };
const observation = { scope, audience: (0, ai_gateway_draft_schemas_1.leafEnum)('operator'), observedAt: ai_gateway_draft_schemas_1.leafTime, bounded: yes,
    semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('current_policy_rechecked_metadata_and_preview_not_business_fact') };
const readyPreview = (0, ai_gateway_draft_schemas_1.leafClosed)({ status: (0, ai_gateway_draft_schemas_1.leafEnum)('ready'), documentVersion: id, aclRevision: revision, truncated: boolean,
    sources: (0, ai_gateway_draft_schemas_1.leafList)((0, ai_gateway_draft_schemas_1.leafClosed)({ source, snippet: (0, ai_gateway_draft_schemas_1.leafText)(2000), contentFingerprint: { ...(0, ai_gateway_draft_schemas_1.leafText)(64, 64), pattern: '^[a-f0-9]{64}$' },
        trust: (0, ai_gateway_draft_schemas_1.leafEnum)('untrusted_data') }), 10), semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('preview_not_approval_or_search_readiness') });
const unavailablePreview = (0, ai_gateway_draft_schemas_1.leafClosed)({ status: (0, ai_gateway_draft_schemas_1.leafEnum)('unavailable'), sources: (0, ai_gateway_draft_schemas_1.leafList)((0, ai_gateway_draft_schemas_1.leafClosed)({}), 0) });
const preferenceItem = (0, ai_gateway_draft_schemas_1.leafClosed)({ memoryId: id, revision, aclRevision: revision, expiresAt: ai_gateway_draft_schemas_1.leafTime, preference, confirmationRecordId: id });
const memoryMetadata = (0, ai_gateway_draft_schemas_1.leafClosed)({ memoryId: id, revision, aclRevision: revision, expiresAt: ai_gateway_draft_schemas_1.leafTime,
    storageStatus: (0, ai_gateway_draft_schemas_1.leafEnum)('proposed', 'confirmed', 'deleted'), consentStatus: (0, ai_gateway_draft_schemas_1.leafEnum)('confirmed', 'revoked', 'expired', 'invalidated', 'not_confirmed') });
exports.AI_KNOWLEDGE_CONSUMPTION_HTTP_SCHEMAS = {
    AiKnowledgeDocumentReadRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ documentId: id, previewLimit: (0, ai_gateway_draft_schemas_1.leafInt)(1, 10) }, ['documentId']),
    AiKnowledgeSourceReadRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)(reference),
    AiKnowledgeMemoryReadRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ memoryId: id }),
    AiKnowledgePreferencesReadRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ limit: (0, ai_gateway_draft_schemas_1.leafInt)(1, 10) }),
    AiKnowledgeDocumentReadResponseDraft: { oneOf: [
            (0, ai_gateway_draft_schemas_1.leafClosed)({ ...observation, state: (0, ai_gateway_draft_schemas_1.leafEnum)('current_readable'), body: (0, ai_gateway_draft_schemas_1.leafEnum)('current_readable'), preview: readyPreview,
                metadata: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...metadata, publication: (0, ai_gateway_draft_schemas_1.leafEnum)('draft', 'published'), parsing: (0, ai_gateway_draft_schemas_1.leafEnum)('parsed') }), truncated: boolean }),
            (0, ai_gateway_draft_schemas_1.leafClosed)({ ...observation, state: (0, ai_gateway_draft_schemas_1.leafEnum)('metadata_only'), body: (0, ai_gateway_draft_schemas_1.leafEnum)('unavailable'), preview: unavailablePreview,
                metadata: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...metadata, publication: (0, ai_gateway_draft_schemas_1.leafEnum)('draft', 'published') }), truncated: no }),
            (0, ai_gateway_draft_schemas_1.leafClosed)({ ...observation, state: (0, ai_gateway_draft_schemas_1.leafEnum)('withdrawn_or_deleted'), body: (0, ai_gateway_draft_schemas_1.leafEnum)('unavailable'), preview: unavailablePreview,
                metadata: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...metadata, publication: (0, ai_gateway_draft_schemas_1.leafEnum)('withdrawn', 'deleted') }), truncated: no }),
        ] },
    AiKnowledgeSourceReadResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ draftVersion: (0, ai_gateway_draft_schemas_1.leafEnum)(ai_knowledge_draft_1.AI_KNOWLEDGE_DRAFT_VERSION),
        documentId: id, documentVersion: id, chunkId: id, scope, aclRevision: revision, locator, text: (0, ai_gateway_draft_schemas_1.leafText)(2000), trust: (0, ai_gateway_draft_schemas_1.leafEnum)('untrusted_data') }),
    AiKnowledgeMemoryReadResponseDraft: { oneOf: [
            (0, ai_gateway_draft_schemas_1.leafClosed)({ status: (0, ai_gateway_draft_schemas_1.leafEnum)('ready'), memory: preferenceItem, observedAt: ai_gateway_draft_schemas_1.leafTime, scope, audience: (0, ai_gateway_draft_schemas_1.leafEnum)('operator'),
                confirmation: (0, ai_gateway_draft_schemas_1.leafClosed)({ confirmationRecordId: id, revision, aclRevision: revision, scope, audience: (0, ai_gateway_draft_schemas_1.leafEnum)('operator'), confirmedAt: ai_gateway_draft_schemas_1.leafTime, expiresAt: ai_gateway_draft_schemas_1.leafTime }),
                semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('current_confirmed_preference_not_business_authority') }),
            (0, ai_gateway_draft_schemas_1.leafClosed)({ status: (0, ai_gateway_draft_schemas_1.leafEnum)('revoked', 'unavailable'), memory: memoryMetadata,
                semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('preference_not_available_without_current_confirmation') }),
        ] },
    AiKnowledgePreferencesReadResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ items: (0, ai_gateway_draft_schemas_1.leafList)(preferenceItem, 10),
        ambiguities: (0, ai_gateway_draft_schemas_1.leafList)((0, ai_gateway_draft_schemas_1.leafClosed)({ kind: (0, ai_gateway_draft_schemas_1.leafEnum)('locale', 'fulfillment_location', 'display_density'), memoryIds: (0, ai_gateway_draft_schemas_1.leafList)(id, 10, 2), nextStep: (0, ai_gateway_draft_schemas_1.leafEnum)('human_selection') }), 3),
        ambiguityCoverage: (0, ai_gateway_draft_schemas_1.leafEnum)('returned_items_only'), businessCompatibility: (0, ai_gateway_draft_schemas_1.leafEnum)('unavailable'), truncated: boolean,
        coverage: (0, ai_gateway_draft_schemas_1.leafEnum)('bounded_window'), pagination: (0, ai_gateway_draft_schemas_1.leafEnum)('unavailable'), semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('preference_not_authority') }),
    AiKnowledgeConsumptionHttpErrorDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ code: (0, ai_gateway_draft_schemas_1.leafEnum)('AI_INVALID_INPUT', 'AI_REVISION_CONFLICT', 'AI_RESOURCE_UNAVAILABLE'), retryable: no }),
};
//# sourceMappingURL=ai-knowledge-consumption-http-draft.js.map