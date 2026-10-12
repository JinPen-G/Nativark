import { leafClosed as obj, leafEnum as choice, leafInt as int, leafList as list, leafText as text,
  leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
import type { FileUploadSessionSummary } from './infrastructure';

export const AI_KNOWLEDGE_MANAGEMENT_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/knowledge-management', method: 'POST',
  prepareCreate: 'documents/prepare-create', create: 'documents/create', parse: 'documents/parse',
  reconcileParse: 'documents/reconcile-parse', revise: 'documents/revise', publish: 'documents/publish',
  withdraw: 'documents/withdraw', delete: 'documents/delete', operationStatus: 'operations/read',
  beginUpload: 'uploads/begin', completeUpload: 'uploads/complete',
  beginRevisionUpload: 'uploads/revision/begin', completeRevisionUpload: 'uploads/revision/complete',
  observeUpload: 'uploads/read', observeRevisionUpload: 'uploads/revision/read',
});

export type AiKnowledgeManagementDraftInput = {
  documentId: string; documentVersion: string; attachmentId: string; title: string;
  validFrom: string; validUntil?: string; operationId: string;
};
export type AiKnowledgeManagementMutationInput = { documentId: string; expectedRevision: number; operationId: string };
export type AiKnowledgeManagementUploadInput = { documentId: string; fileName: string;
  mimeType: 'text/plain' | 'text/markdown'; sizeBytes: number };
export type AiKnowledgeManagementHttpRequestsDraft = {
  beginUpload: AiKnowledgeManagementUploadInput;
  completeUpload: { documentId: string; sessionId: string };
  beginRevisionUpload: AiKnowledgeManagementUploadInput & { expectedRevision: number; targetVersion: string };
  completeRevisionUpload: { documentId: string; sessionId: string; expectedRevision: number; targetVersion: string };
  observeUpload: { documentId: string; sessionId: string };
  observeRevisionUpload: { documentId: string; sessionId: string; expectedRevision: number; targetVersion: string };
  prepareCreate: AiKnowledgeManagementDraftInput;
  create: { confirmation: 'create'; command: AiKnowledgeManagementDraftInput };
  parse: { confirmation: 'parse'; command: AiKnowledgeManagementMutationInput };
  reconcileParse: AiKnowledgeManagementMutationInput;
  revise: { confirmation: 'revise'; expectedRevision: number; command: AiKnowledgeManagementDraftInput };
  publish: { confirmation: 'publish'; command: AiKnowledgeManagementMutationInput };
  withdraw: { confirmation: 'withdraw'; command: AiKnowledgeManagementMutationInput };
  delete: { confirmation: 'delete'; command: AiKnowledgeManagementMutationInput };
  operationStatus: { documentId: string; operationId: string };
};
export type AiKnowledgeManagementStateDraft = {
  documentId: string; title: string; documentVersion: string; revision: number; aclRevision: number;
  publication: 'draft' | 'published' | 'withdrawn' | 'deleted'; parsing: 'pending' | 'parsed' | 'failed' | 'rejected';
  indexing: 'not_indexed' | 'indexing' | 'indexed' | 'failed'; parseOperation: 'pending' | 'not_pending';
  failure?: 'parse_failed' | 'unsupported' | 'invalid_text' | 'empty_text' | 'limit_exceeded' | 'index_failed';
  indexJob: { operationId: string; documentVersion: string; aclRevision: number; generation: number;
    kind: 'upsert' | 'remove'; status: 'pending' | 'completed' | 'failed' } | null;
  body: 'not_included'; physicalIndexDeletion: 'not_verified'; actionAuthorization: 'required';
};
export type AiKnowledgeManagementCommandResponseDraft = {
  operationId: string; document: AiKnowledgeManagementStateDraft;
  semantics: 'current_document_state_not_original_operation_result';
};
export type AiKnowledgeManagementPrepareResponseDraft = {
  documentId: string; documentVersion: string; attachmentId: string; operationId: string;
  format: string[]; status: 'ready_to_create'; semantics: 'preparation_not_creation_or_future_authorization';
};
export type AiKnowledgeManagementOperationResponseDraft = {
  operationId: string; receipt: 'recorded' | 'not_recorded'; document: AiKnowledgeManagementStateDraft;
  completionSemantics: 'receipt_and_head_are_separate_facts'; recovery: 'read_original_operation_only';
};
export type AiKnowledgeManagementHttpResponsesDraft = {
  observeUpload: Omit<FileUploadSessionSummary, 'uploadUrl' | 'uploadHeaders'> & { documentId: string;
    targetVersion?: string; expectedRevision?: number; semantics: 'observed_upload_not_document_commit' };
  observeRevisionUpload: AiKnowledgeManagementHttpResponsesDraft['observeUpload'];
  beginUpload: FileUploadSessionSummary & { documentId: string; semantics: 'upload_intent_not_document' };
  completeUpload: { attachmentId: string; documentId: string; status: 'attachment_bound'; semantics: 'uploaded_not_created_or_published' };
  beginRevisionUpload: FileUploadSessionSummary & { documentId: string; targetVersion: string; expectedRevision: number;
    semantics: 'upload_intent_not_revision_commit' };
  completeRevisionUpload: { attachmentId: string; documentId: string; documentVersion: string; expectedRevision: number;
    status: 'attachment_bound'; semantics: 'uploaded_not_revised_or_published' };
  prepareCreate: AiKnowledgeManagementPrepareResponseDraft;
  create: AiKnowledgeManagementCommandResponseDraft;
  parse: AiKnowledgeManagementCommandResponseDraft;
  reconcileParse: AiKnowledgeManagementCommandResponseDraft;
  revise: AiKnowledgeManagementCommandResponseDraft;
  publish: AiKnowledgeManagementCommandResponseDraft;
  withdraw: AiKnowledgeManagementCommandResponseDraft;
  delete: AiKnowledgeManagementCommandResponseDraft;
  operationStatus: AiKnowledgeManagementOperationResponseDraft;
};
export type AiKnowledgeManagementHttpErrorDraft = {
  code: 'AI_INVALID_INPUT' | 'AI_REVISION_CONFLICT' | 'AI_NOT_READY' | 'AI_RESULT_UNKNOWN' | 'AI_RESOURCE_UNAVAILABLE';
  retryable: false; nextAction: 'read_original_operation';
};

