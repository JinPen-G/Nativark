import { Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import type {
  GrantRentalRewardRequest,
  ImportRentalCalendarRequest,
  RentalQuoteRequest,
  SaveRentalCalendarDayRequest,
  SaveRentalDiscountPlanRequest,
  SaveRentalNotificationTemplateRequest,
  SaveRentalPricingPlanRequest,
  SaveRentalRuleVersionRequest,
  SaveRentalValueAddedServiceRequest,
  SendRentalNotificationRequest,
  SystemUserRow
} from "@store-rental/shared";
import { RentalBusinessService, type BusinessContext } from "./rental-business.service";
import { RentalCoreService } from "./rental-core.service";

interface AuthenticatedRequest { user: SystemUserRow; }

@Controller("rental/v1")
export class RentalBusinessController {
  constructor(
    private readonly business: RentalBusinessService,
    private readonly core: RentalCoreService
  ) {}

  private context(tenantId: string): BusinessContext {
    const profile = this.core.getProfile(tenantId);
    const category = this.core.listCategories().find((item) => item.code === profile.categoryCode);
    if (!category) throw new Error("租户经营品类定义不存在");
    return {
      profile,
      category,
      settings: this.core.getBusinessSettings(tenantId),
      groups: this.core.listItemGroups(tenantId),
      couponTemplates: this.core.listCouponTemplates(tenantId)
    };
  }

  private async committed<T>(tenantId: string, result: T) {
    await Promise.all([this.business.persist(tenantId), this.core.persist(tenantId)]);
    return result;
  }

  @Get("pricing-plans") pricingPlans(@Req() req: AuthenticatedRequest) { return this.business.listPricingPlans(req.user.tenantId, this.context(req.user.tenantId)); }
  @Post("pricing-plans") createPricingPlan(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalPricingPlanRequest) { return this.committed(req.user.tenantId, this.business.savePricingPlan(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Put("pricing-plans/:id") updatePricingPlan(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalPricingPlanRequest) { return this.committed(req.user.tenantId, this.business.savePricingPlan(req.user.tenantId, this.context(req.user.tenantId), { ...body, id })); }

  @Get("discount-plans") discountPlans(@Req() req: AuthenticatedRequest) { return this.business.listDiscountPlans(req.user.tenantId, this.context(req.user.tenantId)); }
  @Post("discount-plans") createDiscountPlan(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalDiscountPlanRequest) { return this.committed(req.user.tenantId, this.business.saveDiscountPlan(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Put("discount-plans/:id") updateDiscountPlan(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalDiscountPlanRequest) { return this.committed(req.user.tenantId, this.business.saveDiscountPlan(req.user.tenantId, this.context(req.user.tenantId), { ...body, id })); }

  @Get("value-added-services") services(@Req() req: AuthenticatedRequest) { return this.business.listServices(req.user.tenantId, this.context(req.user.tenantId)); }
  @Post("value-added-services") createService(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalValueAddedServiceRequest) { return this.committed(req.user.tenantId, this.business.saveService(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Put("value-added-services/:id") updateService(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalValueAddedServiceRequest) { return this.committed(req.user.tenantId, this.business.saveService(req.user.tenantId, this.context(req.user.tenantId), { ...body, id })); }

  @Get("calendars/:year") calendar(@Req() req: AuthenticatedRequest, @Param("year") year: string) { return this.business.getCalendar(req.user.tenantId, this.context(req.user.tenantId), Number(year)); }
  @Post("calendars/import") importCalendar(@Req() req: AuthenticatedRequest, @Body() body: ImportRentalCalendarRequest) { return this.committed(req.user.tenantId, this.business.importOfficialCalendar(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Put("calendars/:year/days/:date") saveCalendarDay(@Req() req: AuthenticatedRequest, @Param("year") year: string, @Param("date") date: string, @Body() body: SaveRentalCalendarDayRequest) { return this.committed(req.user.tenantId, this.business.saveCalendarDay(req.user.tenantId, this.context(req.user.tenantId), Number(year), { ...body, date })); }
  @Post("calendars/:year/publish") publishCalendar(@Req() req: AuthenticatedRequest, @Param("year") year: string) { return this.committed(req.user.tenantId, this.business.publishCalendar(req.user.tenantId, this.context(req.user.tenantId), Number(year))); }

  @Get("rule-versions") ruleVersions(@Req() req: AuthenticatedRequest) { return this.business.listRuleVersions(req.user.tenantId, this.context(req.user.tenantId)); }
  @Get("rule-versions/current") currentRule(@Req() req: AuthenticatedRequest) { return this.business.currentRule(req.user.tenantId, this.context(req.user.tenantId)); }
  @Post("rule-versions") saveRule(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalRuleVersionRequest) { return this.committed(req.user.tenantId, this.business.saveRuleVersion(req.user.tenantId, this.context(req.user.tenantId), body, req.user.displayName)); }

  @Get("customer-coupons") customerCoupons(@Req() req: AuthenticatedRequest, @Query("customerId") customerId?: string) { return this.business.listCustomerCoupons(req.user.tenantId, this.context(req.user.tenantId), customerId); }
  @Post("customer-coupons/claim") claimCoupon(@Req() req: AuthenticatedRequest, @Body() body: { templateId: string; customerId: string }) { return this.committed(req.user.tenantId, this.business.claimCoupon(req.user.tenantId, this.context(req.user.tenantId), body.templateId, body.customerId)); }

  @Get("rewards") rewards(@Req() req: AuthenticatedRequest, @Query("customerId") customerId?: string) { return this.business.listRewards(req.user.tenantId, this.context(req.user.tenantId), customerId); }
  @Get("benefit-accounts") benefitAccounts(@Req() req: AuthenticatedRequest, @Query("customerId") customerId?: string) { return this.business.listBenefitAccounts(req.user.tenantId, this.context(req.user.tenantId), customerId); }
  @Post("rewards/grant") grantReward(@Req() req: AuthenticatedRequest, @Body() body: GrantRentalRewardRequest) { return this.committed(req.user.tenantId, this.business.grantReward(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Post("rewards/:id/reverse") reverseReward(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: { reason: string }) { return this.committed(req.user.tenantId, this.business.reverseReward(req.user.tenantId, this.context(req.user.tenantId), id, body.reason)); }

  @Get("notification-templates") notificationTemplates(@Req() req: AuthenticatedRequest) { return this.business.listNotificationTemplates(req.user.tenantId, this.context(req.user.tenantId)); }
  @Post("notification-templates") createNotificationTemplate(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalNotificationTemplateRequest) { return this.committed(req.user.tenantId, this.business.saveNotificationTemplate(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Put("notification-templates/:id") updateNotificationTemplate(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalNotificationTemplateRequest) { return this.committed(req.user.tenantId, this.business.saveNotificationTemplate(req.user.tenantId, this.context(req.user.tenantId), { ...body, id })); }
  @Get("notification-logs") notificationLogs(@Req() req: AuthenticatedRequest) { return this.business.listNotificationLogs(req.user.tenantId, this.context(req.user.tenantId)); }
  @Post("notifications/send") sendNotification(@Req() req: AuthenticatedRequest, @Body() body: SendRentalNotificationRequest) { return this.committed(req.user.tenantId, this.business.sendNotification(req.user.tenantId, this.context(req.user.tenantId), body)); }

  @Post("quotes") quote(@Req() req: AuthenticatedRequest, @Body() body: RentalQuoteRequest) { return this.committed(req.user.tenantId, this.business.createQuote(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Get("quotes/:id") quoteDetail(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.business.getQuote(req.user.tenantId, this.context(req.user.tenantId), id); }
}
