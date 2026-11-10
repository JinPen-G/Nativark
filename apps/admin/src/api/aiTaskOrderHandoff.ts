/** Only current owned Task IDs are transported. Epoch checks suppress old
 * reads; this endpoint never starts a model, task or business operation. */
import { AI_TASK_ORDER_HANDOFF_HTTP, aiTaskOrderHandoffQuery, aiTaskOrderHandoffResponse,
  type AiTaskOrderHandoffQuery, type ApiResult } from '@rental-os/shared';
import { http } from './http';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
export const aiTaskOrderHandoffApi = Object.freeze({ async read(input: AiTaskOrderHandoffQuery, signal: AbortSignal) {
  const query = aiTaskOrderHandoffQuery.parse(structuredClone(input));
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const response = await http.post<ApiResult<unknown>>(`/${AI_TASK_ORDER_HANDOFF_HTTP.basePath}/${AI_TASK_ORDER_HANDOFF_HTTP.read}`,
    query, { signal: active, timeout: 12000 });
  if (active.aborted || epoch !== currentSessionEpoch()) throw Error('AI_SCOPE_CHANGED');
  if (new TextEncoder().encode(JSON.stringify(response.data.data)).length > 32768) throw Error('AI_RESOURCE_UNAVAILABLE');
  const value = aiTaskOrderHandoffResponse.parse(response.data.data);
  if (value.taskId !== query.taskId || (query.runId !== undefined && value.runId !== query.runId)) throw Error('AI_SCOPE_CHANGED');
  return value;
} });