const id: AiLeafSchemaDraft = { ...text(128), pattern: '^[A-Za-z0-9_-]+$' };
const revision = int(1, 4294967294), expectedRevision = int(1, Number.MAX_SAFE_INTEGER - 1);
const draft = obj({ documentId: id, documentVersion: id, attachmentId: id, title: text(256),
  validFrom: time, validUntil: time, operationId: id }, ['documentId', 'documentVersion', 'attachmentId', 'title', 'validFrom', 'operationId']);
const mutation = obj({ documentId: id, expectedRevision, operationId: id });
const upload = { documentId: id, fileName: text(180), mimeType: choice('text/plain', 'text/markdown'), sizeBytes: int(1, 262144) };
// Only the existing storage runtime may produce signed upload URLs/headers.
// They are upload capabilities, never model navigation or source links.
const uploadSession = { sessionId: text(191), fileAssetId: text(191), provider: text(128),
  mode: choice('provider', 'simulation'), status: text(128), expiresAt: time,
  uploadUrl: text(16384), uploadHeaders: { type: 'object', maxProperties: 32, additionalProperties: text(8192, 0) } };
const sessionRequired = ['sessionId', 'fileAssetId', 'provider', 'mode', 'status', 'expiresAt', 'documentId', 'semantics'];
const state = obj({ documentId: id, title: text(256), documentVersion: id, revision, aclRevision: revision,
  publication: choice('draft', 'published', 'withdrawn', 'deleted'), parsing: choice('pending', 'parsed', 'failed', 'rejected'),
  indexing: choice('not_indexed', 'indexing', 'indexed', 'failed'), parseOperation: choice('pending', 'not_pending'),
  failure: choice('parse_failed', 'unsupported', 'invalid_text', 'empty_text', 'limit_exceeded', 'index_failed'),
  indexJob: { oneOf: [{ type: 'null' }, obj({ operationId: text(191), documentVersion: id, aclRevision: revision, generation: revision,
    kind: choice('upsert', 'remove'), status: choice('pending', 'completed', 'failed') })] },
  body: choice('not_included'), physicalIndexDeletion: choice('not_verified'), actionAuthorization: choice('required'),
}, ['documentId', 'title', 'documentVersion', 'revision', 'aclRevision', 'publication', 'parsing', 'indexing',
  'parseOperation', 'indexJob', 'body', 'physicalIndexDeletion', 'actionAuthorization']);
