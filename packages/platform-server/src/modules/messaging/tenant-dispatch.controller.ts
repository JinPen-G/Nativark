/** 当前租户原寄件事实的列表与详情 HTTP，业务来源和敏感投影沿真实参加者处理。 */
import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import type { TenantDispatchChannel, TenantDispatchSource } from "@rental-os/platform-contracts/tenant-messaging";
import { TenantDispatchQueryDto } from "./tenant-messaging-request.dto";
import { TENANT_DISPATCH_HTTP_APPLICATION, type TenantDispatchHttpApplication } from "./tenant-messaging-http.application";

@Controller("platform/dispatch")
export class TenantDispatchController {
  constructor(@Inject(TENANT_DISPATCH_HTTP_APPLICATION) private readonly dispatch: TenantDispatchHttpApplication) {}
  @Get() list(@Query() query: TenantDispatchQueryDto) { return this.dispatch.list(query); }
  @Get(":source/:id") detail(@Param("source") source: TenantDispatchSource, @Param("id") id: string, @Query("channel") channel: TenantDispatchChannel) {
    return this.dispatch.detail(source, id, channel);
  }
}
