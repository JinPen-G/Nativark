"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_KNOWLEDGE_MANAGEMENT_HTTP_SCHEMAS = exports.AI_KNOWLEDGE_MANAGEMENT_HTTP_DRAFT = void 0;
const ai_gateway_draft_schemas_1 = require("./ai-gateway-draft-schemas");
exports.AI_KNOWLEDGE_MANAGEMENT_HTTP_DRAFT = Object.freeze({
    basePath: 'ai-native/knowledge-management', method: 'POST',
    prepareCreate: 'documents/prepare-create', create: 'documents/create', parse: 'documents/parse',
    reconcileParse: 'documents/reconcile-parse', revise: 'documents/revise', publish: 'documents/publish',
    withdraw: 'documents/withdraw', delete: 'documents/delete', operationStatus: 'operations/read',
    beginUpload: 'uploads/begin', completeUpload: 'uploads/complete',
    beginRevisionUpload: 'uploads/revision/begin', completeRevisionUpload: 'uploads/revision/complete',
    observeUpload: 'uploads/read', observeRevisionUpload: 'uploads/revision/read',
});
const id = { ...(0, ai_gateway_draft_schemas_1.leafText)(128), pattern: '^[A-Za-z0-9_-]+$' };
const revision = (0, ai_gateway_draft_schemas_1.leafInt)(1, 4294967294), expectedRevision = (0, ai_gateway_draft_schemas_1.leafInt)(1, Number.MAX_SAFE_INTEGER - 1);
const draft = (0, ai_gateway_draft_schemas_1.leafClosed)({ documentId: id, documentVersion: id, attachmentId: id, title: (0, ai_gateway_draft_schemas_1.leafText)(256),
    validFrom: ai_gateway_draft_schemas_1.leafTime, validUntil: ai_gateway_draft_schemas_1.leafTime, operationId: id }, ['documentId', 'documentVersion', 'attachmentId', 'title', 'validFrom', 'operationId']);
const mutation = (0, ai_gateway_draft_schemas_1.leafClosed)({ documentId: id, expectedRevision, operationId: id });
const upload = { documentId: id, fileName: (0, ai_gateway_draft_schemas_1.leafText)(180), mimeType: (0, ai_gateway_draft_schemas_1.leafEnum)('text/plain', 'text/markdown'), sizeBytes: (0, ai_gateway_draft_schemas_1.leafInt)(1, 262144) };
// Only the existing storage runtime may produce signed upload URLs/headers.
// They are upload capabilities, never model navigation or source links.
const uploadSession = { sessionId: (0, ai_gateway_draft_schemas_1.leafText)(191), fileAssetId: (0, ai_gateway_draft_schemas_1.leafText)(191), provider: (0, ai_gateway_draft_schemas_1.leafText)(128),
    mode: (0, ai_gateway_draft_schemas_1.leafEnum)('provider', 'simulation'), status: (0, ai_gateway_draft_schemas_1.leafText)(128), expiresAt: ai_gateway_draft_schemas_1.leafTime,
    uploadUrl: (0, ai_gateway_draft_schemas_1.leafText)(16384), uploadHeaders: { type: 'object', maxProperties: 32, additionalProperties: (0, ai_gateway_draft_schemas_1.leafText)(8192, 0) } };
const sessionRequired = ['sessionId', 'fileAssetId', 'provider', 'mode', 'status', 'expiresAt', 'documentId', 'semantics'];
const state = (0, ai_gateway_draft_schemas_1.leafClosed)({ documentId: id, title: (0, ai_gateway_draft_schemas_1.leafText)(256), documentVersion: id, revision, aclRevision: revision,
    publication: (0, ai_gateway_draft_schemas_1.leafEnum)('draft', 'published', 'withdrawn', 'deleted'), parsing: (0, ai_gateway_draft_schemas_1.leafEnum)('pending', 'parsed', 'failed', 'rejected'),
    indexing: (0, ai_gateway_draft_schemas_1.leafEnum)('not_indexed', 'indexing', 'indexed', 'failed'), parseOperation: (0, ai_gateway_draft_schemas_1.leafEnum)('pending', 'not_pending'),
    failure: (0, ai_gateway_draft_schemas_1.leafEnum)('parse_failed', 'unsupported', 'invalid_text', 'empty_text', 'limit_exceeded', 'index_failed'),
    indexJob: { oneOf: [{ type: 'null' }, (0, ai_gateway_draft_schemas_1.leafClosed)({ operationId: (0, ai_gateway_draft_schemas_1.leafText)(191), documentVersion: id, aclRevision: revision, generation: revision,
                kind: (0, ai_gateway_draft_schemas_1.leafEnum)('upsert', 'remove'), status: (0, ai_gateway_draft_schemas_1.leafEnum)('pending', 'completed', 'failed') })] },
    body: (0, ai_gateway_draft_schemas_1.leafEnum)('not_included'), physicalIndexDeletion: (0, ai_gateway_draft_schemas_1.leafEnum)('not_verified'), actionAuthorization: (0, ai_gateway_draft_schemas_1.leafEnum)('required'),
}, ['documentId', 'title', 'documentVersion', 'revision', 'aclRevision', 'publication', 'parsing', 'indexing',
    'parseOperation', 'indexJob', 'body', 'physicalIndexDeletion', 'actionAuthorization']);
