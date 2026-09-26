import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { SubscriptionService } from "./subscription.service";
import { SubmitSubscriptionRequestDto } from "./subscription-request.dto";

interface AuthenticatedRequest {
  user: SystemUserRow;
}

/**
 * 租户「版本与订阅」页与左下角到期浮窗（§5.2/§5.4）。
 *
 * 挂在 `/platform/subscription`（单数）下、audience=租户：操作对象恒为**调用者自身租户**
 * （`req.user.tenantId`），租户端不接受体内/路径租户，避免越权查看或申请他租户订阅。
 * 平台端跨租户管理走 `/platform/subscriptions`（复数）的 PlatformSubscriptionController。
 */
@Controller("platform/subscription")
export class TenantSubscriptionController {
  constructor(private readonly subscription: SubscriptionService) {}

  @Get("view") view(@Req() req: AuthenticatedRequest) {
    return this.subscription.getTenantView(req.user.tenantId);
  }

  @Get("reminder") reminder(@Req() req: AuthenticatedRequest) {
    return this.subscription.getReminder(req.user.tenantId);
  }

  @Post("requests") submit(@Req() req: AuthenticatedRequest, @Body() body: SubmitSubscriptionRequestDto) {
    return this.subscription.submitRequest(req.user.tenantId, body);
  }

  @Post("requests/:id/cancel") cancel(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.subscription.cancelRequest(req.user.tenantId, id);
  }
}
