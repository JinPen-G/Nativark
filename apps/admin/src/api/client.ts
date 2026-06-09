import axios from "axios";
import type {
  AdapterLogSummary,
  ApiResult,
  AsyncJobSummary,
  AuthUser,
  BindTBoxDeviceRequest,
  CorporateContractAttachmentResult,
  CorporateDetail,
  CorporateListQuery,
  CorporateListResult,
  CorporateMonthlyBillSummary,
  CorporateSummary,
  CreateAsyncJobRequest,
  CreateCorporateContractAttachmentRequest,
  CreateDataExchangeJobRequest,
  CreateFileAssetRequest,
  CreatePriceAdjustmentScheduleRequest,
  CreatePrintJobRequest,
  GeneratePlatformNumberResult,
  CreateVehicleConditionPhotoRecordRequest,
  CreateVehicleLocationEventRequest,
  CreateVehicleAccidentRecordRequest,
  CreateVehicleMaintenanceRecordRequest,
  CreateVehicleTransferTaskRequest,
  CreateStoreRentalFeeRequest,
  CreateStoreRentalContractRequest,
  CreateStoreRentalNotificationRequest,
  CreateStoreRentalRemarkRequest,
  CreateStoreRentalOrderRequest,
  CreateStoreRentalOrderResult,
  CreateStoreRentalTransactionRequest,
  DeleteVehicleGroupResult,
  DataExchangeJobResult,
  DataExchangeTemplateSummary,
  FinanceDocumentRow,
  FinanceManualAdjustmentRow,
  FinanceOverviewMetrics,
  FinancePreAuthorizationRow,
  FinanceReconciliationRow,
  FinanceTransactionRow,
  FileAssetSummary,
  InfraDashboardResult,
  InvokeMockAdapterRequest,
  LoginRequest,
  LoginResponse,
  MarketingPlanDetail,
  MarketingPlanSummary,
  MemberDetail,
  MemberListQuery,
  MemberListResult,
  MemberReviewTask,
  MemberSummary,
  MembershipPlanSummary,
  NotificationSendLogSummary,
  NotificationTemplateSummary,
  OrganizationSummary,
  PermissionModule,
  PlatformAuditLogQuery,
  PlatformAuditResult,
  PlatformDictionaryGroup,
  PlatformFilterPreset,
  PlatformFilterPresetQuery,
  PlatformNumberRule,
  PriceAdjustmentSchedule,
  PricingPlanDetail,
  PricingPlanSummary,
  PricingQuoteRequest,
  PricingQuoteResult,
  ProcessFinanceManualAdjustmentRequest,
  ProcessMemberReviewRequest,
  ProcessMemberRiskRequest,
  PrintJobSummary,
  StoreRentalFinanceReport,
  StoreRentalOpsHealth,
  StoreRentalOpsLogRow,
  StoreRentalOrdersReport,
  StoreRentalReportDashboard,
  StoreRentalReportExportJob,
  StoreRentalReportExportRequest,
  StoreRentalReportQuery,
  StoreRentalAvailabilityRequest,
  StoreRentalAvailabilityResult,
  StoreRentalAiDispatchAnalyzeRequest,
  StoreRentalAiDispatchAnalysisResult,
  SaveCorporateRequest,
  SaveFinanceDocumentRequest,
  SaveFinanceManualAdjustmentRequest,
  SaveFinancePreAuthorizationRequest,
  SaveMarketingPlanRequest,
  SaveMemberRequest,
  SaveMembershipPlanRequest,
  SaveOrganizationRequest,
  SavePlatformDictionaryGroupRequest,
  SavePlatformFilterPresetRequest,
  SavePlatformNumberRuleRequest,
  SavePricingPlanRequest,
  SaveTBoxDeviceRequest,
  SendMockNotificationRequest,
  SaveStationCalendarDayRequest,
  SettleCorporateMonthlyBillRequest,
  SaveVehicleCredentialRequest,
  SaveVehicleOnboardItemRequest,
  SaveSystemRoleRequest,
  SaveSystemRuleSectionRequest,
  SaveSystemUserRequest,
  SystemAiConnectionTestResult,
  SystemSecurityBaselineConfig,
  StoreRentalDispatchApplyRequest,
  StoreRentalDispatchApplyResult,
  StoreRentalDispatchBoard,
  StoreRentalDispatchEvent,
  StoreRentalDispatchEventQuery,
  StoreRentalDispatchHardLockRequest,
  StoreRentalDispatchManualReassignRequest,
  StoreRentalDispatchOptimizeRequest,
  StoreRentalDispatchPlan,
  StoreRentalDispatchTaskPool,
  StoreRentalDispatchTaskQuery,
  StoreRentalDispatchCloseTaskRequest,
  StoreRentalDispatchTaskActionResult,
  StoreRentalDispatchVehicleUnavailableRequest,
  StoreRentalDispatchVehicleUnavailableResult,
  StoreRentalOrderNotificationRecord,
  StoreRentalOrderOperationRecord,
  StoreRentalFeeCenter,
  StoreRentalContractRecord,
  StoreRentalNotificationRecord,
  StoreRentalOrderActionResult,
  StoreRentalOrderDetail,
  StoreRentalOrderFulfillmentRecords,
  StoreRentalOrderRemarkRecord,
  StoreRentalOrderSummary,
  StoreRentalRuleConfig,
  StoreRentalRuleVersionRecord,
  StoreRentalVehiclesReport,
  StoreRentalVehicleDetail,
  StoreStationHierarchyNode,
  StoreStationListQuery,
  StoreStationListResult,
  StoreStationSummary,
  StoreValueAddedServiceSummary,
  StationCalendarDay,
  StationCapacityRefreshResult,
  StationCapacitySnapshot,
  StationCapacityRefreshResult,
  TenantBootstrapPreview,
  TenantBootstrapRequest,
  TenantBootstrapResult,
  SystemRoleRow,
  SystemRulesConfig,
  SystemUserRow,
  TboxCommandResult,
  TboxDeviceSummary,
  TenantSummary,
  TBoxDeviceSummary,
  UpdateVehicleAccidentRecordRequest,
  UpdateVehicleLocationEventRequest,
  UpdateVehicleMaintenanceRecordRequest,
  WaiveStoreRentalFeeRequest,
  BindTboxDeviceRequest,
  VehicleGroupMaster,
  VehicleCredentialRecord,
  VehicleInstanceSummary,
  VehicleListQuery,
  VehicleListResult,
  VehicleOnboardItemRecord,
  VehicleTransferTask,
  VehicleTransferTaskResult,
  VehicleStatusActionResult,
  UpdateVehicleStatusRequest,
  RunTboxCommandRequest,
  WorkflowTransition
} from "@rimo/shared";

