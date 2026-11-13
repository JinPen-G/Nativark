/** Formal task calendar-draft API. Original references are read from the server,
 * never entered by a user or reconstructed from a model/card's raw fields. */
import { AI_TASK_CALENDAR_DRAFT_HTTP, aiTaskCalendarDraftListResponse, aiTaskCalendarDraftReviewResponse, aiTaskCalendarDraftOperationResponse,
  type AiTaskCalendarDraftReference, type AiTaskCalendarDraftReviewInput, type AiTaskCalendarDraftSaveInput, type ApiResult } from '@rental-os/shared';
import { http } from './http';
import { currentSessionSignal, currentSessionEpoch } from '@/app/queryClient';
import { AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP, aiTaskCalendarDraftPreparationResponse,
  aiTaskCalendarDraftPreparationPreviewResponse, aiTaskCalendarDraftPreparationOperationResponse,
  aiTaskCalendarDraftSourceResponse, aiTaskCalendarDraftEntryResponse,
  type AiTaskCalendarDraftPreparationInput, type AiTaskCalendarDraftPreparationPreviewInput,
  type AiTaskCalendarDraftPrepareInput, type AiTaskCalendarDraftPreparationReference,
  type AiTaskCalendarDraftSourceInput, type AiTaskCalendarDraftEntryInput, type AiTaskCalendarDraftEntryReference } from '@rental-os/shared';
const post = async (action: 'list' | 'review' | 'save' | 'operation' | 'preparation' | 'previewPreparation' | 'prepare'
  | 'preparationOperation' | 'source' | 'entry' | 'entryOperation', value: unknown, signal: AbortSignal) => {
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const path = action in AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP
    ? AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP[action as Exclude<keyof typeof AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP, 'basePath'>]
    : AI_TASK_CALENDAR_DRAFT_HTTP[action as 'list' | 'review' | 'save' | 'operation'];
  const write = ['save', 'prepare', 'entry'].includes(action);
  // Preserve the original write attempt through an authentication failure.
  const result = await http.post<ApiResult<unknown>>(`/${AI_TASK_CALENDAR_DRAFT_HTTP.basePath}/${path}`, structuredClone(value),
    { signal: active, timeout: 12000, ...(write ? { _authRetry: true } : {}) });
  if (active.aborted || epoch !== currentSessionEpoch()) throw Error('AI_SCOPE_CHANGED');
  return result.data.data;
};
export const aiTaskCalendarDraftApi = Object.freeze({
  list: async (taskId: string, signal: AbortSignal) => aiTaskCalendarDraftListResponse.parse(await post('list', { taskId }, signal)),
  review: async (value: AiTaskCalendarDraftReviewInput, signal: AbortSignal) => aiTaskCalendarDraftReviewResponse.parse(await post('review', value, signal)),
  save: async (value: AiTaskCalendarDraftSaveInput, signal: AbortSignal) => aiTaskCalendarDraftOperationResponse.parse(await post('save', value, signal)),
  operation: async (value: AiTaskCalendarDraftReference, signal: AbortSignal) => aiTaskCalendarDraftOperationResponse.parse(await post('operation', value, signal)),
  preparation: async (value: AiTaskCalendarDraftPreparationInput, signal: AbortSignal) => aiTaskCalendarDraftPreparationResponse.parse(await post('preparation', value, signal)),
  previewPreparation: async (value: AiTaskCalendarDraftPreparationPreviewInput, signal: AbortSignal) => aiTaskCalendarDraftPreparationPreviewResponse.parse(await post('previewPreparation', value, signal)),
  prepareProposal: async (value: AiTaskCalendarDraftPrepareInput, signal: AbortSignal) => aiTaskCalendarDraftPreparationOperationResponse.parse(await post('prepare', value, signal)),
  preparationOperation: async (value: AiTaskCalendarDraftPreparationReference, signal: AbortSignal) => aiTaskCalendarDraftPreparationOperationResponse.parse(await post('preparationOperation', value, signal)),
  source: async (value: AiTaskCalendarDraftSourceInput, signal: AbortSignal) => aiTaskCalendarDraftSourceResponse.parse(await post('source', value, signal)),
  entry: async (value: AiTaskCalendarDraftEntryInput, signal: AbortSignal) => aiTaskCalendarDraftEntryResponse.parse(await post('entry', value, signal)),
  entryOperation: async (value: AiTaskCalendarDraftEntryReference, signal: AbortSignal) => aiTaskCalendarDraftEntryResponse.parse(await post('entryOperation', value, signal))
});
