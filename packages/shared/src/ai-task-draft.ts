/**
 * AIN-C04 草案：状态、动作身份、租约及事件协议，不是持久化运行器或授权凭据。
 * C01 创建时上下文只用于追溯；恢复/每步执行仍必须重新授权并在数据库提交点做 CAS/fencing。
 */
import type { AiExecutionContext, AiFactReference, AiToolCode, AiToolError } from "./ai-native";

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
  toolCode: AiToolCode;
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
export interface AiTaskEventResetDraft {
  contractVersion: typeof AI_TASK_DRAFT_VERSION;
  taskId: string;
  status: "reset_required";
  reason: "cursor_expired" | "unsupported_version";
}
