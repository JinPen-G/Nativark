/**
 * SUB-02/03 订阅查询与写操作 API。
 *
 * 类型来自 `@rental-os/shared`（总控 SUB-01 契约）。**端点路径已与后端控制器 f631452 逐条核对一致**：
 * 租户订阅走 `/platform/subscription/*`（audience tenant）——§5.1 要求无已配置空间的新租户也能看订阅/提交申请，
 * 而 `/rental/v1`、`/rental-os` 是空间级 fail-closed（无空间进不去），`/platform/*` 豁免空间校验，正合适；
 * 平台端走 `/platform/subscriptions/*`（audience saas，system:tenant:subscription:manage；非 SaaS 管理员 fail-closed 403）。
 * 平台端静态 GET（feature-catalog / standard-prices）在后端声明于 `:tenantId` 参数路由之前，不会被误匹配。
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
  /** SaaS 平台端租户订阅列表（§8.1）。后端 GET /platform/subscriptions，支持 plan/serviceStatus/dueWithin/keyword 筛选（f631452）。 */
  platformList: (params?: PlatformSubscriptionListQuery) =>
    request<TenantSubscriptionOverview[]>("/platform/subscriptions", { params }),
  /** SaaS 平台端某租户订阅详情（§8）。 */
  platformDetail: (tenantId: string) =>
    request<TenantSubscriptionView>(`/platform/subscriptions/${encodeURIComponent(tenantId)}`),
  /** SaaS 平台功能目录（§3.3/§8，介绍/对比/维护用）。后端 GET /platform/subscriptions/feature-catalog（f631452）。 */
  featureCatalog: () => request<SubscriptionFeatureCatalogEntry[]>("/platform/subscriptions/feature-catalog"),
  /** 标准套餐年费列表（§5.2/§8）。后端 GET /platform/subscriptions/standard-prices（f631452）。 */
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
