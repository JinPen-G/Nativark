/** SaaS Profile editor over the existing encrypted CAS management API. No
 * provider requests, automatic capability claims, model catalogue or quota. */
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import type { AiPlatformModelSettingsInputDraft } from "@rental-os/shared";
import { platformAiSettingsApi } from "@/api/platformAiSettings";
import { currentSessionEpoch } from "@/app/queryClient";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { ActionButton, Alert, Input, Segmented, Select, Switch } from "@/components/ui";
import { useAuthStore } from "@/features/auth/authStore";
import { PLATFORM_MODEL_CAPABILITIES, PlatformModelSettingsSession } from "./platform-model-settings-session";

const identityKey = () => JSON.stringify([useAuthStore.getState().user, currentSessionEpoch()]);
const feedback = { idle: "配置、能力验证、费率及预算分别管理，不会因保存而开放调用。", saved: "平台配置已保存，请重新读取当前配置。",
  recorded: "原保存收据已确认，请重新读取当前配置。", unknown: "保存结果未知，只能核对原操作收据，不能换编号重试。",
  conflict: "修订或原操作冲突，请重新读取，不覆盖其他配置。", denied: "当前权限已不足，已清除旧配置显示。",
  invalid: "配置未通过服务端校验，请检查输入。", unavailable: "配置或收据不可用，不代表不存在或未保存。" };
