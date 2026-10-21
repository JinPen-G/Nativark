/** Tenant configuration host. The server remains the permission/CAS authority;
 * this page cannot grant capabilities, initialize quotas or dispatch a model. */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { aiModelSettingsApi } from "@/api/aiModelSettings";
import { currentSessionEpoch } from "@/app/queryClient";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { ActionButton, Alert } from "@/components/ui";
import { useAuthStore } from "@/features/auth/authStore";
import { AiServiceSettingsCard } from "./AiServiceSettingsCard";
import { ModelSettingsSession, type SettingsFeedback } from "./model-settings-session";
import { TenantBudgetSettings } from "./TenantBudgetSettings";
import { TenantPlatformRate } from './TenantPlatformRate';
import { TenantByokRate } from './TenantByokRate';
import { CapabilityProbePanel } from './CapabilityProbePanel';

const labels: Record<SettingsFeedback, string> = {
  idle: "配置保存、真实能力验证与执行准入分别管理。",
  saved: "AI 配置已保存；尚未自动验证能力或开放预算。",
  recorded: "原保存收据已确认；请重新读取当前配置，历史收据不代表当前配置未变化。",
  unknown: "保存结果待核对。只能读取原操作收据，不能再次保存或更换操作编号重试。",
  conflict: "配置修订已变化，请重新读取并确认；未覆盖其他人的修改。",
  denied: "当前无权读取或管理 AI 配置，已停止显示旧配置。",
  unavailable: "配置或收据暂不可用，请稍后重新读取；不代表保存未发生。",
  invalid: "输入未通过服务端校验，请检查配置。"
};
function contextKey() {
  const state = useAuthStore.getState();
  return JSON.stringify([state.tenant?.tenantId, state.currentWorkspaceId, state.user]);
}
export function AiModelSettingsPage() {
  const { t } = useLocale();
  const auth = useAuthStore();
  const allowed = !!auth.token && !!auth.tenant?.tenantId && !!auth.currentWorkspaceId && !!auth.user?.id
    && !auth.user.isSaasAdmin && auth.hasPermission("system:params:manage");
  return <>
    <PageHeader title={t("AI 服务设置")} description={t("平台统一服务或自定义 BYOK，预算和执行权限独立管理。")} />
    {allowed ? <><TenantSettingsEditor key={contextKey()} tenantId={auth.tenant!.tenantId} identity={contextKey()} />
      <TenantBudgetSettings key={`budget:${contextKey()}`} identity={contextKey()} />
      <TenantPlatformRate key={`rate:${contextKey()}`} identity={contextKey()} />
      <TenantByokRate key={`byok-rate:${contextKey()}`} tenantId={auth.tenant!.tenantId} identity={contextKey()} />
      <CapabilityProbePanel key={`capability:${contextKey()}`} identity={contextKey()} /></>
      : <Alert type="warning" title={t("需要当前经营空间及 AI 配置管理权限。")}/>}
  </>;
}
function TenantSettingsEditor({ tenantId, identity }: { tenantId: string; identity: string }) {
  const { t } = useLocale();
  const [reviewLegacy, setReviewLegacy] = useState(false);
  const session = useMemo(() => {
    const epoch = currentSessionEpoch();
    let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* The pending key remains in memory and visible below. */ }
    // Reference partition only, never authorization or an enable switch.
    const owner = useAuthStore.getState();
    const storageKey = `rental_ai_config_operation:${JSON.stringify([tenantId, owner.currentWorkspaceId, owner.user?.id])}`;
    return new ModelSettingsSession(tenantId, aiModelSettingsApi,
      () => currentSessionEpoch() === epoch && contextKey() === identity && !!useAuthStore.getState().token
        && useAuthStore.getState().hasPermission("system:params:manage"),
      () => window.crypto.randomUUID(), storage, storageKey);
  }, [tenantId, identity]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.activate(); void session.load(); return () => session.dispose(); }, [session]);
  const legacy = state.legacy?.state === "review_required" && state.legacy.currentConfiguration === "absent" ? state.legacy : null;
  const showEditor = !!state.summary || !!legacy && reviewLegacy && legacy.supportedProtocol !== null;
  return <section aria-label={t("AI 服务设置")} aria-busy={state.busy}>
    <Alert type={state.feedback === "saved" || state.feedback === "recorded" ? "success"
      : ["denied", "invalid", "conflict"].includes(state.feedback) ? "error" : "info"} title={t(labels[state.feedback])} />
    <div className="panel-toolbar">
      <ActionButton label={t("重新读取当前配置")} successLabel={t("读取已结束")} disabled={state.busy} onAction={() => session.load()} />
      {state.pending && <ActionButton label={t("核对原保存收据")} successLabel={t("核对已结束")} disabled={state.busy} onAction={() => session.reconcile()} />}
    </div>
    {state.pending && <p role="status">{t("原操作编号")}: <code>{state.pending.operationKey}</code>。{t("当前配置读取不能证明原保存是否成功。")}</p>}
    <QueryState loading={state.busy && !state.summary && !state.legacy}>
      {legacy && <>
        <Alert type="warning" title={t("检测到旧版 BYOK 配置，原数据保持不变。")}
          description={t("不会导入旧密钥或把旧模拟测试当作真实验证。替换须核对来源版本、输入新密钥并保持停用。")}/>
        <p>{t("来源版本")}: {legacy.source.versionNo}</p>
        {legacy.supportedProtocol === null ? <p role="status">{t("旧协议无法受控转换，需由管理员处理；没有自动替换。")}</p>
          : !reviewLegacy && <ActionButton label={t("审阅并准备停用替换")} successLabel={t("待填写并保存")} disabled={state.busy || !!state.pending} onAction={async () => { setReviewLegacy(true); }} />}
      </>}
      {showEditor && <AiServiceSettingsCard summary={state.summary} configId={tenantId} expectedRevision={state.summary?.configRevision ?? 0}
        contextIdentity={identity} pending={state.busy} readOnly={!!state.pending}
        legacySource={!state.summary && legacy && reviewLegacy ? legacy.source : undefined}
        onSave={input => session.save(input)} />}
    </QueryState>
  </section>;
}