const commandResponse = obj({ operationId: id, document: state, semantics: choice('current_document_state_not_original_operation_result') });
export const AI_KNOWLEDGE_MANAGEMENT_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiKnowledgeManagementBeginUploadRequestDraft: obj(upload),
  AiKnowledgeManagementCompleteUploadRequestDraft: obj({ documentId: id, sessionId: id }),
  AiKnowledgeManagementBeginRevisionUploadRequestDraft: obj({ ...upload, expectedRevision, targetVersion: id }),
  AiKnowledgeManagementCompleteRevisionUploadRequestDraft: obj({ documentId: id, sessionId: id, expectedRevision, targetVersion: id }),
  AiKnowledgeManagementObserveUploadRequestDraft: obj({ documentId: id, sessionId: id }),
  AiKnowledgeManagementObserveRevisionUploadRequestDraft: obj({ documentId: id, sessionId: id, expectedRevision, targetVersion: id }),
  AiKnowledgeManagementObserveUploadResponseDraft: obj({ sessionId: text(191), fileAssetId: text(191), provider: text(128),
    mode: choice('provider', 'simulation'), status: text(128), expiresAt: time, documentId: id,
    targetVersion: id, expectedRevision, semantics: choice('observed_upload_not_document_commit') }, sessionRequired),
  AiKnowledgeManagementBeginUploadResponseDraft: obj({ ...uploadSession, documentId: id,
    semantics: choice('upload_intent_not_document') }, sessionRequired),
  AiKnowledgeManagementCompleteUploadResponseDraft: obj({ attachmentId: id, documentId: id, status: choice('attachment_bound'),
    semantics: choice('uploaded_not_created_or_published') }),
  AiKnowledgeManagementBeginRevisionUploadResponseDraft: obj({ ...uploadSession, documentId: id, targetVersion: id, expectedRevision,
    semantics: choice('upload_intent_not_revision_commit') }, [...sessionRequired, 'targetVersion', 'expectedRevision']),
  AiKnowledgeManagementCompleteRevisionUploadResponseDraft: obj({ attachmentId: id, documentId: id, documentVersion: id, expectedRevision,
    status: choice('attachment_bound'), semantics: choice('uploaded_not_revised_or_published') }),
  AiKnowledgeManagementPrepareRequestDraft: draft,
  AiKnowledgeManagementCreateRequestDraft: obj({ confirmation: choice('create'), command: draft }),
  AiKnowledgeManagementParseRequestDraft: obj({ confirmation: choice('parse'), command: mutation }),
  AiKnowledgeManagementReconcileParseRequestDraft: mutation,
  AiKnowledgeManagementReviseRequestDraft: obj({ confirmation: choice('revise'), expectedRevision, command: draft }),
  AiKnowledgeManagementPublishRequestDraft: obj({ confirmation: choice('publish'), command: mutation }),
  AiKnowledgeManagementWithdrawRequestDraft: obj({ confirmation: choice('withdraw'), command: mutation }),
  AiKnowledgeManagementDeleteRequestDraft: obj({ confirmation: choice('delete'), command: mutation }),
  AiKnowledgeManagementOperationRequestDraft: obj({ documentId: id, operationId: id }),
  AiKnowledgeManagementStateDraft: state,
  AiKnowledgeManagementCommandResponseDraft: commandResponse,
  AiKnowledgeManagementPrepareResponseDraft: obj({ documentId: id, documentVersion: id, attachmentId: id, operationId: id,
    format: list(choice('text/plain', 'text/markdown'), 2, 1), status: choice('ready_to_create'),
    semantics: choice('preparation_not_creation_or_future_authorization') }),
  AiKnowledgeManagementOperationResponseDraft: obj({ operationId: id, receipt: choice('recorded', 'not_recorded'), document: state,
    completionSemantics: choice('receipt_and_head_are_separate_facts'), recovery: choice('read_original_operation_only') }),
  AiKnowledgeManagementHttpErrorDraft: obj({ code: choice('AI_INVALID_INPUT', 'AI_REVISION_CONFLICT', 'AI_NOT_READY', 'AI_RESULT_UNKNOWN', 'AI_RESOURCE_UNAVAILABLE'),
    retryable: { type: 'boolean', const: false }, nextAction: choice('read_original_operation') }),
};
