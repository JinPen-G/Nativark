import type { AiAudience, AiExecutionContext, AiExecutionScope, AiToolCode } from "./ai-native";

/** C05 draft records, not an approval API or business execution authority. */
export const AI_PROPOSAL_DRAFT_VERSION = "ain-c05-draft-1" as const;
export interface AiProposalSnapshotRefDraft {
  recordId: string;
  revision: number;
  contentHash: string;
}
export interface AiProposalActionDraft {
  actionId: string;
  toolCode: AiToolCode;
  toolVersion: string;
  /** Immutable Core-produced inputs/previews, not amounts supplied by a model. */
  input: AiProposalSnapshotRefDraft;
  preview: AiProposalSnapshotRefDraft;
  target: { resourceType: "order" | "quote" | "configuration" | "customer" | "inspection" | "category"; resourceId: string; version: string };
}
export interface AiProposalPayloadDraft {
  contractVersion: typeof AI_PROPOSAL_DRAFT_VERSION;
  proposalId: string;
  taskId: string;
  revision: number;
  audience: Exclude<AiAudience, "automation">;
  scope: AiExecutionScope;
  actions: AiProposalActionDraft[];
  /** Single action or explicitly partial ordered plan; never pretend external effects roll back. */
  atomicity: "single_action" | "ordered_partial";
  failurePolicy: "stop_and_reconcile";
  expiresAt: string;
}
export interface AiProposalRecordDraft {
  payload: AiProposalPayloadDraft;
  payloadHash: string;
  status: "pending_confirmation" | "confirmed" | "superseded" | "cancelled" | "expired";
}
/** Client supplies what was reviewed, not the actor/scope or its own approval record. */
export interface AiProposalDecisionRequestDraft {
  contractVersion: typeof AI_PROPOSAL_DRAFT_VERSION;
  proposalId: string;
  proposalRevision: number;
  reviewedPayloadHash: string;
  decision: "approve" | "reject";
}
export type AiHumanApprovalActorDraft = Exclude<AiExecutionContext["actor"], { kind: "automation" }>;
/** Persisted by the confirmation service after current authorization; IDs are not bearer tokens. */
export interface AiApprovalRecordDraft {
  contractVersion: typeof AI_PROPOSAL_DRAFT_VERSION;
  approvalId: string;
  proposalId: string;
  proposalRevision: number;
  payloadHash: string;
  audience: Exclude<AiAudience, "automation">;
  scope: AiExecutionScope;
  actor: AiHumanApprovalActorDraft;
  decision: "approved" | "rejected";
  issuedAt: string;
  expiresAt: string;
}
interface AiApprovalConsumptionBaseDraft {
  contractVersion: typeof AI_PROPOSAL_DRAFT_VERSION;
  approvalId: string;
  proposalId: string;
  proposalRevision: number;
  actionId: string;
  actionFingerprint: string;
  businessIdempotencyKey: string;
}
/** Per-action consumption must have a DB unique constraint and commit association in AIN-03/07. */
export type AiApprovalConsumptionDraft = AiApprovalConsumptionBaseDraft & (
  | { status: "reserved" }
  | { status: "committed"; result: AiProposalSnapshotRefDraft }
  | { status: "unknown"; retryable: false; nextAction: "reconcile" }
  | { status: "failed_no_effect"; nextAction: "revalidate_or_manual" }
);
export type AiApprovalBindingCheckDraft =
  | { valid: true }
  | { valid: false; reason: "invalid_record" | "proposal_inactive" | "proposal_changed" | "approval_rejected" | "context_changed" | "approval_expired" | "action_missing" };
