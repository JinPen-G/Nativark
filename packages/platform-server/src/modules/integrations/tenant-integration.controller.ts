/** 原租户第三方目录、保存和测试HTTP。当前主体由Guard建立，凭据只传到服务端配置与探针。 */
import { Body, Controller, Get, Inject, Param, Post, Put, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { SaveTenantIntegrationDto, TenantIntegrationRouteDto } from "./tenant-integration-request.dto";
import { TenantIntegrationConnectivityService } from "./tenant-integration.connectivity.service";
import { TenantIntegrationService } from "./tenant-integration.service";

import { TENANT_INTEGRATION_APPLICATION, TENANT_INTEGRATION_CONNECTIVITY } from "./integration-store";

interface RequestWithUser { user?: SystemUserRow; }

@Controller("platform/integrations")
export class TenantIntegrationController {
  constructor(
    @Inject(TENANT_INTEGRATION_APPLICATION) private readonly service: TenantIntegrationService,
    @Inject(TENANT_INTEGRATION_CONNECTIVITY) private readonly connectivity: TenantIntegrationConnectivityService
  ) {}

  @Get()
  list(@Req() req: RequestWithUser) {
    return this.service.catalog(req.user?.tenantId);
  }

  @Put(":capability/:provider")
  save(@Param() route: TenantIntegrationRouteDto, @Body() body: SaveTenantIntegrationDto, @Req() req: RequestWithUser) {
    return this.service.save(route.capability, route.provider, body, req.user);
  }

  @Post(":capability/:provider/test")
  test(@Param() route: TenantIntegrationRouteDto, @Req() req: RequestWithUser) {
    return this.connectivity.test(route.capability, route.provider, req.user);
  }
}
