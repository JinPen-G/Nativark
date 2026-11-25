/** 当前租户客服邮件读取与显式同步 HTTP，沿原邮箱 UID 台账、租约与操作审计。 */
import { Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { TenantSupportEmailQueryDto } from "./tenant-messaging-request.dto";
import { TENANT_SUPPORT_EMAIL_HTTP_APPLICATION, type TenantSupportEmailHttpApplication } from "./tenant-messaging-http.application";

@Controller("platform/support/emails")
export class TenantSupportEmailController {
  constructor(@Inject(TENANT_SUPPORT_EMAIL_HTTP_APPLICATION) private readonly support: TenantSupportEmailHttpApplication) {}
  @Get() list(@Query() query: TenantSupportEmailQueryDto) { return this.support.list(query); }
  @Get(":id") detail(@Param("id") id: string) { return this.support.detail(id); }
  @Post("sync") sync() { return this.support.sync(); }
}
