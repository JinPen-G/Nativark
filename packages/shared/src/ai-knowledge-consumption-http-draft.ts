import type { AiExecutionScope } from './ai-native';
import type { AiKnowledgeChunkDraft, AiKnowledgeDocumentDraft, AiKnowledgeSourceDraft, AiPreferenceValueDraft } from './ai-knowledge-draft';

export const AI_KNOWLEDGE_CONSUMPTION_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/knowledge-consumption', method: 'POST',
  readDocument: 'documents/read', openSource: 'sources/read',
  readMemory: 'memories/read', readPreferences: 'preferences/read',
});

export type AiKnowledgeDocumentReadRequestDraft = { documentId: string; previewLimit?: number };
export type AiKnowledgeSourceReadRequestDraft = Omit<Extract<AiKnowledgeSourceDraft, { kind: 'document' }>, 'scope'>;
export type AiKnowledgeMemoryReadRequestDraft = { memoryId: string };
export type AiKnowledgePreferencesReadRequestDraft = { limit: number };

type Source = Extract<AiKnowledgeSourceDraft, { kind: 'document' }>;
type Preference = {
  memoryId: string; revision: number; aclRevision: number; expiresAt: string;
  preference: AiPreferenceValueDraft; confirmationRecordId: string;
};
export type AiKnowledgeDocumentReadResponseDraft = {
  state: 'current_readable' | 'withdrawn_or_deleted' | 'metadata_only';
  metadata: Pick<AiKnowledgeDocumentDraft, 'documentId' | 'title' | 'documentVersion' | 'aclRevision' | 'publication' | 'parsing' | 'indexing'> & { revision: number };
  body: 'current_readable' | 'unavailable';
  preview: { status: 'unavailable'; sources: never[] } | {
    status: 'ready'; documentVersion: string; aclRevision: number; truncated: boolean;
    sources: Array<{ source: Source; snippet: string; contentFingerprint: string; trust: 'untrusted_data' }>;
    semantics: 'preview_not_approval_or_search_readiness';
  };
  scope: AiExecutionScope; audience: 'operator'; observedAt: string; bounded: true; truncated: boolean;
  semantics: 'current_policy_rechecked_metadata_and_preview_not_business_fact';
};
export type AiKnowledgeMemoryReadResponseDraft = {
  status: 'ready'; memory: Preference; observedAt: string; scope: AiExecutionScope; audience: 'operator';
  confirmation: { confirmationRecordId: string; revision: number; aclRevision: number; scope: AiExecutionScope;
    audience: 'operator'; confirmedAt: string; expiresAt: string };
  semantics: 'current_confirmed_preference_not_business_authority';
} | {
  status: 'revoked' | 'unavailable';
  memory: { memoryId: string; revision: number; aclRevision: number; storageStatus: 'proposed' | 'confirmed' | 'deleted';
    consentStatus: 'confirmed' | 'revoked' | 'expired' | 'invalidated' | 'not_confirmed'; expiresAt: string };
  semantics: 'preference_not_available_without_current_confirmation';
};
export type AiKnowledgePreferencesReadResponseDraft = {
  items: Preference[]; ambiguities: Array<{ kind: AiPreferenceValueDraft['kind']; memoryIds: string[]; nextStep: 'human_selection' }>;
  ambiguityCoverage: 'returned_items_only'; businessCompatibility: 'unavailable'; truncated: boolean;
  coverage: 'bounded_window'; pagination: 'unavailable'; semantics: 'preference_not_authority';
};
export type AiKnowledgeConsumptionHttpResponsesDraft = {
  readDocument: AiKnowledgeDocumentReadResponseDraft;
  openSource: AiKnowledgeChunkDraft;
  readMemory: AiKnowledgeMemoryReadResponseDraft;
  readPreferences: AiKnowledgePreferencesReadResponseDraft;
};
export type AiKnowledgeConsumptionHttpErrorDraft = {
  code: 'AI_INVALID_INPUT' | 'AI_REVISION_CONFLICT' | 'AI_RESOURCE_UNAVAILABLE'; retryable: false;
};
