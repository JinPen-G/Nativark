/** Original observations only. Reconnection cannot claim, resume or dispatch.
 * Canonical HTTP retains tenant/session handling; both lifetimes abort reads. */
import { AI_TASK_CENTER_HTTP_DRAFT, type AiTaskMetadataPageDraft, type AiTaskMetadataQueryDraft,
  type AiTaskSnapshotDraft, type AiTaskEventPageDraft, type AiTaskEventResetDraft, type ApiResult,
  type AiTaskModelObservationDraft, type AiTaskBudgetUsagePageDraft, type AiTaskConfirmationHistoryDraft,
  type AiTaskReviewQueryDraft, type AiTaskDecisionQueryDraft, type AiTaskHumanReviewDraft, type AiTaskHumanDecisionReceiptDraft,
  type AiTaskBusinessObservationDraft } from "@rental-os/shared";
import { currentSessionSignal } from "@/app/queryClient";
import { http } from "./http";

async function read<T>(action: "list" | "snapshot" | "events" | "result" | "usage" | "confirmation" | "review" | "decision" | "decisionReceipt" | "business", data: unknown, signal: AbortSignal): Promise<T> {
  const result = await http.post<ApiResult<T>>(`/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT[action]}`,
    data, { signal: AbortSignal.any([signal, currentSessionSignal()]) });
  return result.data.data;
}
export const aiTaskCenterApi = Object.freeze({
  list: (input: AiTaskMetadataQueryDraft, signal: AbortSignal) => read<AiTaskMetadataPageDraft>("list", input, signal),
  snapshot: (taskId: string, signal: AbortSignal) => read<AiTaskSnapshotDraft>("snapshot", { taskId }, signal),
  events: (taskId: string, after: string, signal: AbortSignal) => read<AiTaskEventPageDraft | AiTaskEventResetDraft>("events", { taskId, after, limit: 50 }, signal),
  result: (taskId: string, resultId: string, signal: AbortSignal) => read<AiTaskModelObservationDraft>("result", { taskId, resultId }, signal),
  usage: (taskId: string, signal: AbortSignal, after?: string) => read<AiTaskBudgetUsagePageDraft>("usage", { taskId, limit: 20, ...(after ? { after } : {}) }, signal),
  confirmation: (input: AiTaskReviewQueryDraft, signal: AbortSignal) => read<AiTaskConfirmationHistoryDraft>("confirmation", input, signal),
  review: (input: AiTaskReviewQueryDraft, signal: AbortSignal) => read<AiTaskHumanReviewDraft>("review", input, signal),
  decision: (input: AiTaskDecisionQueryDraft, signal: AbortSignal) => read<AiTaskHumanDecisionReceiptDraft>("decision", input, signal),
  decisionReceipt: (input: AiTaskDecisionQueryDraft, signal: AbortSignal) => read<AiTaskHumanDecisionReceiptDraft>("decisionReceipt", input, signal),
  business: (input: AiTaskReviewQueryDraft, signal: AbortSignal) => read<AiTaskBusinessObservationDraft>("business", input, signal)
});
