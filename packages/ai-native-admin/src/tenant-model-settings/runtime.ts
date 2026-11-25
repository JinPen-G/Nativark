/** 原租户设置与平台配置共用一个已验证宿主和会话订阅；只增加本页实际 API 端口。 */
import { useMemo } from "react";
import { useAiAdminHost } from "../host";
import { usePlatformModelSettingsRuntime } from "../platform-model-settings/runtime";
import { createAiModelSettingsApi } from "./aiModelSettings";
import { createAiCapabilityProbeApi } from "./aiCapabilityProbe";

export function useTenantModelSettingsRuntime() {
  const host = useAiAdminHost();
  const session = usePlatformModelSettingsRuntime();
  const ports = useMemo(() => ({
    aiModelSettingsApi: createAiModelSettingsApi(host),
    aiCapabilityProbeApi: createAiCapabilityProbeApi(host),
  }), [host]);
  return { ...session, ...ports };
}
