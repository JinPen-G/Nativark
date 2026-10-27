import { AI_KNOWLEDGE_DRAFT_VERSION, type AiMemoryDraft, type AiMemoryChangeDraft, type AiPreferenceValueDraft } from './ai-knowledge-draft';
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafInt as int,
  leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export const AI_MEMORY_MANAGEMENT_HTTP_DRAFT = Object.freeze({ basePath: 'ai-native/memory-management', method: 'POST',
  list: 'list', state: 'state', read: 'read', propose: 'propose', confirm: 'confirm', resumeConfirmation: 'confirmation/resume',
  confirmation: 'confirmation/read', change: 'change', changeStatus: 'change/read', revoke: 'consent/revoke', operation: 'operations/read' });
export type AiMemoryConfirmationCommandDraft = { memoryId: string; expectedRevision: number; operationId: string; expiresAt: string };
export type AiMemoryManagementRequestsDraft = {
  list: { limit: number; after?: string };
  state: { memoryId: string };
  read: { memoryId: string };
  propose: { confirmation: 'propose_memory_preference'; command: { memoryId: string; operationId: string; expiresAt: string; preference: AiPreferenceValueDraft } };
  confirm: { confirmation: 'confirm_memory_preference'; command: AiMemoryConfirmationCommandDraft };
  resumeConfirmation: AiMemoryConfirmationCommandDraft;
  confirmation: AiMemoryConfirmationCommandDraft;
  change: { confirmation: 'change_memory_preference'; operationId: string; command: AiMemoryChangeDraft & { operation: 'modify' | 'delete' } };
  changeStatus: { operationId: string; command: AiMemoryChangeDraft & { operation: 'modify' | 'delete' } };
  revoke: { confirmation: 'revoke_memory_consent'; command: { memoryId: string; expectedRevision: number } };
  operation: { memoryId: string; operationId: string; expectedRevision: number; operation: 'propose' | 'modify' | 'confirm' | 'revoke' | 'delete' };
};
export type AiMemoryManagementStateDraft = { memoryId: string; revision: number; aclRevision: number;
  storageStatus: 'proposed' | 'confirmed' | 'deleted'; consentStatus: 'not_confirmed' | 'confirmed' | 'revoked' | 'expired' | 'invalidated';
  expiresAt: string; usable: boolean; semantics: 'preference_not_authority' };
export type AiMemoryManagementMutationDraft = { memory: AiMemoryDraft; semantics: 'human_preference_not_business_approval' };
export type AiMemoryManagementResponsesDraft = {
  list: { items: AiMemoryManagementStateDraft[]; nextAfter: string | null; semantics: 'owner_metadata_not_preference_reuse' };
  state: AiMemoryManagementStateDraft;
  read: AiMemoryManagementMutationDraft;
  propose: AiMemoryManagementMutationDraft; confirm: AiMemoryManagementMutationDraft;
  resumeConfirmation: AiMemoryManagementMutationDraft; change: AiMemoryManagementMutationDraft;
  changeStatus: { memoryId: string; operationId: string; revision: number;
    status: 'committed_current' | 'committed_superseded' | 'not_recorded'; nextStep: 'read_current' | 'reconcile_original_operation' };
  revoke: { memoryId: string; confirmationRecordId: string; status: 'revoked'; semantics: 'consent_revoked_not_memory_deleted' };
  confirmation: { memoryId: string; operationId: string; status: 'not_created' | 'confirmation_saved' | 'confirmed' | 'invalidated' | 'unknown';
    confirmationRecordId?: string };
  operation: { memoryId: string; operationId: string; requestedOperation: 'propose' | 'modify' | 'confirm' | 'revoke' | 'delete';
    receipt: 'recorded' | 'unknown'; binding: 'key_only_not_command_attestation'; current: { status: 'proposed' | 'confirmed' | 'deleted'; revision: number; expiresAt: string };
    nextStep: 'reconcile_recorded_operation' | 'reconcile_same_operation'; absenceSemantics: 'no_receipt_is_not_proof_of_non_execution' };
};
export type AiMemoryManagementErrorDraft = { code: 'AI_INVALID_INPUT' | 'AI_REVISION_CONFLICT' | 'AI_NOT_READY' | 'AI_RESULT_UNKNOWN' | 'AI_RESOURCE_UNAVAILABLE';
  retryable: false; nextAction: 'read_original_memory_operation' | 'read_current_memory_state' };
