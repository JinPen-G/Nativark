/** 公开一次性邀请凭证入口，先执行原 IP 限流，再读取或接受原邀请。 */
import { Body, Controller, Inject, Post, Req } from "@nestjs/common";
import { AcceptTenantOperatorInvitationDto, InspectTenantOperatorInvitationDto } from "./tenant-messaging-request.dto";
import {
  TENANT_OPERATOR_INVITATIONS_HTTP_APPLICATION,
  type TenantOperatorInvitationsHttpApplication
} from "./tenant-messaging-http.application";

@Controller("auth/operator-invitations")
export class AcceptTenantOperatorInvitationController {
  constructor(@Inject(TENANT_OPERATOR_INVITATIONS_HTTP_APPLICATION)
    private readonly invitations: TenantOperatorInvitationsHttpApplication) {}
  @Post("inspect") inspect(@Body() body: InspectTenantOperatorInvitationDto, @Req() req: { ip?: string }) {
    this.invitations.assertPublicRate(req.ip); return this.invitations.inspect(body.token);
  }
  @Post("accept") accept(@Body() body: AcceptTenantOperatorInvitationDto, @Req() req: { ip?: string }) {
    this.invitations.assertPublicRate(req.ip); return this.invitations.accept(body);
  }
}
