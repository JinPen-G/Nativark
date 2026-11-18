import { Controller, Get, Param, Query } from "@nestjs/common";
import type { TenantDispatchChannel, TenantDispatchSource } from "@rental-os/shared";
import { TenantDispatchQueryDto } from "./tenant-messaging-request.dto";
import { TenantDispatchService } from "./tenant-dispatch.service";

@Controller("platform/dispatch")
export class TenantDispatchController {
  constructor(private readonly dispatch: TenantDispatchService) {}
  @Get() list(@Query() query: TenantDispatchQueryDto) { return this.dispatch.list(query); }
  @Get(":source/:id") detail(@Param("source") source: TenantDispatchSource, @Param("id") id: string, @Query("channel") channel: TenantDispatchChannel) {
    return this.dispatch.detail(source, id, channel);
  }
}
