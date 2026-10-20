/** Platform management only, with independent server read/manage permissions. */
import { AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT, type AiPlatformModelSettingsInputDraft } from "@rental-os/shared";
import { request } from "./http";
const path = (id: string) => `/${AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${encodeURIComponent(id)}`;
export const platformAiSettingsApi = Object.freeze({
  read: (id: string) => request<unknown>(path(id)),
  save: (id: string, input: AiPlatformModelSettingsInputDraft) => request<unknown>(path(id), { method: "put", data: input }),
  operation: (id: string, key: string) => request<unknown>(`${path(id)}/operations/${encodeURIComponent(key)}`)
});
