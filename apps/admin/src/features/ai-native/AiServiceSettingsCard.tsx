import { useEffect, useId, useRef, useState } from "react";
import { ActionButton, Alert, Input, Segmented, Select, Switch } from "@/components/ui";
import type { AiLegacyModelConfigurationReferenceDraft, AiTenantModelSettingsSummaryDraft, AiProviderDiscoveryInputDraft, AiProviderDiscoveryResultDraft, AiProviderDiscoveryProtocol } from "@rental-os/shared";
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
  onModeChange?: (mode: AiSettingsMode) => void;
  onDiscover?: (action: 'models' | 'detect', input: AiProviderDiscoveryInputDraft, signal: AbortSignal) => Promise<AiProviderDiscoveryResultDraft>;
  /** Only an explicitly reviewed legacy source; never an imported credential. */
  legacySource?: AiLegacyModelConfigurationReferenceDraft;
}

/** Feature-local preparation card. It has no transport, storage or route side effects. */
export function AiServiceSettingsCard({ summary, configId, expectedRevision, contextIdentity, readOnly = false, pending = false, error, onSave, legacySource, onModeChange, onDiscover }: AiServiceSettingsCardProps) {
  const { t } = useLocale();
  const fieldId = useId();
  const identity = JSON.stringify([contextIdentity, configId, expectedRevision, summary ?? null, legacySource ?? null]);
  const initial = () => legacySource ? { ...fromAiServiceSummary(null), mode: "tenant_managed" as const, protocol: "openai_chat_completions", secretOperation: "replace" as const } : fromAiServiceSummary(summary);
  const [editor, setEditor] = useState(() => ({ identity, draft: initial() }));
  const draft = editor.identity === identity ? editor.draft : initial();
  const validation = validateAiSettingsDraft(draft);
  const [feedback, setFeedback] = useState({ identity, state: "idle" });
  const [discovery, setDiscovery] = useState<{ identity: string; result?: AiProviderDiscoveryResultDraft; busy?: boolean; failed?: boolean }>({ identity });
  const flight = useRef<AbortController | null>(null), liveIdentity = useRef(identity);
  liveIdentity.current = identity;
  useEffect(() => { flight.current?.abort(); return () => { flight.current?.abort(); }; }, [identity]);
  const session = useRef(new SettingsSaveSession());
  const usable = Boolean(contextIdentity && configId && Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 && (!summary || summary.draftVersion === "ain-c07-draft-2"));
  const currentState = feedback.identity === identity ? feedback.state : "idle";
  const disabled = readOnly || pending || currentState === "pending" || !usable;
  session.current.bind(identity, onSave, readOnly || pending || !usable || !onSave);
  useEffect(() => { const current = session.current; current.activate(); return () => current.dispose(); }, []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial());
  const update = (next: AiServiceSettingsDraft) => { if (disabled) return;
    if (next.mode !== draft.mode || next.baseUrl !== draft.baseUrl || next.protocol !== draft.protocol || next.apiKeyDraft !== draft.apiKeyDraft || next.secretOperation !== draft.secretOperation) {
      flight.current?.abort(); flight.current = null; setDiscovery({ identity });
    }
    setEditor({ identity, draft: next }); setFeedback({ identity, state: "idle" }); if (next.mode !== draft.mode) onModeChange?.(next.mode); };
  const discoveryState = discovery.identity === identity ? discovery : { identity };
  const models = draft.models ?? (draft.model ? [draft.model] : []);
  const canDiscover = !!onDiscover && !disabled && !legacySource && !flight.current && !validation.errors.baseUrl && !validation.errors.protocol
    && (draft.secretOperation === 'replace' ? !validation.errors.apiKey : draft.secretOperation === 'retain' && summary?.mode === 'tenant_managed'
      && summary.credentialState === 'configured' && draft.baseUrl.replace(/\/+$/u, '') === summary.baseUrl.replace(/\/+$/u, ''));
  const discover = async (action: 'models' | 'detect') => {
    if (!canDiscover || !onDiscover) throw Error(t('请先填写有效的协议、Base URL 和密钥。'));
    const controller = new AbortController(); flight.current = controller; setDiscovery({ identity, busy: true });
    try {
      const result = await onDiscover(action, { baseUrl: draft.baseUrl.trim(), protocol: draft.protocol as AiProviderDiscoveryProtocol, expectedRevision,
        secretChange: draft.secretOperation === 'replace' ? { operation: 'replace', apiKey: draft.apiKeyDraft } : { operation: 'retain' } }, controller.signal);
      if (controller.signal.aborted || flight.current !== controller || liveIdentity.current !== identity) return;
      if (result.observation !== 'metadata_only' || !Array.isArray(result.models) || result.models.length > 200
        || result.models.some(model => !/^[\w./:-]{1,256}$/u.test(model)) || !Array.isArray(result.protocols)) throw Error();
      setDiscovery({ identity, result });
    } catch {
      if (controller.signal.aborted || flight.current !== controller || liveIdentity.current !== identity) return;
      setDiscovery({ identity, failed: true }); throw Error(t('暂时无法获取供应商信息，请核对地址和密钥，也可以手动填写模型。'));
    } finally { if (flight.current === controller) flight.current = null; }
  };
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
    <Segmented aria-label={t("AI 服务模式")} value={mode} disabled={disabled || !!legacySource} options={[{ value: "platform_managed", label: t("Rental OS AI（推荐）") }, { value: "tenant_managed", label: t("自带 AI 供应商") }]} onChange={value => update(setAiSettingsMode(draft, value as AiSettingsMode))} />
    <p><label htmlFor={`${fieldId}-enabled`}>{t("启用 AI 服务配置")}</label> <Switch id={`${fieldId}-enabled`} checked={draft.enabled} disabled={disabled || !!legacySource || draft.secretOperation === "clear"} onChange={value => update({ ...draft, enabled: value })} /></p>
    <p className="muted">{t("AI 只能使用当前账号获准的业务功能。保存连接信息不代表连接验证成功。")}</p>
    {dirty && <p role="status">{t("修改尚未保存；切换模式不会自动保存或删除现有 BYOK 配置。")}</p>}
    {mode === "platform_managed" ? <>
      <p>{t("平台统一提供 AI；无需填写供应商、模型、Base URL 或密钥。")}</p>
      <p>{t("向平台申请金额额度，经 SaaS 管理员批准后，由租户管理员分配空间上限。供应商和费率由平台维护。")}</p>
      <p role="status">{t(!draft.enabled ? "未启用" : summary?.mode === "platform_managed" && summary.availability === "ready" ? "服务可用" : summary?.mode === "platform_managed" && summary.availability === "unavailable" ? "服务不可用" : "服务未验证")}</p>
    </> : <div aria-label="自定义 AI 服务配置">
      <p>{t("费用直接向您的供应商结算；Rental OS 记录 Token 用量，不要求填写供应商费率。")}</p>
      <p><label htmlFor={`${fieldId}-protocol`}>{t("协议")}</label></p>
      <Select id={`${fieldId}-protocol`} value={draft.protocol || undefined} disabled={disabled || !!legacySource} aria-describedby={`${fieldId}-errors`} options={[
        { value: "openai_chat_completions", label: "OpenAI Chat Completions" }, { value: "openai_responses", label: "OpenAI Responses" }, { value: "anthropic_messages", label: "Anthropic Messages" }
      ]} onChange={value => update({ ...draft, protocol: String(value) })} />
      <p><label htmlFor={`${fieldId}-url`}>Base URL</label></p>
      <Input id={`${fieldId}-url`} autoComplete="off" placeholder={draft.protocol === 'anthropic_messages' ? 'https://api.example.com' : 'https://api.example.com/v1'} value={draft.baseUrl} maxLength={2048} disabled={disabled} aria-invalid={!!validation.errors.baseUrl} aria-describedby={`${fieldId}-errors`} onChange={event => update({ ...draft, baseUrl: event.target.value })} />
      <p><label htmlFor={`${fieldId}-models`}>{t("可用模型")}</label></p>
      <Select id={`${fieldId}-models`} mode="tags" value={models} disabled={disabled} aria-label={t('可用模型')} style={{ width: '100%' }}
        tokenSeparators={[',', '，']} maxCount={20} placeholder={t('选择模型或输入模型 ID，最多 20 个')}
        options={[...new Set([...(discoveryState.result?.models ?? []), ...models])].map(value => ({ value, label: value }))}
        onChange={value => { const chosen = value as string[]; update({ ...draft, models: chosen, model: chosen.includes(draft.model) ? draft.model : chosen[0] ?? '' }); }} />
      <p><label htmlFor={`${fieldId}-model`}>{t("默认模型")}</label></p>
      <Select id={`${fieldId}-model`} value={models.includes(draft.model) ? draft.model : undefined} disabled={disabled || !models.length}
        options={models.map(value => ({ value, label: value }))} onChange={value => update({ ...draft, model: String(value) })} />
      <p>{t("密钥操作")}</p><Segmented aria-label={t("密钥操作")} value={draft.secretOperation} disabled={disabled || !!legacySource} options={[{ value: "retain", label: t("保留现有密钥") }, { value: "replace", label: t("替换密钥") }, { value: "clear", label: t("清除密钥") }]} onChange={value => update({ ...draft, secretOperation: value as AiServiceSettingsDraft["secretOperation"], enabled: value === "clear" ? false : draft.enabled, apiKeyDraft: "" })} />
      {draft.secretOperation === "replace" && <><p><label htmlFor={`${fieldId}-key`}>API Key</label></p><Input id={`${fieldId}-key`} type="password" autoComplete="new-password" value={draft.apiKeyDraft} maxLength={8192} disabled={disabled} aria-invalid={!!validation.errors.apiKey} aria-describedby={`${fieldId}-errors`} onChange={event => update({ ...draft, apiKeyDraft: event.target.value })} /></>}
      {onDiscover && <div className="panel-toolbar" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <ActionButton label={t('获取模型')} pendingLabel={t('正在获取…')} disabled={!canDiscover || discoveryState.busy} onAction={() => discover('models')} />
        <ActionButton label={t('识别协议类型')} pendingLabel={t('正在识别…')} disabled={!canDiscover || discoveryState.busy} onAction={() => discover('detect')} />
      </div>}
      {discoveryState.result && <div role="status">
        <p>{t(discoveryState.result.state === 'listed' ? '模型列表已获取，请选择要使用的模型。' : discoveryState.result.state === 'empty'
          ? '供应商返回了空列表，可以手动填写模型 ID。' : discoveryState.result.state === 'authentication_failed'
            ? '供应商未接受当前密钥，请核对密钥和地址。' : '供应商未提供可读取的模型列表，可以手动填写。')}</p>
        {discoveryState.result.truncated && <p>{t('这里只显示前 200 个模型；其他模型可手动填写。')}</p>}
        {discoveryState.result.protocols.some(p => p.state === 'candidate') && <p>{t('可能兼容的协议')}：{discoveryState.result.protocols.filter(p => p.state === 'candidate').map(p => p.protocol === 'anthropic_messages' ? 'Anthropic Messages' : p.protocol === 'openai_responses' ? 'OpenAI Responses' : 'OpenAI Chat Completions').join(' / ')}</p>}
        <p className="muted">{t('模型列表不能证明协议可调用。请选择协议并保存，再用“测试连接”验证，不会自动改动你的选择。')}</p>
      </div>}
      {discoveryState.failed && <p role="alert">{t('暂时无法获取供应商信息，请核对地址和密钥，也可以手动填写模型。')}</p>}
      {!validation.ok && <div id={`${fieldId}-errors`} role="status"><Alert type="warning" title={t("配置尚未满足保存条件")} description={Object.values(validation.errors).map(value => t(value)).join("；")} /></div>}
    </div>}
    {error || currentState === "failed" ? <Alert type="error" title={t("AI 设置保存未确认，请核对原操作收据、修订与权限。请勿盲目重试。")}/> : null}
    {currentState === "request_finished" && <p role="status">{t("保存请求已返回，能力验证状态未改变。")}</p>}
    {!onSave && <p role="status">{t("保存能力未提供，当前配置不会写入。")}</p>}
    {onSave && <ActionButton label={t("保存 AI 设置")} successLabel={t("请求已返回")} pendingLabel={t("保存中…")} disabled={disabled || discoveryState.busy || !validation.ok} onAction={save} />}
  </section>;
}
