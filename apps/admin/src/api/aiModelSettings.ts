/** Configuration management only: shared paths + canonical authenticated HTTP.
 * No model probes, secret readback, budget initialization or write retries. */
import { AI_MODEL_SETTINGS_HTTP_DRAFT, type AiTenantModelSettingsInputDraft, type AiProviderDiscoveryInputDraft, type AiProviderDiscoveryResultDraft } from "@rental-os/shared";
import { http, request } from "./http";
import { currentSessionSignal } from '@/app/queryClient';

const path = (action: "read" | "save" | "operation" | "legacy") =>
  `/${AI_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${AI_MODEL_SETTINGS_HTTP_DRAFT[action]}`;
export const aiModelSettingsApi = Object.freeze({
  read: () => request<unknown>(path("read"), { method: "post", data: {} }),
  discover: async (action: 'models' | 'detect', input: AiProviderDiscoveryInputDraft, signal: AbortSignal) => (await http.post<{ data: AiProviderDiscoveryResultDraft }>(
    `/${AI_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${action === 'models' ? AI_MODEL_SETTINGS_HTTP_DRAFT.discoverModels : AI_MODEL_SETTINGS_HTTP_DRAFT.detectProtocols}`,
    input, { signal: AbortSignal.any([signal, currentSessionSignal()]), timeout: 16000, headers: { 'Cache-Control': 'no-store' } })).data.data,
  legacy: () => request<unknown>(path("legacy"), { method: "post", data: {} }),
  save: (input: AiTenantModelSettingsInputDraft) => request<unknown>(path("save"), { method: "post", data: input }),
  operation: (operationKey: string) => request<unknown>(path("operation"), { method: "post", data: { operationKey } })
});
