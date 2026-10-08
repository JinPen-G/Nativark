import { useEffect, useRef, useState } from "react";
import { ActionButton, Alert, Input, Segmented } from "@/components/ui";
import type { AiTenantModelSettingsSummaryDraft } from "../../../../../packages/shared/src/ai-usage-draft";
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
}

/** Feature-local preparation card. It has no transport, storage or route side effects. */
export function AiServiceSettingsCard({ summary, configId, expectedRevision, contextIdentity, readOnly = false, pending = false, error, onSave }: AiServiceSettingsCardProps) {
  const identity = JSON.stringify([contextIdentity, configId, expectedRevision, summary ?? null]);
  const [editor, setEditor] = useState(() => ({ identity, draft: fromAiServiceSummary(summary) }));
  const draft = editor.identity === identity ? editor.draft : fromAiServiceSummary(summary);
  const validation = validateAiSettingsDraft(draft);
  const [feedback, setFeedback] = useState({ identity, state: "idle" });
  const session = useRef(new SettingsSaveSession());
  const usable = Boolean(contextIdentity && configId && Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 && (!summary || summary.draftVersion === "ain-c07-draft-2"));
  const currentState = feedback.identity === identity ? feedback.state : "idle";
  const disabled = readOnly || pending || currentState === "pending" || !usable;
  session.current.bind(identity, onSave, readOnly || pending || !usable || !onSave);
  useEffect(() => { const current = session.current; current.activate(); return () => current.dispose(); }, []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(fromAiServiceSummary(summary));
  const update = (next: AiServiceSettingsDraft) => { if (disabled) return; setEditor({ identity, draft: next }); setFeedback({ identity, state: "idle" }); };
  const save = async () => {
    const input = toAiSettingsInput(draft, configId, expectedRevision);
    if (!input || !onSave || disabled) throw new Error("AI 设置操作不可用");
    await session.current.run(() => onSave(input), state => {
      setFeedback({ identity, state });
      if (state === "request_finished") setEditor({ identity, draft: { ...draft, apiKeyDraft: "", secretOperation: "retain" } });
    });
  };
  const mode: AiSettingsMode = draft.mode;
  return <section aria-label="AI 服务设置摘要" data-ai-service-settings="feature-local">
    <h3>AI 服务</h3>
    <Segmented aria-label="AI 服务模式" value={mode} disabled={disabled} options={[{ value: "platform_managed", label: "Rental OS AI（推荐）" }, { value: "tenant_managed", label: "自定义 AI 服务 / BYOK" }]} onChange={value => update(setAiSettingsMode(draft, value as AiSettingsMode))} />
    {dirty && <p role="status">修改尚未保存；切换模式不会自动保存或删除现有 BYOK 配置。</p>}
    {mode === "platform_managed" ? <>
      <p>平台统一提供 AI；此视图不展示供应商、模型、Base URL 或密钥。</p>
      <p role="status">{summary?.mode === "platform_managed" && summary.availability === "ready" ? "服务可用" : summary?.mode === "platform_managed" && summary.availability === "unavailable" ? "服务不可用" : "服务未验证"}</p>
    </> : <div aria-label="自定义 AI 服务配置">
      <label>协议<Input value={draft.protocol} maxLength={128} disabled={disabled} onChange={event => update({ ...draft, protocol: event.target.value })} /></label>
      <label>Base URL<Input value={draft.baseUrl} maxLength={2048} disabled={disabled} onChange={event => update({ ...draft, baseUrl: event.target.value })} /></label>
      <label>模型标识<Input value={draft.model} maxLength={256} disabled={disabled} onChange={event => update({ ...draft, model: event.target.value })} /></label>
      <label>密钥操作<Segmented aria-label="密钥操作" value={draft.secretOperation} disabled={disabled} options={[{ value: "retain", label: "保留现有密钥" }, { value: "replace", label: "替换密钥" }, { value: "clear", label: "清除密钥" }]} onChange={value => update({ ...draft, secretOperation: value as AiServiceSettingsDraft["secretOperation"], apiKeyDraft: "" })} /></label>
      {draft.secretOperation === "replace" && <label>新密钥（仅内存输入，不读取已存密钥）<Input type="password" autoComplete="off" value={draft.apiKeyDraft} maxLength={4096} disabled={disabled} onChange={event => update({ ...draft, apiKeyDraft: event.target.value })} /></label>}
      {!validation.ok && <Alert type="warning" message="配置尚未满足保存条件，请核对协议、HTTPS 地址、模型和密钥操作。" />}
    </div>}
    {error || currentState === "failed" ? <Alert type="error" message="AI 设置请求失败，请重新核对修订与权限；输入仍待确认。" /> : null}
    {currentState === "request_finished" && <p role="status">保存请求已返回；请宿主重新读取已保存配置，能力验证状态未改变。</p>}
    {!onSave && <p role="status">保存能力未提供，当前配置不会写入。</p>}
    {onSave && <ActionButton label="保存 AI 设置" successLabel="请求已返回" pendingLabel="保存中…" disabled={disabled || !validation.ok} onAction={save} />}
  </section>;
}