const commandResponse = (0, ai_gateway_draft_schemas_1.leafClosed)({ operationId: id, document: state, semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('current_document_state_not_original_operation_result') });
exports.AI_KNOWLEDGE_MANAGEMENT_HTTP_SCHEMAS = {
    AiKnowledgeManagementBeginUploadRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)(upload),
    AiKnowledgeManagementCompleteUploadRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ documentId: id, sessionId: id }),
    AiKnowledgeManagementBeginRevisionUploadRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...upload, expectedRevision, targetVersion: id }),
    AiKnowledgeManagementCompleteRevisionUploadRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ documentId: id, sessionId: id, expectedRevision, targetVersion: id }),
    AiKnowledgeManagementObserveUploadRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ documentId: id, sessionId: id }),
    AiKnowledgeManagementObserveRevisionUploadRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ documentId: id, sessionId: id, expectedRevision, targetVersion: id }),
    AiKnowledgeManagementObserveUploadResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ sessionId: (0, ai_gateway_draft_schemas_1.leafText)(191), fileAssetId: (0, ai_gateway_draft_schemas_1.leafText)(191), provider: (0, ai_gateway_draft_schemas_1.leafText)(128),
        mode: (0, ai_gateway_draft_schemas_1.leafEnum)('provider', 'simulation'), status: (0, ai_gateway_draft_schemas_1.leafText)(128), expiresAt: ai_gateway_draft_schemas_1.leafTime, documentId: id,
        targetVersion: id, expectedRevision, semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('observed_upload_not_document_commit') }, sessionRequired),
    AiKnowledgeManagementBeginUploadResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...uploadSession, documentId: id,
        semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('upload_intent_not_document') }, sessionRequired),
    AiKnowledgeManagementCompleteUploadResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ attachmentId: id, documentId: id, status: (0, ai_gateway_draft_schemas_1.leafEnum)('attachment_bound'),
        semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('uploaded_not_created_or_published') }),
    AiKnowledgeManagementBeginRevisionUploadResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ ...uploadSession, documentId: id, targetVersion: id, expectedRevision,
        semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('upload_intent_not_revision_commit') }, [...sessionRequired, 'targetVersion', 'expectedRevision']),
    AiKnowledgeManagementCompleteRevisionUploadResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ attachmentId: id, documentId: id, documentVersion: id, expectedRevision,
        status: (0, ai_gateway_draft_schemas_1.leafEnum)('attachment_bound'), semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('uploaded_not_revised_or_published') }),
    AiKnowledgeManagementPrepareRequestDraft: draft,
    AiKnowledgeManagementCreateRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ confirmation: (0, ai_gateway_draft_schemas_1.leafEnum)('create'), command: draft }),
    AiKnowledgeManagementParseRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ confirmation: (0, ai_gateway_draft_schemas_1.leafEnum)('parse'), command: mutation }),
    AiKnowledgeManagementReconcileParseRequestDraft: mutation,
    AiKnowledgeManagementReviseRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ confirmation: (0, ai_gateway_draft_schemas_1.leafEnum)('revise'), expectedRevision, command: draft }),
    AiKnowledgeManagementPublishRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ confirmation: (0, ai_gateway_draft_schemas_1.leafEnum)('publish'), command: mutation }),
    AiKnowledgeManagementWithdrawRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ confirmation: (0, ai_gateway_draft_schemas_1.leafEnum)('withdraw'), command: mutation }),
    AiKnowledgeManagementDeleteRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ confirmation: (0, ai_gateway_draft_schemas_1.leafEnum)('delete'), command: mutation }),
    AiKnowledgeManagementOperationRequestDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ documentId: id, operationId: id }),
    AiKnowledgeManagementStateDraft: state,
    AiKnowledgeManagementCommandResponseDraft: commandResponse,
    AiKnowledgeManagementPrepareResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ documentId: id, documentVersion: id, attachmentId: id, operationId: id,
        format: (0, ai_gateway_draft_schemas_1.leafList)((0, ai_gateway_draft_schemas_1.leafEnum)('text/plain', 'text/markdown'), 2, 1), status: (0, ai_gateway_draft_schemas_1.leafEnum)('ready_to_create'),
        semantics: (0, ai_gateway_draft_schemas_1.leafEnum)('preparation_not_creation_or_future_authorization') }),
    AiKnowledgeManagementOperationResponseDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ operationId: id, receipt: (0, ai_gateway_draft_schemas_1.leafEnum)('recorded', 'not_recorded'), document: state,
        completionSemantics: (0, ai_gateway_draft_schemas_1.leafEnum)('receipt_and_head_are_separate_facts'), recovery: (0, ai_gateway_draft_schemas_1.leafEnum)('read_original_operation_only') }),
    AiKnowledgeManagementHttpErrorDraft: (0, ai_gateway_draft_schemas_1.leafClosed)({ code: (0, ai_gateway_draft_schemas_1.leafEnum)('AI_INVALID_INPUT', 'AI_REVISION_CONFLICT', 'AI_NOT_READY', 'AI_RESULT_UNKNOWN', 'AI_RESOURCE_UNAVAILABLE'),
        retryable: { type: 'boolean', const: false }, nextAction: (0, ai_gateway_draft_schemas_1.leafEnum)('read_original_operation') }),
};
//# sourceMappingURL=ai-knowledge-management-http-draft.js.map