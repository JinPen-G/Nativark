import { Body, Controller, Post, Req } from "@nestjs/common";
import { AcceptTenantOperatorInvitationDto, InspectTenantOperatorInvitationDto } from "./tenant-messaging-request.dto";
import { TenantOperatorInvitationsService } from "./tenant-operator-invitations.service";

@Controller("auth/operator-invitations")
export class AcceptTenantOperatorInvitationController {
  constructor(private readonly invitations: TenantOperatorInvitationsService) {}
  @Post("inspect") inspect(@Body() body: InspectTenantOperatorInvitationDto, @Req() req: { ip?: string }) {
    this.invitations.assertPublicRate(req.ip); return this.invitations.inspect(body.token);
  }
  @Post("accept") accept(@Body() body: AcceptTenantOperatorInvitationDto, @Req() req: { ip?: string }) {
    this.invitations.assertPublicRate(req.ip); return this.invitations.accept(body);
  }
}
