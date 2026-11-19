/**
 * 门市租赁核心业务 API（`/rental/v1/*`）：品类与能力、商品与资产、库存、定价与优惠、
 * 日历与规则版本、订单全流程、验机、工单、通知与报表。均按当前会话的经营空间作用。
 */
import { createRentalOperationsApi } from "@rental-os/rental-core/admin/operations/client";
import { createRentalSetupApi } from "@rental-os/rental-core/admin/setup/client";
import { createRentalPaymentReconciliationApi } from "@rental-os/rental-core/admin/payment-reconciliation/client";
import { createRentalGovernanceApi } from "@rental-os/rental-core/admin/governance/client";
import { createRentalWorkOrderApi } from "@rental-os/rental-core/admin/work-orders/client";
import { createRentalOrderApi } from "@rental-os/rental-core/admin/orders/client";
import { createRentalLocationApi } from "@rental-os/rental-core/admin/locations/client";
import { createRentalCatalogApi, type RentalCatalogImageRequest } from "@rental-os/rental-core/admin/catalog/client";
import { createRentalCapabilityApi } from "@rental-os/rental-core/admin/capabilities/client";
import { createRentalCommercialApi } from "@rental-os/rental-core/admin/commercial/client";
import type { RentalCurrency, RentalCustomerBenefitAccount, RentalOrder, RentalRewardLedgerEntry, GrantRentalRewardRequest } from "@rental-os/shared";
import { useQuery } from "@tanstack/react-query";
import { currentSessionEpoch, currentSessionSignal } from "@/app/queryClient";
import { http, request, requestText } from "./http";

/** 型号图片复用原 Axios 鉴权与刷新，查询取消和会话切换均拒绝迟到字节。 */
export const requestRentalCatalogImage: RentalCatalogImageRequest = async (path, options) => {
  const epoch = currentSessionEpoch();
  const sessionSignal = currentSessionSignal();
  const signal = options?.signal ? AbortSignal.any([options.signal, sessionSignal]) : sessionSignal;
  if (signal.aborted) throw new DOMException("型号图片读取已取消", "AbortError");
  const response = await http.get<Blob>(path, { responseType: "blob", signal });
  if (signal.aborted || currentSessionEpoch() !== epoch)
    throw new DOMException("型号图片所属会话已变化", "AbortError");
  return response.data;
};

const rentalLocationApi = createRentalLocationApi(request);
const rentalCatalogApi = createRentalCatalogApi(request, requestRentalCatalogImage);

const rentalCommercialApi = createRentalCommercialApi(request, requestRentalCatalogImage);

const rentalGovernanceApi = createRentalGovernanceApi(request);
const rentalOperationsApi = createRentalOperationsApi(request, requestText);
const rentalSetupApi = createRentalSetupApi(request);
const rentalPaymentReconciliationApi = createRentalPaymentReconciliationApi(request);

