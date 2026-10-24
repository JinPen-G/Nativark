import type { AiProposalActionDraft, AiProposalPayloadDraft, AiProposalRecordDraft, AiApprovalRecordDraft } from './ai-proposal-draft';
import type { AiTaskEventDraft, AiTaskStatusDraft } from './ai-task-draft';
import type { AiTaskRunnerOutcomeDraft, AiTaskRecoverySnapshot } from './ai-task-recovery-draft';

export const AI_APPROVED_SETTINGS_DRAFT_VERSION = 'ain-approved-settings-draft-1' as const;
export const AI_APPROVED_SETTINGS_TOOL_CODE = 'tenant.notifications.commit' as const;
/** Freeze an original change only, never active configuration or approval. */
export interface AiApprovedSettingsChangePrepareDraft {
  changeKey: string; baseRevision: number; expiresAt: string;
  notifications: { enabledEvents: string[]; editableChannels: Array<'sms' | 'app_push' | 'wechat' | 'email'> };
}
export interface AiApprovedSettingsChangeReceiptReadDraft { changeKey: string; }
/** Only the current notification projection, never secrets or execution proof. */
export interface AiApprovedSettingsCurrentDraft {
  settingsRevision: number;
  notifications: AiApprovedSettingsChangePrepareDraft['notifications'];
}
export interface AiApprovedSettingsChangePreparationResultDraft {
  change: AiApprovedSettingsChangeReviewDraft;
  task: 'not_created';
  approval: 'not_granted';
  activeSettings: 'not_modified';
}
/** Historical preparation evidence is not a current approval or a commit. */
export type AiApprovedSettingsChangeReceiptDraft =
  | { state: 'prepared_not_approved'; change: AiApprovedSettingsChangeReviewDraft }
  | { state: 'not_observed'; nextAction: 'read_change_receipt' };
/** References the original Core preparation; never supplies task ownership,
 * a plan, approval or active configuration values. */
export interface AiApprovedSettingsTaskCreationDraft { creationKey: string; changeKey: string; }
/** Metadata acknowledgement only. Neither creation nor history grants execution. */
export interface AiApprovedSettingsCreatedTaskDraft {
  taskId: string; runId: string; status: AiTaskStatusDraft; revision: number; replayed: boolean;
}
type SettingsCreationBase = {
  original: { changeId: string; changeHash: string }; execution: 'not_attested'; approval: 'not_granted';
};
export type AiApprovedSettingsTaskCreatedDraft = SettingsCreationBase & { receipt: AiApprovedSettingsCreatedTaskDraft };
export type AiApprovedSettingsTaskCreationReadDraft = SettingsCreationBase & { receipt:
  | { state: 'observed'; creationKey: string; retryable: false; nextAction: 'read_original_task'; task: AiApprovedSettingsCreatedTaskDraft }
  | { state: 'unknown' | 'not_observed'; creationKey: string; retryable: false; nextAction: 'reconcile'; task: null } };
/** Cancellation intent/task settlement is never a business rollback or refund. */
type SettingsCancellationBase = {
  cancellation: 'not_business_rollback'; automaticRetry: false; financialRelease: 'not_performed';
};
type SettingsCancellationEvent = Extract<AiTaskEventDraft, { type: 'task.transition' }>;
export type AiApprovedSettingsTaskCancellationResultDraft = SettingsCancellationBase & {
  receipt: { event: SettingsCancellationEvent; runRevision?: number | null };
};
export type AiApprovedSettingsTaskCancellationReadDraft = SettingsCancellationBase & { receipt: {
  taskId: string; expectedRevision: number; status: 'observed' | 'not_observed'; event: SettingsCancellationEvent | null;
  snapshot: { revision: number; cursor: string; status: AiTaskStatusDraft };
  cancellation: 'request_not_rollback' | 'task_cancelled_not_business_rollback'; remoteCancellation: 'not_attested';
  automaticRetry: false; admission: 'not_granted'; absenceSemantics: 'not_observed_is_not_proof_of_uncommitted';
} };
/** Same persisted runner outcome, not a model result or proof of a Core commit. */
export interface AiApprovedSettingsTaskRunRequestDraft { taskId: string; runId: string; }
export interface AiApprovedSettingsTaskCheckpointReadDraft extends AiApprovedSettingsTaskRunRequestDraft { stepId: string; }
export interface AiApprovedSettingsTaskContinueDraft extends AiApprovedSettingsTaskRunRequestDraft { checkpointRef: string; }
export interface AiApprovedSettingsTaskCancelDraft { taskId: string; expectedRevision: number; }
export type AiApprovedSettingsTaskRunDraft =
  | { kind: 'not_started'; reason: 'host_aborted' | 'plan_unavailable' | 'task_not_runnable' | 'lease_held'
      | 'recovery_lease_unavailable' | 'confirmation_lease_unavailable' }
  | { kind: 'run_outcome'; outcome: AiTaskRunnerOutcomeDraft };
export interface AiApprovedSettingsTaskCheckpointDraft {
  taskId: string; runId: string; stepId: string; taskRevision: number; checkpointRef: string;
  proposal: { contractVersion: AiProposalPayloadDraft['contractVersion']; proposalId: string;
    proposalRevision: number; reviewedPayloadHash: string };
  execution: 'not_attested';
}
/** Expired input/terminal work permits original observation, never another run. */
export type AiApprovedSettingsTaskRecoveryDraft = AiApprovedSettingsTaskRunDraft | {
  mode: 'read_only'; snapshot: AiTaskRecoverySnapshot; retryable: false; execution: 'original_result_read_no_restart';
} & (
  | { operation: { state: 'committed'; receipt: AiApprovedSettingsOperationReceiptDraft }; businessOutcome: 'committed' }
  | { operation: null; businessOutcome: 'unknown' | 'not_observed' }
);
export type AiApprovedSettingsTaskCancelResponseDraft = {
  receipt: { event: SettingsCancellationEvent; runRevision: null }; cancellation: 'requested_not_rollback';
  reconciliation: AiApprovedSettingsTaskRecoveryDraft | { kind: 'unavailable';
    errorCode: 'AI_INVALID_INPUT' | 'AI_ACCESS_DENIED' | 'AI_RESOURCE_UNAVAILABLE' | 'AI_REVISION_CONFLICT' | 'AI_STORAGE_UNAVAILABLE';
    nextAction: 'read_original_task'; retryable: false };
};
/** Task-local cursor stays a string; a reset requires a new formal snapshot. */
export interface AiApprovedSettingsTaskEventsReadDraft extends AiApprovedSettingsTaskCreationDraft {
  after: string; limit: number;
}
/** Selects a server-registered action template, never permissions or an approval. */
export interface AiApprovedSettingsTaskPolicyReadDraft extends AiApprovedSettingsTaskCreationDraft { operation: string; }
export interface AiApprovedSettingsTaskPolicyConfigureDraft extends AiApprovedSettingsTaskPolicyReadDraft { expectedRevision: number | null; }
export interface AiApprovedSettingsTaskPolicyClearDraft extends AiApprovedSettingsTaskPolicyReadDraft { expectedRevision: number; }
/** The original receipt, not a caller task/run or cancellation proof. */
export interface AiApprovedSettingsTaskCancellationDraft extends AiApprovedSettingsTaskCreationDraft { expectedRevision: number; }
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
  nextAction: 'read_preparation_receipt' | 'read_decision_receipt' | 'read_change_receipt' | 'read_task_input' | 'read_operation' | 'revalidate_or_manual';
}
