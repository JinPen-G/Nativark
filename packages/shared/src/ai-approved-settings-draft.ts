import type { AiProposalActionDraft, AiProposalPayloadDraft, AiProposalRecordDraft, AiApprovalRecordDraft } from './ai-proposal-draft';

export const AI_APPROVED_SETTINGS_DRAFT_VERSION = 'ain-approved-settings-draft-1' as const;
export const AI_APPROVED_SETTINGS_TOOL_CODE = 'tenant.notifications.commit' as const;
export interface AiApprovedSettingsReferenceDraft {
  draftVersion: typeof AI_APPROVED_SETTINGS_DRAFT_VERSION;
  taskId: string;
  proposalId: string;
  proposalRevision: number;
  reviewedPayloadHash: string;
}
export interface AiApprovedSettingsPrepareDraft extends Omit<AiApprovedSettingsReferenceDraft, 'reviewedPayloadHash'> {
  runId: string;
  stepId: string;
  changeId: string;
  changeHash: string;
}
export type AiApprovedSettingsPreparationReceiptDraft = { draftVersion: typeof AI_APPROVED_SETTINGS_DRAFT_VERSION } & (
  | { state: 'prepared'; reference: AiApprovedSettingsReferenceDraft }
  | { state: 'not_observed'; nextAction: 'read_preparation_receipt' }
);
export interface AiApprovedSettingsDecisionDraft extends AiApprovedSettingsReferenceDraft { decision: 'approve' | 'reject' }
export interface AiApprovedSettingsCommitDraft extends AiApprovedSettingsReferenceDraft { operationKey: string; approvalId: string }
export interface AiApprovedSettingsReadOperationDraft { draftVersion: typeof AI_APPROVED_SETTINGS_DRAFT_VERSION; operationKey: string }
export type AiApprovedSettingsPayloadDraft = Omit<AiProposalPayloadDraft, 'actions' | 'atomicity'> & {
  atomicity: 'single_action';
  actions: [Omit<AiProposalActionDraft, 'toolCode'> & { toolCode: typeof AI_APPROVED_SETTINGS_TOOL_CODE }];
};
export interface AiApprovedSettingsChangeReviewDraft {
  changeId: string;
  changeHash: string;
  baseRevision: number;
  expiresAt: string;
  diff: {
    'notifications.enabledEvents': { before: string[]; after: string[] };
    'notifications.editableChannels': { before: Array<'sms' | 'app_push' | 'wechat' | 'email'>; after: Array<'sms' | 'app_push' | 'wechat' | 'email'> };
  };
}
export interface AiApprovedSettingsReviewDraft {
  draftVersion: typeof AI_APPROVED_SETTINGS_DRAFT_VERSION;
  proposal: Omit<AiProposalRecordDraft, 'payload'> & { payload: AiApprovedSettingsPayloadDraft };
  change: AiApprovedSettingsChangeReviewDraft;
  generatedText: null;
}
export interface AiApprovedSettingsOperationReceiptDraft {
  receiptId: string;
  operationKey: string;
  changeId: string;
  changeHash: string;
  baseRevision: number;
  resultRevision: number;
  resultHash: string;
  committedAt: string;
}
export type AiApprovedSettingsOperationResultDraft = { draftVersion: typeof AI_APPROVED_SETTINGS_DRAFT_VERSION } & (
  | { state: 'committed'; receipt: AiApprovedSettingsOperationReceiptDraft; cacheRefreshed: boolean }
  | { state: 'not_observed'; nextAction: 'read_operation' }
);
export type AiApprovedSettingsDecisionReceiptDraft = { draftVersion: typeof AI_APPROVED_SETTINGS_DRAFT_VERSION } & (
  | { state: 'recorded'; approval: AiApprovalRecordDraft }
  | { state: 'not_observed'; nextAction: 'read_decision_receipt' }
);
export interface AiApprovedSettingsErrorDraft {
  draftVersion: typeof AI_APPROVED_SETTINGS_DRAFT_VERSION;
  code: 'AI_INVALID_INPUT' | 'AI_ACCESS_DENIED' | 'AI_REVISION_CONFLICT' | 'AI_RESOURCE_UNAVAILABLE' | 'AI_RESULT_UNKNOWN' | 'SETTINGS_RESULT_UNKNOWN';
  retryable: false;
  nextAction: 'read_preparation_receipt' | 'read_decision_receipt' | 'read_operation' | 'revalidate_or_manual';
}
