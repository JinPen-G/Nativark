import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_QUOTE_SELECTION_DRAFT_SCHEMAS, type AiQuoteSelectionCreateDraft, type AiQuoteSelectionReadDraft,
  type AiClarifiedQuoteSelectionRequestDraft, type AiClarifiedQuoteSelectionPreparationDraft, type AiQuoteSelectionProofDraft,
  type AiQuoteSelectionSelectResponseDraft, type AiQuoteSelectionReconcileResponseDraft, type AiQuoteSelectionReceiptDraft,
  type AiHumanQuoteOrderRepreparePreparationDraft, type AiQuoteRequestReissuePreparationDraft, type AiQuoteRequestReissueOperationDraft,
  type AiQuoteRequestReissueSelectionPreparationDraft, type AiQuoteRequestReissueSelectionOperationDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { freezeOriginalInput } from './original-request.validation';
import { HttpException } from '@nestjs/common';
import { AI_PROPOSAL_DRAFT_SCHEMAS, AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS,
  AI_TASK_RECOVERY_HTTP_SCHEMAS, AI_TASK_CONFIRMATION_HISTORY_SCHEMAS,
  type AiSelectedQuoteTaskRunDraft, type AiSelectedQuoteTaskConfirmationDraft, type AiSelectedQuoteTaskRecoveryDraft,
  type AiSelectedQuoteTaskResultDraft, type AiSelectedQuoteTaskCancelResponseDraft,
  type AiHumanQuoteOrderDecisionResponseDraft, type AiHumanQuoteOrderReprepareResponseDraft,
  type AiApprovalApplicationReviewDraft, type AiApprovalApplicationReceiptDraft, type AiApprovalReprepareEligibilityDraft } from '@rental-os/shared';
import { AI_TASK_OBSERVATION_DRAFT_SCHEMAS, AI_SCENE_REQUEST_DRAFT_SCHEMAS, AI_TASK_INPUT_DRAFT_SCHEMAS,
  AI_SCENE_QUOTE_HTTP_SCHEMAS, type AiTaskMetadataPageDraft, type AiTaskEventPageDraft, type AiTaskEventResetDraft } from '@rental-os/shared';
import { AI_NATIVE_COMPONENT_SCHEMAS } from '../../../contracts/ai-native-schemas';

export type AiQuoteSelectionProofRequest = AiQuoteSelectionProofDraft;
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const create = ajv.compile<AiQuoteSelectionCreateDraft>(AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiQuoteSelectionCreateDraft);
const read = ajv.compile<AiQuoteSelectionReadDraft>(AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiQuoteSelectionReadDraft);
const proof = ajv.compile<AiQuoteSelectionProofRequest>(AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiQuoteSelectionProofRequest);
const clarified = ajv.compile<AiClarifiedQuoteSelectionRequestDraft>(AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiClarifiedQuoteSelectionRequestDraft);
type QuoteSelectionResponses = { AiQuoteSelectionSelectResponseDraft: AiQuoteSelectionSelectResponseDraft;
  AiQuoteRequestReissuePreparationDraft: AiQuoteRequestReissuePreparationDraft;
  AiQuoteRequestReissueOperationDraft: AiQuoteRequestReissueOperationDraft;
  AiQuoteRequestReissueSelectionPreparationDraft: AiQuoteRequestReissueSelectionPreparationDraft;
  AiQuoteRequestReissueSelectionOperationDraft: AiQuoteRequestReissueSelectionOperationDraft;
  AiHumanQuoteOrderRepreparePreparationDraft: AiHumanQuoteOrderRepreparePreparationDraft;
  AiClarifiedQuoteSelectionPreparationDraft: AiClarifiedQuoteSelectionPreparationDraft;
  AiQuoteSelectionReconcileResponseDraft: AiQuoteSelectionReconcileResponseDraft;
  AiQuoteSelectionReceiptDraft: AiQuoteSelectionReceiptDraft;
  AiSelectedQuoteTaskRunDraft: AiSelectedQuoteTaskRunDraft;
  AiSelectedQuoteTaskConfirmationDraft: AiSelectedQuoteTaskConfirmationDraft;
  AiSelectedQuoteTaskRecoveryDraft: AiSelectedQuoteTaskRecoveryDraft;
  AiSelectedQuoteTaskResultDraft: AiSelectedQuoteTaskResultDraft;
  AiSelectedQuoteTaskCancelResponseDraft: AiSelectedQuoteTaskCancelResponseDraft;
  AiHumanQuoteOrderDecisionResponseDraft: AiHumanQuoteOrderDecisionResponseDraft;
  AiHumanQuoteOrderReprepareResponseDraft: AiHumanQuoteOrderReprepareResponseDraft;
  AiApprovalApplicationReviewDraft: AiApprovalApplicationReviewDraft;
  AiApprovalApplicationReceiptDraft: AiApprovalApplicationReceiptDraft;
  AiApprovalReprepareEligibilityDraft: AiApprovalReprepareEligibilityDraft;
  AiTaskMetadataPageDraft: AiTaskMetadataPageDraft;
  AiTaskEventsObservationDraft: AiTaskEventPageDraft | AiTaskEventResetDraft };
