/** Public observation of an existing, source-revalidated model result. Text,
 * citations and tool candidates remain data, not approval or execution proof.
 * Current authorization and original dispatch provenance stay server-owned. */
import type { AiKnowledgeSourceDraft, AiKnowledgeChunkDraft, AiPreferenceValueDraft } from './ai-knowledge-draft';
import type { AiWorkspaceScope, AiOrderExplainRequestDraft } from './ai-native';
import type { AiOrderReadFactsDraft } from './ai-order-facts-draft';
import type { AiSceneRequestReceiptDraft } from './ai-scene-request-draft';
import type { AiOrderHistoryFactsDraft, AiOrderLocalPaymentsDraft, AiOrderInspectionEvidenceDraft, AiOpeningSectionMaterialDraft,
  AiOrderEvidenceReferenceDraft, AiOrderExplanationMaterialDraft, AiOpeningBusinessMaterialDraft, AiQuoteBusinessMaterialDraft,
  AiQuoteGoalBusinessMaterialDraft } from './ai-business-material-draft';

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
type AvailableQuote = ModelObservation<'quote_clarification'> & Available<AiQuoteBusinessMaterialDraft | AiQuoteGoalBusinessMaterialDraft> & { sources: [] };
type Unavailable<S extends AiSceneRequestReceiptDraft['sceneCode']> = ModelObservation<S> & { text: null; automaticRetry: false } & (
  | { status: 'unknown'; nextAction: 'reconcile' }
  | { status: 'failed'; nextAction: 'manual_review' }
  | { status: 'stale'; nextAction: 'reread_facts' }
);
export type AiSceneModelResultObservationDraft = AvailableOrder | AvailableOpening | AvailableQuote
  | Unavailable<'order_explanation'> | Unavailable<'opening_diagnosis'> | Unavailable<'quote_clarification'>;

/** The index locates an original supplied source; it is not a resource grant.
 * Omitted sourceKind retains the original order-only request behaviour. */
export interface AiSceneModelSourceReadDraft {
  original: Pick<AiSceneRequestReceiptDraft, 'draftVersion' | 'inputRef'>;
  resultId: string; sourceIndex: number; sourceKind?: 'order' | 'knowledge';
}
type Evidence<T> = { coverage: 'partial'; value: T; source: AiOrderEvidenceReferenceDraft };
type FeeFacts = Extract<AiOrderExplanationMaterialDraft['payload'], { question: 'fees' }>['facts'];
type OrderSourceValues = {
  order: Evidence<AiOrderReadFactsDraft['order']>;
  amounts: FeeFacts['amounts']; rental_period: FeeFacts['fulfillment'];
  saved_basis: Evidence<AiOrderHistoryFactsDraft>; payment_records: Evidence<AiOrderLocalPaymentsDraft>;
  inspection_records: Evidence<AiOrderInspectionEvidenceDraft>;
};
export type AiOrderSourceObservationDraft = {
  [F in keyof OrderSourceValues]: { status: 'available'; scope: AiWorkspaceScope; orderId: string; field: F;
    value: OrderSourceValues[F]; observedAt: string; freshness: 'current_observation_not_historical_payment_snapshot';
    reauthorization: 'current_order_authority_rechecked' }
}[keyof OrderSourceValues]
  | { status: 'stale'; field: keyof OrderSourceValues; reason: 'order_version_changed_reread_material' }
  | { status: 'missing'; scope: AiWorkspaceScope; orderId: string; field: keyof OrderSourceValues;
      reason: 'historical_or_optional_source_not_loaded' };
export type AiSceneModelSourceReadResponseDraft = {
  original: AiSceneRequestReceiptDraft; resultId: string; sourceIndex: number; execution: 'not_attempted';
} & (
  | { original: Omit<AiSceneRequestReceiptDraft, 'sceneCode'> & { sceneCode: 'order_explanation' };
      sourceKind?: never; reference: AiOrderEvidenceReferenceDraft; source: AiOrderSourceObservationDraft }
  | { sourceKind: 'knowledge'; reference: Extract<AiKnowledgeSourceDraft, { kind: 'document' }>; source: AiKnowledgeChunkDraft }
);
type OpeningConfiguration = AiOpeningBusinessMaterialDraft['configuration'];
export interface AiOpeningSectionObservationDraft extends Pick<AiOpeningSectionMaterialDraft,
  'key' | 'issue' | 'required' | 'impact' | 'evidence' | 'manual' | 'candidate' | 'externalVerification'> {
  status: 'ready_for_human_review' | 'capability_unavailable' | 'missing_configuration' | 'check_failed' | 'awaiting_external_evidence';
  current: NonNullable<OpeningConfiguration['products'] | OpeningConfiguration['pricing'] | OpeningConfiguration['fulfillment']>
    | { configVersion: string; fields: string[] } | { fields: string[] };
  materials: string[]; persistence: 'not_attempted'; publication: 'not_attempted';
}
export interface AiSceneOpeningModelSourceReadResponseDraft {
  original: Omit<AiSceneRequestReceiptDraft, 'sceneCode'> & { sceneCode: 'opening_diagnosis' };
  resultId: string; key: string; reference: AiOpeningSectionMaterialDraft['evidence']; source: AiOpeningSectionObservationDraft;
  frozenBasis: { materialHash: string; reference: Omit<AiOpeningSectionMaterialDraft['evidence'], 'observedAt'> };
  observation: 'current_authorized_reobservation'; historicalConfiguration: 'not_loaded';
  execution: 'not_attempted'; proposalPersistence: 'not_attempted';
}
