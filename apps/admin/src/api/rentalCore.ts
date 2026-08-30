import type {
  CreateRentalInspectionRequest,
  CreateRentalOrderRequest,
  PartialReturnRentalOrderRequest,
  RentalAsset,
  RentalAvailabilityRequest,
  RentalAvailabilityResult,
  RentalCategoryDefinition,
  RentalCalendarOverrideAudit,
  RentalCalendarPublishPreview,
  RentalCalendarVersionSummary,
  RentalCalendarYear,
  RentalCalendarTimePriceDay,
  RentalCouponTemplate,
  RentalCustomerBenefitAccount,
  RentalCustomerCoupon,
  RentalDiscountPlan,
  RentalFulfillmentLocation,
  RentalFulfillmentOperator,
  RentalInspectionRecord,
  RentalInspectionTemplate,
  RentalItemGroup,
  RentalOrder,
  RentalNotificationSendLogV1,
  RentalNotificationTemplateV1,
  RentalPricingPlanV1,
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
  RentalValueAddedService,
  RentalWorkspaceOperationReport,
  RentalWorkspaceReportFilter,
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
  SaveRentalPricingPlanRequest,
  SaveRentalRuleVersionRequest,
  SaveRentalValueAddedServiceRequest,
  SaveRentalServiceCapacityRequest,
  SendRentalNotificationRequest,
  SaveRentalAssetRequest,
  SaveRentalCouponTemplateRequest,
  SaveRentalFulfillmentLocationRequest,
  SaveRentalFulfillmentOperatorRequest,
  SaveRentalItemGroupRequest,
  SaveRentalStockBalanceRequest,
  SaveTenantRentalBusinessSettingsRequest,
  SaveTenantRentalProfileRequest,
  TenantRentalBusinessSettings,
  TenantRentalProfile,
  SubstituteRentalBundleComponentRequest
} from "@store-rental/shared";
import { request, requestText } from "./http";

