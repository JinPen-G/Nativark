/** 当前租户邀请管理 HTTP，身份由 Guard 建立，账号和业务授权由应用真实权威复验。 */
import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { CheckTenantOperatorEmailDto, InviteTenantOperatorDto } from "./tenant-messaging-request.dto";
import {
  TENANT_OPERATOR_INVITATIONS_HTTP_APPLICATION,
  type TenantOperatorInvitationsHttpApplication
} from "./tenant-messaging-http.application";

@Controller("platform/users/invitations")
export class TenantOperatorInvitationsController {
  constructor(@Inject(TENANT_OPERATOR_INVITATIONS_HTTP_APPLICATION)
    private readonly invitations: TenantOperatorInvitationsHttpApplication) {}
  @Get() list() { return this.invitations.list(); }
  @Post("check-email") check(@Body() body: CheckTenantOperatorEmailDto) { return this.invitations.checkEmail(body.email); }
  @Post("preview") preview(@Body() body: InviteTenantOperatorDto) { return this.invitations.mailPreview(body); }
  @Get("by-key/:key") read(@Param("key") key: string) { return this.invitations.readByKey(key); }
  @Post() invite(@Body() body: InviteTenantOperatorDto) { return this.invitations.send(body); }
  @Post(":id/revoke") revoke(@Param("id") id: string) { return this.invitations.revoke(id); }
}
