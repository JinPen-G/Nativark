/** 员工订阅上下文 HTTP 入口，复用宿主的同一订阅服务与已认证身份。 */
import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import type { SubscriptionService } from "@rental-os/platform-server/subscription";

export const RENTAL_STAFF_SUBSCRIPTION_APPLICATION = Symbol("RENTAL_STAFF_SUBSCRIPTION_APPLICATION");
export type RentalStaffSubscriptionHttpApplication = Pick<SubscriptionService, "getStaffContext">;

interface AuthenticatedRequest {
  user: SystemUserRow;
}

/**
 * SUB-MP：员工小程序只读「订阅/权益」工作上下文（§4.4）。
 *
 * 挂 `/rental/v1/subscription`，operator 与员工门面（staff facade 归一为 /rental/v1）共用。
 * 任意已登录员工可读**自身租户**（req.user.tenantId）的版本/服务状态/权益/到期提醒；
 * 金额由服务端结构性脱敏（§SUB-MP-02）。到期对"新业务"的实际拦截由 SUB-04A 守卫负责，
 * 本端点只提供只读上下文供小程序渲染版本页与页面守卫的 UX 判定。
 */
@Controller("rental/v1/subscription")
export class StaffSubscriptionController {
  constructor(@Inject(RENTAL_STAFF_SUBSCRIPTION_APPLICATION) private readonly subscription: RentalStaffSubscriptionHttpApplication) {}

  @Get("context") context(@Req() req: AuthenticatedRequest) {
    return this.subscription.getStaffContext(req.user.tenantId);
  }
}
