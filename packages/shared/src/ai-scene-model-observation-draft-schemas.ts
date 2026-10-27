/** Exact existing model-result observation, with bounded source/preference
 * context. Missing/stale/unknown results never carry invented successful text. */
import { AI_SCENE_REQUEST_DRAFT_SCHEMAS } from './ai-scene-request-draft-schemas';
import { AI_KNOWLEDGE_DRAFT_SCHEMAS } from './ai-knowledge-draft-schemas';
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafId as id,
  leafText as text, leafTime as time, leafInt as integer, leafList as list, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
const hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const bool: AiLeafSchemaDraft = { type: 'boolean' }, no: AiLeafSchemaDraft = { type: 'boolean', const: false };
const documentSource = AI_KNOWLEDGE_DRAFT_SCHEMAS.AiKnowledgeSourceDraft.oneOf![0];
const preferenceKinds = choice('locale', 'fulfillment_location', 'display_density');
const knowledge = obj({ version: choice('ain-scene-knowledge-1'), originalInputRef: { type: 'string', format: 'uuid' }, contentHash: hash,
  material: obj({ requestId: id(), observationId: id(), queryFingerprint: hash, observedAt: time, trust: choice('untrusted_data'),
    purpose: choice('context_only'), status: choice('ready', 'partial'),
    sources: list(obj({ sourceId: hash, source: documentSource, snippet: text(2000), contentFingerprint: hash,
      snippetFingerprint: hash, truncated: bool, trust: choice('untrusted_data') }), 10),
    sections: obj({ knowledge: choice('authorized_sources'), preferences: choice('optional_confirmed_preferences'), businessFacts: choice('core_authoritative_only') }),
    preferences: { oneOf: [obj({ status: choice('not_requested') }), obj({ status: choice('ready'),
      items: list(obj({ memoryId: id(), revision: integer(1, 4294967294), aclRevision: integer(1, 4294967294), expiresAt: time,
        preference: ref('AiPreferenceValueDraft'), confirmationRecordId: id() }), 10),
      ambiguities: list(obj({ kind: preferenceKinds, memoryIds: list(id(), 10, 2), nextStep: choice('human_selection') }), 3),
      ambiguityCoverage: choice('returned_items_only'), businessCompatibility: choice('unavailable'), truncated: bool,
      coverage: choice('bounded_window'), pagination: choice('unavailable'), semantics: choice('preference_not_authority') })] }
  }, ['requestId', 'queryFingerprint', 'observedAt', 'trust', 'purpose', 'status', 'sources', 'preferences']) });
const base = (scene: string) => ({
  original: { ...AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReceiptDraft,
    properties: { ...AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReceiptDraft.properties!, sceneCode: choice(scene) } },
  sceneCode: choice(scene), taskId: id(), runId: id(), resultId: id(), observedAt: time,
  businessExecution: choice('not_inferred_from_model_result')
});
const available = (scene: string, material: string, order = false) => obj({ ...base(scene), status: choice('available'),
  text: obj({ value: text(131072, 0), trust: choice('unverified_model_text_not_execution_evidence') }), materialHash: hash,
  callId: id(), facts: ref(material), sources: list(ref('AiOrderEvidenceReferenceDraft'), order ? 5 : 0), knowledge: ref('AiSceneKnowledgeSnapshotDraft'),
  ...(order ? { toolCandidates: obj({ requests: list(ref('AiOrderExplainRequestDraft'), 8, 1), execution: choice('not_attempted'), authorization: choice('not_granted') }) } : {}),
  citationValidation: choice('supplied_sources_only_text_not_validated'), nextAction: choice('read_only')
}, [...Object.keys(base(scene)), 'status', 'text', 'materialHash', 'callId', 'facts', 'sources', 'citationValidation', 'nextAction']);
const unavailable = (scene: string, status: string, nextAction: string) => obj({ ...base(scene), status: choice(status),
  text: { type: 'null' }, nextAction: choice(nextAction), automaticRetry: no });
export const AI_SCENE_MODEL_OBSERVATION_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiSceneKnowledgeSnapshotDraft: knowledge,
  AiSceneModelResultObservationDraft: { oneOf: [available('order_explanation', 'AiOrderExplanationMaterialDraft', true),
    available('opening_diagnosis', 'AiOpeningBusinessMaterialDraft'), available('quote_clarification', 'AiQuoteBusinessMaterialDraft'),
    ...['order_explanation', 'opening_diagnosis', 'quote_clarification'].flatMap(scene => [unavailable(scene, 'unknown', 'reconcile'),
      unavailable(scene, 'failed', 'manual_review'), unavailable(scene, 'stale', 'reread_facts')])] }
};
