import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CheckTenantOperatorEmailDto, InviteTenantOperatorDto } from "./tenant-messaging-request.dto";
import { TenantOperatorInvitationsService } from "./tenant-operator-invitations.service";

@Controller("platform/users/invitations")
export class TenantOperatorInvitationsController {
  constructor(private readonly invitations: TenantOperatorInvitationsService) {}
  @Get() list() { return this.invitations.list(); }
  @Post("check-email") check(@Body() body: CheckTenantOperatorEmailDto) { return this.invitations.checkEmail(body.email); }
  @Post("preview") preview(@Body() body: InviteTenantOperatorDto) { return this.invitations.mailPreview(body); }
  @Get("by-key/:key") read(@Param("key") key: string) { return this.invitations.readByKey(key); }
  @Post() invite(@Body() body: InviteTenantOperatorDto) { return this.invitations.send(body); }
  @Post(":id/revoke") revoke(@Param("id") id: string) { return this.invitations.revoke(id); }
}
