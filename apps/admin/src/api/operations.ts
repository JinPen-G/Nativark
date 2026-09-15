import { http } from "./http";
import type {
  AdapterLogSummary,
  ApiResult,
  AsyncJobSummary,
  BusinessWorkspace,
  CreateBusinessWorkspaceRequest,
  CreateAsyncJobRequest,
  CreateFileAssetRequest,
  CreatePrintJobRequest,
  GeneratePlatformNumberResult,
  FileAssetSummary,
  InvokeMockAdapterRequest,
  NotificationSendLogSummary,
  NotificationTemplateSummary,
  OrganizationSummary,
  PlatformDictionaryGroup,
  PlatformFilterPreset,
  PlatformFilterPresetQuery,
  PlatformNumberRule,
  ResetUserPasswordResult,
  PrintJobSummary,
  SaveOrganizationRequest,
  SavePlatformDictionaryGroupRequest,
  SavePlatformFilterPresetRequest,
  SavePlatformNumberRuleRequest,
  SaveSystemRuleSectionRequest,
  SystemSecurityBaselineConfig,
  TenantBootstrapPreview,
  TenantBootstrapRequest,
  TenantBootstrapResult,
  SystemRulesConfig,
  TenantSummary,
  UpdateBusinessWorkspaceRequest,
  UpdateTenantRequest,
  UpdateTenantStatusRequest
} from "@rental-os/shared";

export async function saveSystemRuleSection(
  payload: SaveSystemRuleSectionRequest
) {
  const response = await http.put<ApiResult<SystemRulesConfig>>(
    `/platform/system-rules/${payload.sectionKey}`,
    {
      config: payload.config,
      operator: payload.operator
    }
  );
  return response.data.data;
}

export async function saveSecurityBaseline(
  config: SystemSecurityBaselineConfig,
  operator: string
) {
  const response = await http.put<ApiResult<SystemSecurityBaselineConfig>>(
    "/platform/security-baseline",
    { config, operator }
  );
  return response.data.data;
}

export async function checkSecondConfirmation(action: string, confirmationCode?: string) {
  const response = await http.post<
    ApiResult<{
      action: string;
      required: boolean;
      accepted: boolean;
      message: string;
    }>
  >("/platform/security-baseline/second-confirmation/check", {
    action,
    confirmationCode
  });
  return response.data.data;
}

export async function listPlatformFilterPresets(
  params: PlatformFilterPresetQuery = {}
) {
  const response = await http.get<ApiResult<PlatformFilterPreset[]>>(
    "/platform/filter-presets",
    { params }
  );
  return response.data.data;
}

export async function invokeMockAdapter(payload: InvokeMockAdapterRequest) {
  const response = await http.post<ApiResult<AdapterLogSummary>>(
    "/integrations/adapters/mock-call",
    payload
  );
  return response.data.data;
}

export async function savePlatformFilterPreset(
  payload: SavePlatformFilterPresetRequest
) {
  const response = await http.post<ApiResult<PlatformFilterPreset>>(
    "/platform/filter-presets",
    payload
  );
  return response.data.data;
}

export async function setPlatformFilterPresetDefault(
  id: string,
  operator?: string
) {
  const response = await http.put<ApiResult<PlatformFilterPreset>>(
    `/platform/filter-presets/${id}/default`,
    { operator }
  );
  return response.data.data;
}

export async function deletePlatformFilterPreset(id: string, operator?: string) {
  const response = await http.delete<ApiResult<{ id: string; deleted: boolean }>>(
    `/platform/filter-presets/${id}`,
    { params: { operator } }
  );
  return response.data.data;
}

export async function listPlatformDictionaries() {
  const response = await http.get<ApiResult<PlatformDictionaryGroup[]>>(
    "/platform/dictionaries"
  );
  return response.data.data;
}

export async function savePlatformDictionary(
  payload: SavePlatformDictionaryGroupRequest
) {
  const response = await http.put<ApiResult<PlatformDictionaryGroup>>(
    `/platform/dictionaries/${payload.code}`,
    payload
  );
  return response.data.data;
}

export async function listFileAssets() {
  const response = await http.get<ApiResult<FileAssetSummary[]>>("/files");
  return response.data.data;
}

export async function createFileAsset(payload: CreateFileAssetRequest) {
  const response = await http.post<ApiResult<FileAssetSummary>>("/files", payload);
  return response.data.data;
}

export async function listNotificationTemplates() {
  const response = await http.get<ApiResult<NotificationTemplateSummary[]>>(
    "/notifications/templates"
  );
  return response.data.data;
}

