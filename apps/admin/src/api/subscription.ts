/** Subscription endpoints are tenant-scoped; no operating workspace is required. */
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
import type { RentalCategoryIdentityLabel } from "@rental-os/shared";
import { request } from "./http";

export interface PlatformSubscriptionListQuery {
  plan?: string;
  serviceStatus?: string;
  dueWithin?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface PlatformSubscriptionList {
  items: TenantSubscriptionOverview[];
  total: number;
  page: number;
  pageSize: number;
}

export const subscriptionApi = {
  /** 租户「版本与订阅」页一次拉取的聚合视图（§5.2）。走 /platform（audience tenant，豁免空间校验，§5.1）。 */
  tenantView: () => request<TenantSubscriptionView>("/platform/subscription/view"),
  /** No reminder is represented by stage=none; summary carries no monetary data. */
  expiryReminder: () => request<SubscriptionExpiryReminder>("/platform/subscription/reminder"),
  /** SaaS 平台端租户订阅列表（§8.1）。后端 GET /platform/subscriptions，支持 plan/serviceStatus/dueWithin/keyword 筛选（f631452）。 */
  platformList: (params?: PlatformSubscriptionListQuery) =>
    request<PlatformSubscriptionList>("/platform/subscriptions", { params }),
  /** SaaS 平台端某租户订阅详情（§8）。 */
  platformDetail: (tenantId: string) =>
    request<TenantSubscriptionView>(`/platform/subscriptions/${encodeURIComponent(tenantId)}`),
  /** SaaS 平台功能目录（§3.3/§8，介绍/对比/维护用）。后端 GET /platform/subscriptions/feature-catalog（f631452）。 */
  featureCatalog: () => request<SubscriptionFeatureCatalogEntry[]>("/platform/subscriptions/feature-catalog"),
  categoryLabels: (platform: boolean) => request<RentalCategoryIdentityLabel[]>(platform ? "/platform/subscriptions/category-labels" : "/platform/subscription/category-labels"),
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
