/** Public observation of an existing, source-revalidated model result. Text,
 * citations and tool candidates remain data, not approval or execution proof.
 * Current authorization and original dispatch provenance stay server-owned. */
import type { AiKnowledgeSourceDraft, AiPreferenceValueDraft } from './ai-knowledge-draft';
import type { AiOrderExplainRequestDraft } from './ai-native';
import type { AiSceneRequestReceiptDraft } from './ai-scene-request-draft';
import type { AiOrderEvidenceReferenceDraft, AiOrderExplanationMaterialDraft,
  AiOpeningBusinessMaterialDraft, AiQuoteBusinessMaterialDraft } from './ai-business-material-draft';

type PreferenceKind = AiPreferenceValueDraft['kind'];
export interface AiSceneKnowledgeSnapshotDraft {
  version: 'ain-scene-knowledge-1'; originalInputRef: string; contentHash: string;
  material: {
    requestId: string; observationId?: string; queryFingerprint: string; observedAt: string;
    trust: 'untrusted_data'; purpose: 'context_only'; status: 'ready' | 'partial';
    sources: Array<{ sourceId: string; source: Extract<AiKnowledgeSourceDraft, { kind: 'document' }>;
      snippet: string; contentFingerprint: string; snippetFingerprint: string; truncated: boolean; trust: 'untrusted_data' }>;
    sections?: { knowledge: 'authorized_sources'; preferences: 'optional_confirmed_preferences'; businessFacts: 'core_authoritative_only' };
    preferences: { status: 'not_requested' } | {
      status: 'ready'; items: Array<{ memoryId: string; revision: number; aclRevision: number; expiresAt: string;
        preference: AiPreferenceValueDraft; confirmationRecordId: string }>;
      ambiguities: Array<{ kind: PreferenceKind; memoryIds: string[]; nextStep: 'human_selection' }>;
      ambiguityCoverage: 'returned_items_only'; businessCompatibility: 'unavailable'; truncated: boolean;
      coverage: 'bounded_window'; pagination: 'unavailable'; semantics: 'preference_not_authority';
    };
  };
}
interface ModelObservation<S extends AiSceneRequestReceiptDraft['sceneCode']> {
  original: Omit<AiSceneRequestReceiptDraft, 'sceneCode'> & { sceneCode: S }; sceneCode: S;
  taskId: string; runId: string; resultId: string; observedAt: string; businessExecution: 'not_inferred_from_model_result';
}
type Available<M> = {
  status: 'available'; text: { value: string; trust: 'unverified_model_text_not_execution_evidence' };
  materialHash: string; callId: string; facts: M; knowledge?: AiSceneKnowledgeSnapshotDraft;
  citationValidation: 'supplied_sources_only_text_not_validated'; nextAction: 'read_only';
};
type AvailableOrder = ModelObservation<'order_explanation'> & Available<AiOrderExplanationMaterialDraft> & {
  sources: AiOrderEvidenceReferenceDraft[];
  toolCandidates?: { requests: AiOrderExplainRequestDraft[]; execution: 'not_attempted'; authorization: 'not_granted' };
};
type AvailableOpening = ModelObservation<'opening_diagnosis'> & Available<AiOpeningBusinessMaterialDraft> & { sources: [] };
type AvailableQuote = ModelObservation<'quote_clarification'> & Available<AiQuoteBusinessMaterialDraft> & { sources: [] };
type Unavailable<S extends AiSceneRequestReceiptDraft['sceneCode']> = ModelObservation<S> & { text: null; automaticRetry: false } & (
  | { status: 'unknown'; nextAction: 'reconcile' }
  | { status: 'failed'; nextAction: 'manual_review' }
  | { status: 'stale'; nextAction: 'reread_facts' }
);
export type AiSceneModelResultObservationDraft = AvailableOrder | AvailableOpening | AvailableQuote
  | Unavailable<'order_explanation'> | Unavailable<'opening_diagnosis'> | Unavailable<'quote_clarification'>;
