/** 设置页面观察同一已验证 AI 宿主；只订阅稳定身份值，不创建认证或查询缓存。 */
import { useMemo, useSyncExternalStore } from "react";
import { useAiAdminHost } from "../host";
import { createPlatformAiSettingsApi } from "./platformAiSettings";
import { createAiBudgetSettingsApi } from "./aiBudgetSettings";
import { createAiCreditApi } from "./aiCredit";

export function usePlatformModelSettingsRuntime() {
  const host = useAiAdminHost();
  const ports = useMemo(() => {
    const currentSessionEpoch = () => host.runtime.currentSessionEpoch();
    const identityKey = () => JSON.stringify([host.getSession().user, currentSessionEpoch()]);
    const tenantIdentity = () => {
      const auth = host.getSession();
      return JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user]);
    };
    return {
      runtime: host.runtime,
      getSession: host.getSession,
      currentSessionEpoch,
      identityKey,
      tenantIdentity,
      identityNow: (platform = false) => platform ? identityKey() : tenantIdentity(),
      platformAiSettingsApi: createPlatformAiSettingsApi(host),
      aiBudgetSettingsApi: createAiBudgetSettingsApi(host),
      aiCreditApi: createAiCreditApi(host),
      snapshot: () => {
        const auth = host.getSession();
        return JSON.stringify([auth.sessionVerified, auth.authenticated, auth.user, auth.tenant,
          auth.currentWorkspaceId, currentSessionEpoch()]);
      },
    };
  }, [host]);
  useSyncExternalStore(host.runtime.subscribe, ports.snapshot, ports.snapshot);
  return { ...ports, auth: host.getSession() };
}
