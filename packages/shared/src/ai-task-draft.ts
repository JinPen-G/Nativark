/**
 * AIN-C04 草案：状态、动作身份、租约及事件协议，不是持久化运行器或授权凭据。
 * C01 创建时上下文只用于追溯；恢复/每步执行仍必须重新授权并在数据库提交点做 CAS/fencing。
 */
import { AI_TOOL_CODES } from './ai-native';
import { AI_TASK_DRAFT_VERSION, AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE,
  AI_TEXT_CAPABILITY_PROBE_STEP_CODE, type AiTaskStateDraft as TaskState, type AiStepStateDraft as StepState,
  type AiTaskStatusDraft, type AiStepStatusDraft } from '@rental-os/platform-contracts/ai-task';
export { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT, AI_TASK_TERMINAL_STATUSES_DRAFT,
  AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE, AI_TEXT_CAPABILITY_PROBE_STEP_CODE,
  AI_TASK_TRANSITION_REASONS_DRAFT, AI_STEP_TRANSITION_REASONS_DRAFT } from '@rental-os/platform-contracts/ai-task';
export type { AiTaskStatusDraft, AiStepStatusDraft, AiStepOutcomeDraft, AiRunLeaseDraft, AiTaskTransitionReasonDraft,
  AiStepTransitionReasonDraft, AiTaskTransitionRequestDraft, AiTaskTransitionDecisionDraft, AiTaskEventBaseDraft,
  AiTaskEventDraft, AiTaskEventPageDraft, AiTaskSnapshotDraft, AiTaskEventResetDraft } from '@rental-os/platform-contracts/ai-task';

export const AI_TASK_STEP_CODES = Object.freeze([...AI_TOOL_CODES, AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE, AI_TEXT_CAPABILITY_PROBE_STEP_CODE] as const);
export type AiTaskStepCode = typeof AI_TASK_STEP_CODES[number];
export type AiStepStateDraft = StepState<AiTaskStepCode>;
export type AiTaskStateDraft = TaskState<AiTaskStepCode>;

/** Owner-only observation transport. Metadata, source-revalidated original
 * model text and original usage have separate current-authorized reads. No
 * execution or lease; cursor continuation is never authority. */
export const AI_TASK_CENTER_HTTP_DRAFT = Object.freeze({ basePath: "ai-native/task-center", method: "POST",
  list: "list", snapshot: "snapshot", events: "events", result: "result", usage: "usage", usageSummary: "usage-summary", performance: "performance", visibleReport: "visible-report", outcomes: 'outcomes', confirmation: "confirmation",
  review: "review", decision: "decision", decisionReceipt: "decision-receipt", business: "business", continue: "continue", source: "source",
  stop: 'stop', stopReceipt: 'stop-receipt', input: 'input', resumeInput: 'input/resume',
  inputReceipt: 'input/receipt', continueInput: 'input/continue' } as const);
export const AI_TASK_CENTER_ENTRY_PERMISSIONS = Object.freeze([
  "rental-os:order:view", "rental-os:order:create", "rental-os:price:manage", "system:params:manage"
] as const);
export type { AiTaskMetadataQueryDraft, AiTaskMetadataPageDraft } from '@rental-os/platform-contracts';

/** A source-revalidated original model observation, not a generic artifact
 * download or business receipt. Other scene/result kinds remain unavailable. */
export interface AiTaskModelObservationDraft {
  contractVersion: typeof AI_TASK_DRAFT_VERSION;
  taskId: string; runId: string; resultId: string;
  sceneCode: "order_explanation" | "opening_diagnosis" | "quote_clarification";
  status: "available" | "stale" | "unknown" | "failed";
  text: { value: string; trust: "unverified_model_text_not_execution_evidence" } | null;
  sources: AiTaskModelSourceReferenceDraft[];
  observedAt: string;
  businessExecution: "not_inferred_from_model_result";
  execution: "read_only_no_start_no_reconnect_side_effect";
}

/** Server-issued lookup only. Neither a URL nor permission to reopen content. */
export interface AiTaskModelSourceReferenceDraft {
  kind: 'order' | 'knowledge'; index: number; referenceHash: string;
}
export interface AiTaskModelSourceQueryDraft {
  taskId: string; resultId: string; source: AiTaskModelSourceReferenceDraft;
}
export interface AiTaskModelSourceObservationDraft extends AiTaskModelSourceQueryDraft {
  contractVersion: typeof AI_TASK_DRAFT_VERSION; runId: string; observedAt: string;
  content: { format: 'text' | 'json'; value: string; trust: 'source_data_not_instructions' };
  execution: 'read_only_no_start_no_reconnect_side_effect';
}
/** Cancellation intent only. The original transition/actor/revision is the
 * receipt key; absence is never proof of rollback or permission to repeat. */