const id = (): AiLeafSchemaDraft => ({ type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' });
const operationId = (): AiLeafSchemaDraft => ({ ...id(), maxLength: 110 });
const revision = int(1, 4294967293), status = choice('proposed', 'confirmed', 'deleted');
const confirmation = obj({ memoryId: id(), expectedRevision: revision, operationId: operationId(), expiresAt: time });
const mutation = obj({ memory: ref('AiMemoryDraft'), semantics: choice('human_preference_not_business_approval') });
const change = { draftVersion: choice(AI_KNOWLEDGE_DRAFT_VERSION), memoryId: id(), expectedRevision: revision };
export const AI_MEMORY_MANAGEMENT_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiMemoryManagementListRequestDraft: obj({ limit: int(1, 30), after: id() }, ['limit']),
  AiMemoryManagementListResponseDraft: obj({ items: { type: 'array', items: ref('AiMemoryManagementStateDraft'), maxItems: 30 },
    nextAfter: { oneOf: [id(), { type: 'null' }] }, semantics: choice('owner_metadata_not_preference_reuse') }),
  AiMemoryManagementStateRequestDraft: obj({ memoryId: id() }),
  AiMemoryManagementReadRequestDraft: obj({ memoryId: id() }),
  AiMemoryManagementProposeRequestDraft: obj({ confirmation: choice('propose_memory_preference'), command: obj({ memoryId: id(), operationId: operationId(), expiresAt: time, preference: ref('AiPreferenceValueDraft') }) }),
  AiMemoryManagementConfirmRequestDraft: obj({ confirmation: choice('confirm_memory_preference'), command: confirmation }),
  AiMemoryManagementConfirmationRequestDraft: confirmation,
  AiMemoryManagementChangeRequestDraft: obj({ confirmation: choice('change_memory_preference'), operationId: operationId(), command: { oneOf: [
    obj({ ...change, operation: choice('modify'), preference: ref('AiPreferenceValueDraft') }), obj({ ...change, operation: choice('delete') })] } }),
  AiMemoryManagementChangeStatusRequestDraft: obj({ operationId: operationId(), command: { oneOf: [
    obj({ ...change, operation: choice('modify'), preference: ref('AiPreferenceValueDraft') }), obj({ ...change, operation: choice('delete') })] } }),
  AiMemoryManagementRevokeRequestDraft: obj({ confirmation: choice('revoke_memory_consent'), command: obj({ memoryId: id(), expectedRevision: int(2, 4294967294) }) }),
  AiMemoryManagementOperationRequestDraft: obj({ memoryId: id(), operationId: operationId(), expectedRevision: revision, operation: choice('propose', 'modify', 'confirm', 'revoke', 'delete') }),
  AiMemoryManagementStateDraft: obj({ memoryId: id(), revision: int(1, 4294967294), aclRevision: int(1, 4294967294), storageStatus: status,
    consentStatus: choice('not_confirmed', 'confirmed', 'revoked', 'expired', 'invalidated'), expiresAt: time, usable: { type: 'boolean' }, semantics: choice('preference_not_authority') }),
  AiMemoryManagementMutationDraft: mutation,
  AiMemoryManagementChangeStatusResponseDraft: obj({ memoryId: id(), operationId: operationId(), revision: int(1, 4294967294),
    status: choice('committed_current', 'committed_superseded', 'not_recorded'), nextStep: choice('read_current', 'reconcile_original_operation') }),
  AiMemoryManagementRevokeResponseDraft: obj({ memoryId: id(), confirmationRecordId: id(), status: choice('revoked'), semantics: choice('consent_revoked_not_memory_deleted') }),
  AiMemoryManagementConfirmationResponseDraft: obj({ memoryId: id(), operationId: operationId(), status: choice('not_created', 'confirmation_saved', 'confirmed', 'invalidated', 'unknown'), confirmationRecordId: id() }, ['memoryId', 'operationId', 'status']),
  AiMemoryManagementOperationResponseDraft: obj({ memoryId: id(), operationId: operationId(), requestedOperation: choice('propose', 'modify', 'confirm', 'revoke', 'delete'), receipt: choice('recorded', 'unknown'), binding: choice('key_only_not_command_attestation'),
    current: obj({ status, revision: int(1, 4294967294), expiresAt: time }), nextStep: choice('reconcile_recorded_operation', 'reconcile_same_operation'), absenceSemantics: choice('no_receipt_is_not_proof_of_non_execution') }),
  AiMemoryManagementErrorDraft: obj({ code: choice('AI_INVALID_INPUT', 'AI_REVISION_CONFLICT', 'AI_NOT_READY', 'AI_RESULT_UNKNOWN', 'AI_RESOURCE_UNAVAILABLE'), retryable: { type: 'boolean', const: false }, nextAction: choice('read_original_memory_operation', 'read_current_memory_state') }),
};
