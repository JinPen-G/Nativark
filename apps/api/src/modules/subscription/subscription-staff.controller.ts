import { Controller, Get, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { SubscriptionService } from "./subscription.service";

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
  constructor(private readonly subscription: SubscriptionService) {}

  @Get("context") context(@Req() req: AuthenticatedRequest) {
    return this.subscription.getStaffContext(req.user.tenantId);
  }
}
