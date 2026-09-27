import type { StaffSubscriptionContext } from "@rental-os/shared";
import { request } from "../core/http";

/**
 * SUB-MP-01：员工端只读「订阅 / 权益」工作上下文。
 * 金额已在契约层结构性脱敏（StaffSubscriptionContext.overview 用 Omit 去掉 currentAmount/handledAt）。
 * 租户级只读、不随经营空间切换；服务端并入 PUBLIC_ROUTES，任意已登录员工可读、无 RBAC 权限。
 */
export function getSubscriptionContext(): Promise<StaffSubscriptionContext> {
  return request<StaffSubscriptionContext>("/rental/v1/subscription/context", { scope: "tenant" });
}
