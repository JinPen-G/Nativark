/** Tenant configuration host. The server remains the permission/CAS authority;
 * this page cannot grant capabilities, initialize quotas or dispatch a model. */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { aiModelSettingsApi } from "@/api/aiModelSettings";
import { currentSessionEpoch } from "@/app/queryClient";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { ActionButton, Alert, Tabs } from "@/components/ui";
import { useAuthStore } from "@/features/auth/authStore";
import { AiServiceSettingsCard } from "./AiServiceSettingsCard";
import { ModelSettingsSession, type SettingsFeedback } from "./model-settings-session";
import { TenantAiCreditSettings } from './AiCreditSettings';
import { AiCallRecords } from './AiCallRecords';
import type { AiSettingsMode } from './ai-service-settings-model';
import { AiConnectionCheck } from './AiConnectionCheck';

const labels: Record<SettingsFeedback, string> = {
  idle: "选择 AI 服务并保存。平台 AI 的金额额度需向平台申请。",
  saved: "AI 设置已保存。",
  recorded: "上次保存结果已确认，请刷新查看当前设置。",
  unknown: "上次保存结果尚未确认，请先核对保存结果，不要重复提交。",
  conflict: "设置已被其他管理员修改，请重新读取后确认。",
  denied: "当前没有管理 AI 设置的权限。",
  unavailable: "AI 设置暂不可用，请稍后刷新；保存过的设置不会因此被删除。",
  invalid: "输入未通过服务端校验，请检查配置。"
};
function contextKey() {
  const state = useAuthStore.getState();
  return JSON.stringify([state.tenant?.tenantId, state.currentWorkspaceId, state.user]);
}
export function AiModelSettingsPage() {
  const { t } = useLocale();
  const auth = useAuthStore();
  const identity = contextKey();
  const [selection, setSelection] = useState<{ identity: string; mode: AiSettingsMode } | null>(null);
  const mode = selection?.identity === identity ? selection.mode : null;
  const onModeChange = useCallback((mode: AiSettingsMode) => setSelection({ identity, mode }), [identity]);
  const allowed = !!auth.token && !!auth.tenant?.tenantId && !!auth.currentWorkspaceId && !!auth.user?.id
    && !auth.user.isSaasAdmin && auth.hasPermission("system:params:manage");
  return <>
    <PageHeader title={t("AI 服务设置")} description={t("选择平台 AI 或自带供应商，管理使用额度和查询调用记录。")} />
    {allowed ? <Tabs key={identity} items={[
      { key: 'settings', label: t('服务配置'), children: <>
        <TenantSettingsEditor tenantId={auth.tenant!.tenantId} identity={identity} onModeChange={onModeChange} />
      </> },
      { key: 'credits', label: t('平台额度'), children: mode === 'tenant_managed'
        ? <Alert type="info" title={t('自带供应商由供应商直接计费，无需申请平台额度。切换至平台 AI 后可在此申请。')} />
        : <TenantAiCreditSettings identity={identity} /> },
      { key: 'calls', label: t('调用记录'), children: <AiCallRecords identity={identity} /> }
    ]} />
      : <Alert type="warning" title={t("需要当前经营空间及 AI 配置管理权限。")}/>}
  </>;
}
function TenantSettingsEditor({ tenantId, identity, onModeChange }: { tenantId: string; identity: string; onModeChange: (mode: AiSettingsMode) => void }) {
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
  useEffect(() => { if (state.summary) onModeChange(state.summary.mode); }, [state.summary?.mode, onModeChange]);
  useEffect(() => { session.activate(); void session.load(); return () => session.dispose(); }, [session]);
  const legacy = state.legacy?.state === "review_required" && state.legacy.currentConfiguration === "absent" ? state.legacy : null;
  const showEditor = !!state.summary || !!legacy && reviewLegacy && legacy.supportedProtocol !== null;
  return <section aria-label={t("AI 服务设置")} aria-busy={state.busy}>
    {state.feedback !== 'idle' && <Alert type={state.feedback === "saved" || state.feedback === "recorded" ? "success"
      : ["denied", "invalid", "conflict"].includes(state.feedback) ? "error" : "info"} title={t(labels[state.feedback])} />}
    <div className="panel-toolbar">
      <ActionButton label={t("刷新设置")} successLabel={t("已刷新")} disabled={state.busy} onAction={() => session.load()} />
      {state.pending && <ActionButton label={t("核对上次保存结果")} successLabel={t("核对已结束")} disabled={state.busy} onAction={() => session.reconcile()} />}
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
        onModeChange={onModeChange}
        onSave={input => session.save(input)} />}
      {state.summary?.mode === 'tenant_managed' && <AiConnectionCheck identity={identity}
        configurationRevision={state.summary.configRevision} disabled={state.busy || !!state.pending || !state.summary.enabled} />}
    </QueryState>
  </section>;
}
