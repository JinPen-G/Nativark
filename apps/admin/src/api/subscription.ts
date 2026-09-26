/**
 * SUB-02/03 订阅只读查询 API。
 *
 * 类型来自 `@rental-os/shared`（总控 SUB-01 只读契约）。**端点路径待与后端(总控)对齐**：
 * 下面按约定前缀预置（租户走 /rental/v1、平台走 /platform），后端 SUB-01/03 通端点后核对即可。
 * 本批仅只读；管理员办理/授权与租户申请提交的写接口随 SUB-01D/SUB-03 补齐。
 * 平台列表/详情的正式读 DTO 也随 SUB-03 定；此处先用 overview/view 形状承接。
 */
import type {
  SubscriptionExpiryReminder,
  TenantSubscriptionOverview,
  TenantSubscriptionView
} from "@rental-os/shared";
import { request } from "./http";

export interface PlatformSubscriptionListQuery {
  plan?: string;
  serviceStatus?: string;
  dueWithin?: string;
  keyword?: string;
}

export const subscriptionApi = {
  /** 租户「版本与订阅」页一次拉取的聚合视图（§5.2）。 */
  tenantView: () => request<TenantSubscriptionView>("/rental/v1/subscription/view"),
  /** 左下角到期浮窗只读数据（§5.4）；无提醒时后端返回 null。 */
  expiryReminder: () => request<SubscriptionExpiryReminder | null>("/rental/v1/subscription/reminder"),
  /** SaaS 平台端租户订阅列表（§8.1）。TODO(SUB-03)：正式列表读 DTO 与筛选参数待后端定。 */
  platformList: (params?: PlatformSubscriptionListQuery) =>
    request<TenantSubscriptionOverview[]>("/platform/subscriptions", { params }),
  /** SaaS 平台端某租户订阅详情（§8）。 */
  platformDetail: (tenantId: string) =>
    request<TenantSubscriptionView>(`/platform/subscriptions/${encodeURIComponent(tenantId)}`)
};
