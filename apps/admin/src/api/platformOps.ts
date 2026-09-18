/**
 * 平台运维工具 API：数据字典、编号规则、筛选预设、文件资产、通知模板与日志、
 * 异步任务与打印任务、基础设施仪表盘与 Mock 适配器。
 *
 * 会话、组织、账号、角色、租户生命周期见 `./platform.ts`。
 */
import type {
  AdapterLogSummary,
  AsyncJobSummary,
  CreateAsyncJobRequest,
  CreateFileAssetRequest,
  CreatePrintJobRequest,
  FileAssetSummary,
  GeneratePlatformNumberResult,
  InfraDashboardResult,
  InvokeMockAdapterRequest,
  NotificationSendLogSummary,
  NotificationTemplateSummary,
  PlatformDictionaryGroup,
  PlatformFilterPreset,
  PlatformFilterPresetQuery,
  PlatformNumberRule,
  PrintJobSummary,
  SavePlatformDictionaryGroupRequest,
  SavePlatformFilterPresetRequest,
  SavePlatformNumberRuleRequest,
  SendMockNotificationRequest
} from "@rental-os/shared";
import { request } from "./http";

export const platformOpsApi = {
  // ---- 数据字典 / 编号规则 / 筛选预设 ----
  dictionaries: () => request<PlatformDictionaryGroup[]>("/platform/dictionaries"),
  saveDictionary: (payload: SavePlatformDictionaryGroupRequest) => request<PlatformDictionaryGroup>(`/platform/dictionaries/${payload.code}`, { method: "put", data: payload }),
  numberRules: () => request<PlatformNumberRule[]>("/platform/number-rules"),
  saveNumberRule: (payload: SavePlatformNumberRuleRequest) => request<PlatformNumberRule>(`/platform/number-rules/${payload.code}`, { method: "put", data: payload }),
  generateNumber: (code: string, operator: string) => request<GeneratePlatformNumberResult>("/platform/number-rules/generate", { method: "post", data: { code, operator } }),
  filterPresets: (params: PlatformFilterPresetQuery = {}) => request<PlatformFilterPreset[]>("/platform/filter-presets", { params }),
  saveFilterPreset: (payload: SavePlatformFilterPresetRequest) => request<PlatformFilterPreset>("/platform/filter-presets", { method: "post", data: payload }),
  setFilterPresetDefault: (id: string, operator?: string) => request<PlatformFilterPreset>(`/platform/filter-presets/${id}/default`, { method: "put", data: { operator } }),
  deleteFilterPreset: (id: string, operator?: string) => request<{ id: string; deleted: boolean }>(`/platform/filter-presets/${id}`, { method: "delete", params: { operator } }),

  // ---- 文件资产 / 通知 ----
  fileAssets: () => request<FileAssetSummary[]>("/files"),
  createFileAsset: (payload: CreateFileAssetRequest) => request<FileAssetSummary>("/files", { method: "post", data: payload }),
  notificationTemplates: () => request<NotificationTemplateSummary[]>("/notifications/templates"),
  notificationLogs: () => request<NotificationSendLogSummary[]>("/notifications/logs"),
  sendNotification: (payload: SendMockNotificationRequest) => request<unknown>("/notifications/send", { method: "post", data: payload }),

  // ---- 异步任务 / 打印任务 ----
  asyncJobs: () => request<AsyncJobSummary[]>("/jobs"),
  createAsyncJob: (payload: CreateAsyncJobRequest) => request<AsyncJobSummary>("/jobs", { method: "post", data: payload }),
  runJob: (id: string) => request<AsyncJobSummary>(`/jobs/${id}/run`, { method: "post" }),
  runDueJobs: () => request<{ ranCount: number; jobs: AsyncJobSummary[]; message: string }>("/jobs/run-due", { method: "post" }),
  printJobs: () => request<PrintJobSummary[]>("/jobs/print"),
  createPrintJob: (payload: CreatePrintJobRequest) => request<PrintJobSummary>("/jobs/print", { method: "post", data: payload }),

  // ---- 基础设施 ----
  integrations: () => request<InfraDashboardResult>("/integrations/dashboard"),
  invokeMockAdapter: (payload: InvokeMockAdapterRequest) => request<AdapterLogSummary>("/integrations/adapters/mock-call", { method: "post", data: payload })
};
