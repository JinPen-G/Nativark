import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { TenantSupportEmailQueryDto } from "./tenant-messaging-request.dto";
import { TenantSupportEmailService } from "./tenant-support-email.service";

@Controller("platform/support/emails")
export class TenantSupportEmailController {
  constructor(private readonly support: TenantSupportEmailService) {}
  @Get() list(@Query() query: TenantSupportEmailQueryDto) { return this.support.list(query); }
  @Get(":id") detail(@Param("id") id: string) { return this.support.detail(id); }
  @Post("sync") sync() { return this.support.sync(); }
}