const baseURL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export const http = axios.create({
  baseURL,
  timeout: 10_000
});

http.interceptors.request.use((config) => {
  const token = window.localStorage.getItem("rimo_access_token");
  const tenantRaw = window.localStorage.getItem("rimo_tenant");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (tenantRaw) {
    try {
      const tenant = JSON.parse(tenantRaw) as {
        tenantId?: string;
        tenantCode?: string;
      };
      if (tenant.tenantId) {
        config.headers["x-tenant-id"] = tenant.tenantId;
      }
      if (tenant.tenantCode) {
        config.headers["x-tenant-code"] = tenant.tenantCode;
      }
    } catch {
      window.localStorage.removeItem("rimo_tenant");
    }
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      window.localStorage.removeItem("rimo_access_token");
      window.localStorage.removeItem("rimo_tenant");
      window.localStorage.removeItem("rimo_user");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export async function login(payload: LoginRequest) {
  const response = await http.post<ApiResult<LoginResponse>>("/auth/login", payload);
  return response.data.data;
}

export async function getMe() {
  const response = await http.get<ApiResult<AuthUser>>("/auth/me");
  return response.data.data;
}

export async function getRentalRules() {
  const response = await http.get<ApiResult<StoreRentalRuleConfig>>("/store-rental/rules");
  return response.data.data;
}

export async function saveRentalRules(payload: StoreRentalRuleConfig) {
  const response = await http.put<ApiResult<StoreRentalRuleConfig>>("/store-rental/rules", payload);
  return response.data.data;
}

export async function listRentalRuleVersions() {
  const response = await http.get<ApiResult<StoreRentalRuleVersionRecord[]>>(
    "/store-rental/rules/versions"
  );
  return response.data.data;
}

export async function getRentalRuleVersion(version: string) {
  const response = await http.get<ApiResult<StoreRentalRuleVersionRecord>>(
    `/store-rental/rules/versions/${version}`
  );
  return response.data.data;
}

export async function listPricingPlans() {
  const response = await http.get<ApiResult<PricingPlanSummary[]>>("/store-rental/pricing/plans");
  return response.data.data;
}

export async function getPricingPlan(id: string) {
  const response = await http.get<ApiResult<PricingPlanDetail>>(`/store-rental/pricing/plans/${id}`);
  return response.data.data;
}

export async function savePricingPlan(id: string, payload: SavePricingPlanRequest) {
  const response = await http.put<ApiResult<PricingPlanDetail>>(`/store-rental/pricing/plans/${id}`, payload);
  return response.data.data;
}

export async function createPriceSchedule(payload: CreatePriceAdjustmentScheduleRequest) {
  const response = await http.post<ApiResult<PriceAdjustmentSchedule>>(
    "/store-rental/pricing/schedules",
    payload
  );
  return response.data.data;
}

export async function cancelPriceSchedule(id: string) {
  const response = await http.patch<ApiResult<PriceAdjustmentSchedule>>(
    `/store-rental/pricing/schedules/${id}/cancel`
  );
  return response.data.data;
}

export async function quoteStoreRental(payload: PricingQuoteRequest) {
  const response = await http.post<ApiResult<PricingQuoteResult>>("/store-rental/pricing/quote", payload);
  return response.data.data;
}

export async function listMarketingPlans() {
  const response = await http.get<ApiResult<MarketingPlanSummary[]>>("/store-rental/marketing/plans");
  return response.data.data;
}

export async function getMarketingPlan(id: string) {
  const response = await http.get<ApiResult<MarketingPlanDetail>>(`/store-rental/marketing/plans/${id}`);
  return response.data.data;
}

export async function saveMarketingPlan(payload: SaveMarketingPlanRequest) {
  const request = payload.id
    ? http.put<ApiResult<MarketingPlanDetail>>(`/store-rental/marketing/plans/${payload.id}`, payload)
    : http.post<ApiResult<MarketingPlanDetail>>("/store-rental/marketing/plans", payload);
  const response = await request;
  return response.data.data;
}

export async function checkStoreRentalAvailability(
  payload: StoreRentalAvailabilityRequest
) {
  const response = await http.post<ApiResult<StoreRentalAvailabilityResult>>(
    "/store-rental/availability",
    payload
  );
  return response.data.data;
}

export async function createStoreRentalOrder(payload: CreateStoreRentalOrderRequest) {
  const response = await http.post<ApiResult<CreateStoreRentalOrderResult>>("/store-rental/orders", payload);
  return response.data.data;
}

export async function listStoreRentalOrders() {
  const response = await http.get<ApiResult<StoreRentalOrderSummary[]>>("/store-rental/orders");
  return response.data.data;
}

export async function getStoreRentalOrder(id: string) {
  const response = await http.get<ApiResult<StoreRentalOrderDetail>>(
    `/store-rental/orders/${id}`
  );
  return response.data.data;
}

export async function getStoreRentalOrderFeeCenter(id: string) {
  const response = await http.get<ApiResult<StoreRentalFeeCenter>>(
    `/store-rental/orders/${id}/fees`
  );
  return response.data.data;
}

export async function getStoreRentalOrderFulfillment(id: string) {
  const response = await http.get<ApiResult<StoreRentalOrderFulfillmentRecords>>(
    `/store-rental/orders/${id}/fulfillment`
  );
  return response.data.data;
}

export async function createStoreRentalOrderContract(
  id: string,
  payload: CreateStoreRentalContractRequest
) {
  const response = await http.post<ApiResult<StoreRentalContractRecord>>(
    `/store-rental/orders/${id}/contracts`,
    payload
  );
  return response.data.data;
}

export async function createStoreRentalOrderNotification(
  id: string,
  payload: CreateStoreRentalNotificationRequest
) {
  const response = await http.post<ApiResult<StoreRentalNotificationRecord>>(
    `/store-rental/orders/${id}/notifications`,
    payload
  );
  return response.data.data;
}

export async function createStoreRentalOrderRemark(
  id: string,
  payload: CreateStoreRentalRemarkRequest
) {
  const response = await http.post<ApiResult<StoreRentalOrderRemarkRecord>>(
    `/store-rental/orders/${id}/remarks`,
    payload
  );
  return response.data.data;
}

export async function createStoreRentalOrderFee(
  id: string,
  payload: CreateStoreRentalFeeRequest
) {
  const response = await http.post<ApiResult<StoreRentalFeeCenter>>(
    `/store-rental/orders/${id}/fees`,
    payload
  );
  return response.data.data;
}

export async function waiveStoreRentalOrderFee(
  id: string,
  feeId: string,
  payload: WaiveStoreRentalFeeRequest
) {
  const response = await http.post<ApiResult<StoreRentalFeeCenter>>(
    `/store-rental/orders/${id}/fees/${feeId}/waive`,
    payload
  );
  return response.data.data;
}

export async function createStoreRentalOrderTransaction(
  id: string,
  payload: CreateStoreRentalTransactionRequest
) {
  const response = await http.post<ApiResult<StoreRentalFeeCenter>>(
    `/store-rental/orders/${id}/transactions`,
    payload
  );
  return response.data.data;
}

function normalizeMemberListResult(
  data: MemberListResult | MemberSummary[],
  query: MemberListQuery = {}
): MemberListResult {
  if (!Array.isArray(data)) {
    return data;
  }
  const availableTags = Array.from(
    new Set(data.flatMap((row) => row.tags.map((item) => item.trim()).filter(Boolean)))
  ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  return {
    rows: data,
    total: data.length,
    page: Number(query.page || 1),
    pageSize: Number(query.pageSize || data.length || 20),
    availableTags,
    stats: {
      total: data.length,
      active: data.filter((row) => row.status === "active").length,
      pendingReview: data.filter((row) => row.reviewStatus === "pending").length,
      blacklisted: data.filter((row) => row.status === "blacklisted").length
    }
  };
}

export async function listMemberPage(query: MemberListQuery = {}) {
  const response = await http.get<ApiResult<MemberListResult | MemberSummary[]>>(
    "/store-rental/members",
    { params: query }
  );
  return normalizeMemberListResult(response.data.data, query);
}

export async function listMembers(query: MemberListQuery = {}) {
  const result = await listMemberPage({ page: 1, pageSize: 100, ...query });
  return result.rows;
}

export async function getMemberDetail(id: string) {
  const response = await http.get<ApiResult<MemberDetail>>(`/store-rental/members/${id}`);
  return response.data.data;
}

export async function saveMember(payload: SaveMemberRequest) {
  const response = payload.id
    ? await http.put<ApiResult<MemberDetail>>(`/store-rental/members/${payload.id}`, payload)
    : await http.post<ApiResult<MemberDetail>>("/store-rental/members", payload);
  return response.data.data;
}

export async function processMemberRisk(id: string, payload: ProcessMemberRiskRequest) {
  const response = await http.post<
    ApiResult<{
      member: MemberDetail;
      affectedOrderNos: string[];
      message: string;
    }>
  >(`/store-rental/members/${id}/risk-actions`, payload);
  return response.data.data;
}

export async function listMemberReviews() {
  const response = await http.get<ApiResult<MemberReviewTask[]>>(
    "/store-rental/member-reviews"
  );
  return response.data.data;
}

export async function processMemberReview(
  id: string,
  payload: ProcessMemberReviewRequest
) {
  const response = await http.post<
    ApiResult<{ review: MemberReviewTask; member: MemberDetail }>
  >(`/store-rental/member-reviews/${id}/process`, payload);
  return response.data.data;
}

export async function listMembershipPlans() {
  const response = await http.get<ApiResult<MembershipPlanSummary[]>>(
    "/store-rental/membership-plans"
  );
  return response.data.data;
}

export async function saveMembershipPlan(payload: SaveMembershipPlanRequest) {
  const response = payload.id
    ? await http.put<ApiResult<MembershipPlanSummary>>(
        `/store-rental/membership-plans/${payload.id}`,
        payload
      )
    : await http.post<ApiResult<MembershipPlanSummary>>(
        "/store-rental/membership-plans",
        payload
      );
  return response.data.data;
}

function normalizeCorporateListResult(
  data: CorporateListResult | CorporateSummary[],
  query: CorporateListQuery = {}
): CorporateListResult {
  if (!Array.isArray(data)) {
    return data;
  }
  return {
    rows: data,
    total: data.length,
    page: Number(query.page || 1),
    pageSize: Number(query.pageSize || data.length || 20),
    stats: {
      total: data.length,
      active: data.filter((row) => row.status === "active").length,
      paused: data.filter((row) => row.status === "paused").length,
      disabled: data.filter((row) => row.status === "disabled").length,
      expiringContracts: data.filter((row) => row.contractStatus === "expiring").length,
      expiredContracts: data.filter((row) => row.contractStatus === "expired").length
    }
  };
}

export async function listCorporatePage(query: CorporateListQuery = {}) {
  const response = await http.get<ApiResult<CorporateListResult | CorporateSummary[]>>(
    "/store-rental/corporates",
    { params: query }
  );
  return normalizeCorporateListResult(response.data.data, query);
}

export async function listCorporates(query: CorporateListQuery = {}) {
  const result = await listCorporatePage({ page: 1, pageSize: 100, ...query });
  return result.rows;
}

export async function getCorporateDetail(id: string) {
  const response = await http.get<ApiResult<CorporateDetail>>(
    `/store-rental/corporates/${id}`
  );
  return response.data.data;
}

export async function saveCorporate(payload: SaveCorporateRequest) {
  const response = payload.id
    ? await http.put<ApiResult<CorporateDetail>>(
        `/store-rental/corporates/${payload.id}`,
        payload
      )
    : await http.post<ApiResult<CorporateDetail>>("/store-rental/corporates", payload);
  return response.data.data;
}

export async function listCorporateMonthlyBills(id: string) {
  const response = await http.get<ApiResult<CorporateMonthlyBillSummary[]>>(
    `/store-rental/corporates/${id}/monthly-bills`
  );
  return response.data.data;
}

export async function settleCorporateMonthlyBill(
  corporateId: string,
  billId: string,
  payload: SettleCorporateMonthlyBillRequest
) {
  const response = await http.post<ApiResult<CorporateMonthlyBillSummary>>(
    `/store-rental/corporates/${corporateId}/monthly-bills/${billId}/settle`,
    payload
  );
  return response.data.data;
}

export async function getFinanceOverview() {
  const response = await http.get<ApiResult<FinanceOverviewMetrics>>(
    "/store-rental/finance/overview"
  );
  return response.data.data;
}

export async function listFinanceTransactions() {
  const response = await http.get<ApiResult<FinanceTransactionRow[]>>(
    "/store-rental/finance/transactions"
  );
  return response.data.data;
}

export async function listFinanceDocuments() {
  const response = await http.get<ApiResult<FinanceDocumentRow[]>>(
    "/store-rental/finance/documents"
  );
  return response.data.data;
}

export async function saveFinanceDocument(payload: SaveFinanceDocumentRequest) {
  const response = payload.id
    ? await http.put<ApiResult<FinanceDocumentRow>>(
        `/store-rental/finance/documents/${payload.id}`,
        payload
      )
    : await http.post<ApiResult<FinanceDocumentRow>>(
        "/store-rental/finance/documents",
        payload
      );
  return response.data.data;
}

export async function listFinancePreAuthorizations() {
  const response = await http.get<ApiResult<FinancePreAuthorizationRow[]>>(
    "/store-rental/finance/pre-authorizations"
  );
  return response.data.data;
}

export async function saveFinancePreAuthorization(
  payload: SaveFinancePreAuthorizationRequest
) {
  const response = payload.id
    ? await http.put<ApiResult<FinancePreAuthorizationRow>>(
        `/store-rental/finance/pre-authorizations/${payload.id}`,
        payload
      )
    : await http.post<ApiResult<FinancePreAuthorizationRow>>(
        "/store-rental/finance/pre-authorizations",
        payload
      );
  return response.data.data;
}

export async function listFinanceManualAdjustments() {
  const response = await http.get<ApiResult<FinanceManualAdjustmentRow[]>>(
    "/store-rental/finance/manual-adjustments"
  );
  return response.data.data;
}

export async function createFinanceManualAdjustment(
  payload: SaveFinanceManualAdjustmentRequest
) {
  const response = await http.post<ApiResult<FinanceManualAdjustmentRow>>(
    "/store-rental/finance/manual-adjustments",
    payload
  );
  return response.data.data;
}

export async function processFinanceManualAdjustment(
  id: string,
  payload: ProcessFinanceManualAdjustmentRequest
) {
  const response = await http.post<ApiResult<FinanceManualAdjustmentRow>>(
    `/store-rental/finance/manual-adjustments/${id}/process`,
    payload
  );
  return response.data.data;
}

export async function listFinanceReconciliationRows() {
  const response = await http.get<ApiResult<FinanceReconciliationRow[]>>(
    "/store-rental/finance/reconciliation"
  );
  return response.data.data;
}

export async function runStoreRentalOrderAction(
  id: string,
  action: string,
  payload: Record<string, unknown>
) {
  const response = await http.post<ApiResult<StoreRentalOrderActionResult>>(
    `/store-rental/orders/${id}/actions/${action}`,
    payload
  );
  return response.data.data;
}

export async function getWorkflow() {
  const response = await http.get<ApiResult<WorkflowTransition[]>>("/store-rental/workflow");
  return response.data.data;
}

export async function getDispatchBoard(params: Partial<StoreRentalDispatchOptimizeRequest> = {}) {
  const response = await http.get<ApiResult<StoreRentalDispatchBoard>>(
    "/store-rental/dispatch/board",
    { params }
  );
  return response.data.data;
}

export async function getDispatchTasks(params: StoreRentalDispatchTaskQuery = {}) {
  const response = await http.get<ApiResult<StoreRentalDispatchTaskPool>>(
    "/store-rental/dispatch/tasks",
    { params }
  );
  return response.data.data;
}

export async function closeDispatchTask(payload: StoreRentalDispatchCloseTaskRequest) {
  const response = await http.post<ApiResult<StoreRentalDispatchTaskActionResult>>(
    "/store-rental/dispatch/tasks/close",
    payload
  );
  return response.data.data;
}

export async function getOrderOperationRecords(id: string) {
  const response = await http.get<ApiResult<StoreRentalOrderOperationRecord[]>>(
    `/store-rental/orders/${id}/operation-records`
  );
  return response.data.data;
}

export async function getOrderNotifications(id: string) {
  const response = await http.get<ApiResult<StoreRentalOrderNotificationRecord[]>>(
    `/store-rental/orders/${id}/notifications`
  );
  return response.data.data;
}

export async function getDispatchEvents(params: StoreRentalDispatchEventQuery = {}) {
  const response = await http.get<ApiResult<StoreRentalDispatchEvent[]>>(
    "/store-rental/dispatch/events",
    { params }
  );
  return response.data.data;
}

export async function previewDispatchOptimization(
  payload: StoreRentalDispatchOptimizeRequest
) {
  const response = await http.post<ApiResult<StoreRentalDispatchPlan>>(
    "/store-rental/dispatch/optimize",
    payload
  );
  return response.data.data;
}

export async function applyDispatchOptimization(
  payload: StoreRentalDispatchApplyRequest
) {
  const response = await http.post<ApiResult<StoreRentalDispatchApplyResult>>(
    "/store-rental/dispatch/apply",
    payload
  );
  return response.data.data;
}

export async function hardLockDispatchOrders(
  payload: StoreRentalDispatchHardLockRequest
) {
  const response = await http.post<ApiResult<StoreRentalDispatchApplyResult>>(
    "/store-rental/dispatch/hard-lock",
    payload
  );
  return response.data.data;
}

export async function manualReassignFromDispatch(
  payload: StoreRentalDispatchManualReassignRequest
) {
  const response = await http.post<ApiResult<StoreRentalOrderActionResult>>(
    "/store-rental/dispatch/manual-reassign",
    payload
  );
  return response.data.data;
}

export async function processDispatchVehicleUnavailable(
  payload: StoreRentalDispatchVehicleUnavailableRequest
) {
  const response = await http.post<
    ApiResult<StoreRentalDispatchVehicleUnavailableResult>
  >("/store-rental/dispatch/vehicle-unavailable", payload);
  return response.data.data;
}

export async function analyzeDispatchWithAi(payload: StoreRentalAiDispatchAnalyzeRequest) {
  const response = await http.post<ApiResult<StoreRentalAiDispatchAnalysisResult>>(
    "/store-rental/dispatch/ai-analysis",
    payload
  );
  return response.data.data;
}

export async function getPermissionTree() {
  const response = await http.get<ApiResult<PermissionModule[]>>(
    "/platform/permission-tree"
  );
  return response.data.data;
}

export async function getSystemRules() {
  const response = await http.get<ApiResult<SystemRulesConfig>>(
    "/platform/system-rules"
  );
  return response.data.data;
}

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

export async function testSystemAiConnection(operator: string) {
  const response = await http.post<ApiResult<SystemAiConnectionTestResult>>(
    "/platform/system-rules/ai-test",
    { operator }
  );
  return response.data.data;
}

export async function getSecurityBaseline() {
  const response = await http.get<ApiResult<SystemSecurityBaselineConfig>>(
    "/platform/security-baseline"
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

export async function listPlatformAuditLogs(params: PlatformAuditLogQuery = {}) {
  const response = await http.get<ApiResult<PlatformAuditResult>>(
    "/platform/audit-logs",
    { params }
  );
  return response.data.data;
}

export async function getInfraDashboard() {
  const response = await http.get<ApiResult<InfraDashboardResult>>(
    "/integrations/dashboard"
  );
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

export async function listDataExchangeTemplates() {
  const response = await http.get<ApiResult<DataExchangeTemplateSummary[]>>(
    "/integrations/data-exchange/templates"
  );
  return response.data.data;
}

export async function createDataExchangeJob(payload: CreateDataExchangeJobRequest) {
  const response = await http.post<ApiResult<DataExchangeJobResult>>(
    "/integrations/data-exchange/jobs",
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

export async function createCorporateContractAttachment(
  corporateId: string,
  contractId: string,
  payload: CreateCorporateContractAttachmentRequest
) {
  const response = await http.post<ApiResult<CorporateContractAttachmentResult>>(
    `/store-rental/corporates/${corporateId}/contracts/${contractId}/attachments`,
    payload
  );
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

export async function sendMockNotification(payload: SendMockNotificationRequest) {
  const response = await http.post<ApiResult<NotificationSendLogSummary>>(
    "/notifications/send",
    payload
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

export async function saveTBoxDevice(payload: SaveTBoxDeviceRequest) {
  const response = payload.id
    ? await http.put<ApiResult<TBoxDeviceSummary>>(
        `/integrations/tbox-devices/${payload.id}`,
        payload
      )
    : await http.post<ApiResult<TBoxDeviceSummary>>(
        "/integrations/tbox-devices",
        payload
      );
  return response.data.data;
}

export async function bindTBoxDevice(
  id: string,
  payload: BindTBoxDeviceRequest
) {
  const response = await http.post<ApiResult<TBoxDeviceSummary>>(
    `/integrations/tbox-devices/${id}/bind`,
    payload
  );
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

export async function getRoles() {
  const response = await http.get<ApiResult<SystemRoleRow[]>>("/platform/roles");
  return response.data.data;
}

export async function saveRolePermissions(id: string, permissions: string[]) {
  const response = await http.put<ApiResult<SystemRoleRow>>(
    `/platform/roles/${id}/permissions`,
    { permissions }
  );
  return response.data.data;
}

export async function saveSystemRole(payload: SaveSystemRoleRequest) {
  const response = payload.id
    ? await http.put<ApiResult<SystemRoleRow>>(`/platform/roles/${payload.id}`, payload)
    : await http.post<ApiResult<SystemRoleRow>>("/platform/roles", payload);
  return response.data.data;
}

export async function deleteSystemRole(id: string) {
  const response = await http.delete<ApiResult<{ id: string; deleted: boolean }>>(
    `/platform/roles/${id}`
  );
  return response.data.data;
}

export async function listTenants() {
  const response = await http.get<ApiResult<TenantSummary[]>>("/platform/tenants");
  return response.data.data;
}

export async function listOrganizations(tenantId?: string) {
  const response = await http.get<ApiResult<OrganizationSummary[]>>(
    "/platform/organizations",
    { params: { tenantId } }
  );
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

export async function listSystemUsers(tenantId?: string) {
  const response = await http.get<ApiResult<SystemUserRow[]>>("/platform/users", {
    params: { tenantId }
  });
  return response.data.data;
}

export async function saveSystemUser(payload: SaveSystemUserRequest) {
  const response = payload.id
    ? await http.put<ApiResult<SystemUserRow>>(`/platform/users/${payload.id}`, payload)
    : await http.post<ApiResult<SystemUserRow>>("/platform/users", payload);
  return response.data.data;
}

export async function setSystemUserStatus(id: string, isActive: boolean) {
  const response = await http.put<ApiResult<SystemUserRow>>(
    `/platform/users/${id}/status`,
    { isActive }
  );
  return response.data.data;
}

export async function resetSystemUserPassword(id: string) {
  const response = await http.post<
    ApiResult<{
      userId: string;
      account: string;
      temporaryPassword: string;
      message: string;
    }>
  >(`/platform/users/${id}/reset-password`);
  return response.data.data;
}

export async function getStoreRentalReportDashboard(
  params: StoreRentalReportQuery = {}
) {
  const response = await http.get<ApiResult<StoreRentalReportDashboard>>(
    "/reports/dashboard",
    { params }
  );
  return response.data.data;
}

export async function getStoreRentalOrdersReport(
  params: StoreRentalReportQuery = {}
) {
  const response = await http.get<ApiResult<StoreRentalOrdersReport>>(
    "/reports/orders",
    { params }
  );
  return response.data.data;
}

export async function getStoreRentalVehiclesReport(
  params: StoreRentalReportQuery = {}
) {
  const response = await http.get<ApiResult<StoreRentalVehiclesReport>>(
    "/reports/vehicles",
    { params }
  );
  return response.data.data;
}

export async function getStoreRentalFinanceReport(
  params: StoreRentalReportQuery = {}
) {
  const response = await http.get<ApiResult<StoreRentalFinanceReport>>(
    "/reports/finance",
    { params }
  );
  return response.data.data;
}

export async function createStoreRentalReportExport(
  payload: StoreRentalReportExportRequest
) {
  const response = await http.post<ApiResult<StoreRentalReportExportJob>>(
    "/reports/exports",
    payload
  );
  return response.data.data;
}

export async function listStoreRentalReportExports(
  params: StoreRentalReportQuery = {}
) {
  const response = await http.get<ApiResult<StoreRentalReportExportJob[]>>(
    "/reports/exports",
    { params }
  );
  return response.data.data;
}

export async function getStoreRentalOpsHealth(params: StoreRentalReportQuery = {}) {
  const response = await http.get<ApiResult<StoreRentalOpsHealth>>(
    "/reports/ops/health",
    { params }
  );
  return response.data.data;
}

export async function listStoreRentalOpsLogs(params: StoreRentalReportQuery = {}) {
  const response = await http.get<ApiResult<StoreRentalOpsLogRow[]>>(
    "/reports/ops/logs",
    { params }
  );
  return response.data.data;
}

function normalizeStationListResult(
  data: StoreStationListResult | StoreStationSummary[],
  query: StoreStationListQuery = {}
): StoreStationListResult {
  if (!Array.isArray(data)) {
    return data;
  }
  return {
    rows: data,
    total: data.length,
    page: Number(query.page || 1),
    pageSize: Number(query.pageSize || data.length || 20),
    stats: {
      total: data.length,
      enabled: data.filter((row) => row.status === "enabled").length,
      disabled: data.filter((row) => row.status === "disabled").length,
      normal: data.filter((row) => row.serviceStatus === "normal").length,
      paused: data.filter((row) => row.serviceStatus === "paused").length,
      maintenance: data.filter((row) => row.serviceStatus === "maintenance").length
    }
  };
}

export async function listStationPage(query: StoreStationListQuery = {}) {
  const response = await http.get<ApiResult<StoreStationListResult | StoreStationSummary[]>>(
    "/store-rental/stations",
    { params: query }
  );
  return normalizeStationListResult(response.data.data, query);
}

export async function listStations() {
  const response = await http.get<ApiResult<StoreStationListResult | StoreStationSummary[]>>(
    "/store-rental/stations"
  );
  return normalizeStationListResult(response.data.data).rows;
}

export async function listStationHierarchy() {
  const response = await http.get<ApiResult<StoreStationHierarchyNode[]>>(
    "/store-rental/stations/hierarchy"
  );
  return response.data.data;
}

export async function saveStation(payload: StoreStationSummary) {
  const response = payload.id
    ? await http.put<ApiResult<StoreStationSummary>>(
        `/store-rental/stations/${payload.id}`,
        payload
      )
    : await http.post<ApiResult<StoreStationSummary>>("/store-rental/stations", payload);
  return response.data.data;
}

export async function listStationCalendar(stationId: string) {
  const response = await http.get<ApiResult<StationCalendarDay[]>>(
    `/store-rental/stations/${stationId}/calendar`
  );
  return response.data.data;
}

export async function saveStationCalendarDay(
  stationId: string,
  payload: SaveStationCalendarDayRequest
) {
  const response = await http.put<ApiResult<StationCalendarDay[]>>(
    `/store-rental/stations/${stationId}/calendar`,
    payload
  );
  return response.data.data;
}

export async function listStationCapacitySnapshots(stationId?: string) {
  const response = await http.get<ApiResult<StationCapacitySnapshot[]>>(
    "/store-rental/stations/capacity-snapshots",
    { params: { stationId } }
  );
  return response.data.data;
}

export async function refreshStationCapacitySnapshots(stationId?: string) {
  const response = await http.post<ApiResult<StationCapacityRefreshResult>>(
    "/store-rental/stations/capacity-snapshots/refresh",
    undefined,
    { params: { stationId } }
  );
  return response.data.data;
}

export async function listVehicleGroups() {
  const response = await http.get<ApiResult<VehicleGroupMaster[]>>("/store-rental/vehicle-groups");
  return response.data.data;
}

export async function saveVehicleGroup(payload: VehicleGroupMaster) {
  const response = payload.id
    ? await http.put<ApiResult<VehicleGroupMaster>>(
        `/store-rental/vehicle-groups/${payload.id}`,
        payload
      )
    : await http.post<ApiResult<VehicleGroupMaster>>(
        "/store-rental/vehicle-groups",
        payload
      );
  return response.data.data;
}

export async function deleteVehicleGroup(id: string) {
  const response = await http.delete<ApiResult<DeleteVehicleGroupResult>>(
    `/store-rental/vehicle-groups/${id}`
  );
  return response.data.data;
}

function normalizeVehicleListResult(
  data: VehicleListResult | VehicleInstanceSummary[],
  query: VehicleListQuery = {}
): VehicleListResult {
  if (!Array.isArray(data)) {
    return data;
  }
  const availableStores = Array.from(
    new Set(data.map((row) => row.currentStoreName.trim()).filter(Boolean))
  ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  const availableStations = Array.from(
    new Set(data.map((row) => row.currentStationName.trim()).filter(Boolean))
  ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  return {
    rows: data,
    total: data.length,
    page: Number(query.page || 1),
    pageSize: Number(query.pageSize || data.length || 20),
    availableStores,
    availableStations,
    stats: {
      total: data.length,
      idle: data.filter((row) => row.operationStatus === "idle").length,
      reserved: data.filter((row) => row.operationStatus === "reserved").length,
      renting: data.filter((row) => row.operationStatus === "renting").length,
      controlled: data.filter((row) => row.operationStatus === "controlled").length,
      maintenance: data.filter((row) => row.operationStatus === "maintenance").length,
      disabled: data.filter((row) => row.operationStatus === "disabled").length
    }
  };
}

export async function listVehiclePage(query: VehicleListQuery = {}) {
  const response = await http.get<ApiResult<VehicleListResult | VehicleInstanceSummary[]>>(
    "/store-rental/vehicles",
    { params: query }
  );
  return normalizeVehicleListResult(response.data.data, query);
}

export async function listVehicles() {
  const response = await http.get<ApiResult<VehicleListResult | VehicleInstanceSummary[]>>(
    "/store-rental/vehicles"
  );
  return normalizeVehicleListResult(response.data.data).rows;
}

export async function listVehicleTransferTasks() {
  const response = await http.get<ApiResult<VehicleTransferTask[]>>(
    "/store-rental/vehicles/transfer-tasks"
  );
  return response.data.data;
}

export async function createVehicleTransferTask(
  payload: CreateVehicleTransferTaskRequest
) {
  const response = await http.post<ApiResult<VehicleTransferTaskResult>>(
    "/store-rental/vehicles/transfer-tasks",
    payload
  );
  return response.data.data;
}

export async function getVehicleDetail(id: string) {
  const response = await http.get<ApiResult<StoreRentalVehicleDetail>>(
    `/store-rental/vehicles/${id}`
  );
  return response.data.data;
}

export async function createVehicleLocationEvent(
  id: string,
  payload: CreateVehicleLocationEventRequest
) {
  const response = await http.post<ApiResult<StoreRentalVehicleDetail>>(
    `/store-rental/vehicles/${id}/location-events`,
    payload
  );
  return response.data.data;
}

export async function updateVehicleLocationEvent(
  id: string,
  recordId: string,
  payload: UpdateVehicleLocationEventRequest
) {
  const response = await http.patch<ApiResult<StoreRentalVehicleDetail>>(
    `/store-rental/vehicles/${id}/location-events/${recordId}`,
    payload
  );
  return response.data.data;
}

export async function createVehicleConditionPhotoRecord(
  id: string,
  payload: CreateVehicleConditionPhotoRecordRequest
) {
  const response = await http.post<ApiResult<StoreRentalVehicleDetail>>(
    `/store-rental/vehicles/${id}/condition-photos`,
    payload
  );
  return response.data.data;
}

export async function createVehicleMaintenanceRecord(
  id: string,
  payload: CreateVehicleMaintenanceRecordRequest
) {
  const response = await http.post<ApiResult<StoreRentalVehicleDetail>>(
    `/store-rental/vehicles/${id}/maintenance-records`,
    payload
  );
  return response.data.data;
}

export async function listVehicleCredentials(id: string) {
  const response = await http.get<ApiResult<VehicleCredentialRecord[]>>(
    `/store-rental/vehicles/${id}/credentials`
  );
  return response.data.data;
}

export async function saveVehicleCredential(
  id: string,
  payload: SaveVehicleCredentialRequest
) {
  const response = await http.put<ApiResult<VehicleCredentialRecord[]>>(
    `/store-rental/vehicles/${id}/credentials`,
    payload
  );
  return response.data.data;
}

export async function listVehicleOnboardItems(id: string) {
  const response = await http.get<ApiResult<VehicleOnboardItemRecord[]>>(
    `/store-rental/vehicles/${id}/onboard-items`
  );
  return response.data.data;
}

export async function saveVehicleOnboardItem(
  id: string,
  payload: SaveVehicleOnboardItemRequest
) {
  const response = await http.put<ApiResult<VehicleOnboardItemRecord[]>>(
    `/store-rental/vehicles/${id}/onboard-items`,
    payload
  );
  return response.data.data;
}

export async function createVehicleAccidentRecord(
  id: string,
  payload: CreateVehicleAccidentRecordRequest
) {
  const response = await http.post<ApiResult<StoreRentalVehicleDetail>>(
    `/store-rental/vehicles/${id}/accident-records`,
    payload
  );
  return response.data.data;
}

export async function updateVehicleMaintenanceRecord(
  id: string,
  recordId: string,
  payload: UpdateVehicleMaintenanceRecordRequest
) {
  const response = await http.patch<ApiResult<StoreRentalVehicleDetail>>(
    `/store-rental/vehicles/${id}/maintenance-records/${recordId}`,
    payload
  );
  return response.data.data;
}

export async function updateVehicleAccidentRecord(
  id: string,
  recordId: string,
  payload: UpdateVehicleAccidentRecordRequest
) {
  const response = await http.patch<ApiResult<StoreRentalVehicleDetail>>(
    `/store-rental/vehicles/${id}/accident-records/${recordId}`,
    payload
  );
  return response.data.data;
}

export async function saveVehicle(payload: VehicleInstanceSummary) {
  const response = payload.id
    ? await http.put<ApiResult<VehicleInstanceSummary>>(
        `/store-rental/vehicles/${payload.id}`,
        payload
      )
    : await http.post<ApiResult<VehicleInstanceSummary>>("/store-rental/vehicles", payload);
  return response.data.data;
}

export async function updateVehicleStatus(
  id: string,
  payload: UpdateVehicleStatusRequest
) {
  const response = await http.patch<ApiResult<VehicleStatusActionResult>>(
    `/store-rental/vehicles/${id}/status`,
    payload
  );
  return response.data.data;
}

export async function listTboxDevices() {
  const response = await http.get<ApiResult<TboxDeviceSummary[]>>(
    "/store-rental/tbox-devices"
  );
  return response.data.data;
}

export async function bindTboxDevice(
  id: string,
  payload: BindTboxDeviceRequest
) {
  const response = await http.put<ApiResult<TboxDeviceSummary>>(
    `/store-rental/tbox-devices/${id}/binding`,
    payload
  );
  return response.data.data;
}

export async function runTboxCommand(
  id: string,
  payload: RunTboxCommandRequest
) {
  const response = await http.post<ApiResult<TboxCommandResult>>(
    `/store-rental/tbox-devices/${id}/commands`,
    payload
  );
  return response.data.data;
}

export async function listValueAddedServices() {
  const response = await http.get<ApiResult<StoreValueAddedServiceSummary[]>>("/store-rental/value-added-services");
  return response.data.data;
}

export async function saveValueAddedService(payload: StoreValueAddedServiceSummary) {
  const response = payload.id
    ? await http.put<ApiResult<StoreValueAddedServiceSummary>>(
        `/store-rental/value-added-services/${payload.id}`,
        payload
      )
    : await http.post<ApiResult<StoreValueAddedServiceSummary>>(
        "/store-rental/value-added-services",
        payload
      );
  return response.data.data;
}
