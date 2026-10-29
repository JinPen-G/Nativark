/** Frozen recognition input, candidate result and original inspection receipts.
 * Preparation, saved candidates, business submission and draft linkage remain
 * separate. Unknown results are original-key observations, never retry grants. */
import { leafClosed as object, leafEnum as choice, leafId as genericId, leafInt as integer,
  leafList as list, leafRef as ref, leafText as text, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
import type { AiInspectionCandidateDraft } from './ai-inspection-draft';
import type { AiInspectionRecognitionRequest, AiInspectionRecognitionTaskReference, AiStaffInspectionSavedReference,
  AiInspectionOperationResult, AiInspectionDraftReadRequest, AiInspectionPrepareSubmissionRequest, AiInspectionSubmitRequest } from './ai-inspection-persistence';

type DraftSaved = AiInspectionOperationResult & { status: 'draft_saved'; inspectionId: null };
type Prepared = AiInspectionOperationResult & { status: 'prepared'; inspectionId: null };
export type AiInspectionResultReadRequest = AiInspectionRecognitionTaskReference & { taskId: string; resultId: string };
export type AiInspectionInputPrepareResponse = DraftSaved & { inputId: string; dispatch: 'unavailable'; code: 'CAPABILITY_UNSUPPORTED' };
export type AiInspectionInputReceiptResponse = { inputId: string; execution: 'not_attested'; retryable: false } & (
  | { status: 'found'; result: DraftSaved } | { status: 'absent' | 'unavailable' });
export type AiInspectionResultReadResponse = AiInspectionResultReadRequest & {
  resultHash: string; inputFingerprint: string; runId: string; stepId: string; observedAt: string;
  trust: 'untrusted_candidate'; automaticRetry: false; persistence: 'not_saved'; execution: 'not_attempted';
} & (
  | { status: 'available'; candidates: AiInspectionCandidateDraft[]; recognitionEvidence: 'persisted_image_step' | 'persisted_audio_step'; nextAction: 'human_review' }
  | { status: 'unknown' | 'failed'; candidates: []; recognitionEvidence: 'not_confirmed'; nextAction: 'reconcile_or_manual_review' });
export type AiInspectionResultSaveResponse = { status: 'saved'; result: DraftSaved; execution: 'not_attempted' };
type Mode = 'original_single' | 'manual_review_only';
export type AiInspectionSubmissionPrepareResponse = Prepared & { mode: Mode; businessValidation: 'required_at_original_inspection_entry' };
export type AiInspectionSubmissionPreparationRequest = { kind: 'prepare' | 'prepareReview'; request: AiInspectionPrepareSubmissionRequest };
export type AiInspectionSubmissionPreparationResponse = { execution: 'not_attested' } & (
  | { status: 'found'; result: Prepared; mode: Mode; businessValidation: 'required_at_original_inspection_entry' }
  | { status: 'absent' | 'unavailable' });
export type AiInspectionSubmissionSubmitResponse = { draftId: string } & (
  | { status: 'submitted'; inspectionId: string; draftLinked: boolean }
  | { status: 'submission_unknown'; nextAction: 'reconcile_original_action' }
  | { status: 'submission_unknown'; receiptLookup: 'absent' | 'unavailable'; actionId: string; requestHash: string; nextAction: 'manual_reconcile_original_action' });
export type AiInspectionSubmissionReadResponse = { draftId: string; revision: number; retryable: false } & (
  | { status: 'not_prepared' }
  | { actionId: string; requestHash: string; semantics: 'original_receipt_observation_not_submission_or_draft_link' } & (
      | { status: 'submitted'; inspectionId: string; draftLinked: boolean }
      | { status: 'submission_unknown'; draftLinked: false; nextAction: 'manual_reconcile_original_action' }));
export interface AiInspectionLifecycleHttpRequests {
  'input-prepare': AiInspectionRecognitionRequest; 'input-receipt': AiInspectionRecognitionRequest;
  'result-read': AiInspectionResultReadRequest; 'result-save': AiStaffInspectionSavedReference;
  'submission-review': AiInspectionPrepareSubmissionRequest; 'submission-prepare': AiInspectionPrepareSubmissionRequest;
  'submission-preparation': AiInspectionSubmissionPreparationRequest; 'submission-submit': AiInspectionSubmitRequest;
  'submission-read': AiInspectionDraftReadRequest;
}
export interface AiInspectionLifecycleHttpResponses {
  'input-prepare': AiInspectionInputPrepareResponse; 'input-receipt': AiInspectionInputReceiptResponse;
  'result-read': AiInspectionResultReadResponse; 'result-save': AiInspectionResultSaveResponse;
  'submission-review': AiInspectionSubmissionPrepareResponse; 'submission-prepare': AiInspectionSubmissionPrepareResponse;
  'submission-preparation': AiInspectionSubmissionPreparationResponse; 'submission-submit': AiInspectionSubmissionSubmitResponse;
  'submission-read': AiInspectionSubmissionReadResponse;
}
export const AI_INSPECTION_LIFECYCLE_HTTP_CONTRACTS = Object.freeze({
  'input-prepare': { request: 'AiInspectionRecognitionRequest', response: 'AiInspectionInputPrepareResponse', write: true },
  'input-receipt': { request: 'AiInspectionRecognitionRequest', response: 'AiInspectionInputReceiptResponse', write: false },
  'result-read': { request: 'AiInspectionResultReadRequest', response: 'AiInspectionResultReadResponse', write: false },
  'result-save': { request: 'AiStaffInspectionSavedReference', response: 'AiInspectionResultSaveResponse', write: true },
  'submission-review': { request: 'AiInspectionPrepareSubmissionRequest', response: 'AiInspectionSubmissionPrepareResponse', write: true },
  'submission-prepare': { request: 'AiInspectionPrepareSubmissionRequest', response: 'AiInspectionSubmissionPrepareResponse', write: true },
  'submission-preparation': { request: 'AiInspectionSubmissionPreparationRequest', response: 'AiInspectionSubmissionPreparationResponse', write: false },
  'submission-submit': { request: 'AiInspectionSubmitRequest', response: 'AiInspectionSubmissionSubmitResponse', write: true },
  'submission-read': { request: 'AiInspectionDraftReadRequest', response: 'AiInspectionSubmissionReadResponse', write: false },
} as const);
const id = { ...genericId(), maxLength: 128 }, hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const no: AiLeafSchemaDraft = { type: 'boolean', const: false }, bool: AiLeafSchemaDraft = { type: 'boolean' };
const target = { orderId: id, allocationId: id, templateId: id, stage: choice('pickup', 'return'), draftId: id };
const recognition = { ...target, inputId: id, expectedRevision: integer(1, 999), taskId: id, resultId: id };
const saved = { draftId: id, revision: integer(1, 1000), status: choice('draft_saved'), inspectionId: { type: 'null' } };
const prepared = { ...saved, status: choice('prepared') };
const operation = { ...target, operationId: id, expectedRevision: integer(1, 998) };
const preparation = object({ ...operation, expectedRevision: integer(1, 997), actionId: id, handoverSignatureFileAssetId: id }, [...Object.keys(operation), 'actionId']);
const mode = choice('original_single', 'manual_review_only'), validation = choice('required_at_original_inspection_entry');
const recognitionBase = { ...recognition, resultHash: hash, inputFingerprint: hash, runId: id, stepId: id, observedAt: time,
  trust: choice('untrusted_candidate'), automaticRetry: no, persistence: choice('not_saved'), execution: choice('not_attempted') };
const inputReceipt = { inputId: id, execution: choice('not_attested'), retryable: no };
const readBase = { draftId: id, revision: integer(1, 1000), retryable: no };
const observed = { ...readBase, actionId: id, requestHash: hash, semantics: choice('original_receipt_observation_not_submission_or_draft_link') };
export const AI_INSPECTION_LIFECYCLE_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiInspectionRecognitionRequest: object({ ...target, operationId: id, expectedRevision: integer(1, 999), question: text(4000) }),
  AiInspectionInputPrepareResponse: object({ ...saved, inputId: id, dispatch: choice('unavailable'), code: choice('CAPABILITY_UNSUPPORTED') }),
  AiInspectionInputReceiptResponse: { oneOf: [object({ ...inputReceipt, status: choice('found'), result: object(saved) }),
    object({ ...inputReceipt, status: choice('absent', 'unavailable') })] },
  AiInspectionResultReadRequest: object(recognition),
  AiInspectionResultReadResponse: { oneOf: [object({ ...recognitionBase, status: choice('available'),
    candidates: list(ref('AiInspectionCandidateDraft'), 100), recognitionEvidence: choice('persisted_image_step', 'persisted_audio_step'), nextAction: choice('human_review') }),
    object({ ...recognitionBase, status: choice('unknown', 'failed'), candidates: list(ref('AiInspectionCandidateDraft'), 0),
      recognitionEvidence: choice('not_confirmed'), nextAction: choice('reconcile_or_manual_review') })] },
  AiInspectionResultSaveResponse: object({ status: choice('saved'), result: object(saved), execution: choice('not_attempted') }),
  AiInspectionSubmitRequest: object(operation),
  AiInspectionPrepareSubmissionRequest: preparation,
  AiInspectionSubmissionPrepareResponse: object({ ...prepared, mode, businessValidation: validation }),
  AiInspectionSubmissionPreparationRequest: object({ kind: choice('prepare', 'prepareReview'), request: preparation }),
  AiInspectionSubmissionPreparationResponse: { oneOf: [object({ status: choice('found'), result: object(prepared), mode,
    execution: choice('not_attested'), businessValidation: validation }), object({ status: choice('absent', 'unavailable'), execution: choice('not_attested') })] },
  AiInspectionSubmissionSubmitResponse: { oneOf: [
    object({ status: choice('submitted'), draftId: id, inspectionId: id, draftLinked: bool }),
    object({ status: choice('submission_unknown'), draftId: id, nextAction: choice('reconcile_original_action') }),
    object({ status: choice('submission_unknown'), draftId: id, receiptLookup: choice('absent', 'unavailable'),
      actionId: id, requestHash: hash, nextAction: choice('manual_reconcile_original_action') })] },
  AiInspectionSubmissionReadResponse: { oneOf: [object({ ...readBase, status: choice('not_prepared') }),
    object({ ...observed, status: choice('submitted'), inspectionId: id, draftLinked: bool }),
    object({ ...observed, status: choice('submission_unknown'), draftLinked: no, nextAction: choice('manual_reconcile_original_action') })] },
};
