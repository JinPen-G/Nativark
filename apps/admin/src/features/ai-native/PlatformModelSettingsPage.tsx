/** SaaS Profile editor, bounded configuration directory and separate policy views.
 * Original encrypted CAS/receipt APIs remain authoritative; this host never invokes a provider. */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AiPlatformModelSettingsInputDraft, AiPlatformModelDirectoryDraft } from "@rental-os/shared";
import { platformAiSettingsApi } from "@/api/platformAiSettings";
import { currentSessionEpoch } from "@/app/queryClient";
import { useAiManagementLocale as useLocale } from "./management-locale";
import { PageHeader } from "@/components/PageHeader";
import { WorkspacePageActions } from "@/components/workspace/WorkspaceHeader";
import { ActionButton, Alert, FormSection, Input, Segmented, Select, Switch, Tabs } from "@/components/ui";
import { useAuthStore } from "@/features/auth/authStore";
import { PLATFORM_MODEL_CAPABILITIES, PlatformModelSettingsSession } from "./platform-model-settings-session";
import { safeDisplayText } from './safe-display';
import { PlatformPriceReview } from './PlatformPriceReview';
import { PlatformAiCreditSettings } from './AiCreditSettings';
import { PlatformBudgetSettings } from './PlatformBudgetSettings';
import { PlatformCapabilityObservation, platformCapabilityLabels } from './PlatformCapabilityObservation';
import styles from './AiManagement.module.css';

const identityKey = () => JSON.stringify([useAuthStore.getState().user, currentSessionEpoch()]);
const feedback = { idle: "配置、能力验证、费率及预算分别管理，不会因保存而开放调用。", saved: "平台配置已保存，请重新读取当前配置。",
  recorded: "原保存收据已确认，请重新读取当前配置。", unknown: "保存结果未知，只能核对原操作收据，不能换编号重试。",
  conflict: "修订或原操作冲突，请重新读取，不覆盖其他配置。", denied: "当前权限已不足，已清除旧配置显示。",
  invalid: "配置未通过服务端校验，请检查输入。", unavailable: "配置或收据不可用，不代表不存在或未保存。",
  reference_unavailable: "原操作引用无法可靠保存或读取，已停止发送。请恢复浏览器存储并核对原保存结果。" };
export function PlatformModelSettingsPage() {
  const { t } = useLocale(), auth = useAuthStore();
  const allowed = !!auth.token && auth.user?.isSaasAdmin && auth.hasPermission("system:ai-provider:view");
  const identity = identityKey();
  return <>
    <PageHeader title={t("平台 AI 配置")} description={t("管理平台供应商连接，不读取租户 BYOK 密钥。")} />
    {allowed ? <PlatformModelWorkspace key={identity} identity={identity} /> : <Alert type="warning" title={t("需要 SaaS 平台 AI 配置读取权限。")}/>}
  </>;
}

function PlatformModelWorkspace({ identity }: { identity: string }) {
  const { t } = useLocale(), id = useId();
  const [target, setTarget] = useState("");
  const [selected, setSelected] = useState("");
  return <Tabs aria-label={t("平台 AI 配置")} items={[
    { key: "models", label: t("模型配置"), forceRender: true, children: <section className={styles.stack} aria-label={t("模型配置")}>
      <FormSection title={t("选择平台配置")}>
        <PlatformModelDirectory identity={identity} onSelect={value => { setTarget(value); setSelected(value); }}
          onClear={() => { setTarget(''); setSelected(''); }} />
        <div className={styles.requestRow}>
          <div className={styles.field}><label htmlFor={id}>{t("Profile 编号")}</label>
            <Input id={id} value={target} maxLength={36} onChange={e => { setTarget(e.target.value); setSelected(""); }} />
          </div>
          <ActionButton variant="secondary" label={t("选择配置对象")} successLabel={t("对象已选择，请读取或准备首次配置")}
            disabled={!/^[A-Za-z0-9][\w.:-]{0,35}$/u.test(target)} onAction={async () => { setSelected(target); }} />
        </div>
        <p className={styles.help}>{t("按正式 Profile 编号读取；首次配置须明确选择修订零创建，不会把读取失败当作不存在。")}</p>
      </FormSection>
      {selected && <ProfileHost key={selected} profileId={selected} identity={identity} />}
    </section> },
    { key: "budget", label: t("平台预算"), forceRender: true, children: <PlatformBudgetSettings identity={identity} /> },
    { key: "credits", label: t("额度申请"), forceRender: true, children: <PlatformAiCreditSettings identity={identity} /> },
  ]} />;
}
/** Explicit bounded directory read. Selection is not a connection test or an
 * invocation; manual first setup and the original CAS editor remain intact. */
