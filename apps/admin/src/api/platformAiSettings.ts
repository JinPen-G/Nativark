/** Platform management only, with independent server read/manage permissions. */
import { AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT, type AiPlatformModelSettingsInputDraft, type AiPlatformModelDirectoryQueryDraft,
  type AiPlatformModelDirectoryDraft, type ApiResult } from "@rental-os/shared";
import { currentSessionSignal } from '@/app/queryClient';
import { http, request } from "./http";
const path = (id: string) => `/${AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${encodeURIComponent(id)}`;
export const platformAiSettingsApi = Object.freeze({
  list: async (input: AiPlatformModelDirectoryQueryDraft, signal: AbortSignal) => {
    const response = await http.get<ApiResult<AiPlatformModelDirectoryDraft>>(`/${AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath}`,
      { params: input, signal: AbortSignal.any([signal, currentSessionSignal()]) });
    return response.data.data;
  },
  read: (id: string) => request<unknown>(path(id)),
  save: (id: string, input: AiPlatformModelSettingsInputDraft) => request<unknown>(path(id), { method: "put", data: input }),
  operation: (id: string, key: string) => request<unknown>(`${path(id)}/operations/${encodeURIComponent(key)}`)
});
