/** Original Rental catalogue specialization of the public C05 contract. */
import type { AiToolCode } from './ai-native';
import type { AiProposalActionDraft as PublicAction, AiProposalPayloadDraft as PublicPayload,
  AiProposalRecordDraft as PublicRecord } from '@rental-os/platform-contracts';
export { AI_PROPOSAL_DRAFT_VERSION } from '@rental-os/platform-contracts';
export type { AiProposalSnapshotRefDraft, AiProposalDecisionRequestDraft, AiHumanApprovalActorDraft,
  AiApprovalRecordDraft, AiApprovalConsumptionDraft, AiApprovalBindingCheckDraft } from '@rental-os/platform-contracts';
export type AiProposalActionDraft = PublicAction<AiToolCode>;
export type AiProposalPayloadDraft = PublicPayload<AiToolCode>;
export type AiProposalRecordDraft = PublicRecord<AiToolCode>;
