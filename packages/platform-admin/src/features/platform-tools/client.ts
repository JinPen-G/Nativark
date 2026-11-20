/** 字典与编号沿宿主认证请求入口；写入仅派发一次，401不刷新重发。 */
import type { GeneratePlatformNumberResult, PlatformDictionaryGroup, PlatformNumberRule,
  SavePlatformDictionaryGroupRequest, SavePlatformNumberRuleRequest } from "@rental-os/platform-contracts";
import { useMemo } from "react";
import { useAdminRuntime, type AdminRuntime } from "../../runtime";

export function createPlatformToolsApi(request: AdminRuntime["request"]) {
  return {
    dictionaries: (signal?: AbortSignal) => request<PlatformDictionaryGroup[]>("/platform/dictionaries", { signal }),
    saveDictionary: (payload: SavePlatformDictionaryGroupRequest) => request<PlatformDictionaryGroup>(
      `/platform/dictionaries/${encodeURIComponent(payload.code)}`, { method: "put", data: payload, retryAuthentication: false }
    ),
    numberRules: (signal?: AbortSignal) => request<PlatformNumberRule[]>("/platform/number-rules", { signal }),
    saveNumberRule: (payload: SavePlatformNumberRuleRequest) => request<PlatformNumberRule>(
      `/platform/number-rules/${encodeURIComponent(payload.code)}`, { method: "put", data: payload, retryAuthentication: false }
    ),
    generateNumber: (code: string, operator: string) => request<GeneratePlatformNumberResult>(
      "/platform/number-rules/generate", { method: "post", data: { code, operator }, retryAuthentication: false }
    )
  };
}

export function usePlatformToolsApi() {
  const runtime = useAdminRuntime();
  return useMemo(() => createPlatformToolsApi(runtime.request), [runtime]);
}