export const rentalCoreApi = {
  categories: rentalLocationApi.categories,
  /**
   * REPORT-01A：当前经营空间经营报表。
   *
   * 刻意不接受 workspaceId：空间一律由服务端按会话解析。
   * 让页面传空间等于允许查自己无权进入的空间的经营数据。
   */
  operationReport: rentalOperationsApi.operationReport,
  workbenchTodos: rentalOperationsApi.workbenchTodos,
  reconcilePayments: rentalOperationsApi.reconcilePayments,
  paymentStatementBatches: rentalPaymentReconciliationApi.paymentStatementBatches,
  paymentStatementBatch: rentalPaymentReconciliationApi.paymentStatementBatch,
  importPaymentStatement: rentalPaymentReconciliationApi.importPaymentStatement,
  reviewPaymentStatementLine: rentalPaymentReconciliationApi.reviewPaymentStatementLine,
  /**
   * REPORT-01B：导出当前经营空间报表（CSV）。
   *
   * 走原始文本请求而不是 `request()`：后者会剥掉 `{ data }` 信封，
   * 而 CSV 本身就不是信封结构。同样不接受 workspaceId——空间取自会话。
   */
  exportOperationReport: rentalOperationsApi.exportOperationReport,
  ...createRentalOrderApi(request),
  /** TENANT-READY-01：当前空间开业配置状态（服务端权威判定）。 */
  tenantReadiness: rentalSetupApi.tenantReadiness,
  saveBusinessSettings: rentalGovernanceApi.saveBusinessSettings,
  couponTemplates: rentalCommercialApi.couponTemplates,
  saveCouponTemplate: rentalCommercialApi.saveCouponTemplate,
  /** PRICE-03：空间级不可变版本，不按计划拆分。 */
  priceVersions: rentalCommercialApi.priceVersions,
  priceVersion: rentalCommercialApi.priceVersion,
  restorePriceVersion: rentalCommercialApi.restorePriceVersion,
  priceAdjustments: rentalCommercialApi.priceAdjustments,
  createPriceAdjustment: rentalCommercialApi.createPriceAdjustment,
  confirmPriceAdjustment: rentalCommercialApi.confirmPriceAdjustment,
  cancelPriceAdjustment: rentalCommercialApi.cancelPriceAdjustment,
  saveDiscountPlan: rentalCommercialApi.saveDiscountPlan,
  saveValueAddedService: rentalCommercialApi.saveValueAddedService,
  serviceCapacities: rentalCommercialApi.serviceCapacities,
  saveServiceCapacity: rentalCommercialApi.saveServiceCapacity,
  calendar: rentalGovernanceApi.calendar,
  /**
   * 可引用的公共官方来源版本（需求 4.5.2）。空间侧不再直接提交原始官方日期：
   * 公共数据由 SaaS 平台管理员在注册表里维护，空间只能引用某一版生成草稿再自行发布。
   */
  officialCalendarSourceVersions: rentalGovernanceApi.officialCalendarSourceVersions,
  applyOfficialCalendarSource: rentalGovernanceApi.applyOfficialCalendarSource,
  saveCalendarDay: rentalGovernanceApi.saveCalendarDay,
  /** 撤销原因走 body 而非查询串：覆盖原因常含客户名或事故描述，不该进访问日志。 */
  removeCalendarDayOverride: rentalGovernanceApi.removeCalendarDayOverride,
  /** 范围覆盖预览（需求 4.5.9）：提交前展示冲突日期、当前值与将替换的字段。 */
  calendarRangePreview: rentalGovernanceApi.calendarRangePreview,
  /** 应用范围覆盖：一次提交原子生效，共用原因/批次，只推进一次 revision。 */
  calendarRangeApply: rentalGovernanceApi.calendarRangeApply,
  /** 范围移除预览：展示每个日期恢复后的取值与来源。 */
  calendarRangeRemovePreview: rentalGovernanceApi.calendarRangeRemovePreview,
  /** 应用范围移除：只移除范围内带人工覆盖的日期，恢复下一优先级来源。 */
  calendarRangeRemove: rentalGovernanceApi.calendarRangeRemove,
  publishCalendar: rentalGovernanceApi.publishCalendar,
  /** 作废年度日历草稿（需求 4.5.7）。原因必填，走 body。 */
  voidCalendarVersion: rentalGovernanceApi.voidCalendarVersion,
  /** 以某个历史版本的内容生成新草稿（需求 4.5.7 的「恢复旧规则」）。只产生草稿，仍需发布。 */
  restoreCalendarVersion: rentalGovernanceApi.restoreCalendarVersion,
  /** 年度日历的全部版本（草稿/已发布/已被替代/已作废），供历史与追溯。 */
  calendarVersions: rentalGovernanceApi.calendarVersions,
  /** 单个版本详情，含逐日、发布差异与覆盖审计。 */
  calendarVersion: rentalGovernanceApi.calendarVersion,
  /** 覆盖审计流水（独立只追加表，不截断）。可按版本过滤。 */
  calendarOverrideAudits: rentalGovernanceApi.calendarOverrideAudits,
  /** 发布前影响预览（需求 4.5.8）。只读推演，不改状态、不触碰未来订单。 */
  calendarPublishPreview: rentalGovernanceApi.calendarPublishPreview,
  ruleVersions: rentalCommercialApi.ruleVersions,
  ruleVersionAudits: rentalGovernanceApi.ruleVersionAudits,
  /** 发布前影响预览（需求 4.6.1）。只读推演，不改状态、不动已锁定报价。 */
  ruleVersionPublishPreview: rentalGovernanceApi.ruleVersionPublishPreview,
  /** 只存草稿；已发布版本不可修改，需先 restoreRuleVersion 成新草稿。 */
  saveRuleVersion: rentalGovernanceApi.saveRuleVersion,
  restoreRuleVersion: rentalGovernanceApi.restoreRuleVersion,
  publishRuleVersion: rentalGovernanceApi.publishRuleVersion,
  voidRuleVersion: rentalGovernanceApi.voidRuleVersion,
  claimCoupon: rentalCommercialApi.claimCoupon,
  voidCustomerCoupon: rentalCommercialApi.voidCustomerCoupon,
  rewards: (customerId?: string) => request<RentalRewardLedgerEntry[]>("/rental/v1/rewards", { params: { customerId } }),
  benefitAccounts: (customerId?: string) => request<RentalCustomerBenefitAccount[]>("/rental/v1/benefit-accounts", { params: { customerId } }),
  grantReward: (data: GrantRentalRewardRequest) => request<RentalRewardLedgerEntry[]>("/rental/v1/rewards/grant", { method: "post", data }),
  reverseReward: (id: string, reason: string) => request<RentalRewardLedgerEntry>(`/rental/v1/rewards/${id}/reverse`, { method: "post", data: { reason } }),
  notificationTemplates: rentalGovernanceApi.notificationTemplates,
  saveNotificationTemplate: rentalGovernanceApi.saveNotificationTemplate,
  notificationLogs: rentalGovernanceApi.notificationLogs,
  retryNotification: rentalGovernanceApi.retryNotification,
  queryNotificationDelivery: rentalGovernanceApi.queryNotificationDelivery,
  retryDueNotifications: rentalGovernanceApi.retryDueNotifications,
  sendNotification: rentalGovernanceApi.sendNotification,
  operators: rentalLocationApi.operators,
  saveOperator: rentalLocationApi.saveOperator,
  saveLocation: rentalLocationApi.saveLocation,
  saveItemGroup: rentalCatalogApi.saveItemGroup,
  uploadItemGroupImage: rentalCatalogApi.uploadItemGroupImage,
  removeItemGroupImage: rentalCatalogApi.removeItemGroupImage,
  itemGroupImageBlob: rentalCatalogApi.itemGroupImageBlob,
  savePricingGroup: rentalCommercialApi.savePricingGroup,
  updatePricingGroupSecurityRates: rentalCommercialApi.updatePricingGroupSecurityRates,
  assets: rentalCatalogApi.assets,
  assetStatusHistory: rentalCatalogApi.assetStatusHistory,
  saveAsset: rentalCatalogApi.saveAsset,
  stockBalances: rentalCatalogApi.stockBalances,
  stockLedger: rentalCatalogApi.stockLedger,
  applyStockOperation: rentalCatalogApi.applyStockOperation,
  ...createRentalWorkOrderApi(request),
  orders: () => request<RentalOrder[]>("/rental/v1/orders"),
  // 空间能力读写沿原认证会话的当前经营空间。
  ...createRentalCapabilityApi(request)
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
