/** 原平台 Profile 目录、配置、能力观察与保存收据；不验证供应商或调用模型。 */
import {
  AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT,
  type AiPlatformModelSettingsInputDraft,
  type AiPlatformModelDirectoryQueryDraft,
  type AiPlatformModelDirectoryDraft,
  type AiPlatformModelCapabilityObservationDraft,
} from "@rental-os/platform-contracts/ai-usage";
import type { AiAdminHost } from "../host";
import { createAiSettingsRequest } from "./request";

export function createPlatformAiSettingsApi(host: AiAdminHost) {
  const request = createAiSettingsRequest(host);
  const readAccess = { audience: "platform", permission: "system:ai-provider:view", write: false } as const;
  const manageAccess = { audience: "platform", permission: "system:ai-provider:manage", write: true } as const;
  const path = (id: string) => `/${AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${encodeURIComponent(id)}`;
  return Object.freeze({
    list: (input: AiPlatformModelDirectoryQueryDraft, signal: AbortSignal) =>
      request<AiPlatformModelDirectoryDraft>(`/${AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath}`, readAccess, { params: input, signal }),
    capabilities: (id: string, signal: AbortSignal) =>
      request<AiPlatformModelCapabilityObservationDraft>(`${path(id)}/capabilities`, readAccess,
        { signal, headers: { "Cache-Control": "no-store" } }),
    read: (id: string) => request<unknown>(path(id), readAccess),
    save: (id: string, input: AiPlatformModelSettingsInputDraft) =>
      request<unknown>(path(id), manageAccess, { method: "put", data: input }),
    operation: (id: string, key: string) =>
      request<unknown>(`${path(id)}/operations/${encodeURIComponent(key)}`, readAccess),
  });
}
