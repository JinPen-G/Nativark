import type { AiExecutionScope } from "./ai-native";
import type { RentalInspectionTemplate } from "./core";
export const AI_INSPECTION_DRAFT_VERSION = "ain-c09-draft-1" as const;
/** IDs are references only. Source reading must reauthorize attachment/order/resource ownership. */
export type AiInspectionSourceDraft = { attachmentId: string; attachmentRevision: number } & (
  | { kind: "image"; region: { x: number; y: number; width: number; height: number } }
  | { kind: "audio"; span: { startMs: number; endMs: number } }
);
export type AiInspectionValueDraft =
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "text" | "select"; value: string }
  | { kind: "photo"; attachmentId: string; attachmentRevision: number };
export type AiInspectionCandidateDraft = { candidateId: string; fieldCode: string; sources: AiInspectionSourceDraft[] } & (
  | { status: "candidate"; value: AiInspectionValueDraft; confidence: number }
  | { status: "missing" | "blurred"; reason: string }
);
/** Human correction is not submission/approval; actor identity established by server. */
export interface AiInspectionCorrectionDraft {
  correctionId: string; candidateId: string; expectedDraftRevision: number;
  value: AiInspectionValueDraft; reason: string; recordedAt: string;
}
export type AiInspectionReviewIssueDraft = "baseline_missing" | "meter_replaced" | "reading_backwards" | "field_unavailable" | "source_unclear";
export interface AiInspectionExtractDraft {
  draftVersion: typeof AI_INSPECTION_DRAFT_VERSION; draftId: string; revision: number;
  scope: Extract<AiExecutionScope, { kind: "workspace" }>;
  orderId: string; assetId: string; allocationId: string;
  stage: RentalInspectionTemplate["stage"];
  frozenTemplate: { templateId: string; version: string };
  status: "awaiting_review" | "pending_submission";
  candidates: AiInspectionCandidateDraft[]; corrections: AiInspectionCorrectionDraft[];
  reviewIssues: AiInspectionReviewIssueDraft[];
}
