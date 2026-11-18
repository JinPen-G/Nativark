/** 字典与编号沿宿主认证请求入口，读取可取消，写入返回原服务Promise。 */
import type { GeneratePlatformNumberResult, PlatformDictionaryGroup, PlatformNumberRule,
  SavePlatformDictionaryGroupRequest, SavePlatformNumberRuleRequest } from "@rental-os/platform-contracts";
import { useMemo } from "react";
import { useAdminRuntime, type AdminRuntime } from "../../runtime";

export function createPlatformToolsApi(request: AdminRuntime["request"]) {
  return {
    dictionaries: (signal?: AbortSignal) => request<PlatformDictionaryGroup[]>("/platform/dictionaries", { signal }),
    saveDictionary: (payload: SavePlatformDictionaryGroupRequest) => request<PlatformDictionaryGroup>(
      `/platform/dictionaries/${encodeURIComponent(payload.code)}`, { method: "put", data: payload }
    ),
    numberRules: (signal?: AbortSignal) => request<PlatformNumberRule[]>("/platform/number-rules", { signal }),
    saveNumberRule: (payload: SavePlatformNumberRuleRequest) => request<PlatformNumberRule>(
      `/platform/number-rules/${encodeURIComponent(payload.code)}`, { method: "put", data: payload }
    ),
    generateNumber: (code: string, operator: string) => request<GeneratePlatformNumberResult>(
      "/platform/number-rules/generate", { method: "post", data: { code, operator } }
    )
  };
}

export function usePlatformToolsApi() {
  const runtime = useAdminRuntime();
  return useMemo(() => createPlatformToolsApi(runtime.request), [runtime]);
}
