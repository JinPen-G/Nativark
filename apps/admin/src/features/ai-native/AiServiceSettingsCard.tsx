import { useEffect, useState } from "react";
import { ActionButton, Alert, Input, PasswordField, Segmented } from "@/components/ui";
import type { AiTenantModelSettingsSummaryDraft } from "../../../../../packages/shared/src/ai-usage-draft";
import { fromAiServiceSummary, setAiSettingsMode, toAiSettingsInput, validateAiSettingsDraft, type AiServiceSettingsDraft, type AiSettingsMode } from "./ai-service-settings-model";

export interface AiServiceSettingsCardProps {
  summary?: AiTenantModelSettingsSummaryDraft | null;
  configId: string;
  expectedRevision: number;
  readOnly?: boolean;
  pending?: boolean;
  error?: string | null;
  onSave?: (input: NonNullable<ReturnType<typeof toAiSettingsInput>>) => Promise<unknown>;
}

/** Feature-local preparation card. It has no transport, storage or route side effects. */
export function AiServiceSettingsCard({ summary, configId, expectedRevision, readOnly = false, pending = false, error, onSave }: AiServiceSettingsCardProps) {
  const [draft, setDraft] = useState<AiServiceSettingsDraft>(() => fromAiServiceSummary(summary));
  const [validation, setValidation] = useState(validateAiSettingsDraft(draft));
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => { const next = fromAiServiceSummary(summary); setDraft(next); setValidation(validateAiSettingsDraft(next)); setSaveError(null); }, [summary?.configId, summary?.configRevision, summary?.mode]);
  const update = (next: AiServiceSettingsDraft) => { setDraft(next); setValidation(validateAiSettingsDraft(next)); setSaveError(null); };
  const save = async () => {
    const input = toAiSettingsInput(draft, configId, expectedRevision);
    if (!input || !onSave) return;
    try { await onSave(input); } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "保存失败，输入已保留"); throw cause; }
  };
  const mode: AiSettingsMode = draft.mode;
  return <section aria-label="AI 服务设置摘要" data-ai-service-settings="feature-local">
    <h3>AI 服务</h3>
    <Segmented aria-label="AI 服务模式" value={mode} disabled={readOnly || pending} options={[{ value: "platform_managed", label: "Rental OS AI（推荐）" }, { value: "tenant_managed", label: "自定义 AI 服务 / BYOK" }]} onChange={value => update(setAiSettingsMode(draft, value as AiSettingsMode))} />
    {mode === "platform_managed" ? <>
      <p>平台统一提供 AI；此视图不展示供应商、模型、Base URL 或密钥。</p>
      <p role="status">{summary?.mode === "platform_managed" && summary.availability === "ready" ? "服务可用" : summary?.mode === "platform_managed" && summary.availability === "unavailable" ? "服务不可用" : "服务未验证"}</p>
    </> : <div aria-label="自定义 AI 服务配置">
      <label>协议<Input value={draft.protocol} disabled={readOnly || pending} onChange={event => update({ ...draft, protocol: event.target.value })} /></label>
      <label>Base URL<Input value={draft.baseUrl} disabled={readOnly || pending} onChange={event => update({ ...draft, baseUrl: event.target.value })} /></label>
      <label>模型标识<Input value={draft.model} disabled={readOnly || pending} onChange={event => update({ ...draft, model: event.target.value })} /></label>
      <label>密钥操作<Segmented aria-label="密钥操作" value={draft.secretOperation} disabled={readOnly || pending} options={[{ value: "retain", label: "保留现有密钥" }, { value: "replace", label: "替换密钥" }, { value: "clear", label: "清除密钥" }]} onChange={value => update({ ...draft, secretOperation: value as AiServiceSettingsDraft["secretOperation"], apiKeyDraft: "" })} /></label>
      {draft.secretOperation === "replace" && <label>新密钥（不会回显或保存到本地）<PasswordField value={draft.apiKeyDraft} disabled={readOnly || pending} onChange={event => update({ ...draft, apiKeyDraft: event.target.value })} /></label>}
      {!validation.ok && <Alert type="warning" message="配置尚未满足保存条件，请核对协议、HTTPS 地址、模型和密钥操作。" />}
    </div>}
    {error || saveError ? <Alert type="error" message={error ?? saveError ?? "保存失败，输入已保留"} /> : null}
    {onSave && <ActionButton label="保存 AI 设置" pendingLabel="保存中…" disabled={readOnly || pending || !validation.ok} onAction={save} />}
  </section>;
}
