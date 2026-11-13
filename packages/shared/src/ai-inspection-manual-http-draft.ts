/** Original staff manual-draft transport, including historical fields and exact
 * operation receipts. Dynamic field maps are typed, not arbitrary JSON; their
 * keys are checked at the HTTP boundary. No model or inspection approval. */
import { leafClosed as object, leafEnum as choice, leafId as genericId, leafInt as integer,
  leafList as list, leafText as text, leafRef as ref, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
import type { AiWorkspaceScope } from './ai-native';
import type { RentalInspectionTemplate, RentalAllocation } from './core';
import type { AiInspectionDraftCreateRequest, AiInspectionDraftEditRequest, AiInspectionDraftReadRequest,
  AiInspectionEvidenceChangeRequest, AiInspectionEvidenceRef, AiInspectionBindingRequest, AiInspectionTarget,
  AiInspectionDraftState, AiInspectionDraftStatus, AiInspectionOperationResult, AiInspectionReceiptLookup,
  AiInspectionOriginalOperationRequest, AiStaffInspectionHostProjection, AiStaffInspectionSavedReference,
  AiStaffInspectionHistoryRequest, AiStaffInspectionHistoryResponse, AiStaffInspectionReceiptHostRequest,
  AiStaffInspectionReceiptHostProjection, AiInspectionRecognitionBasisReference } from './ai-inspection-persistence';
import { AI_STAFF_INSPECTION_HISTORY_SCHEMAS } from './ai-inspection-persistence';
import type { AiInspectionReviewIssueDraft } from './ai-inspection-draft';
import { AI_INSPECTION_LIFECYCLE_HTTP_SCHEMAS, AI_INSPECTION_REVIEW_ISSUE_SCHEMA,
  type AiInspectionRecognitionBasisIssueDraft } from './ai-inspection-lifecycle-http-draft';

export interface AiInspectionTemplateResponseDraft {
  scope: AiWorkspaceScope; owner: { actorKind: 'user'; actorId: string }; audience: 'operator' | 'staff';
  orderId: string; allocationId: string; assetId: string; stage: 'pickup' | 'return';
  template: Omit<RentalInspectionTemplate, 'categoryCode' | 'enabled'> & { categoryCode: string; enabled: true };
  allocationStatus: Exclude<RentalAllocation['status'], 'released' | 'returned'>;
  bindingFingerprint: string; status: 'template_ready'; semantics: 'read_projection_not_inspection_or_action_authorization';
}
/** Current read projection only; never persisted as authority or an edit grant. */
export interface AiInspectionSavedCandidateReview {
  candidateId: string; basis: AiInspectionRecognitionBasisReference;
  reviewIssues: AiInspectionReviewIssueDraft[]; basisIssues: AiInspectionRecognitionBasisIssueDraft[];
  sourcesMatchDraftEvidence: boolean; adoption: 'human_confirmation_required' | 'unavailable';
}
export interface AiInspectionDraftReadResponse {
  draftId: string; revision: number; status: AiInspectionDraftStatus; target: AiInspectionTarget; assetId: string;
  templateVersion: string; bindingFingerprint: string; state: AiInspectionDraftState; inspectionId: string | null;
  recognitionEvidence: 'caller_supplied_not_model_execution_proof';
  candidateReviews: AiInspectionSavedCandidateReview[];
}
export interface AiInspectionManualHttpRequests {
  'history-read': AiStaffInspectionHistoryRequest; 'receipt-host-read': AiStaffInspectionReceiptHostRequest;
  'template-read': AiInspectionTarget; 'host-read': AiInspectionDraftReadRequest;
  'draft-create': AiInspectionDraftCreateRequest; 'draft-read': AiInspectionDraftReadRequest;
  'draft-edit': AiInspectionDraftEditRequest; 'evidence-bind': AiInspectionBindingRequest;
  'evidence-fingerprint': { target: AiInspectionTarget; refs: AiInspectionEvidenceRef[] };
  'evidence-replace': AiInspectionEvidenceChangeRequest; 'draft-operation': AiInspectionOriginalOperationRequest;
  'result-save-receipt': AiStaffInspectionSavedReference;
}
export interface AiInspectionManualHttpResponses {
  'history-read': AiStaffInspectionHistoryResponse; 'receipt-host-read': AiStaffInspectionReceiptHostProjection;
  'template-read': AiInspectionTemplateResponseDraft; 'host-read': AiStaffInspectionHostProjection;
  'draft-create': AiInspectionOperationResult; 'draft-read': AiInspectionDraftReadResponse;
  'draft-edit': AiInspectionOperationResult; 'evidence-bind': AiInspectionEvidenceRef;
  'evidence-fingerprint': string; 'evidence-replace': AiInspectionOperationResult;
  'draft-operation': AiInspectionReceiptLookup; 'result-save-receipt': AiInspectionReceiptLookup;
}
export const AI_INSPECTION_MANUAL_HTTP_CONTRACTS = Object.freeze({
  'history-read': { request: 'AiStaffInspectionHistoryRequest', response: 'AiStaffInspectionHistoryResponse', write: false },
  'receipt-host-read': { request: 'AiStaffInspectionReceiptHostRequest', response: 'AiStaffInspectionReceiptHostProjection', write: false },
  'template-read': { request: 'AiInspectionTarget', response: 'AiInspectionTemplateResponseDraft', write: false },
  'host-read': { request: 'AiInspectionDraftReadRequest', response: 'AiStaffInspectionHostProjection', write: false },
  'draft-create': { request: 'AiInspectionDraftCreateRequest', response: 'AiInspectionOperationResult', write: true },
  'draft-read': { request: 'AiInspectionDraftReadRequest', response: 'AiInspectionDraftReadResponse', write: false },
  'draft-edit': { request: 'AiInspectionDraftEditRequest', response: 'AiInspectionOperationResult', write: true },
  'evidence-bind': { request: 'AiInspectionBindingRequest', response: 'AiInspectionEvidenceRef', write: true },
  'evidence-fingerprint': { request: 'AiInspectionEvidenceFingerprintRequest', response: 'AiInspectionEvidenceFingerprintResponse', write: false },
  'evidence-replace': { request: 'AiInspectionEvidenceChangeRequest', response: 'AiInspectionOperationResult', write: true },
  'draft-operation': { request: 'AiInspectionOriginalOperationRequest', response: 'AiInspectionReceiptLookup', write: false },
  'result-save-receipt': { request: 'AiStaffInspectionSavedReference', response: 'AiInspectionReceiptLookup', write: false },
} as const);

const id = { ...genericId(), maxLength: 128 }, hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const bool: AiLeafSchemaDraft = { type: 'boolean' }, nil: AiLeafSchemaDraft = { type: 'null' };
const positive: AiLeafSchemaDraft = { type: 'integer', minimum: 1 };
const scalar: AiLeafSchemaDraft = { oneOf: [text(2000, 0), { type: 'number' }, bool, nil] };
const map = (value: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ type: 'object', maxProperties: 100, additionalProperties: value });
const target = { orderId: id, allocationId: id, templateId: id, stage: choice('pickup', 'return') };
const evidence = object({ attachmentId: id, attachmentRevision: positive });
const draftStatus = choice('draft_saved', 'prepared', 'submission_unknown', 'submitted');
const changed = { ...target, draftId: id, operationId: id, expectedRevision: integer(1, 999), bindingFingerprint: hash };
const field = { code: id, label: text(256), type: choice('boolean', 'number', 'text', 'select', 'photo'), required: bool };
const options = list(text(256), 100);
const template = object({ id, tenantId: id, categoryCode: text(128), code: id, name: text(256), stage: target.stage, version: id,
  enabled: { type: 'boolean', const: true }, fields: list(object({ ...field, unit: text(64, 0), options, usageMetric: bool }, Object.keys(field)), 100, 1),
  allocationIds: list(id, 200), sourceTemplateId: id, exchangeId: id },
  ['id', 'tenantId', 'categoryCode', 'code', 'name', 'stage', 'version', 'enabled', 'fields']);
