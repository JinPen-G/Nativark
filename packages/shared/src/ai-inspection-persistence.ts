import type { AiInspectionCandidateDraft } from './ai-inspection-draft';

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

export type AiInspectionBindingRequest = AiInspectionTarget & { attachmentId: string };
export type AiInspectionDraftReadRequest = AiInspectionTarget & { draftId: string };
export type AiInspectionDraftListRequest = AiInspectionTarget & { after?: string; limit: number };
export type AiInspectionDraftCandidateRequest = AiInspectionTarget & {
  draftId: string; operationId: string; expectedRevision: number; bindingFingerprint: string; candidates: AiInspectionCandidateDraft[];
};
export type AiInspectionRecognitionRequest = AiInspectionDraftReadRequest & {
  operationId: string; expectedRevision: number; question: string;
};
export type AiInspectionSubmitRequest = AiInspectionDraftReadRequest & { operationId: string; expectedRevision: number };
export type AiInspectionPrepareSubmissionRequest = AiInspectionSubmitRequest & { actionId: string; handoverSignatureFileAssetId?: string };
export type AiInspectionOriginalOperationRequest =
  | { kind: 'create'; request: AiInspectionDraftCreateRequest }
  | { kind: 'edit'; request: AiInspectionDraftEditRequest }
  | { kind: 'candidates'; request: AiInspectionDraftCandidateRequest };

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
