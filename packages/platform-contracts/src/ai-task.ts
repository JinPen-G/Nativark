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
