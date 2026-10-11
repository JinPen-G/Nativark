import type { AiExecutionScope } from './ai-native';
import { AI_KNOWLEDGE_DRAFT_VERSION, type AiKnowledgeChunkDraft, type AiKnowledgeDocumentDraft, type AiKnowledgeSourceDraft, type AiPreferenceValueDraft } from './ai-knowledge-draft';
import { AI_KNOWLEDGE_DRAFT_SCHEMAS } from './ai-knowledge-draft-schemas';
import { leafClosed as obj, leafEnum as choice, leafInt as int, leafList as list, leafText as text,
  leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

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
export type AiKnowledgeSourceReadResponseDraft = AiKnowledgeChunkDraft;
export type AiKnowledgeConsumptionHttpResponsesDraft = {
  readDocument: AiKnowledgeDocumentReadResponseDraft;
  openSource: AiKnowledgeSourceReadResponseDraft;
  readMemory: AiKnowledgeMemoryReadResponseDraft;
  readPreferences: AiKnowledgePreferencesReadResponseDraft;
};
export type AiKnowledgeConsumptionHttpErrorDraft = {
  code: 'AI_INVALID_INPUT' | 'AI_REVISION_CONFLICT' | 'AI_RESOURCE_UNAVAILABLE'; retryable: false;
};

const id: AiLeafSchemaDraft = { ...text(128), pattern: '^[A-Za-z0-9_-]+$' };
const revision = int(1, 4294967294), boolean: AiLeafSchemaDraft = { type: 'boolean' };
const yes: AiLeafSchemaDraft = { type: 'boolean', const: true }, no: AiLeafSchemaDraft = { type: 'boolean', const: false };
const scope: AiLeafSchemaDraft = { oneOf: [obj({ kind: choice('platform') }), obj({ kind: choice('tenant'), tenantId: id }),
  obj({ kind: choice('workspace'), tenantId: id, workspaceId: id })] };
const locator: AiLeafSchemaDraft = { oneOf: [obj({ kind: choice('page'), page: int(1, 100000), paragraph: int(1, 100000) }),
  obj({ kind: choice('section'), sectionId: id, paragraph: int(1, 100000) })] };
const preference = AI_KNOWLEDGE_DRAFT_SCHEMAS.AiPreferenceValueDraft;
const reference = { kind: choice('document'), documentId: id, documentVersion: id, chunkId: id,
  aclRevision: { type: 'integer', minimum: 1 } as AiLeafSchemaDraft, locator };
const source = obj({ ...reference, scope });
const metadata = { documentId: id, title: text(256), documentVersion: id, revision, aclRevision: revision,
  publication: choice('draft', 'published', 'withdrawn', 'deleted'), parsing: choice('pending', 'parsed', 'failed', 'rejected'),
  indexing: choice('not_indexed', 'indexing', 'indexed', 'failed') };
const observation = { scope, audience: choice('operator'), observedAt: time, bounded: yes,
  semantics: choice('current_policy_rechecked_metadata_and_preview_not_business_fact') };
const readyPreview = obj({ status: choice('ready'), documentVersion: id, aclRevision: revision, truncated: boolean,
  sources: list(obj({ source, snippet: text(2000), contentFingerprint: { ...text(64, 64), pattern: '^[a-f0-9]{64}$' },
    trust: choice('untrusted_data') }), 10), semantics: choice('preview_not_approval_or_search_readiness') });
const unavailablePreview = obj({ status: choice('unavailable'), sources: list(obj({}), 0) });
const preferenceItem = obj({ memoryId: id, revision, aclRevision: revision, expiresAt: time, preference, confirmationRecordId: id });
const memoryMetadata = obj({ memoryId: id, revision, aclRevision: revision, expiresAt: time,
  storageStatus: choice('proposed', 'confirmed', 'deleted'), consentStatus: choice('confirmed', 'revoked', 'expired', 'invalidated', 'not_confirmed') });

export const AI_KNOWLEDGE_CONSUMPTION_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiKnowledgeDocumentReadRequestDraft: obj({ documentId: id, previewLimit: int(1, 10) }, ['documentId']),
  AiKnowledgeSourceReadRequestDraft: obj(reference),
  AiKnowledgeMemoryReadRequestDraft: obj({ memoryId: id }),
  AiKnowledgePreferencesReadRequestDraft: obj({ limit: int(1, 10) }),
  AiKnowledgeDocumentReadResponseDraft: { oneOf: [
    obj({ ...observation, state: choice('current_readable'), body: choice('current_readable'), preview: readyPreview,
      metadata: obj({ ...metadata, publication: choice('draft', 'published'), parsing: choice('parsed') }), truncated: boolean }),
    obj({ ...observation, state: choice('metadata_only'), body: choice('unavailable'), preview: unavailablePreview,
      metadata: obj({ ...metadata, publication: choice('draft', 'published') }), truncated: no }),
    obj({ ...observation, state: choice('withdrawn_or_deleted'), body: choice('unavailable'), preview: unavailablePreview,
      metadata: obj({ ...metadata, publication: choice('withdrawn', 'deleted') }), truncated: no }),
  ] },
  AiKnowledgeSourceReadResponseDraft: obj({ draftVersion: choice(AI_KNOWLEDGE_DRAFT_VERSION),
    documentId: id, documentVersion: id, chunkId: id, scope, aclRevision: revision, locator, text: text(2000), trust: choice('untrusted_data') }),
  AiKnowledgeMemoryReadResponseDraft: { oneOf: [
    obj({ status: choice('ready'), memory: preferenceItem, observedAt: time, scope, audience: choice('operator'),
      confirmation: obj({ confirmationRecordId: id, revision, aclRevision: revision, scope, audience: choice('operator'), confirmedAt: time, expiresAt: time }),
      semantics: choice('current_confirmed_preference_not_business_authority') }),
    obj({ status: choice('revoked', 'unavailable'), memory: memoryMetadata,
      semantics: choice('preference_not_available_without_current_confirmation') }),
  ] },
  AiKnowledgePreferencesReadResponseDraft: obj({ items: list(preferenceItem, 10),
    ambiguities: list(obj({ kind: choice('locale', 'fulfillment_location', 'display_density'), memoryIds: list(id, 10, 2), nextStep: choice('human_selection') }), 3),
    ambiguityCoverage: choice('returned_items_only'), businessCompatibility: choice('unavailable'), truncated: boolean,
    coverage: choice('bounded_window'), pagination: choice('unavailable'), semantics: choice('preference_not_authority') }),
  AiKnowledgeConsumptionHttpErrorDraft: obj({ code: choice('AI_INVALID_INPUT', 'AI_REVISION_CONFLICT', 'AI_RESOURCE_UNAVAILABLE'), retryable: no }),
};