const responseNames = ['AiQuoteSelectionSelectResponseDraft', 'AiQuoteSelectionReconcileResponseDraft', 'AiQuoteSelectionReceiptDraft',
  'AiQuoteRequestReissuePreparationDraft', 'AiQuoteRequestReissueOperationDraft', 'AiQuoteRequestReissueSelectionPreparationDraft', 'AiQuoteRequestReissueSelectionOperationDraft',
  'AiHumanQuoteOrderRepreparePreparationDraft',
  'AiClarifiedQuoteSelectionPreparationDraft',
  'AiSelectedQuoteTaskRunDraft', 'AiSelectedQuoteTaskConfirmationDraft', 'AiSelectedQuoteTaskRecoveryDraft', 'AiSelectedQuoteTaskResultDraft',
  'AiSelectedQuoteTaskCancelResponseDraft', 'AiHumanQuoteOrderDecisionResponseDraft', 'AiHumanQuoteOrderReprepareResponseDraft',
  'AiApprovalApplicationReviewDraft', 'AiApprovalApplicationReceiptDraft', 'AiApprovalReprepareEligibilityDraft',
  'AiTaskMetadataPageDraft', 'AiTaskEventsObservationDraft'] as const;
const responseDefinitions = JSON.parse(JSON.stringify({ ...AI_NATIVE_COMPONENT_SCHEMAS, ...AI_PROPOSAL_DRAFT_SCHEMAS,
  ...AI_TASK_RECOVERY_HTTP_SCHEMAS, ...AI_TASK_CONFIRMATION_HISTORY_SCHEMAS,
  ...AI_TASK_OBSERVATION_DRAFT_SCHEMAS, ...AI_SCENE_REQUEST_DRAFT_SCHEMAS, ...AI_SCENE_QUOTE_HTTP_SCHEMAS, ...AI_TASK_INPUT_DRAFT_SCHEMAS,
  ...AI_APPROVAL_APPLICATION_DRAFT_SCHEMAS, ...AI_QUOTE_SELECTION_DRAFT_SCHEMAS }).replaceAll('#/components/schemas/', '#/$defs/'));
const responseValidators = Object.fromEntries(responseNames.map(name => [name,
  ajv.compile({ $ref: `#/$defs/${name}`, $defs: responseDefinitions })]));
export function validateQuoteSelectionHttpRequest(name: string, value: unknown): unknown {
  if (![AI_QUOTE_SELECTION_DRAFT_SCHEMAS, AI_TASK_OBSERVATION_DRAFT_SCHEMAS].some(schemas =>
    Object.prototype.hasOwnProperty.call(schemas, name))) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const copy = structuredClone(value);
  const validator = ajv.getSchema(`quote-http:${name}`) ?? ajv.compile({ $id: `quote-http:${name}`,
    $ref: `#/$defs/${name}`, $defs: responseDefinitions });
  if (!validator(copy) || Buffer.byteLength(JSON.stringify(copy), 'utf8') > 65536) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(copy);
}
/** A malformed saved-selection reply may follow COMMIT; only the original
 * selection command can observe it. Validation does not strip extra fields. */
export function validateQuoteSelectionResponse<K extends keyof QuoteSelectionResponses>(name: K, value: unknown, mayHaveCommitted = false): QuoteSelectionResponses[K] {
  try {
    const snapshot = structuredClone(value);
    const finite = (item: unknown): boolean => typeof item === 'number' ? Number.isFinite(item)
      : item && typeof item === 'object' ? Object.values(item).every(finite) : true;
    if (finite(snapshot)) {
      const wire = JSON.parse(JSON.stringify(snapshot));
      if (responseValidators[name](wire)) return wire as QuoteSelectionResponses[K];
    }
  } catch { /* never expose malformed producer content */ }
  if (mayHaveCommitted) throw new HttpException({ code: 'AI_RESULT_UNKNOWN' }, 409);
  throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
}
export function parseClarifiedQuoteSelection(value: unknown) {
  if (!clarified(value) || Buffer.byteLength(JSON.stringify(value), 'utf8') > 65536) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(structuredClone(value));
}
export function parseQuoteSelection(value: unknown) {
  if (!create(value) || Buffer.byteLength(JSON.stringify(value), 'utf8') > 32768
    || Date.parse(value.order.endAt) <= Date.parse(value.order.startAt)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(structuredClone(value));
}
export function parseQuoteSelectionRead(value: unknown) {
  if (!read(value)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(structuredClone(value));
}
export function parseQuoteSelectionProof(value: unknown) {
  if (!proof(value)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(structuredClone(value));
}
