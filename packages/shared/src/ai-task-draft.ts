/**
 * AIN-C04 草案：状态、动作身份、租约及事件协议，不是持久化运行器或授权凭据。
 * C01 创建时上下文只用于追溯；恢复/每步执行仍必须重新授权并在数据库提交点做 CAS/fencing。
 */
import { AI_TOOL_CODES, type AiExecutionContext, type AiFactReference, type AiToolError } from "./ai-native";

export const AI_TEXT_MODEL_STEP_CODE = "ai.model.text" as const;
export const AI_IMAGE_MODEL_STEP_CODE = "ai.model.image" as const;
export const AI_AUDIO_MODEL_STEP_CODE = "ai.model.audio" as const;
export const AI_TEXT_CAPABILITY_PROBE_STEP_CODE = "ai.capability.text.probe" as const;
export const AI_TASK_STEP_CODES = Object.freeze([...AI_TOOL_CODES, AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE, AI_TEXT_CAPABILITY_PROBE_STEP_CODE] as const);
export type AiTaskStepCode = typeof AI_TASK_STEP_CODES[number];

export const AI_TASK_DRAFT_VERSION = "ain-c04-draft-1" as const;
export const AI_TASK_STATUSES_DRAFT = Object.freeze([
  "queued", "running", "waiting_input", "waiting_confirmation", "waiting_external", "cancel_requested",
  "succeeded", "partially_succeeded", "failed", "cancelled"
] as const);
export type AiTaskStatusDraft = typeof AI_TASK_STATUSES_DRAFT[number];
export const AI_STEP_STATUSES_DRAFT = Object.freeze(["pending", "running", "succeeded", "failed", "unknown", "cancelled"] as const);
export type AiStepStatusDraft = typeof AI_STEP_STATUSES_DRAFT[number];
export const AI_TASK_TERMINAL_STATUSES_DRAFT: readonly AiTaskStatusDraft[] = Object.freeze([
  "succeeded", "partially_succeeded", "failed", "cancelled"
]);

/** 业务写结果未知时保留原 actionId/fingerprint，不能换key重放。 */
export type AiStepOutcomeDraft =
  | { status: "pending" | "cancelled"; effect: "none" }
  | { status: "running"; effect: "none" | "possible" }
  | { status: "succeeded"; effect: "none"; facts: AiFactReference[] }
  | { status: "succeeded"; effect: "committed"; facts: [AiFactReference, ...AiFactReference[]] }
  | { status: "failed"; effect: "none"; error: Exclude<AiToolError, { code: "AI_RESULT_UNKNOWN" }> }
  | { status: "unknown"; effect: "possible"; error: Extract<AiToolError, { code: "AI_RESULT_UNKNOWN" }> };

export interface AiStepStateDraft {
  stepId: string;
  runId: string;
  sequence: number;
  revision: number;
  toolCode: AiTaskStepCode;
  toolVersion: string;
  actionId: string;
  /** 规范化请求的 SHA-256 小写十六进制；本草案不定义/替代 Core 指纹算法。 */
  requestFingerprint: string;
  outcome: AiStepOutcomeDraft;
}

/** 内部完整状态投影，不直接返回前端；事件不包含该权限快照或原始参数。 */
export interface AiTaskStateDraft {
  contractVersion: typeof AI_TASK_DRAFT_VERSION;
  taskId: string;
  revision: number;
  status: AiTaskStatusDraft;
  createdContext: AiExecutionContext;
  /** 累积步骤，不能在新run中清零预算/动作历史；分页存储不改变此语义。 */
  steps: AiStepStateDraft[];
}

/** run 与 task 分离。令牌使用正十进制字符串，避免 bigint 经 JS number 丢精度。 */
export interface AiRunLeaseDraft {
  contractVersion: typeof AI_TASK_DRAFT_VERSION;
  taskId: string;
  runId: string;
  holderId: string;
  fencingToken: string;
  expiresAt: string;
}

export const AI_TASK_TRANSITION_REASONS_DRAFT = Object.freeze([
  "start", "resume", "input_required", "confirmation_required", "external_pending",
  "cancel_requested", "completed", "execution_failed", "cancel_settled"
] as const);
export type AiTaskTransitionReasonDraft = typeof AI_TASK_TRANSITION_REASONS_DRAFT[number];

/** initiator 由服务端审计层建立，不是模型/客户端可签发的身份。 */
export interface AiTaskTransitionRequestDraft {
  contractVersion: typeof AI_TASK_DRAFT_VERSION;
  taskId: string;
  expectedRevision: number;
  to: AiTaskStatusDraft;
  reason: AiTaskTransitionReasonDraft;
  occurredAt: string;
  initiator: { kind: "user" | "worker" | "system"; id: string };
}
export const AI_STEP_TRANSITION_REASONS_DRAFT = Object.freeze([
  "start", "retry_known_failure", "result_observed", "result_unknown", "not_started_cancelled",
  "reconciled_committed", "reconciled_not_committed"
] as const);
export type AiStepTransitionReasonDraft = typeof AI_STEP_TRANSITION_REASONS_DRAFT[number];

