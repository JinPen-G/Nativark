import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { SubscriptionService } from "./subscription.service";
import {
  ExtendSubscriptionDto,
  GrantTenantFeatureDto,
  HandleSubscriptionRequestDto,
  ProvisionSubscriptionDto,
  RenewSubscriptionDto,
  RevokeTenantFeatureDto,
  ScheduleNextSubscriptionDto,
  SetStandardPriceDto,
  UpgradeSubscriptionProDto,
  UpsertFeatureCatalogDto
} from "./subscription-request.dto";

interface AuthenticatedRequest {
  user: SystemUserRow;
}

/**
 * SaaS 平台「租户订阅」管理（§7.1/§8）。挂 `/platform/subscriptions`（复数）、audience=SaaS 平台管理员。
 *
 * 守卫对本前缀有 fail-closed：非 SaaS 管理员（含各租户 isPlatformAdmin，其 hasAnyPermission
 * 对任何权限都放行）一律 403，避免跨租户越权。目标租户一律走**路径参数**，不放进请求体。
 * 具体读端点（feature-catalog / standard-prices）声明在 `:tenantId` 通配之前，避免被其吞掉。
 */
@Controller("platform/subscriptions")
export class PlatformSubscriptionController {
  constructor(private readonly subscription: SubscriptionService) {}

  @Get() list(
    @Query("plan") plan?: string,
    @Query("serviceStatus") serviceStatus?: string,
    @Query("dueWithin") dueWithin?: string,
    @Query("keyword") keyword?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return this.subscription.listOverviews({
      plan,
      serviceStatus,
      dueWithin: dueWithin === undefined ? undefined : Number(dueWithin),
      keyword,
      page: page === undefined ? undefined : Number(page),
      pageSize: pageSize === undefined ? undefined : Number(pageSize)
    });
  }

  @Get("feature-catalog") featureCatalog() {
    return this.subscription.listFeatureCatalog();
  }

  @Get("standard-prices") standardPrices() {
    return this.subscription.getStandardPrices();
  }
  @Patch("requests/:id") handle(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: HandleSubscriptionRequestDto) {
    return this.subscription.handleRequest(id, body, req.user.displayName);
  }

  @Put("feature-catalog/:code") upsertCatalog(@Req() req: AuthenticatedRequest, @Param("code") code: string, @Body() body: UpsertFeatureCatalogDto) {
    return this.subscription.upsertFeatureCatalog(code, { ...body, code }, req.user.displayName);
  }

  @Put("standard-prices/:plan") setPrice(@Req() req: AuthenticatedRequest, @Param("plan") _plan: string, @Body() body: SetStandardPriceDto) {
    // 以请求体里已过枚举校验的 plan 为准，路径参数仅用于 REST 定位，避免非法路径值绕过校验。
    return this.subscription.setStandardPrice(body.plan, body, req.user.displayName);
  }

  @Get(":tenantId") detail(@Param("tenantId") tenantId: string) {
    return this.subscription.getTenantView(tenantId, true);
  }

  @Post(":tenantId/provision") provision(@Req() req: AuthenticatedRequest, @Param("tenantId") tenantId: string, @Body() body: ProvisionSubscriptionDto) {
    return this.subscription.provision(tenantId, body, req.user.displayName);
  }

  @Post(":tenantId/renew") renew(@Req() req: AuthenticatedRequest, @Param("tenantId") tenantId: string, @Body() body: RenewSubscriptionDto) {
    return this.subscription.renew(tenantId, body, req.user.displayName);
  }

  @Post(":tenantId/upgrade") upgrade(@Req() req: AuthenticatedRequest, @Param("tenantId") tenantId: string, @Body() body: UpgradeSubscriptionProDto) {
    return this.subscription.upgradePro(tenantId, body, req.user.displayName);
  }

  @Post(":tenantId/extend") extend(@Req() req: AuthenticatedRequest, @Param("tenantId") tenantId: string, @Body() body: ExtendSubscriptionDto) {
    return this.subscription.extend(tenantId, body, req.user.displayName);
  }

  @Post(":tenantId/schedule-next") scheduleNext(@Req() req: AuthenticatedRequest, @Param("tenantId") tenantId: string, @Body() body: ScheduleNextSubscriptionDto) {
    return this.subscription.scheduleNext(tenantId, body, req.user.displayName);
  }

  @Post(":tenantId/feature-grants") grant(@Req() req: AuthenticatedRequest, @Param("tenantId") tenantId: string, @Body() body: GrantTenantFeatureDto) {
    return this.subscription.grantFeature(tenantId, body, req.user.displayName);
  }

  @Post(":tenantId/feature-grants/revoke") revoke(@Req() req: AuthenticatedRequest, @Param("tenantId") tenantId: string, @Body() body: RevokeTenantFeatureDto) {
    return this.subscription.revokeFeature(tenantId, body, req.user.displayName);
  }
}