export const rentalCoreApi = {
  categories: () => request<RentalCategoryDefinition[]>("/rental/v1/categories"),
  /**
   * REPORT-01A：当前经营空间经营报表。
   *
   * 刻意不接受 workspaceId：空间一律由服务端按会话解析。
   * 让页面传空间等于允许查自己无权进入的空间的经营数据。
   */
  operationReport: (params?: RentalWorkspaceReportFilter) =>
    request<RentalWorkspaceOperationReport>("/rental/v1/reports/operations", { params }),
  /**
   * REPORT-01B：导出当前经营空间报表（CSV）。
   *
   * 走原始文本请求而不是 `request()`：后者会剥掉 `{ data }` 信封，
   * 而 CSV 本身就不是信封结构。同样不接受 workspaceId——空间取自会话。
   */
  exportOperationReport: (params?: RentalWorkspaceReportFilter) =>
    requestText("/rental/v1/reports/operations/export", params),
  profile: () => request<TenantRentalProfile>("/rental/v1/tenant-profile"),
  saveProfile: (data: SaveTenantRentalProfileRequest) => request<TenantRentalProfile>("/rental/v1/tenant-profile", { method: "put", data }),
  businessSettings: () => request<TenantRentalBusinessSettings>("/rental/v1/business-settings"),
  saveBusinessSettings: (data: SaveTenantRentalBusinessSettingsRequest) => request<TenantRentalBusinessSettings>("/rental/v1/business-settings", { method: "put", data }),
  couponTemplates: () => request<RentalCouponTemplate[]>("/rental/v1/coupon-templates"),
  saveCouponTemplate: (data: SaveRentalCouponTemplateRequest) => request<RentalCouponTemplate>(data.id ? `/rental/v1/coupon-templates/${data.id}` : "/rental/v1/coupon-templates", { method: data.id ? "put" : "post", data }),
  pricingPlans: () => request<RentalPricingPlanV1[]>("/rental/v1/pricing-plans"),
  /** PRICE-03：空间级不可变版本，不按计划拆分。 */
  priceVersions: (page?: number, pageSize?: number) => request<{ total: number; rows: Array<RentalPriceVersion & { rateCount: number }> }>("/rental/v1/pricing-versions", { params: { page, pageSize } }),
  priceVersion: (sequence: number) => request<RentalPriceVersion>(`/rental/v1/pricing-versions/${sequence}`),
  restorePriceVersion: (sequence: number, data: RestoreRentalPriceVersionRequest) => request<{ id: string; sequence: number; version: string; restoredFromVersion: string }>(`/rental/v1/pricing-versions/${sequence}/restore`, { method: "post", data }),
  priceAdjustments: (planId: string) => request<RentalPriceAdjustmentPlan[]>(`/rental/v1/pricing-plans/${planId}/adjustments`),
  createPriceAdjustment: (planId: string, data: CreateRentalPriceAdjustmentRequest) => request<{ id: string; code: string; name: string; status: string; preview: RentalPriceAdjustmentPreviewRow[] }>(`/rental/v1/pricing-plans/${planId}/adjustments`, { method: "post", data }),
  confirmPriceAdjustment: (planId: string, adjustmentId: string) => request<unknown>(`/rental/v1/pricing-plans/${planId}/adjustments/${adjustmentId}/confirm`, { method: "post" }),
  cancelPriceAdjustment: (planId: string, adjustmentId: string, data: CancelRentalPriceAdjustmentRequest) => request<unknown>(`/rental/v1/pricing-plans/${planId}/adjustments/${adjustmentId}/cancel`, { method: "post", data }),
  savePricingPlan: (data: SaveRentalPricingPlanRequest) => request<RentalPricingPlanV1>(data.id ? `/rental/v1/pricing-plans/${data.id}` : "/rental/v1/pricing-plans", { method: data.id ? "put" : "post", data }),
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
  currentRule: (at?: string) => request<RentalRuleVersion>("/rental/v1/rule-versions/current", { params: { at } }),
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
  sendNotification: (data: SendRentalNotificationRequest) => request<RentalNotificationSendLogV1>("/rental/v1/notifications/send", { method: "post", data }),
  createQuote: (data: RentalQuoteRequest) => request<RentalQuoteSnapshotV1>("/rental/v1/quotes", { method: "post", data }),
  quote: (id: string) => request<RentalQuoteSnapshotV1>(`/rental/v1/quotes/${id}`),
  locations: () => request<RentalFulfillmentLocation[]>("/rental/v1/locations"),
  operators: () => request<RentalFulfillmentOperator[]>("/rental/v1/fulfillment-operators"),
  saveOperator: (data: SaveRentalFulfillmentOperatorRequest) => request<RentalFulfillmentOperator>(data.id ? `/rental/v1/fulfillment-operators/${data.id}` : "/rental/v1/fulfillment-operators", { method: data.id ? "put" : "post", data }),
  saveLocation: (data: SaveRentalFulfillmentLocationRequest) => request<RentalFulfillmentLocation>(data.id ? `/rental/v1/locations/${data.id}` : "/rental/v1/locations", { method: data.id ? "put" : "post", data }),
  itemGroups: () => request<RentalItemGroup[]>("/rental/v1/item-groups"),
  saveItemGroup: (data: SaveRentalItemGroupRequest) => request<RentalItemGroup>(data.id ? `/rental/v1/item-groups/${data.id}` : "/rental/v1/item-groups", { method: data.id ? "put" : "post", data }),
  assets: () => request<RentalAsset[]>("/rental/v1/assets"),
  saveAsset: (data: SaveRentalAssetRequest) => request<RentalAsset>(data.id ? `/rental/v1/assets/${data.id}` : "/rental/v1/assets", { method: data.id ? "put" : "post", data }),
  stockBalances: () => request<RentalStockBalance[]>("/rental/v1/stock-balances"),
  saveStockBalance: (data: SaveRentalStockBalanceRequest) => request<RentalStockBalance>("/rental/v1/stock-balances", { method: "put", data }),
  availability: (data: RentalAvailabilityRequest) => request<RentalAvailabilityResult>("/rental/v1/availability", { method: "post", data }),
  orders: () => request<RentalOrder[]>("/rental/v1/orders"),
  order: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}`),
  createOrder: (data: CreateRentalOrderRequest) => request<RentalOrder>("/rental/v1/orders", { method: "post", data }),
  confirmOrder: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/confirm`, { method: "post" }),
  allocateOrder: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/allocate`, { method: "post" }),
  substituteBundleComponent: (id: string, data: SubstituteRentalBundleComponentRequest) => request<RentalOrder>(`/rental/v1/orders/${id}/substitute-bundle-component`, { method: "post", data }),
  partialReturnOrder: (id: string, data: PartialReturnRentalOrderRequest) => request<RentalOrder>(`/rental/v1/orders/${id}/partial-return`, { method: "post", data }),
  cancelOrder: (id: string, data: { reason: string; weatherException?: boolean }) => request<RentalOrder>(`/rental/v1/orders/${id}/cancel`, { method: "post", data }),
  handoverOrder: (id: string, stage: "pickup" | "return") => request<RentalOrder>(`/rental/v1/orders/${id}/handover/${stage}`, { method: "post" }),
  inspectionTemplates: (stage?: "pickup" | "return") => request<RentalInspectionTemplate[]>("/rental/v1/inspection-templates", { params: { stage } }),
  inspections: (id: string) => request<RentalInspectionRecord[]>(`/rental/v1/orders/${id}/inspections`),
  createInspection: (id: string, data: CreateRentalInspectionRequest) => request<{ inspection: RentalInspectionRecord; order: RentalOrder }>(`/rental/v1/orders/${id}/inspections`, { method: "post", data }),
  // CORE-EXT-02C：经营空间能力治理。读写都不带 workspaceId——空间取自会话，
  // 客户端无法指定要治理哪个空间的能力，因此也伪造不了能力范围。
  capabilities: () => request<WorkspaceCapabilityOverview>("/rental/v1/capabilities"),
  saveCapability: (data: SaveWorkspaceCapabilityRequest) => request<WorkspaceCapabilityInstance>("/rental/v1/capabilities", { method: "put", data }),
  upgradeCapability: (code: string, data: UpgradeWorkspaceCapabilityRequest) => request<WorkspaceCapabilityInstance>(`/rental/v1/capabilities/${code}/upgrade`, { method: "post", data }),
  capabilityAudits: (code?: string) => request<WorkspaceCapabilityAuditEvent[]>("/rental/v1/capability-audits", { params: { code } })
};