const scope = object({ kind: choice('workspace'), tenantId: id, workspaceId: id });
const submission = object({ mode: choice('original_single', 'manual_review_only'), actionId: id, requestHash: hash,
  body: object({ templateId: id, results: map({ oneOf: [text(2000, 0), { type: 'number' }, bool, list(id, 100)] }),
    attachments: list(id, 101), handoverSignatureFileAssetId: id }, ['templateId', 'results', 'attachments']) }, ['actionId', 'requestHash', 'body']);
const nullable = (value: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ oneOf: [value, nil] });
const basisReference: AiLeafSchemaDraft = { oneOf: [
  object({ version: choice('inspection-recognition-basis-1'), status: choice('recorded'), referenceId: id, sourceHash: hash }),
  object({ version: choice('inspection-recognition-basis-1'), status: choice('not_recorded') }),
] };
const recognition = object({ inputId: id, inputFingerprint: hash, bindingFingerprint: hash, question: text(4000),
  outputContract: choice('inspection-candidate-source-text-1'),
  template: object({ id, version: id, fields: list(object({ ...field, options, unit: text(64, 0), usageMetric: bool }, Object.keys(field)), 100) }),
  basis: basisReference,
  media: list(object({ ...evidence.properties, contentHash: hash, mediaType: text(128), sizeBytes: positive,
    width: nullable(positive), height: nullable(positive), durationMs: nullable({ type: 'integer', minimum: 0 }) }), 8) },
  ['inputId', 'inputFingerprint', 'bindingFingerprint', 'question', 'template', 'media']);
