/**
 * C04纯决策函数：调用方先按schema解析完整输入，再在持久化提交点重授权、CAS和fencing。
 * 这里不读数据库、不创建任务、不发业务动作；allowed只表示状态迁移约束满足，不是执行授权。
 */
import {
  AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_TASK_TERMINAL_STATUSES_DRAFT,
  type AiTaskStatusDraft, type AiTaskStateDraft, type AiTaskTransitionRequestDraft,
  type AiTaskTransitionDecisionDraft, type AiRunLeaseDraft, type AiTaskEventPageDraft,
  type AiStepStateDraft, type AiStepStatusDraft, type AiStepTransitionReasonDraft
} from "@rental-os/shared";

const transitions: Record<AiTaskStatusDraft, readonly AiTaskStatusDraft[]> = {
  queued: ["running", "cancel_requested"],
  running: ["waiting_input", "waiting_confirmation", "waiting_external", "cancel_requested", "succeeded", "partially_succeeded", "failed"],
  waiting_input: ["running", "cancel_requested"],
  waiting_confirmation: ["running", "cancel_requested"],
  waiting_external: ["running", "cancel_requested"],
  // 取消意图不可被waiting_external/resume抹掉；未知动作继续核对，不再开新动作。
  cancel_requested: ["cancelled", "partially_succeeded", "succeeded"],
  succeeded: [], partially_succeeded: [], failed: [], cancelled: []
};
Object.values(transitions).forEach(Object.freeze);
export const AI_TASK_TRANSITIONS_DRAFT = Object.freeze(transitions);

const validRevision = (value: number) => Number.isSafeInteger(value) && value > 0;
const isStatus = (value: string): value is AiTaskStatusDraft => AI_TASK_STATUSES_DRAFT.some(status => status === value);
const timestamp = (value: string) => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value));
const cursor = (value: string, allowZero = false) => typeof value === "string" && value.length <= 20
  && (allowZero ? /^(0|[1-9][0-9]*)$/u : /^[1-9][0-9]*$/u).test(value);
const deny = (reason: Extract<AiTaskTransitionDecisionDraft, { allowed: false }>["reason"]): AiTaskTransitionDecisionDraft => ({ allowed: false, reason });

/** Only persisted transition facts are needed here; do not manufacture business fact references for validation. */
export type AiTaskTransitionStateDraft = Pick<AiTaskStateDraft, "contractVersion" | "taskId" | "revision" | "status"> & {
  steps: Array<Pick<AiStepStateDraft, "stepId" | "runId" | "sequence" | "revision" | "actionId"> & {
    outcome: Pick<AiStepStateDraft["outcome"], "status" | "effect">;
  }>;
};

export function evaluateAiTaskTransitionDraft(state: AiTaskTransitionStateDraft, request: AiTaskTransitionRequestDraft): AiTaskTransitionDecisionDraft {
  if (state.contractVersion !== AI_TASK_DRAFT_VERSION || request.contractVersion !== AI_TASK_DRAFT_VERSION
    || state.taskId !== request.taskId || !state.taskId || !isStatus(state.status) || !isStatus(request.to)
    || !validRevision(state.revision) || state.revision === Number.MAX_SAFE_INTEGER
    || !validRevision(request.expectedRevision) || !timestamp(request.occurredAt)) return deny("invalid_state");
  if (request.expectedRevision !== state.revision) return deny("revision_conflict");
  if (!AI_TASK_TRANSITIONS_DRAFT[state.status].includes(request.to)) return deny("transition_denied");

  const expectedReason = request.to === "running" ? (state.status === "queued" ? "start" : "resume")
    : request.to === "waiting_input" ? "input_required"
    : request.to === "waiting_confirmation" ? "confirmation_required"
    : request.to === "waiting_external" ? "external_pending"
    : request.to === "cancel_requested" ? "cancel_requested"
    : state.status === "cancel_requested" ? "cancel_settled"
    : request.to === "failed" ? "execution_failed" : "completed";
  if (request.reason !== expectedReason) return deny("transition_denied");

  const steps = state.steps;
  if (!Array.isArray(steps) || steps.length > 1000) return deny("invalid_state");
  // 请求指纹不是唯一动作标识；不同action可能有相同内容，但同action不能伪装成两个步骤。
  const ids = new Set<string>(), actions = new Set<string>(), sequences = new Set<string>();
  for (const step of steps) {
    const sequenceKey = JSON.stringify([step.runId, step.sequence]);
    if (!step.stepId || !step.actionId || !step.runId || !validRevision(step.sequence) || !validRevision(step.revision)
      || ids.has(step.stepId) || actions.has(step.actionId) || sequences.has(sequenceKey)
      || !step.outcome || !["pending", "running", "succeeded", "failed", "unknown", "cancelled"].includes(step.outcome.status)) return deny("invalid_state");
    const { status, effect } = step.outcome;
    if ((["pending", "failed", "cancelled"].includes(status) && effect !== "none")
      || (status === "unknown" && effect !== "possible")
      || (status === "running" && effect !== "none" && effect !== "possible")
      || (status === "succeeded" && effect !== "none" && effect !== "committed")) return deny("invalid_state");
    ids.add(step.stepId); actions.add(step.actionId); sequences.add(sequenceKey);
  }
  if (state.status === "queued" && steps.some(step => step.outcome.status !== "pending")) return deny("invalid_state");
  const unresolved = steps.some(step => step.outcome.status === "running" || step.outcome.status === "unknown");
  // 接收取消请求本身不承诺撤销；之后的核对/接管仍需当前授权。
  if (request.to === "cancel_requested") return { allowed: true, nextRevision: state.revision + 1 };
  if (request.to === "waiting_external") {
    return unresolved ? { allowed: true, nextRevision: state.revision + 1 } : deny("outcome_conflict");
  }
  if (unresolved) return deny("unresolved_steps");

  if (AI_TASK_TERMINAL_STATUSES_DRAFT.includes(request.to)) {
    const successes = steps.filter(step => step.outcome.status === "succeeded").length;
    const committed = steps.some(step => step.outcome.effect === "committed");
    if (request.to === "succeeded" && (steps.length === 0 || successes !== steps.length)) return deny("outcome_conflict");
    if (request.to === "partially_succeeded" && (successes === 0 || successes === steps.length)) return deny("outcome_conflict");
    if (request.to === "failed" && successes !== 0) return deny("outcome_conflict");
    if (request.to === "cancelled" && committed) return deny("outcome_conflict");
  }
  return { allowed: true, nextRevision: state.revision + 1 };
}

