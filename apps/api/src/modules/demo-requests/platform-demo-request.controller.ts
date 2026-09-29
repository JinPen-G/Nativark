import { Controller, ForbiddenException, Get, Header, Query, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { DemoRequestListQueryDto } from "./demo-request.dto";
import { DemoRequestService } from "./demo-request.service";

@Controller("platform/demo-requests")
export class PlatformDemoRequestController {
  constructor(private readonly requests: DemoRequestService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(@Req() request: { user?: SystemUserRow }, @Query() query: DemoRequestListQueryDto) {
    // 双重保护：租户内的管理员/通配权限也不能读取平台线索。
    if (!request.user?.isSaasAdmin) throw new ForbiddenException("仅 SaaS 平台管理员可以查看演示预约");
    return this.requests.list(query);
  }
}
