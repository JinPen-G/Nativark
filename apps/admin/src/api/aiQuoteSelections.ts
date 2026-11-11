/** Canonical original-selection transport. Preparation/receipts are reads;
 * only explicit select/start delegates the original server-owned operation. */
import { AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT, AI_SELECTED_QUOTE_TASK_HTTP_DRAFT, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT,
  AI_SCENE_REQUEST_HTTP_DRAFT, validateAiQuoteSelectionHttpValue, validateAiSceneQuoteHttpResponse,
  type ApiResult, type AiClarifiedQuoteSelectionPreparationInputDraft, type AiClarifiedQuoteSelectionPreparationDraft,
  type AiClarifiedQuoteSelectionRequestDraft, type AiClarifiedQuoteSelectionOriginalOperationReadDraft,
  type AiQuoteSelectionSelectResponseDraft, type AiQuoteSelectionReconcileResponseDraft,
  type AiSelectedQuoteTaskRequestDraft, type AiSelectedQuoteTaskRunDraft, type AiSelectedQuoteTaskResultDraft,
  type AiHumanQuoteOrderRepreparePreparationInputDraft, type AiHumanQuoteOrderRepreparePreparationDraft,
  type AiHumanQuoteOrderReprepareRequestDraft, type AiHumanQuoteOrderReprepareResponseDraft,
  type AiQuoteRequestReissuePreparationInputDraft, type AiQuoteRequestReissueReferenceDraft, type AiQuoteRequestReissueCreateDraft,
  type AiQuoteRequestReissuePreparationDraft, type AiQuoteRequestReissueOperationDraft, type AiQuoteRequestReissueSelectionPreparationDraft,
  type AiQuoteRequestReissueSelectDraft, type AiQuoteRequestReissueSelectionOperationDraft,
  type AiSceneRequestReadDraft, type AiSceneQuoteConfirmDraft, type AiOriginalQuoteReviewResponseDraft,
  type AiOriginalQuoteConfirmResponseDraft, type AiOriginalQuoteReceiptResponseDraft } from '@rental-os/shared';
import { http } from './http';
import { currentSessionSignal, currentSessionEpoch } from '@/app/queryClient';
import { AI_EXECUTION_RESPONSE_TIMEOUT_MS } from './aiRequestTiming';

async function call<T>(basePath: string, action: string, input: unknown, signal: AbortSignal, running = false): Promise<T> {
  if (signal.aborted) throw Error('AI_SCOPE_CHANGED');
  const result = await http.post<ApiResult<T>>(`/${basePath}/${action}`, input,
    { signal: AbortSignal.any([signal, currentSessionSignal()]), ...(running ? { timeout: AI_EXECUTION_RESPONSE_TIMEOUT_MS } : {}) });
  return result.data.data;
}
async function linkedValue<T>(basePath: string, action: string, input: unknown, signal: AbortSignal,
  validate: (value: unknown) => value is T, writing = false): Promise<T> {
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const value = await call<unknown>(basePath, action, structuredClone(input), active, writing);
  if (active.aborted || epoch !== currentSessionEpoch()) throw Error('AI_SCOPE_CHANGED');
  if (!validate(value)) throw Error('AI_RESULT_UNKNOWN');
  return value;
}
export const aiQuoteSelectionsApi = Object.freeze({
  reissuePreparation: (input: AiQuoteRequestReissuePreparationInputDraft, signal: AbortSignal) => linkedValue<AiQuoteRequestReissuePreparationDraft>(
    AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.basePath, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readReissuePreparation, input, signal,
    (value): value is AiQuoteRequestReissuePreparationDraft => validateAiQuoteSelectionHttpValue('AiQuoteRequestReissuePreparationDraft', value)),
  reissueRequest: (input: AiQuoteRequestReissueCreateDraft, signal: AbortSignal) => linkedValue<AiQuoteRequestReissueOperationDraft>(
    AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.basePath, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.reissueSelectedRequest, input, signal,
    (value): value is AiQuoteRequestReissueOperationDraft => validateAiQuoteSelectionHttpValue('AiQuoteRequestReissueOperationDraft', value), true),
  reissueOperation: (input: AiQuoteRequestReissueReferenceDraft, signal: AbortSignal) => linkedValue<AiQuoteRequestReissueOperationDraft>(
    AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.basePath, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readReissueOperation, input, signal,
    (value): value is AiQuoteRequestReissueOperationDraft => validateAiQuoteSelectionHttpValue('AiQuoteRequestReissueOperationDraft', value)),
  reissuedSelectionPreparation: (input: AiQuoteRequestReissueReferenceDraft, signal: AbortSignal) => linkedValue<AiQuoteRequestReissueSelectionPreparationDraft>(
    AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.basePath, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readReissuedSelectionPreparation, input, signal,
    (value): value is AiQuoteRequestReissueSelectionPreparationDraft => validateAiQuoteSelectionHttpValue('AiQuoteRequestReissueSelectionPreparationDraft', value)),
  selectReissuedQuote: (input: AiQuoteRequestReissueSelectDraft, signal: AbortSignal) => linkedValue<AiQuoteRequestReissueSelectionOperationDraft>(
    AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.basePath, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.selectReissuedQuote, input, signal,
    (value): value is AiQuoteRequestReissueSelectionOperationDraft => validateAiQuoteSelectionHttpValue('AiQuoteRequestReissueSelectionOperationDraft', value), true),
  reissuedSelectionOperation: (input: AiQuoteRequestReissueReferenceDraft, signal: AbortSignal) => linkedValue<AiQuoteRequestReissueSelectionOperationDraft>(
    AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.basePath, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT.readReissuedSelectionOperation, input, signal,
    (value): value is AiQuoteRequestReissueSelectionOperationDraft => validateAiQuoteSelectionHttpValue('AiQuoteRequestReissueSelectionOperationDraft', value)),
  reviewOriginalQuote: (input: AiSceneRequestReadDraft, signal: AbortSignal) => linkedValue<AiOriginalQuoteReviewResponseDraft>(
    AI_SCENE_REQUEST_HTTP_DRAFT.basePath, AI_SCENE_REQUEST_HTTP_DRAFT.quoteReview, input, signal,
    (value): value is AiOriginalQuoteReviewResponseDraft => validateAiSceneQuoteHttpResponse('AiOriginalQuoteReviewResponseDraft', value)),
  confirmOriginalQuote: (input: AiSceneQuoteConfirmDraft, signal: AbortSignal) => linkedValue<AiOriginalQuoteConfirmResponseDraft>(
    AI_SCENE_REQUEST_HTTP_DRAFT.basePath, AI_SCENE_REQUEST_HTTP_DRAFT.quoteConfirm, input, signal,
    (value): value is AiOriginalQuoteConfirmResponseDraft => validateAiSceneQuoteHttpResponse('AiOriginalQuoteConfirmResponseDraft', value), true),
  originalQuoteReceipt: (input: AiSceneRequestReadDraft, signal: AbortSignal) => linkedValue<AiOriginalQuoteReceiptResponseDraft>(
    AI_SCENE_REQUEST_HTTP_DRAFT.basePath, AI_SCENE_REQUEST_HTTP_DRAFT.quoteReceipt, input, signal,
    (value): value is AiOriginalQuoteReceiptResponseDraft => validateAiSceneQuoteHttpResponse('AiOriginalQuoteReceiptResponseDraft', value)),
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
