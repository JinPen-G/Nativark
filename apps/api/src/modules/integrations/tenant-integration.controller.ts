import { Body, Controller, Get, Param, Post, Put, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { SaveTenantIntegrationDto, TenantIntegrationRouteDto } from "./tenant-integration-request.dto";
import { TenantIntegrationConnectivityService } from "./tenant-integration.connectivity.service";
import { TenantIntegrationService } from "./tenant-integration.service";

interface RequestWithUser { user?: SystemUserRow; }

@Controller("platform/integrations")
export class TenantIntegrationController {
  constructor(
    private readonly service: TenantIntegrationService,
    private readonly connectivity: TenantIntegrationConnectivityService
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
