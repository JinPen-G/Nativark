import { useEffect, useId, useRef, useState } from "react";
import { ActionButton, Alert, Input, Segmented, Select, Switch } from "@/components/ui";
import type { AiLegacyModelConfigurationReferenceDraft, AiTenantModelSettingsSummaryDraft } from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { fromAiServiceSummary, setAiSettingsMode, toAiSettingsInput, validateAiSettingsDraft, type AiServiceSettingsDraft, type AiSettingsMode } from "./ai-service-settings-model";
import { SettingsSaveSession } from "./settings-save-session";

export interface AiServiceSettingsCardProps {
  summary?: AiTenantModelSettingsSummaryDraft | null;
  configId: string;
  expectedRevision: number;
  /** Host must change this for actor, audience, tenant or workspace changes. Not authorization. */
  contextIdentity: string;
  readOnly?: boolean;
  pending?: boolean;
  error?: string | null;
  onSave?: (input: NonNullable<ReturnType<typeof toAiSettingsInput>>) => Promise<unknown>;
  /** Only an explicitly reviewed legacy source; never an imported credential. */
  legacySource?: AiLegacyModelConfigurationReferenceDraft;
}

/** Feature-local preparation card. It has no transport, storage or route side effects. */
export function AiServiceSettingsCard({ summary, configId, expectedRevision, contextIdentity, readOnly = false, pending = false, error, onSave, legacySource }: AiServiceSettingsCardProps) {
  const { t } = useLocale();
  const fieldId = useId();
  const identity = JSON.stringify([contextIdentity, configId, expectedRevision, summary ?? null, legacySource ?? null]);
  const initial = () => legacySource ? { ...fromAiServiceSummary(null), mode: "tenant_managed" as const, protocol: "openai_chat_completions", secretOperation: "replace" as const } : fromAiServiceSummary(summary);
  const [editor, setEditor] = useState(() => ({ identity, draft: initial() }));
  const draft = editor.identity === identity ? editor.draft : initial();
  const validation = validateAiSettingsDraft(draft);
  const [feedback, setFeedback] = useState({ identity, state: "idle" });
  const session = useRef(new SettingsSaveSession());
  const usable = Boolean(contextIdentity && configId && Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 && (!summary || summary.draftVersion === "ain-c07-draft-2"));
  const currentState = feedback.identity === identity ? feedback.state : "idle";
  const disabled = readOnly || pending || currentState === "pending" || !usable;
  session.current.bind(identity, onSave, readOnly || pending || !usable || !onSave);
  useEffect(() => { const current = session.current; current.activate(); return () => current.dispose(); }, []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial());
  const update = (next: AiServiceSettingsDraft) => { if (disabled) return; setEditor({ identity, draft: next }); setFeedback({ identity, state: "idle" }); };
  const save = async () => {
    const input = toAiSettingsInput(draft, configId, expectedRevision);
    if (!input || !onSave || disabled) throw new Error("AI 设置操作不可用");
    if (legacySource && (input.mode !== "tenant_managed" || input.enabled || input.secretChange.operation !== "replace")) throw new Error(t("旧配置替换必须保持停用并输入新密钥"));
    const command = input.mode === "tenant_managed" && legacySource ? { ...input, legacySource: { ...legacySource } } : input;
    await session.current.run(() => onSave(command), state => {
      setFeedback({ identity, state });
      if (state === "request_finished") setEditor({ identity, draft: { ...draft, apiKeyDraft: "", secretOperation: "retain" } });
    });
  };
  const mode: AiSettingsMode = draft.mode;
  return <section aria-label="AI 服务设置摘要" data-ai-service-settings="feature-local">
    <h3>{t("AI 服务")}</h3>
    <Segmented aria-label={t("AI 服务模式")} value={mode} disabled={disabled || !!legacySource} options={[{ value: "platform_managed", label: t("Rental OS AI（推荐）") }, { value: "tenant_managed", label: t("自定义 AI 服务 / BYOK") }]} onChange={value => update(setAiSettingsMode(draft, value as AiSettingsMode))} />
    <p><label htmlFor={`${fieldId}-enabled`}>{t("启用 AI 服务配置")}</label> <Switch id={`${fieldId}-enabled`} checked={draft.enabled} disabled={disabled || !!legacySource || draft.secretOperation === "clear"} onChange={value => update({ ...draft, enabled: value })} /></p>
    <p className="muted">{t("保存配置不会自动开放预算、能力验证、任务权限或模型执行。")}</p>
    {dirty && <p role="status">{t("修改尚未保存；切换模式不会自动保存或删除现有 BYOK 配置。")}</p>}
    {mode === "platform_managed" ? <>
      <p>{t("平台统一提供 AI；无需填写供应商、模型、Base URL 或密钥。")}</p>
      <p role="status">{t(!draft.enabled ? "未启用" : summary?.mode === "platform_managed" && summary.availability === "ready" ? "服务可用" : summary?.mode === "platform_managed" && summary.availability === "unavailable" ? "服务不可用" : "服务未验证")}</p>
    </> : <div aria-label="自定义 AI 服务配置">
      <p><label htmlFor={`${fieldId}-protocol`}>{t("协议")}</label></p>
      <Select id={`${fieldId}-protocol`} value={draft.protocol || undefined} disabled={disabled || !!legacySource} aria-describedby={`${fieldId}-errors`} options={[
        { value: "openai_chat_completions", label: "OpenAI Chat Completions" }, { value: "openai_responses", label: "OpenAI Responses" }, { value: "anthropic_messages", label: "Anthropic Messages" }
      ]} onChange={value => update({ ...draft, protocol: String(value) })} />
      <p><label htmlFor={`${fieldId}-url`}>Base URL</label></p>
      <Input id={`${fieldId}-url`} autoComplete="off" value={draft.baseUrl} maxLength={2048} disabled={disabled} aria-invalid={!!validation.errors.baseUrl} aria-describedby={`${fieldId}-errors`} onChange={event => update({ ...draft, baseUrl: event.target.value })} />
      <p><label htmlFor={`${fieldId}-model`}>{t("模型标识")}</label></p>
      <Input id={`${fieldId}-model`} value={draft.model} maxLength={256} disabled={disabled} aria-invalid={!!validation.errors.model} aria-describedby={`${fieldId}-errors`} onChange={event => update({ ...draft, model: event.target.value })} />
      <p>{t("密钥操作")}</p><Segmented aria-label={t("密钥操作")} value={draft.secretOperation} disabled={disabled || !!legacySource} options={[{ value: "retain", label: t("保留现有密钥") }, { value: "replace", label: t("替换密钥") }, { value: "clear", label: t("清除密钥") }]} onChange={value => update({ ...draft, secretOperation: value as AiServiceSettingsDraft["secretOperation"], enabled: value === "clear" ? false : draft.enabled, apiKeyDraft: "" })} />
      {draft.secretOperation === "replace" && <><p><label htmlFor={`${fieldId}-key`}>{t("新密钥（仅内存输入，不读取已存密钥）")}</label></p><Input id={`${fieldId}-key`} type="password" autoComplete="new-password" value={draft.apiKeyDraft} maxLength={8192} disabled={disabled} aria-invalid={!!validation.errors.apiKey} aria-describedby={`${fieldId}-errors`} onChange={event => update({ ...draft, apiKeyDraft: event.target.value })} /></>}
      {!validation.ok && <div id={`${fieldId}-errors`} role="status"><Alert type="warning" title={t("配置尚未满足保存条件")} description={Object.values(validation.errors).map(value => t(value)).join("；")} /></div>}
    </div>}
    {error || currentState === "failed" ? <Alert type="error" title={t("AI 设置保存未确认，请核对原操作收据、修订与权限。请勿盲目重试。")}/> : null}
    {currentState === "request_finished" && <p role="status">{t("保存请求已返回，能力验证状态未改变。")}</p>}
    {!onSave && <p role="status">{t("保存能力未提供，当前配置不会写入。")}</p>}
    {onSave && <ActionButton label={t("保存 AI 设置")} successLabel={t("请求已返回")} pendingLabel={t("保存中…")} disabled={disabled || !validation.ok} onAction={save} />}
  </section>;
}