export interface AiTaskStopQueryDraft { taskId: string; expectedRevision: number }
export interface AiTaskStopObservationDraft extends AiTaskStopQueryDraft {
  status: 'observed' | 'not_observed';
  cancellation: 'request_not_rollback'; automaticRetry: false;
  remoteCancellation: 'not_attested'; budgetRelease: 'not_attempted';
}

/** Original waiting-step lookup, not an execution or approval credential. */
export interface AiTaskReviewQueryDraft { taskId: string; runId: string; stepId: string }
export interface AiTaskDecisionQueryDraft extends AiTaskReviewQueryDraft {
  proposal: import('./ai-approval-application-draft').AiApprovalApplicationDecisionDraft;
}
export type AiTaskHumanReviewDraft = AiTaskReviewQueryDraft & {
  taskRevision: number; checkpointRef: string; businessExecution: 'not_attested';
} & (
  | { kind: 'order'; review: import('./ai-approval-application-draft').AiApprovalApplicationReviewDraft;
      /** Server-derived original selection for the existing linked reprepare flow. */
      selection?: import('./ai-quote-selection-draft').AiQuoteSelectionProofDraft }
  | { kind: 'settings'; review: import('./ai-approved-settings-draft').AiApprovedSettingsReviewDraft }
);
export type AiTaskHumanDecisionReceiptDraft = AiTaskReviewQueryDraft & {
  receipt: import('./ai-approval-application-draft').AiApprovalApplicationReceiptDraft;
  businessExecution: 'not_attested';
};
/** Original Core receipt only; not a lease, retry instruction or payment fact. */
export type AiTaskBusinessObservationDraft = AiTaskReviewQueryDraft & {
  observedAt: string; execution: 'read_only_no_start_no_reconnect_side_effect';
  payment: 'not_inferred'; fulfillment: 'not_inferred';
} & (
  | { status: 'committed'; kind: 'order'; order: { id: string; status: string; quoteId: string } }
  | { status: 'committed'; kind: 'settings'; receipt: import('./ai-approved-settings-draft').AiApprovedSettingsOperationReceiptDraft }
  | { status: 'unknown' | 'not_observed'; kind: 'order' | 'settings'; retryable: false }
);
export interface AiTaskHumanContinueDraft extends AiTaskReviewQueryDraft {
  checkpointRef: string; expectedTaskRevision: number;
  proposal: import('./ai-approval-application-draft').AiApprovalApplicationReferenceDraft;
}
/** A runner response is not a Core receipt. Observe the original business
 * result independently; never auto retry an interrupted continuation. */
export type AiTaskHumanContinuationDraft = AiTaskReviewQueryDraft & {
  automaticRetry: false; businessExecution: 'read_original_receipt';
} & (
  | { kind: 'not_started'; reason: string }
  | { kind: 'run_outcome'; status: 'succeeded' | 'partially_succeeded' | 'paused' | 'cancel_requested' | 'cancelled' | 'unknown' | 'unavailable' | 'failed' }
);

/** Original clarification only. A response/selection is not business approval;
 * resuming can run the existing configured successor, never a caller's plan. */
export interface AiTaskClarificationQueryDraft { taskId: string }
export interface AiTaskClarificationObservationDraft extends AiTaskClarificationQueryDraft {
  input: { requestId: string; revision: number; expiresAt: string;
    contract: import('./ai-task-input-draft').AiTaskInputContractDraft } | null;
  execution: 'read_only_no_start_no_reconnect_side_effect';
}
export interface AiTaskClarificationAnswerDraft { submission: import('./ai-task-input-draft').AiTaskInputSubmissionDraft }
/** Safe original-operation reference without answer content. Receipt lookup is
 * read-only; explicit continue must resolve stored answers on the server and
 * pass the original execution host. Never a new submission or retry grant. */
export interface AiTaskClarificationReceiptQueryDraft {
  reference: Pick<import('./ai-task-input-draft').AiTaskInputSubmissionDraft, 'taskId' | 'requestId' | 'expectedRevision' | 'submissionKey'>;
}
export type AiTaskClarificationContinueQueryDraft = AiTaskClarificationAnswerDraft | AiTaskClarificationReceiptQueryDraft;
export interface AiTaskClarificationProgressDraft {
  taskId: string; requestId: string; automaticRetry: false; businessExecution: 'not_inferred_from_input';
  receipt: { state: 'not_observed' } | { state: 'observed'; receiptId: string; taskRevision: number;
    runId: string | null; replayed: boolean | null };
  continuation: { kind: 'not_attempted' } | { kind: 'not_started'; reason: string } | { kind: 'unavailable'; errorCode: string }
    | { kind: 'run_outcome'; status: 'succeeded' | 'partially_succeeded' | 'paused' | 'cancel_requested' | 'cancelled' | 'unknown' | 'unavailable' | 'failed';
      stopReason: 'input_limit_reached' | null; nextAction: 'manual_handoff' | null; errorCode: string | null };
}
