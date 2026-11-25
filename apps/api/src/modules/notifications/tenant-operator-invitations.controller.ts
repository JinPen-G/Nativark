/** 原 Rental 邀请入口复用公共 HTTP，创建与预览仍校验原经营空间请求。 */
import { Body, Controller, Inject, Post } from "@nestjs/common";
import { TenantOperatorInvitationsController as PublicTenantOperatorInvitationsController } from "@rental-os/platform-server/messaging";
import { InviteTenantOperatorDto } from "./tenant-messaging-request.dto";
import { TenantOperatorInvitationsService } from "./tenant-operator-invitations.service";

@Controller("platform/users/invitations")
export class TenantOperatorInvitationsController extends PublicTenantOperatorInvitationsController {
  constructor(@Inject(TenantOperatorInvitationsService) invitations: TenantOperatorInvitationsService) { super(invitations); }
  @Post("preview") preview(@Body() body: InviteTenantOperatorDto) { return super.preview(body); }
  @Post() invite(@Body() body: InviteTenantOperatorDto) { return super.invite(body); }
}
