import type { AiExecutionContext, AiExecutionScope } from './ai-context';

/** 原 AI Native 任务状态与 Runner 结果的公共单源。
 * 这些状态不授予任务、租约或业务权限；Core 工具和存储仍由受控宿主供给。
 * 旧 shared 草案出口再导出同一声明，版本、字面量及 unknown 语义保持。 */
export const AI_TASK_DRAFT_VERSION = "ain-c04-draft-1" as const;
export const AI_TASK_STATUSES_DRAFT = Object.freeze([
  "queued", "running", "waiting_input", "waiting_confirmation", "waiting_external", "cancel_requested",
  "succeeded", "partially_succeeded", "failed", "cancelled"
] as const);
export type AiTaskStatusDraft = typeof AI_TASK_STATUSES_DRAFT[number];
export const AI_STEP_STATUSES_DRAFT = Object.freeze(["pending", "running", "succeeded", "failed", "unknown", "cancelled"] as const);
export type AiStepStatusDraft = typeof AI_STEP_STATUSES_DRAFT[number];
export type AiTaskResourceKindDraft = 'steps' | 'calls' | 'active_ms' | 'output_bytes';
export const AI_TASK_TERMINAL_STATUSES_DRAFT: readonly AiTaskStatusDraft[] = Object.freeze([
  "succeeded", "partially_succeeded", "failed", "cancelled"
]);

/** Wire outcome of the existing runner, not a second state machine. Unknown
 * never implies permission to retry or release the original reservation. */
export type AiTaskRunnerOutcomeDraft =
  | { status: 'succeeded' | 'partially_succeeded' | 'paused' | 'cancel_requested' | 'cancelled' | 'unknown'; completedSteps: number; cleanupFailed: number }
  | { status: 'unavailable'; completedSteps: number; cleanupFailed: number;
      stopReason?: 'input_limit_reached'; nextAction?: 'manual_handoff' }
  | { status: 'failed'; completedSteps: number; cleanupFailed: number; errorCode: string };

export const AI_TOOL_DRAFT_VERSION = "draft-1" as const;
export const AI_TEXT_MODEL_STEP_CODE = "ai.model.text" as const;
export const AI_IMAGE_MODEL_STEP_CODE = "ai.model.image" as const;
export const AI_AUDIO_MODEL_STEP_CODE = "ai.model.audio" as const;
export const AI_TEXT_CAPABILITY_PROBE_STEP_CODE = "ai.capability.text.probe" as const;

/** Core 与资源种类各使用 1–64 位小写标识，沿 Core ID 的单连字符规则。
 * 标识只定位事实；宿主仍按已登记 Core、当前 scope 和对象权限读取原结果。 */
export const AI_CORE_FACT_RESOURCE_TYPE_PATTERN = "^core:[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,63}:[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,63}$(?![\\s\\S])";
export type AiCoreFactResourceType = `core:${string}:${string}`;

/** 来源是资源引用而非任意下载 URL；打开时重新鉴权，不把引用本身当能力令牌。 */
export interface AiFactReference {
  scope: AiExecutionScope;
  resourceType: "order" | "quote" | "configuration" | "report" | "inspection" | "knowledge" | AiCoreFactResourceType;
  resourceId: string;
  observedAt: string;
  /** 缺历史依据不能伪装为当前规则或已冻结快照；兼容办理建议须显式标记来源。 */
  basis:
    | { kind: "current" }
    | { kind: "snapshot"; version: string }
    | { kind: "missing"; reason: "snapshot_missing" | "source_unavailable" }
    | { kind: "legacy_current_fallback"; reason: "snapshot_missing" };
}

export const AI_ERROR_CODES = Object.freeze([
  "AI_DISABLED", "AI_PROVIDER_UNAVAILABLE", "AI_BUDGET_EXCEEDED", "AI_TOOL_UNAVAILABLE",
  "AI_SCOPE_CHANGED", "AI_APPROVAL_EXPIRED", "AI_PROPOSAL_STALE", "AI_RESULT_UNKNOWN",
  "AI_INVALID_INPUT", "AI_UNSUPPORTED_VERSION", "AI_ACCESS_DENIED", "AI_BUSINESS_REJECTED"
] as const);
export type AiErrorCode = typeof AI_ERROR_CODES[number];
export type AiRecoveryAction = "none" | "clarify" | "reconfirm" | "reauthorize" | "reconcile" | "retry_later" | "manual";
interface AiToolErrorDetails {
  /** 服务端面向当前受众的安全文案，不含堆栈/密钥/越权对象是否存在的提示。 */
  message: string;
  missingFields: string[];
}
/** 独立消费错误时也必须保留未知结果的核对语义，不能只由外层状态封套约束。 */
export type AiToolError = AiToolErrorDetails & (
  | { code: Exclude<AiErrorCode, "AI_RESULT_UNKNOWN">; retryable: boolean; nextAction: AiRecoveryAction }
  | { code: "AI_RESULT_UNKNOWN"; retryable: false; nextAction: "reconcile" }
);

/** 业务写结果未知时保留原 actionId/fingerprint，不能换key重放。 */
export type AiStepOutcomeDraft =
  | { status: "pending" | "cancelled"; effect: "none" }
  | { status: "running"; effect: "none" | "possible" }
  | { status: "succeeded"; effect: "none"; facts: AiFactReference[] }
  | { status: "succeeded"; effect: "committed"; facts: [AiFactReference, ...AiFactReference[]] }
  | { status: "failed"; effect: "none"; error: Exclude<AiToolError, { code: "AI_RESULT_UNKNOWN" }> }
  | { status: "unknown"; effect: "possible"; error: Extract<AiToolError, { code: "AI_RESULT_UNKNOWN" }> };

export interface AiStepStateDraft<ToolCode extends string = string> {
  stepId: string;
  runId: string;
  sequence: number;
  revision: number;
  toolCode: ToolCode;
  toolVersion: string;
  actionId: string;
  /** 规范化请求的 SHA-256 小写十六进制；本草案不定义/替代 Core 指纹算法。 */
  requestFingerprint: string;
  outcome: AiStepOutcomeDraft;
}

/** 内部完整状态投影，不直接返回前端；事件不包含该权限快照或原始参数。 */
export interface AiTaskStateDraft<ToolCode extends string = string> {
  contractVersion: typeof AI_TASK_DRAFT_VERSION;
  taskId: string;
  revision: number;
  status: AiTaskStatusDraft;
  createdContext: AiExecutionContext;
  /** 累积步骤，不能在新run中清零预算/动作历史；分页存储不改变此语义。 */
  steps: AiStepStateDraft<ToolCode>[];
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

export interface AiTaskEventBaseDraft {
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

export { AI_TASK_FACT_SCHEMA, createAiStepDraftSchemas } from './ai-step-draft-schemas';
