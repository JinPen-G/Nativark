/** Observation methods never execute. Only explicit human decision/continue
 * methods mutate; original server domain policies and hosts remain mandatory.
 * Canonical HTTP retains tenant/session handling and abort lifetimes. */
import { AI_TASK_CENTER_HTTP_DRAFT, type AiTaskMetadataPageDraft, type AiTaskMetadataQueryDraft,
  type AiTaskSnapshotDraft, type AiTaskEventPageDraft, type AiTaskEventResetDraft, type ApiResult,
  type AiTaskModelObservationDraft, type AiTaskBudgetUsagePageDraft, type AiTaskConfirmationHistoryDraft,
  type AiTaskReviewQueryDraft, type AiTaskDecisionQueryDraft, type AiTaskHumanReviewDraft, type AiTaskHumanDecisionReceiptDraft,
  type AiTaskBusinessObservationDraft, type AiTaskHumanContinueDraft, type AiTaskHumanContinuationDraft,
  type AiTaskModelSourceQueryDraft, type AiTaskModelSourceObservationDraft,
  type AiTaskStopQueryDraft, type AiTaskStopObservationDraft, type AiTaskClarificationAnswerDraft,
  type AiTaskClarificationObservationDraft, type AiTaskClarificationProgressDraft, type AiTaskClarificationReceiptQueryDraft } from "@rental-os/shared";
import { currentSessionSignal } from "@/app/queryClient";
import { http } from "./http";

async function read<T>(action: Exclude<keyof typeof AI_TASK_CENTER_HTTP_DRAFT, 'basePath'>, data: unknown, signal: AbortSignal): Promise<T> {
  const result = await http.post<ApiResult<T>>(`/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT[action]}`,
    data, { signal: AbortSignal.any([signal, currentSessionSignal()]) });
  return result.data.data;
}
export const aiTaskCenterApi = Object.freeze({
  input: (taskId: string, signal: AbortSignal) => read<AiTaskClarificationObservationDraft>('input', { taskId }, signal),
  resumeInput: (input: AiTaskClarificationAnswerDraft, signal: AbortSignal) => read<AiTaskClarificationProgressDraft>('resumeInput', input, signal),
  inputReceipt: (input: AiTaskClarificationAnswerDraft | AiTaskClarificationReceiptQueryDraft, signal: AbortSignal) => read<AiTaskClarificationProgressDraft>('inputReceipt', input, signal),
  continueInput: (input: AiTaskClarificationAnswerDraft | AiTaskClarificationReceiptQueryDraft, signal: AbortSignal) => read<AiTaskClarificationProgressDraft>('continueInput', input, signal),
  list: (input: AiTaskMetadataQueryDraft, signal: AbortSignal) => read<AiTaskMetadataPageDraft>("list", input, signal),
  snapshot: (taskId: string, signal: AbortSignal) => read<AiTaskSnapshotDraft>("snapshot", { taskId }, signal),
  events: (taskId: string, after: string, signal: AbortSignal) => read<AiTaskEventPageDraft | AiTaskEventResetDraft>("events", { taskId, after, limit: 50 }, signal),
  result: (taskId: string, resultId: string, signal: AbortSignal) => read<AiTaskModelObservationDraft>("result", { taskId, resultId }, signal),
  source: (input: AiTaskModelSourceQueryDraft, signal: AbortSignal) => read<AiTaskModelSourceObservationDraft>("source", input, signal),
  stop: (input: AiTaskStopQueryDraft, signal: AbortSignal) => read<AiTaskStopObservationDraft>('stop', input, signal),
  stopReceipt: (input: AiTaskStopQueryDraft, signal: AbortSignal) => read<AiTaskStopObservationDraft>('stopReceipt', input, signal),
  usage: (taskId: string, signal: AbortSignal, after?: string) => read<AiTaskBudgetUsagePageDraft>("usage", { taskId, limit: 20, ...(after ? { after } : {}) }, signal),
  confirmation: (input: AiTaskReviewQueryDraft, signal: AbortSignal) => read<AiTaskConfirmationHistoryDraft>("confirmation", input, signal),
  review: (input: AiTaskReviewQueryDraft, signal: AbortSignal) => read<AiTaskHumanReviewDraft>("review", input, signal),
  decision: (input: AiTaskDecisionQueryDraft, signal: AbortSignal) => read<AiTaskHumanDecisionReceiptDraft>("decision", input, signal),
  decisionReceipt: (input: AiTaskDecisionQueryDraft, signal: AbortSignal) => read<AiTaskHumanDecisionReceiptDraft>("decisionReceipt", input, signal),
  business: (input: AiTaskReviewQueryDraft, signal: AbortSignal) => read<AiTaskBusinessObservationDraft>("business", input, signal),
  continue: (input: AiTaskHumanContinueDraft, signal: AbortSignal) => read<AiTaskHumanContinuationDraft>("continue", input, signal)
});