/** 单个逻辑步骤的重试保留身份与指纹；unknown只能经业务核对变成已提交或确定未提交。 */
export function evaluateAiStepTransitionDraft(previous: AiStepStateDraft, next: AiStepStateDraft, reason: AiStepTransitionReasonDraft): AiTaskTransitionDecisionDraft {
  if (!validRevision(previous.revision) || previous.revision === Number.MAX_SAFE_INTEGER
    || next.revision !== previous.revision + 1) return deny("revision_conflict");
  const identityFields = ["stepId", "runId", "sequence", "toolCode", "toolVersion", "actionId", "requestFingerprint"] as const;
  if (identityFields.some(key => previous[key] !== next[key])) return deny("invalid_state");
  const from = previous.outcome.status, to = next.outcome.status;
  const permitted: Record<AiStepStatusDraft, readonly AiStepStatusDraft[]> = {
    pending: ["running", "cancelled"], running: ["succeeded", "failed", "unknown"],
    unknown: ["succeeded", "failed"], failed: ["running"], succeeded: [], cancelled: []
  };
  if (!Object.prototype.hasOwnProperty.call(permitted, from) || !permitted[from].includes(to)) return deny("transition_denied");
  const expectedReason = from === "pending" ? (to === "running" ? "start" : "not_started_cancelled")
    : from === "failed" ? "retry_known_failure"
    : from === "unknown" ? (to === "succeeded" ? "reconciled_committed" : "reconciled_not_committed")
    : to === "unknown" ? "result_unknown" : "result_observed";
  if (reason !== expectedReason) return deny("transition_denied");
  if (previous.outcome.status === "failed" && !previous.outcome.error.retryable) return deny("transition_denied");
  if (from === "unknown" && to === "succeeded" && next.outcome.effect !== "committed") return deny("outcome_conflict");
  if (from === "running" && previous.outcome.effect === "none" && next.outcome.effect !== "none") return deny("outcome_conflict");
  return { allowed: true, nextRevision: next.revision };
}

/** 仅比较服务端读出的租约；同一DB提交仍需原子条件，不能先调用此函数再无条件写库。 */
export function matchesAiRunLeaseDraft(stored: AiRunLeaseDraft, presented: AiRunLeaseDraft, now: string): boolean {
  return stored.contractVersion === AI_TASK_DRAFT_VERSION && presented.contractVersion === AI_TASK_DRAFT_VERSION
    && !!stored.taskId && !!stored.runId && !!stored.holderId
    && stored.taskId === presented.taskId && stored.runId === presented.runId && stored.holderId === presented.holderId
    && cursor(stored.fencingToken) && cursor(presented.fencingToken) && stored.fencingToken === presented.fencingToken
    && timestamp(now) && timestamp(stored.expiresAt) && stored.expiresAt === presented.expiresAt
    && Date.parse(stored.expiresAt) > Date.parse(now);
}

/** 验证同一已授权task的一页事件；身份/访问撤销校验不在本纯函数内。游标空洞合法。 */
export function isAiTaskEventPageConsistentDraft(page: AiTaskEventPageDraft, after: string): boolean {
  if (page.contractVersion !== AI_TASK_DRAFT_VERSION || !page.taskId || !cursor(after, true)
    || !cursor(page.nextCursor, true) || !Array.isArray(page.events) || page.events.length > 100
    || typeof page.hasMore !== "boolean" || (page.hasMore && page.events.length === 0)) return false;
  let previousCursor = BigInt(after), previousRevision = 0;
  for (const event of page.events) {
    if (event.contractVersion !== AI_TASK_DRAFT_VERSION || event.taskId !== page.taskId || !cursor(event.cursor)
      || !validRevision(event.taskRevision) || event.taskRevision < previousRevision
      || BigInt(event.cursor) <= previousCursor || !timestamp(event.occurredAt)) return false;
    previousCursor = BigInt(event.cursor);
    previousRevision = event.taskRevision;
  }
  return BigInt(page.nextCursor) === previousCursor;
}
