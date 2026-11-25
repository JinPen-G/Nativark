/** 原治理、文件与任务工具沿宿主唯一认证请求；写入仅派发一次，401不刷新重发。
 * 文件提供方、打印及作业执行由真实服务端参加者决定，此客户端不补造成功结果。 */
import type { GeneratePlatformNumberResult, PlatformDictionaryGroup, PlatformNumberRule,
  SavePlatformDictionaryGroupRequest, SavePlatformNumberRuleRequest,
  AsyncJobSummary, CreateAsyncJobRequest, CreateFileAssetRequest, CreatePrintJobRequest,
  FileAssetSummary, NotificationSendLogSummary, NotificationTemplateSummary,
  PlatformFilterPreset, PlatformFilterPresetQuery, PlatformFilterPresetScope, PrintJobSummary, SavePlatformFilterPresetRequest
} from "@rental-os/platform-contracts";
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
    ),
    filterPresets: (params: PlatformFilterPresetQuery = {}, signal?: AbortSignal) =>
      request<PlatformFilterPreset[]>("/platform/filter-presets", { params, signal }),
    filterPresetScopes: (signal?: AbortSignal) =>
      request<PlatformFilterPresetScope[]>("/platform/filter-presets/scopes", { signal }),
    saveFilterPreset: (payload: SavePlatformFilterPresetRequest) => request<PlatformFilterPreset>(
      "/platform/filter-presets", { method: "post", data: payload, retryAuthentication: false }),
    setFilterPresetDefault: (id: string, operator?: string) => request<PlatformFilterPreset>(
      `/platform/filter-presets/${encodeURIComponent(id)}/default`,
      { method: "put", data: { operator }, retryAuthentication: false }),
    deleteFilterPreset: (id: string, operator?: string) => request<{ id: string; deleted: boolean }>(
      `/platform/filter-presets/${encodeURIComponent(id)}`,
      { method: "delete", params: { operator }, retryAuthentication: false }),
    fileAssets: (signal?: AbortSignal) => request<FileAssetSummary[]>("/files", { signal }),
    createFileAsset: (payload: CreateFileAssetRequest) => request<FileAssetSummary>(
      "/files", { method: "post", data: payload, retryAuthentication: false }),
    notificationTemplates: (signal?: AbortSignal) => request<NotificationTemplateSummary[]>("/notifications/templates", { signal }),
    notificationLogs: (signal?: AbortSignal) => request<NotificationSendLogSummary[]>("/notifications/logs", { signal }),
    asyncJobs: (signal?: AbortSignal) => request<AsyncJobSummary[]>("/jobs", { signal }),
    createAsyncJob: (payload: CreateAsyncJobRequest) => request<AsyncJobSummary>(
      "/jobs", { method: "post", data: payload, retryAuthentication: false }),
    runJob: (id: string) => request<AsyncJobSummary>(`/jobs/${encodeURIComponent(id)}/run`,
      { method: "post", retryAuthentication: false }),
    runDueJobs: () => request<{ ranCount: number; jobs: AsyncJobSummary[]; message: string }>(
      "/jobs/run-due", { method: "post", retryAuthentication: false }),
    printJobs: (signal?: AbortSignal) => request<PrintJobSummary[]>("/jobs/print", { signal }),
    createPrintJob: (payload: CreatePrintJobRequest) => request<PrintJobSummary>(
      "/jobs/print", { method: "post", data: payload, retryAuthentication: false })
  };
}

export function usePlatformToolsApi() {
  const runtime = useAdminRuntime();
  return useMemo(() => createPlatformToolsApi(runtime.request), [runtime]);
}
