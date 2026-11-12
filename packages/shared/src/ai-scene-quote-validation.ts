/** Browser/Node-neutral checks of owned quote and original material schemas. No remote
 * schema, coercion/defaults, business calculation or execution authority.
 * Unknown schema keywords and bounded-work exhaustion fail closed. */
import { AI_SCENE_QUOTE_HTTP_SCHEMAS, type AiSceneModelQuotePreparationResponseDraft,
  type AiSceneModelQuoteConfirmResponseDraft, type AiSceneModelQuoteReceiptResponseDraft,
  type AiOriginalQuoteReviewResponseDraft, type AiOriginalQuoteConfirmResponseDraft, type AiOriginalQuoteReceiptResponseDraft } from './ai-scene-quote-http-draft';
import { AI_SCENE_REQUEST_DRAFT_SCHEMAS } from './ai-scene-request-draft-schemas';
import { AI_QUOTE_SELECTION_DRAFT_SCHEMAS } from './ai-quote-selection-draft-schemas';
import { AI_TASK_RECOVERY_HTTP_SCHEMAS } from './ai-task-recovery-draft';
import { AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS } from './ai-approval-application-draft-schemas';
import { AI_PROPOSAL_DRAFT_SCHEMAS } from './ai-proposal-draft-schemas';
import { AI_SCOPE_DRAFT_SCHEMAS } from './ai-scope-draft-schemas';
import { AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS } from './ai-business-material-draft-schemas';
import type { AiSceneTaskMaterialResponseDraft, AiOrderSceneTaskMaterialV2 } from './ai-business-material-draft';
import { z } from 'zod';
import { validateAiLeafSchemaValue } from './ai-leaf-schema-validation';
import type { AiClarifiedQuoteSelectionPreparationDraft, AiClarifiedQuoteSelectionOriginalOperationReadDraft,
  AiQuoteSelectionSelectResponseDraft, AiQuoteSelectionReconcileResponseDraft, AiQuoteSelectionProofDraft,
  AiSelectedQuoteTaskRunDraft, AiSelectedQuoteTaskResultDraft, AiHumanQuoteOrderRepreparePreparationDraft,
  AiHumanQuoteOrderReprepareRequestDraft, AiHumanQuoteOrderReprepareResponseDraft,
  AiQuoteRequestReissuePreparationInputDraft, AiQuoteRequestReissueReferenceDraft, AiQuoteRequestReissuePreparationDraft,
  AiQuoteRequestReissueCreateDraft, AiQuoteRequestReissueOperationDraft, AiQuoteRequestReissueSelectionPreparationDraft,
  AiQuoteRequestReissueSelectDraft, AiQuoteRequestReissueSelectionOperationDraft } from './ai-quote-selection-draft';
