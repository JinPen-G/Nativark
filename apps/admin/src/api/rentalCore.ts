/**
 * 门市租赁核心业务 API（`/rental/v1/*`）：品类与能力、商品与资产、库存、定价与优惠、
 * 日历与规则版本、订单全流程、验机、工单、通知与报表。均按当前会话的经营空间作用。
 */
import type {
  TenantReadinessStatus,
  BookingMemberOption,
  CustomerMembershipBookingOption,
  CustomerProfileAddress,
  CreateRentalInspectionRequest,
  CorrectRentalInspectionUsageRequest,
  ManageRentalAllocationRequest,
  RentalAllocationCandidates,
  ApiResult,
  CreateRentalOrderRequest,
  PartialReturnRentalOrderRequest,
  RentalAsset,
  RentalAssetStatusHistory,
  RentalCategoryDefinition,
  RentalCalendarOverrideAudit,
  RentalCalendarPublishPreview,
  RentalCalendarVersionSummary,
  RentalCalendarYear,
  RentalCalendarTimePriceDay,
  RentalCouponTemplate,
  RentalCurrency,
  RentalCustomerBenefitAccount,
  RentalCustomerCoupon,
  RentalDiscountPlan,
  RentalFulfillmentLocation,
  RentalFulfillmentOperator,
  RentalFundingBalance,
  RentalFundingEvent,
  RentalFundingFailureRequest,
  RentalFundingAmountRequest,
  RentalFundingReleaseRequest,
  RefundRentalServiceRequest,
  InitiateRentalFundingRequest,
  RentalInspectionRecord,
  RentalInspectionTemplate,
  ReviewRentalInspectionExceptionRequest,
  AdjustRentalInspectionExceptionRequest,
  RecordRentalInspectionExceptionCustomerResponseRequest,
  ReviewRentalOrderFeeReviewRequest,
  RentalItemGroup,
  RentalOrder,
  RentalDeliveryAddressSnapshot,
  RentalOrderListQuery,
  RentalOrderPage,
  ApplyRentalOrderChangeRequest,
  RentalOrderChange,
  RentalOrderChangePreview,
  PreviewRentalOrderChangeRequest,
  RentalOrderServiceOccurrence,
  RentalOrderExtension,
  RentalOrderExtensionPreview,
  RentalOrderExtensionRequest,
  RentalNotificationSendLogV1,
  RentalNotificationTemplateV1,
  RentalPricingPlanV1,
  RentalPricingGroup,
  RentalPriceAdjustmentPlan,
  RentalPriceAdjustmentPreviewRow,
  RentalPriceVersion,
  RentalQuoteRequest,
  RentalQuoteSnapshotV1,
  RentalRewardLedgerEntry,
  RentalRuleVersion,
  RentalRuleVersionAudit,
  RentalRulePublishPreview,
  PublishRentalRuleVersionRequest,
  RentalStockBalance,
  RentalStockLedgerEntry,
  RentalStockOperationRequest,
  RentalStockOperationResult,
  RentalStockDisposition,
  RentalWorkOrder,
  RentalWorkOrderAssignee,
  RentalWorkOrderHistoryEntry,
  CreateRentalWorkOrderRequest,
  AssignRentalWorkOrderRequest,
  CancelRentalWorkOrderRequest,
  SubmitRentalWorkOrderRequest,
  ReviewRentalWorkOrderRequest,
  RentalValueAddedService,
  RentalWorkspaceOperationReport,
  RentalWorkspaceReportFilter,
  RentalWorkbenchTodos,
  PaymentReconciliationSummary,
  PaymentStatementBatchDetail,
  PaymentStatementBatchSummary,
  ReviewPaymentStatementLineRequest,
  RentalServiceCapacity,
  SaveWorkspaceCapabilityRequest,
  UpgradeWorkspaceCapabilityRequest,
  WorkspaceCapabilityAuditEvent,
  WorkspaceCapabilityInstance,
  WorkspaceCapabilityOverview,
  GrantRentalRewardRequest,
  ApplyOfficialCalendarSourceRequest,
  OfficialCalendarSourceVersionSummary,
  PublishRentalCalendarRequest,
  VoidRentalCalendarRequest,
  RemoveRentalCalendarDayOverrideRequest,
  RestoreRentalCalendarVersionRequest,
  RestoreRentalPriceVersionRequest,
  SaveRentalCalendarDayRequest,
  PreviewRentalCalendarRangeOverrideRequest,
  ApplyRentalCalendarRangeOverrideRequest,
  ApplyRentalCalendarRangeOverrideResult,
  RentalCalendarRangeOverridePreview,
  PreviewRentalCalendarRangeRemoveRequest,
  ApplyRentalCalendarRangeRemoveRequest,
  ApplyRentalCalendarRangeRemoveResult,
  RentalCalendarRangeRemovePreview,
  CancelRentalPriceAdjustmentRequest,
  CreateRentalPriceAdjustmentRequest,
  SaveRentalDiscountPlanRequest,
  SaveRentalNotificationTemplateRequest,
  SaveRentalRuleVersionRequest,
  SaveRentalValueAddedServiceRequest,
  SaveRentalServiceCapacityRequest,
  UpdateRentalServiceOccurrenceRequest,
  SendRentalNotificationRequest,
  SaveRentalAssetRequest,
  SaveRentalCouponTemplateRequest,
  SaveRentalFulfillmentLocationRequest,
  SaveRentalFulfillmentOperatorRequest,
  SaveRentalItemGroupRequest,
  SaveRentalPricingGroupRequest,
  UpdateRentalPricingGroupSecurityRatesRequest,
  SaveTenantRentalBusinessSettingsRequest,
  TenantRentalBusinessSettings,
  TenantRentalProfile,
  SubstituteRentalBundleComponentRequest,
  RentalCarrierShipmentEvent,
  CreateRentalCarrierShipmentEventRequest,
  FileUploadSessionSummary,
  FileDownloadUrlSummary
} from "@rental-os/shared";
import { useQuery } from "@tanstack/react-query";
import { http, request, requestText } from "./http";

