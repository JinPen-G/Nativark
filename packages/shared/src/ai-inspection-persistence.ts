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