import type { AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

interface Responses {
  AiSceneModelQuotePreparationResponseDraft: AiSceneModelQuotePreparationResponseDraft;
  AiSceneModelQuoteConfirmResponseDraft: AiSceneModelQuoteConfirmResponseDraft;
  AiSceneModelQuoteReceiptResponseDraft: AiSceneModelQuoteReceiptResponseDraft;
  AiOriginalQuoteReviewResponseDraft: AiOriginalQuoteReviewResponseDraft;
  AiOriginalQuoteConfirmResponseDraft: AiOriginalQuoteConfirmResponseDraft;
  AiOriginalQuoteReceiptResponseDraft: AiOriginalQuoteReceiptResponseDraft;
}
interface SelectionValues {
  AiQuoteSelectionProofRequest: AiQuoteSelectionProofDraft;
  AiQuoteRequestReissuePreparationInputDraft: AiQuoteRequestReissuePreparationInputDraft;
  AiQuoteRequestReissueReferenceDraft: AiQuoteRequestReissueReferenceDraft;
  AiQuoteRequestReissuePreparationDraft: AiQuoteRequestReissuePreparationDraft;
  AiQuoteRequestReissueCreateDraft: AiQuoteRequestReissueCreateDraft;
  AiQuoteRequestReissueOperationDraft: AiQuoteRequestReissueOperationDraft;
  AiQuoteRequestReissueSelectionPreparationDraft: AiQuoteRequestReissueSelectionPreparationDraft;
  AiQuoteRequestReissueSelectDraft: AiQuoteRequestReissueSelectDraft;
  AiQuoteRequestReissueSelectionOperationDraft: AiQuoteRequestReissueSelectionOperationDraft;
  AiClarifiedQuoteSelectionPreparationDraft: AiClarifiedQuoteSelectionPreparationDraft;
  AiClarifiedQuoteSelectionOriginalOperationReadDraft: AiClarifiedQuoteSelectionOriginalOperationReadDraft;
  AiQuoteSelectionSelectResponseDraft: AiQuoteSelectionSelectResponseDraft;
  AiQuoteSelectionReconcileResponseDraft: AiQuoteSelectionReconcileResponseDraft;
  AiSelectedQuoteTaskRunDraft: AiSelectedQuoteTaskRunDraft;
  AiSelectedQuoteTaskResultDraft: AiSelectedQuoteTaskResultDraft;
  AiHumanQuoteOrderRepreparePreparationDraft: AiHumanQuoteOrderRepreparePreparationDraft;
  AiHumanQuoteOrderReprepareRequestDraft: AiHumanQuoteOrderReprepareRequestDraft;
  AiHumanQuoteOrderReprepareResponseDraft: AiHumanQuoteOrderReprepareResponseDraft;
}
const definitions = { ...AI_SCENE_REQUEST_DRAFT_SCHEMAS, ...AI_SCENE_QUOTE_HTTP_SCHEMAS,
  ...AI_TASK_RECOVERY_HTTP_SCHEMAS, ...AI_QUOTE_SELECTION_DRAFT_SCHEMAS,
  ...AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS, ...AI_PROPOSAL_DRAFT_SCHEMAS, ...AI_SCOPE_DRAFT_SCHEMAS,
  ...AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS };

export function validateAiSceneQuoteHttpResponse<K extends keyof Responses>(name: K, value: unknown): value is Responses[K] {
  return Object.hasOwn(AI_SCENE_QUOTE_HTTP_SCHEMAS, name) && validateOwnedQuoteValue(AI_SCENE_QUOTE_HTTP_SCHEMAS[name], value);
}
/** Only named original-selection contracts; no private DTO or permissive
 * browser substitute for the server's current authorization and Core checks. */
export function validateAiQuoteSelectionHttpValue<K extends keyof SelectionValues>(name: K, value: unknown): value is SelectionValues[K] {
  return Object.hasOwn(AI_QUOTE_SELECTION_DRAFT_SCHEMAS, name) && validateOwnedQuoteValue(AI_QUOTE_SELECTION_DRAFT_SCHEMAS[name], value);
}
/** Reuse the already-published closed material schema, including original
 * request and task references. No feature-private duplicate DTO or authority. */
export const aiOpeningTaskMaterialResponse: z.ZodType<Extract<AiSceneTaskMaterialResponseDraft,
  { original: { sceneCode: 'opening_diagnosis' } }>> = z.custom<Extract<AiSceneTaskMaterialResponseDraft,
  { original: { sceneCode: 'opening_diagnosis' } }>>((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const original = (value as { original?: { sceneCode?: unknown } }).original;
    return original?.sceneCode === 'opening_diagnosis'
      && validateOwnedQuoteValue(AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS.AiSceneTaskMaterialResponseDraft, value);
  }, { message: 'AI_RESOURCE_UNAVAILABLE' }).transform(value => structuredClone(value));
export const aiOrderSceneTaskMaterialV2 = z.custom<AiOrderSceneTaskMaterialV2>((value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const original = (value as { original?: { sceneCode?: unknown } }).original;
  return original?.sceneCode === 'order_explanation'
    && validateOwnedQuoteValue(AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS.AiOrderSceneTaskMaterialV2, value);
}, { message: 'AI_RESOURCE_UNAVAILABLE' }).transform(value => structuredClone(value));
function validateOwnedQuoteValue(root: AiLeafSchemaDraft, value: unknown): boolean {
  return validateAiLeafSchemaValue(root, value, definitions);
}
