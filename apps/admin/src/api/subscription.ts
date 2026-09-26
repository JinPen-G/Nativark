/**
 * SUB-02/03 订阅只读查询 API。
 *
 * 类型来自 `@rental-os/shared`（总控 SUB-01 只读契约）。**端点路径为占位，待后端最终映射表核对**：
 * 租户订阅也走 `/platform/subscription/*`（audience tenant）——§5.1 要求无已配置空间的新租户也能看订阅/提交申请，
 * 而 `/rental/v1`、`/rental-os` 是空间级 fail-closed（无空间进不去），`/platform/*` 豁免空间校验，正合适；
 * 平台端走 `/platform/subscriptions/*`。具体子路径（view/reminder/list/detail/申请…）等后端控制器落地后替换。
 * 本批仅只读；管理员办理/授权与租户申请提交的写接口随 SUB-01D/SUB-03 补齐。
 * 平台列表/详情的正式读 DTO 也随 SUB-03 定；此处先用 overview/view 形状承接。
 */
import type {
  ExtendSubscriptionRequest,
  GrantTenantFeatureRequest,
  HandleSubscriptionRequestRequest,
  ProvisionSubscriptionRequest,
  RenewSubscriptionRequest,
  RevokeTenantFeatureRequest,
  ScheduleNextSubscriptionRequest,
  SetStandardPriceRequest,
  StandardPlanPricing,
  SubmitSubscriptionRequestRequest,
  SubscriptionExpiryReminder,
  SubscriptionFeatureCatalogEntry,
  SubscriptionPlan,
  SubscriptionRequestRecord,
  TenantSubscriptionOverview,
  TenantSubscriptionView,
  UpgradeSubscriptionProRequest,
  UpsertFeatureCatalogRequest
} from "@rental-os/shared";
import { request } from "./http";

export interface PlatformSubscriptionListQuery {
  plan?: string;
  serviceStatus?: string;
  dueWithin?: string;
  keyword?: string;
}

export const subscriptionApi = {
  /** 租户「版本与订阅」页一次拉取的聚合视图（§5.2）。走 /platform（audience tenant，豁免空间校验，§5.1）。 */
  tenantView: () => request<TenantSubscriptionView>("/platform/subscription/view"),
  /** 左下角到期浮窗只读数据（§5.4）；无提醒时后端返回 null。 */
  expiryReminder: () => request<SubscriptionExpiryReminder | null>("/platform/subscription/reminder"),
  /** SaaS 平台端租户订阅列表（§8.1）。TODO(SUB-03)：正式列表读 DTO 与筛选参数待后端定。 */
  platformList: (params?: PlatformSubscriptionListQuery) =>
    request<TenantSubscriptionOverview[]>("/platform/subscriptions", { params }),
  /** SaaS 平台端某租户订阅详情（§8）。 */
  platformDetail: (tenantId: string) =>
    request<TenantSubscriptionView>(`/platform/subscriptions/${encodeURIComponent(tenantId)}`),
  /** SaaS 平台功能目录（§3.3/§8，介绍/对比/维护用）。TODO(SUB-03)：读端点待后端补齐（映射表暂无 GET）。 */
  featureCatalog: () => request<SubscriptionFeatureCatalogEntry[]>("/platform/subscriptions/feature-catalog"),
  /** 标准套餐年费列表（§5.2/§8）。TODO(SUB-03)：读端点待后端补齐。 */
  standardPrices: () => request<StandardPlanPricing[]>("/platform/subscriptions/standard-prices"),

  // ===== 写操作（§7/§8）。目标租户走路径参数；金额可空不落 0；平台写响应以失效后重取为准，故多为 void。 =====
  // 租户端（audience tenant，:manage）
  submitRequest: (body: SubmitSubscriptionRequestRequest) =>
    request<SubscriptionRequestRecord>("/platform/subscription/requests", { method: "post", data: body }),
  cancelRequest: (id: string) =>
    request<SubscriptionRequestRecord>(`/platform/subscription/requests/${encodeURIComponent(id)}/cancel`, { method: "post" }),
  // 平台端（audience saas，system:tenant:subscription:manage）
  provision: (tenantId: string, body: ProvisionSubscriptionRequest) =>
    request<void>(`/platform/subscriptions/${encodeURIComponent(tenantId)}/provision`, { method: "post", data: body }),
  renew: (tenantId: string, body: RenewSubscriptionRequest) =>
    request<void>(`/platform/subscriptions/${encodeURIComponent(tenantId)}/renew`, { method: "post", data: body }),
  upgrade: (tenantId: string, body: UpgradeSubscriptionProRequest) =>
    request<void>(`/platform/subscriptions/${encodeURIComponent(tenantId)}/upgrade`, { method: "post", data: body }),
  extend: (tenantId: string, body: ExtendSubscriptionRequest) =>
    request<void>(`/platform/subscriptions/${encodeURIComponent(tenantId)}/extend`, { method: "post", data: body }),
  scheduleNext: (tenantId: string, body: ScheduleNextSubscriptionRequest) =>
    request<void>(`/platform/subscriptions/${encodeURIComponent(tenantId)}/schedule-next`, { method: "post", data: body }),
  grantFeature: (tenantId: string, body: GrantTenantFeatureRequest) =>
    request<void>(`/platform/subscriptions/${encodeURIComponent(tenantId)}/feature-grants`, { method: "post", data: body }),
  revokeFeature: (tenantId: string, body: RevokeTenantFeatureRequest) =>
    request<void>(`/platform/subscriptions/${encodeURIComponent(tenantId)}/feature-grants/revoke`, { method: "post", data: body }),
  handleRequest: (id: string, body: HandleSubscriptionRequestRequest) =>
    request<SubscriptionRequestRecord>(`/platform/subscriptions/requests/${encodeURIComponent(id)}`, { method: "patch", data: body }),
  upsertFeatureCatalog: (code: string, body: UpsertFeatureCatalogRequest) =>
    request<void>(`/platform/subscriptions/feature-catalog/${encodeURIComponent(code)}`, { method: "put", data: body }),
  setStandardPrice: (plan: SubscriptionPlan, body: SetStandardPriceRequest) =>
    request<void>(`/platform/subscriptions/standard-prices/${encodeURIComponent(plan)}`, { method: "put", data: body })
};
