import { leafClosed as object, leafEnum as choice, leafInt as integer, leafList as array, leafText as text, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
import type { AiInspectionCandidateDraft } from './ai-inspection-draft';
import type { AiTaskInputSubmissionDraft } from './ai-task-input-draft';

export type AiInspectionActorScope = {
  tenantId: string;
  workspaceId: string;
  ownerId: string;
  audience: 'operator' | 'staff';
};

export type AiInspectionTarget = {
  orderId: string;
  allocationId: string;
  templateId: string;
  stage: 'pickup' | 'return';
};

export type AiInspectionEvidenceRef = { attachmentId: string; attachmentRevision: number };
export type AiInspectionFieldValue = string | number | boolean | null;
export type AiInspectionHumanField = {
  value: AiInspectionFieldValue;
  decision: 'manual' | 'accepted' | 'modified' | 'rejected';
  candidateId?: string;
  actorId: string;
};

export type AiInspectionDraftState = {
  version: 1;
  fields: Record<string, AiInspectionHumanField>;
  candidates: AiInspectionCandidateDraft[];
  evidence: AiInspectionEvidenceRef[];
  missingFields: string[];
  reviewRequired: boolean;
  submission?: AiInspectionSubmissionMaterial;
  recognitionInputs?: AiInspectionRecognitionInput[];
};

export type AiInspectionRecognitionInput = {
  inputId: string;
  inputFingerprint: string;
  bindingFingerprint: string;
  question: string;
  template: { id: string; version: string; fields: Array<{ code: string; type: string; label: string; required: boolean; options?: string[] }> };
  media: Array<AiInspectionEvidenceRef & { contentHash: string; mediaType: string; sizeBytes: number; width: number | null; height: number | null; durationMs: number | null }>;
};

export type AiInspectionSubmissionMaterial = {
  mode?: 'original_single' | 'manual_review_only';
  actionId: string;
  requestHash: string;
  body: {
    templateId: string;
    results: Record<string, string | number | boolean | string[]>;
    attachments: string[];
    handoverSignatureFileAssetId?: string;
  };
};

export type AiInspectionDraftCreateRequest = AiInspectionTarget & {
  operationId: string;
  bindingFingerprint: string;
  results: Record<string, AiInspectionFieldValue>;
  evidence: AiInspectionEvidenceRef[];
};

export type AiInspectionDraftEditRequest = AiInspectionTarget & {
  draftId: string;
  operationId: string;
  expectedRevision: number;
  bindingFingerprint: string;
  edits: Array<{ fieldCode: string; decision: AiInspectionHumanField['decision']; value?: AiInspectionFieldValue; candidateId?: string }>;
};

export type AiInspectionEvidenceChangeRequest = AiInspectionTarget & {
  draftId: string; operationId: string; expectedRevision: number; bindingFingerprint: string; evidence: AiInspectionEvidenceRef[];
};
export type AiInspectionBindingRequest = AiInspectionTarget & { attachmentId: string };
export type AiInspectionDraftReadRequest = AiInspectionTarget & { draftId: string };
export type AiInspectionDraftListRequest = AiInspectionTarget & { after?: string; limit: number };
export type AiInspectionDraftCandidateRequest = AiInspectionTarget & {
  draftId: string; operationId: string; expectedRevision: number; bindingFingerprint: string; candidates: AiInspectionCandidateDraft[];
};
export type AiInspectionRecognitionRequest = AiInspectionDraftReadRequest & {
  operationId: string; expectedRevision: number; question: string;
};
/** Reference to an already authorized/frozen image input. Caller IDs are not
 * identity, permission, model material or a runner lease. */
export type AiInspectionRecognitionTaskReference = AiInspectionDraftReadRequest & {
  templateId: string; inputId: string; expectedRevision: number;
};
export type AiInspectionRecognitionTaskCancelRequest = {
  reference: AiInspectionRecognitionTaskReference; expectedRevision: number;
};
export type AiInspectionRecognitionTaskResumeRequest = {
  reference: AiInspectionRecognitionTaskReference; submission: AiTaskInputSubmissionDraft;
};
/** Current server projection for an explicitly registered original staff host.
 * Availability is not permission to bypass per-operation Guard/Core validation. */
export interface AiStaffInspectionHostProjection {
  serverEnabled: true;
  context: AiInspectionActorScope & { audience: 'staff' };
  target: AiInspectionTarget;
  draftId: string; revision: number; templateVersion: string; bindingFingerprint: string; actionId: string;
  capabilities: { edit: boolean; evidence: boolean; review: boolean; submit: boolean };
  observedAt: string;
  execution: 'not_attested';
}
export type AiStaffInspectionSavedReference = AiInspectionRecognitionTaskReference & {
  taskId: string; resultId: string; operationId: string;
};
export type AiStaffInspectionHistoryRequest = { orderId: string; stage: 'pickup' | 'return'; limit: number; after?: string };
export type AiStaffInspectionHistoryItem = {
  draftId: string; target: AiInspectionTarget; revision: number; status: AiInspectionDraftStatus;
  recognitionSaves: AiStaffInspectionSavedReference[]; recognitionSavesTruncated: boolean;
  recognitionReceipt: 'references_available' | 'manual_reconcile';
};
export type AiStaffInspectionHistoryResponse = {
  mode: 'history_selection'; context: AiInspectionActorScope & { audience: 'staff' };
  items: AiStaffInspectionHistoryItem[]; nextAfter: string | null; semantics: 'selection_not_execution_permission';
};
export type AiStaffInspectionReceiptHostRequest = AiInspectionDraftReadRequest & {
  mode: 'receipt_only'; recognitionSave?: AiStaffInspectionSavedReference;
};
export type AiStaffInspectionReceiptHostProjection = {
  mode: 'receipt_only'; serverEnabled: true; context: AiInspectionActorScope & { audience: 'staff' };
  target: AiInspectionTarget; draftId: string; recognitionSave: AiStaffInspectionSavedReference | null;
  capabilities: { recognitionReceipt: boolean; submissionReceipt: boolean };
  semantics: 'receipts_only_not_execution_permission';
};
const historyId: AiLeafSchemaDraft = { ...text(128), pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const historyTarget = { orderId: historyId, allocationId: historyId, templateId: historyId, stage: choice('pickup', 'return') };
const historyScope = object({ tenantId: historyId, workspaceId: historyId, ownerId: historyId, audience: choice('staff') });
const historyReference = object({ ...historyTarget, draftId: historyId, inputId: historyId, taskId: historyId,
  resultId: historyId, operationId: historyId, expectedRevision: integer(1, 999) });
export const AI_STAFF_INSPECTION_HISTORY_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiStaffInspectionHistoryRequest: object({ orderId: historyId, stage: choice('pickup', 'return'), limit: integer(1, 20), after: historyId }, ['orderId', 'stage', 'limit']),
  AiStaffInspectionHistoryResponse: object({ mode: choice('history_selection'), context: historyScope,
    items: array(object({ draftId: historyId, target: object(historyTarget), revision: integer(1, 1000),
      status: choice('draft_saved', 'prepared', 'submission_unknown', 'submitted'), recognitionSaves: array(historyReference, 20),
      recognitionSavesTruncated: { type: 'boolean' }, recognitionReceipt: choice('references_available', 'manual_reconcile') }), 20),
    nextAfter: { oneOf: [historyId, { type: 'null' }] }, semantics: choice('selection_not_execution_permission') }),
  AiStaffInspectionReceiptHostRequest: object({ ...historyTarget, draftId: historyId, mode: choice('receipt_only'), recognitionSave: historyReference },
    [...Object.keys(historyTarget), 'draftId', 'mode']),
  AiStaffInspectionReceiptHostProjection: object({ mode: choice('receipt_only'), serverEnabled: { type: 'boolean', const: true }, context: historyScope,
    target: object(historyTarget), draftId: historyId, recognitionSave: { oneOf: [historyReference, { type: 'null' }] },
    capabilities: object({ recognitionReceipt: { type: 'boolean' }, submissionReceipt: { type: 'boolean' } }),
    semantics: choice('receipts_only_not_execution_permission') }),
};

export type AiInspectionSubmitRequest = AiInspectionDraftReadRequest & { operationId: string; expectedRevision: number };
export type AiInspectionPrepareSubmissionRequest = AiInspectionSubmitRequest & { actionId: string; handoverSignatureFileAssetId?: string };
export type AiInspectionOriginalOperationRequest =
  | { kind: 'create'; request: AiInspectionDraftCreateRequest }
  | { kind: 'edit'; request: AiInspectionDraftEditRequest }
  | { kind: 'candidates'; request: AiInspectionDraftCandidateRequest }
  | { kind: 'evidence'; request: AiInspectionEvidenceChangeRequest };

export type AiInspectionDraftStatus = 'draft_saved' | 'prepared' | 'submission_unknown' | 'submitted';
export type AiInspectionOperationResult = {
  draftId: string;
  revision: number;
  status: AiInspectionDraftStatus;
  inspectionId: string | null;
};

export type AiInspectionReceiptLookup =
  | { status: 'found'; result: AiInspectionOperationResult }
  | { status: 'absent' }
  | { status: 'unavailable' };
