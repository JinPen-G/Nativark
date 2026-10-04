import type { AiTenantModelSettingsInputDraft, AiTenantModelSettingsSummaryDraft } from "../../../../../packages/shared/src/ai-usage-draft";

export type AiSettingsMode = "platform_managed" | "tenant_managed";
export type SecretOperation = "retain" | "replace" | "clear";

export interface AiServiceSettingsDraft {
  mode: AiSettingsMode;
  enabled: boolean;
  protocol: string;
  baseUrl: string;
  model: string;
  secretOperation: SecretOperation;
  /** Write-only input. Never rendered back or persisted by this feature-local adapter. */
  apiKeyDraft: string;
}

export interface AiSettingsValidation { ok: boolean; errors: Partial<Record<"protocol" | "baseUrl" | "model" | "apiKey", string>> }

export function fromAiServiceSummary(input: AiTenantModelSettingsSummaryDraft | null | undefined): AiServiceSettingsDraft {
  if (!input || input.mode === "platform_managed") return { mode: "platform_managed", enabled: input?.enabled === true, protocol: "", baseUrl: "", model: "", secretOperation: "retain", apiKeyDraft: "" };
  return { mode: "tenant_managed", enabled: input.enabled === true, protocol: input.protocol, baseUrl: input.baseUrl, model: input.model, secretOperation: "retain", apiKeyDraft: "" };
}

export function setAiSettingsMode(current: AiServiceSettingsDraft, mode: AiSettingsMode): AiServiceSettingsDraft {
  if (mode === current.mode) return current;
  return mode === "platform_managed"
    ? { ...current, mode, secretOperation: "retain", apiKeyDraft: "" }
    : { ...current, mode, secretOperation: "retain", apiKeyDraft: "" };
}

export function validateAiSettingsDraft(draft: AiServiceSettingsDraft): AiSettingsValidation {
  if (draft.mode === "platform_managed") return { ok: true, errors: {} };
  const errors: AiSettingsValidation["errors"] = {};
  if (!draft.protocol.trim()) errors.protocol = "请选择已支持的协议";
  if (!/^https:\/\//i.test(draft.baseUrl.trim())) errors.baseUrl = "Base URL 必须使用 HTTPS";
  if (!draft.model.trim()) errors.model = "请填写模型标识";
  if (draft.secretOperation === "replace" && !draft.apiKeyDraft.trim()) errors.apiKey = "替换密钥时必须输入新密钥";
  return { ok: Object.keys(errors).length === 0, errors };
}

export function toAiSettingsInput(draft: AiServiceSettingsDraft, configId: string, expectedRevision: number): AiTenantModelSettingsInputDraft | null {
  const validation = validateAiSettingsDraft(draft);
  if (!validation.ok) return null;
  if (draft.mode === "platform_managed") return { draftVersion: "ain-c07-draft-2", configId, expectedRevision, enabled: draft.enabled, mode: "platform_managed" };
  return {
    draftVersion: "ain-c07-draft-2", configId, expectedRevision, enabled: draft.enabled, mode: "tenant_managed",
    protocol: draft.protocol.trim(), baseUrl: draft.baseUrl.trim(), model: draft.model.trim(),
    secretChange: draft.secretOperation === "replace" ? { operation: "replace", apiKey: draft.apiKeyDraft } : { operation: draft.secretOperation },
  };
}
