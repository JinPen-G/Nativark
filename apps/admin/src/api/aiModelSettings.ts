/** Configuration management only: shared paths + canonical authenticated HTTP.
 * No model probes, secret readback, budget initialization or write retries. */
import { AI_MODEL_SETTINGS_HTTP_DRAFT, type AiTenantModelSettingsInputDraft } from "@rental-os/shared";
import { request } from "./http";

const path = (action: "read" | "save" | "operation" | "legacy") =>
  `/${AI_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${AI_MODEL_SETTINGS_HTTP_DRAFT[action]}`;
export const aiModelSettingsApi = Object.freeze({
  read: () => request<unknown>(path("read"), { method: "post", data: {} }),
  legacy: () => request<unknown>(path("legacy"), { method: "post", data: {} }),
  save: (input: AiTenantModelSettingsInputDraft) => request<unknown>(path("save"), { method: "post", data: input }),
  operation: (operationKey: string) => request<unknown>(path("operation"), { method: "post", data: { operationKey } })
});