export function PlatformModelSettingsPage() {
  const { t } = useLocale(), auth = useAuthStore();
  const [target, setTarget] = useState("");
  const [selected, setSelected] = useState("");
  const allowed = !!auth.token && auth.user?.isSaasAdmin && auth.hasPermission("system:ai-provider:view");
  const id = useId();
  return <>
    <PageHeader title={t("平台 AI 配置")} description={t("管理平台供应商连接，不读取租户 BYOK 密钥。")} />
    {allowed ? <section aria-label={t("平台 AI 配置")}>
      <p className="muted">{t("按正式 Profile 编号读取；首次配置须明确选择修订零创建，不会把读取失败当作不存在。")}</p>
      <label htmlFor={id}>{t("Profile 编号")}</label>
      <Input id={id} value={target} maxLength={36} onChange={e => { setTarget(e.target.value); setSelected(""); }} />
      <ActionButton label={t("选择配置对象")} successLabel={t("对象已选择，请读取或准备首次配置")}
        disabled={!/^[A-Za-z0-9][\w.:-]{0,35}$/u.test(target)} onAction={async () => { setSelected(target); }} />
      {selected && <ProfileHost key={identityKey() + selected} profileId={selected} identity={identityKey()} />}
    </section> : <Alert type="warning" title={t("需要 SaaS 平台 AI 配置读取权限。")}/>}
  </>;
}
function ProfileHost({ profileId, identity }: { profileId: string; identity: string }) {
  const { t } = useLocale();
  const canManage = useAuthStore(s => s.hasPermission("system:ai-provider:manage"));
  const session = useMemo(() => {
    let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* Reference remains visible in memory. */ }
    return new PlatformModelSettingsSession(profileId, platformAiSettingsApi,
      () => identityKey() === identity && !!useAuthStore.getState().token && !!useAuthStore.getState().user?.isSaasAdmin
        && useAuthStore.getState().hasPermission("system:ai-provider:view"),
      () => useAuthStore.getState().hasPermission("system:ai-provider:manage"), () => window.crypto.randomUUID(), storage,
      `rental_platform_ai_operation:${JSON.stringify([useAuthStore.getState().user?.id, profileId])}`);
  }, [profileId, identity]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  return <section aria-label={profileId} aria-busy={state.busy}>
    <p>{t("当前配置对象")}: <code>{profileId}</code></p>
    <Alert type={state.feedback === "saved" || state.feedback === "recorded" ? "success" : state.feedback === "idle" ? "info" : "warning"}
      title={t(feedback[state.feedback])} />
    <div className="panel-toolbar">
      <ActionButton label={t("读取当前配置")} successLabel={t("读取已结束")} disabled={state.busy} onAction={() => session.load()} />
      {canManage && !state.summary && !state.creating && <ActionButton label={t("准备首次配置（修订零）")} successLabel={t("仅准备，尚未保存")}
        disabled={state.busy || !!state.pending} onAction={async () => { session.prepareInitial(); }} />}
      {state.pending && <ActionButton label={t("核对原保存收据")} successLabel={t("核对已结束")} disabled={state.busy} onAction={() => session.reconcile()} />}
    </div>
    {state.pending && <p role="status">{t("原操作编号")}: <code>{state.pending.operationKey}</code></p>}
    {(state.summary || state.creating) && <ProfileEditor key={JSON.stringify([state.summary, state.creating])} session={session}
      disabled={state.busy || !!state.pending || !canManage} />}
    {!canManage && <p role="status">{t("仅可读取，当前没有平台 AI 配置管理权限。")}</p>}
  </section>;
}
function ProfileEditor({ session, disabled }: { session: PlatformModelSettingsSession; disabled: boolean }) {
  const { t } = useLocale(), id = useId(), summary = session.snapshot().summary;
  const [draft, setDraft] = useState({ protocol: summary?.protocol ?? "", model: summary?.model ?? "", baseUrl: summary?.baseUrl ?? "",
    enabled: summary?.enabled ?? false, maxOutputTokens: summary?.maxOutputTokens?.toString() ?? "",
    capabilities: summary?.allowedCapabilities ?? [], secret: summary ? "retain" : "replace", apiKey: "" });
  const valid = ["openai_responses", "openai_chat_completions", "anthropic_messages"].includes(draft.protocol)
    && /^[\w./:-]{1,256}$/u.test(draft.model) && /^https:\/\/[^/@?#\s]+(?:\/[^?#\s]*)?$/u.test(draft.baseUrl)
    && /^[1-9][0-9]{0,4}$/u.test(draft.maxOutputTokens) && Number(draft.maxOutputTokens) <= 32768
    && (draft.secret !== "replace" || /^[\x21-\x7e]{1,8192}$/u.test(draft.apiKey));
  return <section aria-label={t("平台模型字段")}>
    <p>{t("当前修订")}: {summary?.revision ?? 0}。{t("白名单不等于能力已验证；密钥不回显。")}</p>
    <p><label htmlFor={`${id}-protocol`}>{t("协议")}</label></p>
    <Select id={`${id}-protocol`} value={draft.protocol || undefined} disabled={disabled} options={[
      { value: "openai_responses", label: "OpenAI Responses" }, { value: "anthropic_messages", label: "Anthropic Messages" }, { value: "openai_chat_completions", label: "OpenAI Chat Completions" }
    ]} onChange={v => setDraft({ ...draft, protocol: String(v) })} />
    <p><label htmlFor={`${id}-model`}>{t("模型标识")}</label></p><Input id={`${id}-model`} value={draft.model} maxLength={256} disabled={disabled} onChange={e => setDraft({ ...draft, model: e.target.value })} />
    <p><label htmlFor={`${id}-url`}>Base URL</label></p><Input id={`${id}-url`} value={draft.baseUrl} maxLength={2048} disabled={disabled} autoComplete="off" onChange={e => setDraft({ ...draft, baseUrl: e.target.value })} />
    <p><label htmlFor={`${id}-limit`}>{t("单次输出 Token 上限（1–32768）")}</label></p><Input id={`${id}-limit`} inputMode="numeric" value={draft.maxOutputTokens} maxLength={5} disabled={disabled} onChange={e => setDraft({ ...draft, maxOutputTokens: e.target.value })} />
    <p><label htmlFor={`${id}-capabilities`}>{t("允许能力白名单（未验证）")}</label></p>
    <Select id={`${id}-capabilities`} mode="multiple" value={draft.capabilities} disabled={disabled} options={PLATFORM_MODEL_CAPABILITIES.map(value => ({ value, label: value }))}
      onChange={values => setDraft({ ...draft, capabilities: values })} />
    <p>{t("密钥操作")}</p><Segmented aria-label={t("密钥操作")} value={draft.secret} disabled={disabled || !summary}
      options={[{ value: "retain", label: t("保留现有密钥") }, { value: "replace", label: t("替换密钥") }, { value: "clear", label: t("清除密钥") }]}
      onChange={v => setDraft({ ...draft, secret: String(v), apiKey: "", enabled: v === "clear" ? false : draft.enabled })} />
    {draft.secret === "replace" && <><p><label htmlFor={`${id}-key`}>{t("新密钥")}</label></p><Input id={`${id}-key`} type="password" autoComplete="new-password" value={draft.apiKey} maxLength={8192} disabled={disabled} onChange={e => setDraft({ ...draft, apiKey: e.target.value })} /></>}
    <p><label htmlFor={`${id}-enabled`}>{t("启用平台配置")}</label> <Switch id={`${id}-enabled`} checked={draft.enabled} disabled={disabled || !summary || draft.secret === "clear"} onChange={enabled => setDraft({ ...draft, enabled })} /></p>
    {!valid && <p role="status">{t("请填写支持的协议、HTTPS 地址、模型标识、输出上限及所需新密钥。首次配置保持停用。")}</p>}
    <ActionButton label={t("保存平台 AI 配置")} successLabel={t("配置已保存，待重新读取")} disabled={disabled || !valid}
      onAction={() => session.save({ expectedRevision: summary?.revision ?? 0, protocol: draft.protocol as AiPlatformModelSettingsInputDraft["protocol"],
        model: draft.model, baseUrl: draft.baseUrl, maxOutputTokens: Number(draft.maxOutputTokens), allowedCapabilities: [...draft.capabilities], enabled: draft.secret === "clear" ? false : draft.enabled,
        secretChange: draft.secret === "replace" ? { operation: "replace", apiKey: draft.apiKey } : { operation: draft.secret as "retain" | "clear" } })} />
  </section>;
}
