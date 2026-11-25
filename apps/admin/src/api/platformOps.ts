/**
 * 平台运维工具 API：数据字典、编号规则、筛选预设、文件资产、通知模板与日志、
 * 异步任务与打印任务、基础设施仪表盘与 Mock 适配器。
 *
 * 会话、组织、账号、角色、租户生命周期见 `./platform.ts`。
 */
import type {
  AdapterLogSummary,
  InfraDashboardResult,
  InvokeMockAdapterRequest,
  SendMockNotificationRequest
} from "@rental-os/shared";
import { request } from "./http";
import { createPlatformToolsApi } from "@rental-os/platform-admin/platform-tools/client";
const toolsApi = createPlatformToolsApi(request);

export const platformOpsApi = {
  // ---- 数据字典 / 编号规则 / 筛选预设 ----
  dictionaries: toolsApi.dictionaries,
  saveDictionary: toolsApi.saveDictionary,
  numberRules: toolsApi.numberRules,
  saveNumberRule: toolsApi.saveNumberRule,
  generateNumber: toolsApi.generateNumber,
  filterPresets: toolsApi.filterPresets,
  saveFilterPreset: toolsApi.saveFilterPreset,
  setFilterPresetDefault: toolsApi.setFilterPresetDefault,
  deleteFilterPreset: toolsApi.deleteFilterPreset,

  // ---- 文件资产 / 通知 ----
  fileAssets: toolsApi.fileAssets,
  createFileAsset: toolsApi.createFileAsset,
  notificationTemplates: toolsApi.notificationTemplates,
  notificationLogs: toolsApi.notificationLogs,
  sendNotification: (payload: SendMockNotificationRequest) => request<unknown>("/notifications/send", { method: "post", data: payload }),

  // ---- 异步任务 / 打印任务 ----
  asyncJobs: toolsApi.asyncJobs,
  createAsyncJob: toolsApi.createAsyncJob,
  runJob: toolsApi.runJob,
  runDueJobs: toolsApi.runDueJobs,
  printJobs: toolsApi.printJobs,
  createPrintJob: toolsApi.createPrintJob,

  // ---- 基础设施 ----
  integrations: () => request<InfraDashboardResult>("/integrations/dashboard"),
  invokeMockAdapter: (payload: InvokeMockAdapterRequest) => request<AdapterLogSummary>("/integrations/adapters/mock-call", { method: "post", data: payload })
};