export const rentalCoreApi = {
  categories: () => request<RentalCategoryDefinition[]>("/rental/v1/categories"),
  bookingMembers: () => request<BookingMemberOption[]>("/rental/v1/booking-members"),
  bookingOptions: (customerId: string) => request<CustomerMembershipBookingOption[]>(`/rental/v1/booking-members/${encodeURIComponent(customerId)}/booking-options`),
  bookingDeliveryAddresses: (customerId: string) => request<CustomerProfileAddress[]>(`/rental/v1/booking-members/${encodeURIComponent(customerId)}/delivery-addresses`),
  /**
   * REPORT-01A：当前经营空间经营报表。
   *
   * 刻意不接受 workspaceId：空间一律由服务端按会话解析。
   * 让页面传空间等于允许查自己无权进入的空间的经营数据。
   */
  operationReport: (params?: RentalWorkspaceReportFilter) =>
    request<RentalWorkspaceOperationReport>("/rental/v1/reports/operations", { params }),
  workbenchTodos: () => request<RentalWorkbenchTodos>("/rental/v1/workbench/todos"),
  reconcilePayments: (limit = 50) => request<PaymentReconciliationSummary>(`/rental/v1/payment-reconciliation?limit=${limit}`, { method: "post" }),
  paymentStatementBatches: (limit = 50) => request<PaymentStatementBatchSummary[]>(`/rental/v1/payment-reconciliation/statements?limit=${limit}`),
  paymentStatementBatch: (batchId: string) => request<PaymentStatementBatchDetail>(`/rental/v1/payment-reconciliation/statements/${batchId}`),
  importPaymentStatement: (provider: string, file: File) => {
    const data = new FormData();
    data.append("provider", provider);
    data.append("file", file);
    return request<PaymentStatementBatchDetail>("/rental/v1/payment-reconciliation/statements", { method: "post", data });
  },
  reviewPaymentStatementLine: (batchId: string, lineId: string, data: ReviewPaymentStatementLineRequest) =>
    request<PaymentStatementBatchDetail>(`/rental/v1/payment-reconciliation/statements/${batchId}/lines/${lineId}/review`, { method: "post", data }),
  /**
   * REPORT-01B：导出当前经营空间报表（CSV）。
   *
   * 走原始文本请求而不是 `request()`：后者会剥掉 `{ data }` 信封，
   * 而 CSV 本身就不是信封结构。同样不接受 workspaceId——空间取自会话。
   */
  exportOperationReport: (params?: RentalWorkspaceReportFilter) =>
    requestText("/rental/v1/reports/operations/export", params),
  profile: () => request<TenantRentalProfile>("/rental/v1/tenant-profile"),
  /** TENANT-READY-01：当前空间开业配置状态（服务端权威判定）。 */
  tenantReadiness: () => request<TenantReadinessStatus>("/rental/v1/tenant-readiness"),
  businessSettings: () => request<TenantRentalBusinessSettings>("/rental/v1/business-settings"),
  saveBusinessSettings: (data: SaveTenantRentalBusinessSettingsRequest) => request<TenantRentalBusinessSettings>("/rental/v1/business-settings", { method: "put", data }),
  couponTemplates: () => request<RentalCouponTemplate[]>("/rental/v1/coupon-templates"),
  saveCouponTemplate: (data: SaveRentalCouponTemplateRequest) => request<RentalCouponTemplate>(data.id ? `/rental/v1/coupon-templates/${data.id}` : "/rental/v1/coupon-templates", { method: data.id ? "put" : "post", data }),
  pricingPlans: () => request<RentalPricingPlanV1[]>("/rental/v1/pricing-plans"),
  /** PRICE-03：空间级不可变版本，不按计划拆分。 */
  priceVersions: (page?: number, pageSize?: number) => request<{ total: number; rows: Array<RentalPriceVersion & { rateCount: number }> }>("/rental/v1/pricing-versions", { params: { page, pageSize } }),
  priceVersion: (sequence: number) => request<RentalPriceVersion>(`/rental/v1/pricing-versions/${sequence}`),
  restorePriceVersion: (sequence: number, data: RestoreRentalPriceVersionRequest) => request<{ id: string; sequence: number; version: string; restoredFromVersion: string }>(`/rental/v1/pricing-versions/${sequence}/restore`, { method: "post", data }),
  priceAdjustments: () => request<RentalPriceAdjustmentPlan[]>("/rental/v1/pricing-adjustments"),
  createPriceAdjustment: (data: CreateRentalPriceAdjustmentRequest) => request<{ id: string; code: string; name: string; status: string; preview: RentalPriceAdjustmentPreviewRow[] }>("/rental/v1/pricing-adjustments", { method: "post", data }),
  confirmPriceAdjustment: (adjustmentId: string) => request<unknown>(`/rental/v1/pricing-adjustments/${adjustmentId}/confirm`, { method: "post" }),
  cancelPriceAdjustment: (adjustmentId: string, data: CancelRentalPriceAdjustmentRequest) => request<unknown>(`/rental/v1/pricing-adjustments/${adjustmentId}/cancel`, { method: "post", data }),
  discountPlans: () => request<RentalDiscountPlan[]>("/rental/v1/discount-plans"),
  saveDiscountPlan: (data: SaveRentalDiscountPlanRequest) => request<RentalDiscountPlan>(data.id ? `/rental/v1/discount-plans/${data.id}` : "/rental/v1/discount-plans", { method: data.id ? "put" : "post", data }),
  valueAddedServices: () => request<RentalValueAddedService[]>("/rental/v1/value-added-services"),
  saveValueAddedService: (data: SaveRentalValueAddedServiceRequest) => request<RentalValueAddedService>(data.id ? `/rental/v1/value-added-services/${data.id}` : "/rental/v1/value-added-services", { method: data.id ? "put" : "post", data }),
  serviceCapacities: (serviceId?: string) => request<RentalServiceCapacity[]>(`/rental/v1/service-capacities${serviceId ? `?serviceId=${encodeURIComponent(serviceId)}` : ""}`),
  saveServiceCapacity: (data: SaveRentalServiceCapacityRequest) => request<RentalServiceCapacity>(data.id ? `/rental/v1/service-capacities/${data.id}` : "/rental/v1/service-capacities", { method: data.id ? "put" : "post", data }),
  calendar: (year: number) => request<RentalCalendarYear & { timePriceSummary: RentalCalendarTimePriceDay[] }>(`/rental/v1/calendars/${year}`),
  /**
   * 可引用的公共官方来源版本（需求 4.5.2）。空间侧不再直接提交原始官方日期：
   * 公共数据由 SaaS 平台管理员在注册表里维护，空间只能引用某一版生成草稿再自行发布。
   */
  officialCalendarSourceVersions: (year?: number) =>
    request<OfficialCalendarSourceVersionSummary[]>(
      `/rental/v1/official-calendar-sources${year ? `?year=${year}` : ""}`
    ),
  applyOfficialCalendarSource: (year: number, data: ApplyOfficialCalendarSourceRequest) =>
    request<RentalCalendarYear>(`/rental/v1/calendars/${year}/apply-official-source`, { method: "post", data }),
  saveCalendarDay: (year: number, data: SaveRentalCalendarDayRequest) => request(`/rental/v1/calendars/${year}/days/${data.date}`, { method: "put", data }),
  /** 撤销原因走 body 而非查询串：覆盖原因常含客户名或事故描述，不该进访问日志。 */
  removeCalendarDayOverride: (year: number, date: string, data: RemoveRentalCalendarDayOverrideRequest) =>
    request(`/rental/v1/calendars/${year}/days/${date}`, { method: "delete", data }),
  /** 范围覆盖预览（需求 4.5.9）：提交前展示冲突日期、当前值与将替换的字段。 */
  calendarRangePreview: (year: number, data: PreviewRentalCalendarRangeOverrideRequest) =>
    request<RentalCalendarRangeOverridePreview>(`/rental/v1/calendars/${year}/days/range-preview`, { method: "post", data }),
  /** 应用范围覆盖：一次提交原子生效，共用原因/批次，只推进一次 revision。 */
  calendarRangeApply: (year: number, data: ApplyRentalCalendarRangeOverrideRequest) =>
    request<ApplyRentalCalendarRangeOverrideResult>(`/rental/v1/calendars/${year}/days/range`, { method: "post", data }),
  /** 范围移除预览：展示每个日期恢复后的取值与来源。 */
  calendarRangeRemovePreview: (year: number, data: PreviewRentalCalendarRangeRemoveRequest) =>
    request<RentalCalendarRangeRemovePreview>(`/rental/v1/calendars/${year}/days/range-remove-preview`, { method: "post", data }),
  /** 应用范围移除：只移除范围内带人工覆盖的日期，恢复下一优先级来源。 */
  calendarRangeRemove: (year: number, data: ApplyRentalCalendarRangeRemoveRequest) =>
    request<ApplyRentalCalendarRangeRemoveResult>(`/rental/v1/calendars/${year}/days/range-remove`, { method: "post", data }),
  publishCalendar: (year: number, data: PublishRentalCalendarRequest) => request<RentalCalendarYear>(`/rental/v1/calendars/${year}/publish`, { method: "post", data }),
  /** 作废年度日历草稿（需求 4.5.7）。原因必填，走 body。 */
  voidCalendarVersion: (year: number, version: string, data: VoidRentalCalendarRequest) =>
    request<RentalCalendarYear>(`/rental/v1/calendars/${year}/versions/${encodeURIComponent(version)}/void`, { method: "post", data }),
  /** 以某个历史版本的内容生成新草稿（需求 4.5.7 的「恢复旧规则」）。只产生草稿，仍需发布。 */
  restoreCalendarVersion: (year: number, version: string, data: RestoreRentalCalendarVersionRequest) =>
    request<RentalCalendarYear>(`/rental/v1/calendars/${year}/versions/${encodeURIComponent(version)}/restore`, { method: "post", data }),
  /** 年度日历的全部版本（草稿/已发布/已被替代/已作废），供历史与追溯。 */
  calendarVersions: (year: number) => request<RentalCalendarVersionSummary[]>(`/rental/v1/calendars/${year}/versions`),
  /** 单个版本详情，含逐日、发布差异与覆盖审计。 */
  calendarVersion: (year: number, version: string) =>
    request<RentalCalendarYear>(`/rental/v1/calendars/${year}/versions/${encodeURIComponent(version)}`),
  /** 覆盖审计流水（独立只追加表，不截断）。可按版本过滤。 */
  calendarOverrideAudits: (year: number, version?: string) =>
    request<RentalCalendarOverrideAudit[]>(
      `/rental/v1/calendars/${year}/override-audits${version ? `?version=${encodeURIComponent(version)}` : ""}`
    ),
  /** 发布前影响预览（需求 4.5.8）。只读推演，不改状态、不触碰未来订单。 */
  calendarPublishPreview: (year: number) =>
    request<RentalCalendarPublishPreview>(`/rental/v1/calendars/${year}/publish-preview`),
  ruleVersions: () => request<RentalRuleVersion[]>("/rental/v1/rule-versions"),
  ruleVersionAudits: (version?: string) => request<RentalRuleVersionAudit[]>("/rental/v1/rule-versions/audits", { params: { version } }),
  /** 发布前影响预览（需求 4.6.1）。只读推演，不改状态、不动已锁定报价。 */
  ruleVersionPublishPreview: (version: string, effectiveFrom?: string) =>
    request<RentalRulePublishPreview>(`/rental/v1/rule-versions/${version}/publish-preview`, { params: { effectiveFrom } }),
  /** 只存草稿；已发布版本不可修改，需先 restoreRuleVersion 成新草稿。 */
  saveRuleVersion: (data: SaveRentalRuleVersionRequest) => request<RentalRuleVersion>("/rental/v1/rule-versions", { method: "post", data }),
  restoreRuleVersion: (version: string, reason: string) =>
    request<RentalRuleVersion>(`/rental/v1/rule-versions/${version}/restore`, { method: "post", data: { reason } }),
  publishRuleVersion: (version: string, data: PublishRentalRuleVersionRequest) =>
    request<RentalRuleVersion>(`/rental/v1/rule-versions/${version}/publish`, { method: "post", data }),
  voidRuleVersion: (version: string, reason: string) =>
    request<RentalRuleVersion>(`/rental/v1/rule-versions/${version}/void`, { method: "post", data: { reason } }),
  customerCoupons: (customerId?: string) => request<RentalCustomerCoupon[]>("/rental/v1/customer-coupons", { params: { customerId } }),
  claimCoupon: (templateId: string, customerId: string) => request<RentalCustomerCoupon>("/rental/v1/customer-coupons/claim", { method: "post", data: { templateId, customerId } }),
  voidCustomerCoupon: (id: string, reason: string) => request<RentalCustomerCoupon>(`/rental/v1/customer-coupons/${id}/void`, { method: "post", data: { reason } }),
  rewards: (customerId?: string) => request<RentalRewardLedgerEntry[]>("/rental/v1/rewards", { params: { customerId } }),
  benefitAccounts: (customerId?: string) => request<RentalCustomerBenefitAccount[]>("/rental/v1/benefit-accounts", { params: { customerId } }),
  grantReward: (data: GrantRentalRewardRequest) => request<RentalRewardLedgerEntry[]>("/rental/v1/rewards/grant", { method: "post", data }),
  reverseReward: (id: string, reason: string) => request<RentalRewardLedgerEntry>(`/rental/v1/rewards/${id}/reverse`, { method: "post", data: { reason } }),
  notificationTemplates: () => request<RentalNotificationTemplateV1[]>("/rental/v1/notification-templates"),
  saveNotificationTemplate: (data: SaveRentalNotificationTemplateRequest) => request<RentalNotificationTemplateV1>(data.id ? `/rental/v1/notification-templates/${data.id}` : "/rental/v1/notification-templates", { method: data.id ? "put" : "post", data }),
  notificationLogs: () => request<RentalNotificationSendLogV1[]>("/rental/v1/notification-logs"),
  retryNotification: (id: string) => request<RentalNotificationSendLogV1>(`/rental/v1/notification-logs/${id}/retry`, { method: "post" }),
  queryNotificationDelivery: (id: string) => request<RentalNotificationSendLogV1>(`/rental/v1/notification-logs/${id}/query-delivery`, { method: "post" }),
  retryDueNotifications: (limit = 20) => request<{ attempted: number; sent: number; failed: number; ids: string[] }>(`/rental/v1/notification-logs/retry-due?limit=${limit}`, { method: "post" }),
  sendNotification: (data: SendRentalNotificationRequest) => request<RentalNotificationSendLogV1>("/rental/v1/notifications/send", { method: "post", data }),
  createQuote: (data: RentalQuoteRequest) => request<RentalQuoteSnapshotV1>("/rental/v1/quotes", { method: "post", data }),
  locations: () => request<RentalFulfillmentLocation[]>("/rental/v1/locations"),
  operators: () => request<RentalFulfillmentOperator[]>("/rental/v1/fulfillment-operators"),
  saveOperator: (data: SaveRentalFulfillmentOperatorRequest) => request<RentalFulfillmentOperator>(data.id ? `/rental/v1/fulfillment-operators/${data.id}` : "/rental/v1/fulfillment-operators", { method: data.id ? "put" : "post", data }),
  saveLocation: (data: SaveRentalFulfillmentLocationRequest) => request<RentalFulfillmentLocation>(data.id ? `/rental/v1/locations/${data.id}` : "/rental/v1/locations", { method: data.id ? "put" : "post", data }),
  itemGroups: () => request<RentalItemGroup[]>("/rental/v1/item-groups"),
  saveItemGroup: (data: SaveRentalItemGroupRequest) => request<RentalItemGroup>(data.id ? `/rental/v1/item-groups/${data.id}` : "/rental/v1/item-groups", { method: data.id ? "put" : "post", data }),
  uploadItemGroupImage: async (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const response = await http.post<ApiResult<RentalItemGroup>>(`/rental/v1/item-groups/${id}/images`, form);
    return response.data.data;
  },
  removeItemGroupImage: (id: string, imageId: string) => request<RentalItemGroup>(`/rental/v1/item-groups/${id}/images/${imageId}`, { method: "delete" }),
  itemGroupImageBlob: async (id: string, imageId: string) => {
    const response = await http.get<Blob>(`/rental/v1/item-groups/${id}/images/${imageId}`, { responseType: "blob" });
    return response.data;
  },
  pricingGroups: () => request<RentalPricingGroup[]>("/rental/v1/pricing-groups"),
  savePricingGroup: (data: SaveRentalPricingGroupRequest) => request<RentalPricingGroup>(data.id ? `/rental/v1/pricing-groups/${data.id}` : "/rental/v1/pricing-groups", { method: data.id ? "put" : "post", data }),
  updatePricingGroupSecurityRates: (id: string, data: UpdateRentalPricingGroupSecurityRatesRequest) => request<{ id: string; sequence: number; version: string; effectiveFrom: string; changeReason?: string }>(`/rental/v1/pricing-groups/${id}/security-rates`, { method: "patch", data }),
  assets: () => request<RentalAsset[]>("/rental/v1/assets"),
  assetStatusHistory: (assetId: string) => request<RentalAssetStatusHistory[]>(`/rental/v1/assets/${encodeURIComponent(assetId)}/status-history`),
  saveAsset: (data: SaveRentalAssetRequest) => request<RentalAsset>(data.id ? `/rental/v1/assets/${data.id}` : "/rental/v1/assets", { method: data.id ? "put" : "post", data }),
  stockBalances: () => request<RentalStockBalance[]>("/rental/v1/stock-balances"),
  stockLedger: (params?: { itemGroupId?: string; locationId?: string; batchNo?: string; sourceDocumentNo?: string; limit?: number }) => request<RentalStockLedgerEntry[]>("/rental/v1/stock-ledger", { params }),
  applyStockOperation: (data: RentalStockOperationRequest) => request<RentalStockOperationResult>("/rental/v1/stock-operations", { method: "post", data }),
  stockDispositions: (orderId?: string) => request<RentalStockDisposition[]>("/rental/v1/stock-dispositions", { params: { orderId } }),
  restoreStockDisposition: (id: string) => request<RentalStockDisposition>(`/rental/v1/stock-dispositions/${id}/restore`, { method: "post" }),
  writeOffStockDisposition: (id: string, reason: string) => request<RentalStockDisposition>("/rental/v1/stock-dispositions/" + id + "/write-off", { method: "post", data: { reason } }),
  workOrders: (status?: string) => request<RentalWorkOrder[]>("/rental/v1/work-orders", { params: { status } }),
  workOrderAssignees: (locationId?: string) => request<RentalWorkOrderAssignee[]>("/rental/v1/work-order-assignees", { params: { locationId } }),
  workOrderHistory: (id: string) => request<RentalWorkOrderHistoryEntry[]>(`/rental/v1/work-orders/${id}/history`),
  createWorkOrder: (data: CreateRentalWorkOrderRequest) => request<RentalWorkOrder>("/rental/v1/work-orders", { method: "post", data }),
  assignWorkOrder: (id: string, data: AssignRentalWorkOrderRequest) => request<RentalWorkOrder>(`/rental/v1/work-orders/${id}/assign`, { method: "put", data }),
  startWorkOrder: (id: string) => request<RentalWorkOrder>(`/rental/v1/work-orders/${id}/start`, { method: "post" }),
  submitWorkOrder: (id: string, data: SubmitRentalWorkOrderRequest) => request<RentalWorkOrder>(`/rental/v1/work-orders/${id}/submit`, { method: "post", data }),
  reviewWorkOrder: (id: string, data: ReviewRentalWorkOrderRequest) => request<RentalWorkOrder>(`/rental/v1/work-orders/${id}/review`, { method: "post", data }),
  cancelWorkOrder: (id: string, data: CancelRentalWorkOrderRequest) => request<RentalWorkOrder>(`/rental/v1/work-orders/${id}/cancel`, { method: "post", data }),
  orders: () => request<RentalOrder[]>("/rental/v1/orders"),
  /**
   * ORDER-LIST-01：服务端筛选 + 分页。始终带 `page`，服务端据此返回分页信封
   * 而不是兼容用的纯数组；空间不传，取会话。
   */
  orderPage: (params: RentalOrderListQuery = {}) =>
    request<RentalOrderPage>("/rental/v1/orders", { params: { ...params, page: params.page ?? 1 } }),
  order: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}`),
  carrierShipmentEvents: (id: string) => request<RentalCarrierShipmentEvent[]>(`/rental/v1/orders/${id}/carrier-shipment/events`),
  createCarrierShipmentEvent: (id: string, data: CreateRentalCarrierShipmentEventRequest, idempotencyKey: string) => request<RentalCarrierShipmentEvent>(
    `/rental/v1/orders/${id}/carrier-shipment/events`, { method: "post", data, headers: { "Idempotency-Key": idempotencyKey } }
  ),
  createCarrierEvidenceUploadSession: (id: string, data: { fileName: string; mimeType: string; sizeBytes: number; idempotencyKey: string }) =>
    request<FileUploadSessionSummary>(`/files/rental-orders/${id}/carrier-evidence/upload-sessions`, { method: "post", data }),
  completeCarrierEvidenceUpload: (id: string, sessionId: string) =>
    request<{ id: string; mimeType: string }>(`/files/rental-orders/${id}/carrier-evidence/upload-sessions/${sessionId}/complete`, { method: "post", data: {} }),
  carrierEvidenceDownloadUrl: (id: string, fileAssetId: string) =>
    request<FileDownloadUrlSummary>(`/files/rental-orders/${id}/carrier-evidence/${fileAssetId}/download-url`),
  revealOrderDeliveryAddress: (id: string) => request<RentalDeliveryAddressSnapshot>(`/rental/v1/orders/${id}/delivery-address/reveal`),
  fundingEvents: (id: string) => request<RentalFundingBalance>(`/rental/v1/orders/${id}/funding-events`),
  initiateFunding: (id: string, data: InitiateRentalFundingRequest) => request<RentalFundingEvent>(`/rental/v1/orders/${id}/funding-events/initiate`, { method: "post", data }),
  appendFunding: (id: string, data: RentalFundingAmountRequest) => request<RentalFundingEvent>(`/rental/v1/orders/${id}/funding-events/append`, { method: "post", data }),
  captureFunding: (id: string, data: RentalFundingAmountRequest) => request<RentalFundingEvent>(`/rental/v1/orders/${id}/funding-events/capture`, { method: "post", data }),
  refundFunding: (id: string, data: RentalFundingAmountRequest) => request<RentalFundingEvent>(`/rental/v1/orders/${id}/funding-events/refund`, { method: "post", data }),
  releaseFunding: (id: string, data: RentalFundingReleaseRequest) => request<RentalFundingEvent>(`/rental/v1/orders/${id}/funding-events/release`, { method: "post", data }),
  failFunding: (id: string, data: RentalFundingFailureRequest) => request<RentalFundingEvent>(`/rental/v1/orders/${id}/funding-events/fail`, { method: "post", data }),
  createOrder: (data: CreateRentalOrderRequest) => request<RentalOrder>("/rental/v1/orders", { method: "post", data }),
  expirePendingOrder: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/expire-pending`, { method: "post" }),
  markPickupOverdue: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/mark-pickup-overdue`, { method: "post" }),
  sendNoShowNotice: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/no-show-notice`, { method: "post" }),
  confirmNoShow: (id: string, data: { reason: string }) => request<RentalOrder>(`/rental/v1/orders/${id}/confirm-no-show`, { method: "post", data }),
  resumePickup: (id: string, data: { reason: string }) => request<RentalOrder>(`/rental/v1/orders/${id}/resume-pickup`, { method: "post", data }),
  confirmOrder: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/confirm`, { method: "post" }),
  allocateOrder: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/allocate`, { method: "post" }),
  allocationCandidates: (id: string, exchange?: { exchangeOrderLineId: string; replacementItemGroupId: string }) => request<RentalAllocationCandidates>(
    `/rental/v1/orders/${id}/allocation-candidates${exchange ? `?exchangeOrderLineId=${encodeURIComponent(exchange.exchangeOrderLineId)}&replacementItemGroupId=${encodeURIComponent(exchange.replacementItemGroupId)}` : ""}`
  ),
  manageAllocations: (id: string, data: ManageRentalAllocationRequest) => request<RentalOrder>(`/rental/v1/orders/${id}/assignments`, { method: "post", data }),
  operationLock: (id: string, action: "acquire" | "release", token?: string) => request<{ token?: string; expiresAt?: string }>(`/rental/v1/orders/${id}/operation-lock`, { method: "post", data: { action, token } }),
  substituteBundleComponent: (id: string, data: SubstituteRentalBundleComponentRequest) => request<RentalOrder>(`/rental/v1/orders/${id}/substitute-bundle-component`, { method: "post", data }),
  partialReturnOrder: (id: string, data: PartialReturnRentalOrderRequest, token?: string) => request<RentalOrder>(`/rental/v1/orders/${id}/partial-return`, { method: "post", data, headers: token ? { "X-Operation-Token": token } : undefined }),
  cancelOrder: (id: string, data: { reason: string; weatherException?: boolean }) => request<RentalOrder>(`/rental/v1/orders/${id}/cancel`, { method: "post", data }),
  handoverOrder: (id: string, stage: "pickup" | "return", token?: string) => request<RentalOrder>(`/rental/v1/orders/${id}/handover/${stage}`, { method: "post", headers: token ? { "X-Operation-Token": token } : undefined }),
  settleOrder: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/settle`, { method: "post" }),
  // 续租 / 延期（需求 4.6.9）。试算与申请分两步：金额要先给客户/运营确认，
  // 确认后才落记录；企业月结的申请直接生效，个人还要再走一次补款。
  orderExtensions: (id: string) => request<RentalOrderExtension[]>(`/rental/v1/orders/${id}/extensions`),
  orderChanges: (id: string) => request<RentalOrderChange[]>(`/rental/v1/orders/${id}/changes`),
  previewPartialLineCancellation: (id: string, data: PreviewRentalOrderChangeRequest) =>
    request<RentalOrderChangePreview>(`/rental/v1/orders/${id}/changes/partial-cancel/preview`, { method: "post", data }),
  applyPartialLineCancellation: (id: string, data: ApplyRentalOrderChangeRequest) =>
    request<{ order: RentalOrder; change: RentalOrderChange }>(`/rental/v1/orders/${id}/changes/partial-cancel`, { method: "post", data }),
  previewPostPickupExchange: (id: string, data: PreviewRentalOrderChangeRequest) =>
    request<RentalOrderChangePreview>(`/rental/v1/orders/${id}/changes/post-pickup-exchange/preview`, { method: "post", data }),
  applyPostPickupExchange: (id: string, data: ApplyRentalOrderChangeRequest) =>
    request<{ order: RentalOrder; change: RentalOrderChange }>(`/rental/v1/orders/${id}/changes/post-pickup-exchange`, { method: "post", data }),
  previewOrderExtension: (id: string, data: RentalOrderExtensionRequest) =>
    request<RentalOrderExtensionPreview>(`/rental/v1/orders/${id}/extensions/preview`, { method: "post", data }),
  requestOrderExtension: (id: string, data: RentalOrderExtensionRequest) =>
    request<{ order: RentalOrder; extension: RentalOrderExtension }>(`/rental/v1/orders/${id}/extensions`, { method: "post", data }),
  payOrderExtension: (id: string, extensionId: string) =>
    request<{ order: RentalOrder; extension: RentalOrderExtension }>(`/rental/v1/orders/${id}/extensions/${extensionId}/pay`, { method: "post" }),
  reviewExtensionRefund: (id: string, extensionId: string, data: { decision: "approved" | "rejected"; reason: string }) =>
    request<{ order: RentalOrder; extension: RentalOrderExtension }>(`/rental/v1/orders/${id}/extensions/${extensionId}/refund-review`, { method: "post", data }),
  /**
   * ORDER-CLOSE-02：裁定订单上的待审费用（规则判为人工核价的逾期费 / 提前归还退款）。
   *
   * 与续租负差额、检查异常各自保持独立接口：三者的来源、状态机与「能不能改金额」
   * 的规则都不同，合成一个统一审批入口会把三套证据糊成一套。
   */
  reviewOrderFeeReview: (id: string, reviewId: string, data: ReviewRentalOrderFeeReviewRequest) =>
    request<RentalOrder>(`/rental/v1/orders/${id}/fee-reviews/${reviewId}/review`, { method: "post", data }),
  updateServiceOccurrence: (id: string, occurrenceId: string, data: UpdateRentalServiceOccurrenceRequest) =>
    request<{ order: RentalOrder; occurrence: RentalOrderServiceOccurrence }>(`/rental/v1/orders/${id}/services/${encodeURIComponent(occurrenceId)}/execution`, { method: "post", data }),
  refundServiceOccurrence: (id: string, occurrenceId: string, data: RefundRentalServiceRequest) =>
    request<{ order: RentalOrder; occurrence: RentalOrderServiceOccurrence }>(`/rental/v1/orders/${id}/services/${encodeURIComponent(occurrenceId)}/refund`, { method: "post", data }),
  inspectionTemplates: (stage?: "pickup" | "return") => request<RentalInspectionTemplate[]>("/rental/v1/inspection-templates", { params: { stage } }),
  inspections: (id: string) => request<RentalInspectionRecord[]>(`/rental/v1/orders/${id}/inspections`),
  createInspection: (id: string, data: CreateRentalInspectionRequest, token?: string) => request<{ inspection: RentalInspectionRecord; order: RentalOrder }>(`/rental/v1/orders/${id}/inspections`, { method: "post", data, headers: token ? { "X-Operation-Token": token } : undefined }),
  correctInspectionUsage: (id: string, inspectionId: string, data: CorrectRentalInspectionUsageRequest) => request<{ inspection: RentalInspectionRecord }>(`/rental/v1/orders/${id}/inspections/${inspectionId}/usage-correction`, { method: "post", data }),
  reviewInspectionException: (id: string, inspectionId: string, exceptionIndex: number, data: ReviewRentalInspectionExceptionRequest) => request<{ order: RentalOrder }>(`/rental/v1/orders/${id}/inspections/${inspectionId}/exceptions/${exceptionIndex}/review`, { method: "post", data }),
  reReviewInspectionException: (id: string, inspectionId: string, exceptionIndex: number, data: AdjustRentalInspectionExceptionRequest, idempotencyKey?: string) => request<{ order: RentalOrder }>(`/rental/v1/orders/${id}/inspections/${inspectionId}/exceptions/${exceptionIndex}/re-review`, { method: "post", data, headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined }),
  recordInspectionExceptionCustomerResponse: (id: string, inspectionId: string, exceptionIndex: number, data: RecordRentalInspectionExceptionCustomerResponseRequest, idempotencyKey?: string) => request<{ order: RentalOrder }>(`/rental/v1/orders/${id}/inspections/${inspectionId}/exceptions/${exceptionIndex}/customer-response`, { method: "post", data, headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined }),
  // CORE-EXT-02C：经营空间能力治理。读写都不带 workspaceId——空间取自会话，
  // 客户端无法指定要治理哪个空间的能力，因此也伪造不了能力范围。
  capabilities: () => request<WorkspaceCapabilityOverview>("/rental/v1/capabilities"),
  saveCapability: (data: SaveWorkspaceCapabilityRequest) => request<WorkspaceCapabilityInstance>("/rental/v1/capabilities", { method: "put", data }),
  upgradeCapability: (code: string, data: UpgradeWorkspaceCapabilityRequest) => request<WorkspaceCapabilityInstance>(`/rental/v1/capabilities/${code}/upgrade`, { method: "post", data }),
  capabilityAudits: (code?: string) => request<WorkspaceCapabilityAuditEvent[]>("/rental/v1/capability-audits", { params: { code } })
};

/**
 * 当前经营空间的结算币种（需求 §948）。
 *
 * 管理端所有金额展示都要经过它 + `formatRentalMoney`，因为**符号不能写死**：
 * 此前十几处硬编码的 `¥` 会把港币空间的金额显示成人民币，而金额本身看不出错。
 *
 * 复用 `["rental-core", "business-settings"]` 这个已有查询键，因此在已经取过
 * 业务设置的页面里不会多发一次请求；缺省 `CNY` 只在首帧与存量数据上出现。
 */
export function useSettlementCurrency(): RentalCurrency {
  const settings = useQuery({
    queryKey: ["rental-core", "business-settings"],
    queryFn: rentalCoreApi.businessSettings
  });
  return settings.data?.pricing.currency ?? "CNY";
}