export async function listNotificationLogs() {
  const response = await http.get<ApiResult<NotificationSendLogSummary[]>>(
    "/notifications/logs"
  );
  return response.data.data;
}

export async function createAsyncJob(payload: CreateAsyncJobRequest) {
  const response = await http.post<ApiResult<AsyncJobSummary>>("/jobs", payload);
  return response.data.data;
}

export async function listAsyncJobs() {
  const response = await http.get<ApiResult<AsyncJobSummary[]>>("/jobs");
  return response.data.data;
}

export async function listPrintJobs() {
  const response = await http.get<ApiResult<PrintJobSummary[]>>("/jobs/print");
  return response.data.data;
}

export async function runAsyncJob(id: string) {
  const response = await http.post<ApiResult<AsyncJobSummary>>(`/jobs/${id}/run`);
  return response.data.data;
}

export async function runDueAsyncJobs() {
  const response = await http.post<
    ApiResult<{ ranCount: number; jobs: AsyncJobSummary[]; message: string }>
  >("/jobs/run-due");
  return response.data.data;
}

export async function createPrintJob(payload: CreatePrintJobRequest) {
  const response = await http.post<ApiResult<PrintJobSummary>>("/jobs/print", payload);
  return response.data.data;
}

export async function listPlatformNumberRules() {
  const response = await http.get<ApiResult<PlatformNumberRule[]>>(
    "/platform/number-rules"
  );
  return response.data.data;
}

export async function savePlatformNumberRule(
  payload: SavePlatformNumberRuleRequest
) {
  const response = await http.put<ApiResult<PlatformNumberRule>>(
    `/platform/number-rules/${payload.code}`,
    payload
  );
  return response.data.data;
}

export async function generatePlatformNumber(code: string, operator: string) {
  const response = await http.post<ApiResult<GeneratePlatformNumberResult>>(
    "/platform/number-rules/generate",
    { code, operator }
  );
  return response.data.data;
}

export async function getTenantBootstrapPreview() {
  const response = await http.get<ApiResult<TenantBootstrapPreview>>(
    "/platform/tenant-bootstrap/preview"
  );
  return response.data.data;
}

export async function bootstrapTenant(payload: TenantBootstrapRequest) {
  const response = await http.post<ApiResult<TenantBootstrapResult>>(
    "/platform/tenant-bootstrap",
    payload
  );
  return response.data.data;
}

export async function listTenants() {
  const response = await http.get<ApiResult<TenantSummary[]>>("/platform/tenants");
  return response.data.data;
}

export async function updateTenant(id: string, payload: UpdateTenantRequest) {
  const response = await http.put<ApiResult<TenantSummary>>(`/platform/tenants/${id}`, payload);
  return response.data.data;
}

export async function updateTenantStatus(id: string, payload: UpdateTenantStatusRequest) {
  const response = await http.put<ApiResult<TenantSummary>>(`/platform/tenants/${id}/status`, payload);
  return response.data.data;
}

export async function resetTenantAdminPassword(tenantId: string) {
  const response = await http.post<ApiResult<ResetUserPasswordResult>>(`/platform/tenants/${tenantId}/admin/reset-password`);
  return response.data.data;
}

export async function listTenantWorkspaces(tenantId: string) {
  const response = await http.get<ApiResult<BusinessWorkspace[]>>(`/platform/tenants/${tenantId}/workspaces`);
  return response.data.data;
}

export async function createTenantWorkspace(tenantId: string, payload: CreateBusinessWorkspaceRequest) {
  const response = await http.post<ApiResult<BusinessWorkspace>>(`/platform/tenants/${tenantId}/workspaces`, payload);
  return response.data.data;
}

export async function updateTenantWorkspace(tenantId: string, workspaceId: string, payload: UpdateBusinessWorkspaceRequest) {
  const response = await http.put<ApiResult<BusinessWorkspace>>(`/platform/tenants/${tenantId}/workspaces/${workspaceId}`, payload);
  return response.data.data;
}

export async function saveOrganization(payload: SaveOrganizationRequest) {
  const response = payload.id
    ? await http.put<ApiResult<OrganizationSummary>>(
        `/platform/organizations/${payload.id}`,
        payload
      )
    : await http.post<ApiResult<OrganizationSummary>>(
        "/platform/organizations",
        payload
      );
  return response.data.data;
}

export async function setOrganizationStatus(
  id: string,
  status: OrganizationSummary["status"],
  operator: string
) {
  const response = await http.put<ApiResult<OrganizationSummary>>(
    `/platform/organizations/${id}/status`,
    { status, operator }
  );
  return response.data.data;
}