export type AiTaskTransitionDecisionDraft =
  | { allowed: true; nextRevision: number }
  | { allowed: false; reason: "invalid_state" | "revision_conflict" | "transition_denied" | "unresolved_steps" | "outcome_conflict" };

interface AiTaskEventBaseDraft {
  contractVersion: typeof AI_TASK_DRAFT_VERSION;
  taskId: string;
  /** 服务端落库后分配，严格递增但可有空洞；不是 taskRevision，也不是授权token。 */
  cursor: string;
  taskRevision: number;
  occurredAt: string;
}
export type AiTaskEventDraft = AiTaskEventBaseDraft & (
  | { type: "task.transition"; data: { from: AiTaskStatusDraft; to: AiTaskStatusDraft; reason: AiTaskTransitionReasonDraft } }
  | { type: "step.registered"; data: { stepId: string; runId: string; sequence: number; stepRevision: 1 } }
  | { type: "step.changed"; data: { stepId: string; runId: string; stepRevision: number; status: AiStepStatusDraft; reason: AiStepTransitionReasonDraft } }
  | { type: "task.output_ready"; data: { resultId: string } }
  /** Same waiting task, new server question revision; consumers must reread input. */
  | { type: "task.input_refreshed"; data: { requestId: string; previousRevision: number; revision: number } }
  | { type: "access.revoked"; data: { code: "AI_ACCESS_DENIED" | "AI_SCOPE_CHANGED" } }
);

/** SSE 使用同一 event，轮询使用此页；先重授权再读取，不能只按cursor续传。 */
export interface AiTaskEventPageDraft {
  contractVersion: typeof AI_TASK_DRAFT_VERSION;
  taskId: string;
  events: AiTaskEventDraft[];
  nextCursor: string;
  hasMore: boolean;
}

/** Owner-authorized read projection and task-local event watermark from one
 * database snapshot. It is neither execution permission nor a business result.
 * Read subsequent events strictly after cursor; gaps remain legitimate.
 */
export interface AiTaskSnapshotDraft {
  contractVersion: typeof AI_TASK_DRAFT_VERSION;
  taskId: string;
  revision: number;
  status: AiTaskStatusDraft;
  sceneCode: string;
  sceneVersion: string;
  createdAt: string;
  updatedAt: string;
  cancelRequestedAt: string | null;
  cursor: string;
  steps: Array<{ stepId: string; runId: string; sequence: number; revision: number; status: AiStepStatusDraft;
    /** Lookup reference only; the original result/source reader must authorize it again. */
    resultId?: string;
    /** Registered step category only, not an allowed action or approval. */
    kind?: 'model' | 'confirmation' }>;
}
export interface AiTaskEventResetDraft {
  contractVersion: typeof AI_TASK_DRAFT_VERSION;
  taskId: string;
  status: "reset_required";
  reason: "cursor_expired" | "unsupported_version";
}

/** Owner-only observation transport. Metadata, source-revalidated original
 * model text and original usage have separate current-authorized reads. No
 * execution or lease; cursor continuation is never authority. */
export const AI_TASK_CENTER_HTTP_DRAFT = Object.freeze({ basePath: "ai-native/task-center", method: "POST",
  list: "list", snapshot: "snapshot", events: "events", result: "result", usage: "usage", confirmation: "confirmation",
  review: "review", decision: "decision", decisionReceipt: "decision-receipt", business: "business", continue: "continue", source: "source" } as const);
export const AI_TASK_CENTER_ENTRY_PERMISSIONS = Object.freeze([
  "rental-os:order:view", "rental-os:order:create", "rental-os:price:manage", "system:params:manage"
] as const);
export interface AiTaskMetadataQueryDraft { limit?: number; cursor?: string; status?: AiTaskStatusDraft; sceneCode?: string }
export interface AiTaskMetadataPageDraft {
  items: Array<{ taskId: string; status: AiTaskStatusDraft; revision: number; sceneCode: string; sceneVersion: string;
    createdAt: string; updatedAt: string; cancelRequestedAt: string | null }>;
  nextCursor: string | null;
}

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

/** Original waiting-step lookup, not an execution or approval credential. */
export interface AiTaskReviewQueryDraft { taskId: string; runId: string; stepId: string }
export interface AiTaskDecisionQueryDraft extends AiTaskReviewQueryDraft {
  proposal: import('./ai-approval-application-draft').AiApprovalApplicationDecisionDraft;
}
export type AiTaskHumanReviewDraft = AiTaskReviewQueryDraft & {
  taskRevision: number; checkpointRef: string; businessExecution: 'not_attested';
} & (
  | { kind: 'order'; review: import('./ai-approval-application-draft').AiApprovalApplicationReviewDraft }
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
