/** Formal task calendar-draft API. Original references are read from the server,
 * never entered by a user or reconstructed from a model/card's raw fields. */
import { AI_TASK_CALENDAR_DRAFT_HTTP, aiTaskCalendarDraftListResponse, aiTaskCalendarDraftReviewResponse, aiTaskCalendarDraftOperationResponse,
  type AiTaskCalendarDraftReference, type AiTaskCalendarDraftReviewInput, type AiTaskCalendarDraftSaveInput, type ApiResult } from '@rental-os/shared';
import { http } from './http';
import { currentSessionSignal, currentSessionEpoch } from '@/app/queryClient';
const post = async (action: 'list' | 'review' | 'save' | 'operation', value: unknown, signal: AbortSignal) => {
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const result = await http.post<ApiResult<unknown>>(`/${AI_TASK_CALENDAR_DRAFT_HTTP.basePath}/${AI_TASK_CALENDAR_DRAFT_HTTP[action]}`, structuredClone(value),
    { signal: active, timeout: 12000 });
  if (active.aborted || epoch !== currentSessionEpoch()) throw Error('AI_SCOPE_CHANGED');
  return result.data.data;
};
export const aiTaskCalendarDraftApi = Object.freeze({
  list: async (taskId: string, signal: AbortSignal) => aiTaskCalendarDraftListResponse.parse(await post('list', { taskId }, signal)),
  review: async (value: AiTaskCalendarDraftReviewInput, signal: AbortSignal) => aiTaskCalendarDraftReviewResponse.parse(await post('review', value, signal)),
  save: async (value: AiTaskCalendarDraftSaveInput, signal: AbortSignal) => aiTaskCalendarDraftOperationResponse.parse(await post('save', value, signal)),
  operation: async (value: AiTaskCalendarDraftReference, signal: AbortSignal) => aiTaskCalendarDraftOperationResponse.parse(await post('operation', value, signal))
});
