/** Selected tenant settings use the original editor and the public host's verified session. */
import { canManagePublicResource } from "@rental-os/platform-admin/access";
import type { AdminRuntime } from "@rental-os/platform-admin/runtime";
import { PageHeading, resolveAdminBrandName } from "@rental-os/platform-admin/shell";
import { Alert, AnimatedIcon } from "@rental-os/platform-admin/ui";
import { useAiManagementLocale } from "./ai-native/management-locale";
import { AiAdminHostProvider, createAiAdminHost } from "./host";
import { usePlatformModelRuntime } from "./platform-model-settings/model-runtime";
import { TenantSettingsEditor } from "./tenant-model-settings/TenantSettingsEditor";

function PublicTenantModelSettingsPage() {
  const { t } = useAiManagementLocale();
  const { auth, tenantIdentity, currentSessionEpoch } = usePlatformModelRuntime();
  const tenantId = auth.tenant?.tenantId, identity = tenantIdentity();
  const allowed = auth.sessionVerified && auth.authenticated && auth.currentWorkspaceId === undefined
    && Boolean(auth.user?.id) && !auth.user?.isSaasAdmin && auth.hasPermission("system:params:manage");
  return <>
    <PageHeading brandName={resolveAdminBrandName(auth.tenant, auth.user)} icon={<AnimatedIcon name="rules" />} title={t("AI 服务设置")} />
    {allowed && tenantId
      ? <TenantSettingsEditor key={JSON.stringify([identity, currentSessionEpoch()])} tenantId={tenantId} identity={identity} scope="tenant" />
      : <Alert type="warning" title={t("当前没有管理 AI 设置的权限。")} />}
  </>;
}

export function createPublicTenantModelSettingsPage(runtime: AdminRuntime) {
  const host = createAiAdminHost({ runtime, getSession: () => {
    const state = runtime.getSession();
    return { ...state, authenticated: state.sessionVerified && Boolean(state.user),
      hasPermission: permission => canManagePublicResource(state.user, "tenant", permission) };
  } });
  return function SelectedPublicTenantModelSettingsPage() {
    return <AiAdminHostProvider host={host}><PublicTenantModelSettingsPage /></AiAdminHostProvider>;
  };
}