export function PlatformModelDirectory({ identity, onSelect, onClear }: {
  identity: string; onSelect: (profileId: string) => void; onClear: () => void;
}) {
  const { t } = useLocale(), label = useId();
  const [page, setPage] = useState<AiPlatformModelDirectoryDraft | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [selected, setSelected] = useState<string>();
  const flight = useRef<AbortController | null>(null), mounted = useRef(true);
  const active = useRef({ identity, onSelect, onClear }); active.current = { identity, onSelect, onClear };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; flight.current?.abort(); }; }, []);
  const current = () => mounted.current && active.current.identity === identity && identityKey() === identity
    && !!useAuthStore.getState().token && !!useAuthStore.getState().user?.isSaasAdmin
    && useAuthStore.getState().hasPermission('system:ai-provider:view');
  const read = async (after?: string) => {
    if (flight.current || !current()) throw Error('AI_ACCESS_DENIED');
    const controller = new AbortController(); flight.current = controller; setBusy(true); setError(false); setPage(null); setSelected(undefined);
    try {
      const result = structuredClone(await platformAiSettingsApi.list({ limit: 20, ...(after ? { after } : {}) }, controller.signal));
      if (!current() || controller.signal.aborted) return;
      if (!result || result.observation !== 'configuration_catalog_not_capability_evidence' || !Array.isArray(result.items) || result.items.length > 20
        || new Set(result.items.map(row => row.profileId)).size !== result.items.length
        || result.items.some(row => !/^[A-Za-z0-9][\w.:-]{0,35}$/u.test(row.profileId)
          || !Number.isInteger(row.revision) || row.revision < 1 || row.revision > 4294967295
          || typeof row.enabled !== 'boolean' || typeof row.model !== 'string' || row.model.length > 256
          || typeof row.protocol !== 'string' || row.protocol.length > 64)
        || result.nextCursor !== null && (!/^[A-Za-z0-9][\w.:-]{0,35}$/u.test(result.nextCursor)
          || result.items.at(-1)?.profileId !== result.nextCursor)) throw Error('AI_RESOURCE_UNAVAILABLE');
      setPage(result);
    } catch (failure) {
      if (current() && !controller.signal.aborted) { setError(true); active.current.onClear(); }
      throw failure;
    } finally { if (flight.current === controller) flight.current = null; if (current()) setBusy(false); }
  };
  return <section className={styles.section} aria-label={t('已有平台 AI 配置')}>
    <div className={styles.toolbar}>
      <ActionButton variant="secondary" label={t('读取已有配置')} pendingLabel={t('读取中…')} disabled={busy} onAction={() => read()} />
      {page?.nextCursor && <ActionButton label={t('下一页配置')} pendingLabel={t('读取中…')} disabled={busy}
        onAction={() => read(page.nextCursor!)} />}
    </div>
    {page && <><div className={styles.field}><label htmlFor={label}>{t('选择已有配置（不自动读取或启用）')}</label>
      <Select id={label} value={selected} disabled={busy || !page.items.length}
        options={page.items.map(row => ({ value: row.profileId,
          label: `${safeDisplayText(row.profileKey, 64)} · ${safeDisplayText(row.model, 256)} · ${t(row.enabled ? '配置启用' : '配置停用')} · ${t('修订')}${row.revision}` }))}
        onChange={value => { if (!current() || flight.current || busy || !page.items.some(row => row.profileId === value)) return;
          setSelected(String(value)); active.current.onSelect(String(value)); }} /></div>
      {!page.items.length && <p role="status">{t('本页没有已登记配置；不代表读取失败或允许覆盖其他配置。首次配置仍需原管理权限和修订零。')}</p>}
      <p className={styles.help}>{t('目录仅显示当前平台配置元数据，不代表连接、能力、预算或调用权限已验证；不读取租户 BYOK 或密钥。')}</p></>}
    {error && <Alert type="warning" title={t('配置目录暂不可读取，已清除旧目录。请核对平台读取权限后手动重试。')} />}
  </section>;
}
function ProfileHost({ profileId, identity }: { profileId: string; identity: string }) {
  const { t } = useLocale();
  const canManage = useAuthStore(s => s.hasPermission("system:ai-provider:manage"));
  const session = useMemo(() => {
    let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* The session blocks saves without durable recovery references. */ }
    return new PlatformModelSettingsSession(profileId, platformAiSettingsApi,
      () => identityKey() === identity && !!useAuthStore.getState().token && !!useAuthStore.getState().user?.isSaasAdmin
        && useAuthStore.getState().hasPermission("system:ai-provider:view"),
      () => useAuthStore.getState().hasPermission("system:ai-provider:manage"), () => window.crypto.randomUUID(), storage,
      `rental_platform_ai_operation:${JSON.stringify([useAuthStore.getState().user?.id, profileId])}`);
  }, [profileId, identity]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  return <section className={styles.stack} aria-label={profileId} aria-busy={state.busy}>
    <p className={styles.help}>{t("当前配置对象")}: <code>{profileId}</code></p>
    <Alert type={state.feedback === "saved" || state.feedback === "recorded" ? "success" : state.feedback === "idle" ? "info" : "warning"}
      title={t(feedback[state.feedback])} />
    <div className={styles.toolbar}>
      <ActionButton variant="secondary" label={t("读取当前配置")} successLabel={t("读取已结束")} disabled={state.busy} onAction={() => session.load()} />
      {canManage && !state.summary && !state.creating && <ActionButton label={t("准备首次配置（修订零）")} successLabel={t("仅准备，尚未保存")}
        disabled={state.busy || !!state.pending} onAction={async () => { session.prepareInitial(); }} />}
      {state.pending && <ActionButton label={t("核对原保存收据")} successLabel={t("核对已结束")} disabled={state.busy} onAction={() => session.reconcile()} />}
    </div>
    {state.pending && <p role="status">{t("原操作编号")}: <code>{state.pending.operationKey}</code></p>}
    {!canManage && <p role="status">{t("仅可读取，当前没有平台 AI 配置管理权限。")}</p>}
    <Tabs aria-label={t("所选配置的管理视图")} items={[
      { key: "connection", label: t("连接设置"), forceRender: true, children: (state.summary || state.creating)
        ? <ProfileEditor key={JSON.stringify([state.summary, state.creating])} session={session}
          disabled={state.busy || !!state.pending || state.feedback === 'reference_unavailable' || !canManage} />
        : <p className={styles.help}>{t("请先读取当前配置，或明确准备首次配置。")}</p> },
      { key: "rates", label: t("费率审阅"), forceRender: true, children: <PlatformPriceReview profileId={profileId} identity={identity} profile={state.summary} blocked={state.busy || !!state.pending} /> },
      { key: "capabilities", label: t("能力证据"), forceRender: true, children: <PlatformCapabilityObservation key={JSON.stringify([identity, profileId, state.summary, state.pending])} profileId={profileId} identity={identity} /> },
    ]} />
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
  return <section className={styles.editor} aria-label={t("平台模型字段")}>
    <p className={styles.help}>{t("当前修订")}: {summary?.revision ?? 0}。{t("白名单不等于能力已验证；密钥不回显。")}</p>
    <FormSection title={t("连接与模型")}><div className={styles.formGrid}>
    <div className={styles.field}><label htmlFor={`${id}-protocol`}>{t("协议")}</label>
    <Select id={`${id}-protocol`} value={draft.protocol || undefined} disabled={disabled} options={[
      { value: "openai_responses", label: "OpenAI Responses" }, { value: "anthropic_messages", label: "Anthropic Messages" }, { value: "openai_chat_completions", label: "OpenAI Chat Completions" }
    ]} onChange={v => setDraft({ ...draft, protocol: String(v) })} /></div>
    <div className={styles.field}><label htmlFor={`${id}-model`}>{t("模型标识")}</label><Input id={`${id}-model`} value={draft.model} maxLength={256} disabled={disabled} onChange={e => setDraft({ ...draft, model: e.target.value })} /></div>
    <div className={`${styles.field} ${styles.full}`}><label htmlFor={`${id}-url`}>Base URL</label><Input id={`${id}-url`} value={draft.baseUrl} maxLength={2048} disabled={disabled} autoComplete="off" onChange={e => setDraft({ ...draft, baseUrl: e.target.value })} /></div>
    </div></FormSection>
    <FormSection title={t("调用限制")}>
    <div className={styles.field}><label htmlFor={`${id}-limit`}>{t("单次输出 Token 上限（1–32768）")}</label><Input id={`${id}-limit`} inputMode="numeric" value={draft.maxOutputTokens} maxLength={5} disabled={disabled} onChange={e => setDraft({ ...draft, maxOutputTokens: e.target.value })} /></div>
    <div className={styles.field}><label htmlFor={`${id}-capabilities`}>{t("允许能力白名单（未验证）")}</label>
    <Select id={`${id}-capabilities`} mode="multiple" value={draft.capabilities} disabled={disabled} options={PLATFORM_MODEL_CAPABILITIES.map(value => ({ value, label: t(platformCapabilityLabels[value]) }))}
      onChange={values => setDraft({ ...draft, capabilities: values })} /></div>
    </FormSection>
    <FormSection title={t("凭据与启用")}>
    <div className={styles.field}><span>{t("密钥操作")}</span><Segmented aria-label={t("密钥操作")} value={draft.secret} disabled={disabled || !summary}
      options={[{ value: "retain", label: t("保留现有密钥") }, { value: "replace", label: t("替换密钥") }, { value: "clear", label: t("清除密钥") }]}
      onChange={v => setDraft({ ...draft, secret: String(v), apiKey: "", enabled: v === "clear" ? false : draft.enabled })} /></div>
    {draft.secret === "replace" && <div className={styles.field}><label htmlFor={`${id}-key`}>{t("新密钥")}</label><Input id={`${id}-key`} type="password" autoComplete="new-password" value={draft.apiKey} maxLength={8192} disabled={disabled} onChange={e => setDraft({ ...draft, apiKey: e.target.value })} /></div>}
    <div className={styles.enable}><label htmlFor={`${id}-enabled`}>{t("启用平台配置")}</label> <Switch id={`${id}-enabled`} checked={draft.enabled} disabled={disabled || !summary || draft.secret === "clear"} onChange={enabled => setDraft({ ...draft, enabled })} /></div>
    </FormSection>
    {!valid && <p className={styles.help} role="status">{t("请填写支持的协议、HTTPS 地址、模型标识、输出上限及所需新密钥。首次配置保持停用。")}</p>}
    <WorkspacePageActions>
    <ActionButton label={t("保存平台 AI 配置")} successLabel={t("配置已保存，待重新读取")} disabled={disabled || !valid}
      onAction={() => session.save({ expectedRevision: summary?.revision ?? 0, protocol: draft.protocol as AiPlatformModelSettingsInputDraft["protocol"],
        model: draft.model, baseUrl: draft.baseUrl, maxOutputTokens: Number(draft.maxOutputTokens), allowedCapabilities: [...draft.capabilities], enabled: draft.secret === "clear" ? false : draft.enabled,
        secretChange: draft.secret === "replace" ? { operation: "replace", apiKey: draft.apiKey } : { operation: draft.secret as "retain" | "clear" } })} />
    </WorkspacePageActions>
  </section>;
}
