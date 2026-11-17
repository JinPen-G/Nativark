/** Unsent original drafts, with explicit save and read-only receipt recovery.
 * Session changes reject late responses; authentication cannot replay a POST. */
import { AI_ENTRY_NOTIFICATION_DRAFT_HTTP, aiEntryNotificationDraftPrepareSchema,
  aiEntryNotificationDraftSaveSchema, aiEntryNotificationDraftReadSchema, aiEntryNotificationDraftResponseSchema,
  type AiEntryNotificationDraftPrepare, type AiEntryNotificationDraftSave, type AiEntryNotificationDraftResponse,
  type ApiResult } from '@rental-os/shared';
import { http } from './http';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
async function call(name: 'prepare' | 'save' | 'read', value: unknown, signal: AbortSignal): Promise<AiEntryNotificationDraftResponse> {
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const config = { signal: active, timeout: 15000, _authRetry: true };
  const response = await http.post<ApiResult<unknown>>(`/${AI_ENTRY_NOTIFICATION_DRAFT_HTTP.basePath}/${AI_ENTRY_NOTIFICATION_DRAFT_HTTP[name]}`,
    structuredClone(value), config);
  if (active.aborted || epoch !== currentSessionEpoch()) throw Error('AI_SCOPE_CHANGED');
  if (new TextEncoder().encode(JSON.stringify(response.data.data)).length > 131072) throw Error('AI_RESOURCE_UNAVAILABLE');
  return aiEntryNotificationDraftResponseSchema.parse(response.data.data);
}
export const aiNotificationDraftsApi = Object.freeze({
  prepare(value: AiEntryNotificationDraftPrepare, signal: AbortSignal) {
    return call('prepare', aiEntryNotificationDraftPrepareSchema.parse(value), signal);
  },
  save(value: AiEntryNotificationDraftSave, signal: AbortSignal) {
    return call('save', aiEntryNotificationDraftSaveSchema.parse(value), signal);
  },
  read(operationKey: string, signal: AbortSignal) {
    return call('read', aiEntryNotificationDraftReadSchema.parse({ operationKey }), signal);
  },
});
