/** Canonical original-selection transport. Preparation/receipts are reads;
 * only explicit select/start delegates the original server-owned operation. */
import { AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT, AI_SELECTED_QUOTE_TASK_HTTP_DRAFT, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT,
  type ApiResult, type AiClarifiedQuoteSelectionPreparationInputDraft, type AiClarifiedQuoteSelectionPreparationDraft,
  type AiClarifiedQuoteSelectionRequestDraft, type AiClarifiedQuoteSelectionOriginalOperationReadDraft,
  type AiQuoteSelectionSelectResponseDraft, type AiQuoteSelectionReconcileResponseDraft,
  type AiSelectedQuoteTaskRequestDraft, type AiSelectedQuoteTaskRunDraft, type AiSelectedQuoteTaskResultDraft,
  type AiHumanQuoteOrderRepreparePreparationInputDraft, type AiHumanQuoteOrderRepreparePreparationDraft,
  type AiHumanQuoteOrderReprepareRequestDraft, type AiHumanQuoteOrderReprepareResponseDraft } from '@rental-os/shared';
import { http } from './http';
import { currentSessionSignal } from '@/app/queryClient';
import { AI_EXECUTION_RESPONSE_TIMEOUT_MS } from './aiRequestTiming';

async function call<T>(basePath: string, action: string, input: unknown, signal: AbortSignal, running = false): Promise<T> {
  if (signal.aborted) throw Error('AI_SCOPE_CHANGED');
  const result = await http.post<ApiResult<T>>(`/${basePath}/${action}`, input,
    { signal: AbortSignal.any([signal, currentSessionSignal()]), ...(running ? { timeout: AI_EXECUTION_RESPONSE_TIMEOUT_MS } : {}) });
  return result.data.data;
}
export const aiQuoteSelectionsApi = Object.freeze({
  prepare: (input: AiClarifiedQuoteSelectionPreparationInputDraft, signal: AbortSignal) =>
    call<AiClarifiedQuoteSelectionPreparationDraft>(AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT.basePath, AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT.prepareSelection, input, signal),
  select: (input: AiClarifiedQuoteSelectionRequestDraft, signal: AbortSignal) =>
    call<AiQuoteSelectionSelectResponseDraft>(AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT.basePath, AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT.select, input, signal),
  operation: (input: AiClarifiedQuoteSelectionOriginalOperationReadDraft, signal: AbortSignal) =>
    call<AiQuoteSelectionReconcileResponseDraft>(AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT.basePath, AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT.readOriginalOperation, input, signal),
  start: (input: AiSelectedQuoteTaskRequestDraft, signal: AbortSignal) =>
    call<AiSelectedQuoteTaskRunDraft>(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.basePath, AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.start, input, signal, true),
  result: (input: AiSelectedQuoteTaskRequestDraft, signal: AbortSignal) =>
    call<AiSelectedQuoteTaskResultDraft>(AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.basePath, AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.readResult, input, signal),
  repreparePreparation: (input: AiHumanQuoteOrderRepreparePreparationInputDraft, signal: AbortSignal) =>
    call<AiHumanQuoteOrderRepreparePreparationDraft>(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.basePath, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readSelectedRepreparePreparation, input, signal),
  reprepare: (input: AiHumanQuoteOrderReprepareRequestDraft, signal: AbortSignal) =>
    call<AiHumanQuoteOrderReprepareResponseDraft>(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.basePath, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.reprepareSelectedProposal, input, signal, true),
  reprepareReceipt: (input: AiHumanQuoteOrderReprepareRequestDraft, signal: AbortSignal) =>
    call<AiHumanQuoteOrderReprepareResponseDraft>(AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.basePath, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readSelectedReprepareReceipt, input, signal)
});
