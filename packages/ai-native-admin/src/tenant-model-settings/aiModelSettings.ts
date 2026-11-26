/** 原租户配置与供应商元数据接口；复用所选宿主，不持久化密钥或触发模型检测。 */
import { AI_MODEL_SETTINGS_HTTP_DRAFT, type AiTenantModelSettingsInputDraft } from "@rental-os/platform-contracts/ai-usage";
import type { AiProviderDiscoveryInputDraft, AiProviderDiscoveryResultDraft } from "@rental-os/platform-contracts/ai-provider-discovery";
import type { AiAdminHost } from "../host";
import { createAiSettingsRequest } from "../platform-model-settings/request";

export function createAiModelSettingsApi(host: AiAdminHost, scope: 'workspace' | 'tenant' = 'workspace') {
  const request = createAiSettingsRequest(host);
  const access = { audience: "tenant", permission: "system:params:manage", workspace: scope === 'tenant' ? 'absent' : true, write: false } as const;
  const path = (action: "read" | "save" | "operation" | "legacy") =>
    `/${AI_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${AI_MODEL_SETTINGS_HTTP_DRAFT[action]}`;
  return Object.freeze({
    read: () => request<unknown>(path("read"), access, { method: "post", data: {} }),
    discover: (action: "models" | "detect", input: AiProviderDiscoveryInputDraft, signal: AbortSignal) =>
      request<AiProviderDiscoveryResultDraft>(
        `/${AI_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${action === "models" ? AI_MODEL_SETTINGS_HTTP_DRAFT.discoverModels : AI_MODEL_SETTINGS_HTTP_DRAFT.detectProtocols}`,
        access, { method: "post", data: input, signal, timeout: 16000, headers: { "Cache-Control": "no-store" } }),
    legacy: () => request<unknown>(path("legacy"), access, { method: "post", data: {} }),
    save: (input: AiTenantModelSettingsInputDraft) =>
      request<unknown>(path("save"), { ...access, write: true }, { method: "post", data: input }),
    operation: (operationKey: string) =>
      request<unknown>(path("operation"), access, { method: "post", data: { operationKey } }),
  });
}
