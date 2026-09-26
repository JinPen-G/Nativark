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
  /** 租户「版本与订阅」页一次拉取的聚合视图（§5.2）。走 /platform（audience tenant，豁免空间校验，§5.1）。 */
  tenantView: () => request<TenantSubscriptionView>("/platform/subscription/view"),
  /** 左下角到期浮窗只读数据（§5.4）；无提醒时后端返回 null。 */
  expiryReminder: () => request<SubscriptionExpiryReminder | null>("/platform/subscription/reminder"),
  /** SaaS 平台端租户订阅列表（§8.1）。TODO(SUB-03)：正式列表读 DTO 与筛选参数待后端定。 */
  platformList: (params?: PlatformSubscriptionListQuery) =>
    request<TenantSubscriptionOverview[]>("/platform/subscriptions", { params }),
  /** SaaS 平台端某租户订阅详情（§8）。 */
  platformDetail: (tenantId: string) =>
    request<TenantSubscriptionView>(`/platform/subscriptions/${encodeURIComponent(tenantId)}`)
};