const receipt = object({ draftId: id, revision: integer(1, 1000), status: draftStatus, inspectionId: nullable(id) });
const create = object({ ...target, operationId: id, bindingFingerprint: hash, results: map(scalar), evidence: list(evidence, 100) });
const edit = object({ ...changed, edits: list(object({ fieldCode: id, decision: choice('manual', 'accepted', 'modified', 'rejected'),
  value: scalar, candidateId: id }, ['fieldCode', 'decision']), 100, 1) });
const replace = object({ ...changed, evidence: list(evidence, 100) });
export const AI_INSPECTION_MANUAL_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  ...AI_STAFF_INSPECTION_HISTORY_SCHEMAS,
  AiInspectionRecognitionBasisReference: basisReference,
  AiInspectionTarget: object(target),
  AiInspectionDraftReadRequest: object({ ...target, draftId: id }),
  AiInspectionDraftCreateRequest: create, AiInspectionDraftEditRequest: edit,
  AiInspectionEvidenceChangeRequest: replace,
  AiInspectionBindingRequest: object({ ...target, attachmentId: id }),
  AiInspectionEvidenceRef: evidence,
  AiInspectionEvidenceFingerprintRequest: object({ target: object(target),
    refs: list(object({ attachmentId: id, attachmentRevision: integer(1, 999) }), 100) }),
  AiInspectionEvidenceFingerprintResponse: hash,
  AiInspectionTemplateResponseDraft: object({ scope, owner: object({ actorKind: choice('user'), actorId: id }),
    audience: choice('staff', 'operator'), orderId: id, allocationId: id, assetId: id, stage: target.stage, template,
    allocationStatus: choice('pre_assigned', 'locked', 'allocated', 'picked_up', 'consumed'), bindingFingerprint: hash,
    status: choice('template_ready'), semantics: choice('read_projection_not_inspection_or_action_authorization') }),
  AiStaffInspectionHostProjection: object({ serverEnabled: { type: 'boolean', const: true },
    context: object({ tenantId: id, workspaceId: id, ownerId: id, audience: choice('staff') }), target: object(target),
    draftId: id, revision: integer(1, 1000), templateVersion: id, bindingFingerprint: hash, actionId: id,
    capabilities: object({ edit: bool, evidence: bool, review: bool, submit: bool }), observedAt: time, execution: choice('not_attested') }),
  AiInspectionDraftReadResponse: object({ draftId: id, revision: integer(1, 1000), status: draftStatus, target: object(target), assetId: id,
    templateVersion: id, bindingFingerprint: hash, inspectionId: nullable(id), recognitionEvidence: choice('caller_supplied_not_model_execution_proof'),
    candidateReviews: list(object({ candidateId: id, basis: basisReference,
      reviewIssues: { ...list(AI_INSPECTION_REVIEW_ISSUE_SCHEMA, 5), uniqueItems: true },
      basisIssues: list(AI_INSPECTION_LIFECYCLE_HTTP_SCHEMAS.AiInspectionRecognitionBasisIssueDraft, 100),
      sourcesMatchDraftEvidence: bool, adoption: choice('human_confirmation_required', 'unavailable') }), 100),
    state: object({ version: { type: 'integer', const: 1 }, fields: map(object({ value: scalar,
      decision: choice('manual', 'accepted', 'modified', 'rejected'), candidateId: id, actorId: id }, ['value', 'decision', 'actorId'])),
      candidates: list(ref('AiInspectionCandidateDraft'), 100), evidence: list(evidence, 100), missingFields: list(id, 100),
      reviewRequired: bool, submission, recognitionInputs: list(recognition, 8), candidateBasis: map(basisReference) },
      ['version', 'fields', 'candidates', 'evidence', 'missingFields', 'reviewRequired']) }),
  AiInspectionOperationResult: receipt,
  AiInspectionReceiptLookup: { oneOf: [object({ status: choice('found'), result: receipt }),
    object({ status: choice('absent') }), object({ status: choice('unavailable') })] },
  AiInspectionOriginalOperationRequest: { oneOf: [object({ kind: choice('create'), request: create }),
    object({ kind: choice('edit'), request: edit }), object({ kind: choice('evidence'), request: replace }),
    object({ kind: choice('candidates'), request: object({ ...changed, candidates: list(ref('AiInspectionCandidateDraft'), 100) }) })] },
  AiStaffInspectionSavedReference: object({ ...target, draftId: id, inputId: id, taskId: id, resultId: id, operationId: id,
    expectedRevision: integer(1, 999) }),
};
