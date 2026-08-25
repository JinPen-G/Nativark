import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import type {
  RentalCouponTemplate,
  RentalCustomerCoupon,
  RentalNotificationSendLogV1,
  SystemUserRow
} from "@store-rental/shared";
import { RentalBusinessService, type BusinessContext } from "./rental-business.service";
import {
  GrantRentalRewardDto,
  RentalQuoteDto,
  SendRentalNotificationDto,
} from "./rental-order-request.dto";
import {
  ImportRentalCalendarDto,
  SaveRentalCalendarDayDto,
  SaveRentalDiscountPlanDto,
  SaveRentalNotificationTemplateDto,
  SaveRentalPricingPlanDto,
  SaveRentalRuleVersionDto,
  SaveRentalValueAddedServiceDto,
} from "./rental-config-request.dto";
import { RentalCoreService } from "./rental-core.service";
import { RentalIdempotentActionService } from "./rental-idempotent-action.service";

interface AuthenticatedRequest { user: SystemUserRow; headers?: Record<string, unknown>; }

/**
 * 领券与发通知**不是天然幂等**的动作：同一客户可以合法地多次领同一模板的券
 * （受 perCustomerLimit 约束），同一模板也可以合法地多次发送。因此不能像订单
 * 动作那样凭「订单 + 目标状态」构造兜底键——没有键时，「重试」与「第二次合法请求」
 * 在服务端无法区分，硬造兜底键只会把第二次合法请求错误地回放成第一次的结果。
 *
 * 所以这两个动作只在调用方显式传 `Idempotency-Key` 时提供幂等保护，不传时保持
 * 原语义。这既与主流支付网关一致，也避免凭空发明业务语义。
 * 长度上限与幂等表列宽一致，理由见 rental-core.controller.ts 的同名常量。
 */
const IDEMPOTENCY_KEY_MAX_LENGTH = 191;

function explicitIdempotencyKey(req: { headers?: Record<string, unknown> }): string | undefined {
  const raw = req.headers?.["idempotency-key"] ?? req.headers?.["Idempotency-Key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new BadRequestException(`Idempotency-Key 过长，最多 ${IDEMPOTENCY_KEY_MAX_LENGTH} 个字符`);
  }
  return trimmed;
}

@Controller("rental/v1")
export class RentalBusinessController {
  constructor(
    private readonly business: RentalBusinessService,
    private readonly core: RentalCoreService,
    private readonly idempotent: RentalIdempotentActionService
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

  // 必须先 await 业务结果再写快照：核心服务的配置写方法已转为异步，若直接把 Promise
  // 传进来就会与快照写入并发，快照可能捕获到变更前的状态。
  private async committed<T>(tenantId: string, result: T | Promise<T>): Promise<T> {
    const resolved = await result;
    await Promise.all([this.business.persist(tenantId), this.core.persist(tenantId)]);
    return resolved;
  }

  @Get("pricing-plans") pricingPlans(@Req() req: AuthenticatedRequest) { return this.business.listPricingPlans(req.user.tenantId, this.context(req.user.tenantId)); }
  @Post("pricing-plans") async createPricingPlan(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalPricingPlanDto) { return this.committed(req.user.tenantId, await this.business.savePricingPlan(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Put("pricing-plans/:id") async updatePricingPlan(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalPricingPlanDto) { return this.committed(req.user.tenantId, await this.business.savePricingPlan(req.user.tenantId, this.context(req.user.tenantId), { ...body, id })); }

  @Get("discount-plans") discountPlans(@Req() req: AuthenticatedRequest) { return this.business.listDiscountPlans(req.user.tenantId, this.context(req.user.tenantId)); }
  @Post("discount-plans") async createDiscountPlan(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalDiscountPlanDto) { return this.committed(req.user.tenantId, await this.business.saveDiscountPlan(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Put("discount-plans/:id") async updateDiscountPlan(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalDiscountPlanDto) { return this.committed(req.user.tenantId, await this.business.saveDiscountPlan(req.user.tenantId, this.context(req.user.tenantId), { ...body, id })); }

  @Get("value-added-services") services(@Req() req: AuthenticatedRequest) { return this.business.listServices(req.user.tenantId, this.context(req.user.tenantId)); }
  @Post("value-added-services") async createService(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalValueAddedServiceDto) { return this.committed(req.user.tenantId, await this.business.saveService(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Put("value-added-services/:id") async updateService(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalValueAddedServiceDto) { return this.committed(req.user.tenantId, await this.business.saveService(req.user.tenantId, this.context(req.user.tenantId), { ...body, id })); }

  @Get("calendars/:year") calendar(@Req() req: AuthenticatedRequest, @Param("year") year: string) { return this.business.getCalendar(req.user.tenantId, this.context(req.user.tenantId), Number(year)); }
  @Post("calendars/import") async importCalendar(@Req() req: AuthenticatedRequest, @Body() body: ImportRentalCalendarDto) { return this.committed(req.user.tenantId, await this.business.importOfficialCalendar(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Put("calendars/:year/days/:date") async saveCalendarDay(@Req() req: AuthenticatedRequest, @Param("year") year: string, @Param("date") date: string, @Body() body: SaveRentalCalendarDayDto) { return this.committed(req.user.tenantId, await this.business.saveCalendarDay(req.user.tenantId, this.context(req.user.tenantId), Number(year), { ...body, date })); }
  @Post("calendars/:year/publish") async publishCalendar(@Req() req: AuthenticatedRequest, @Param("year") year: string) { return this.committed(req.user.tenantId, await this.business.publishCalendar(req.user.tenantId, this.context(req.user.tenantId), Number(year))); }

  @Get("rule-versions") ruleVersions(@Req() req: AuthenticatedRequest) { return this.business.listRuleVersions(req.user.tenantId, this.context(req.user.tenantId)); }
  @Get("rule-versions/current") currentRule(@Req() req: AuthenticatedRequest) { return this.business.currentRule(req.user.tenantId, this.context(req.user.tenantId)); }
  @Post("rule-versions") async saveRule(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalRuleVersionDto) { return this.committed(req.user.tenantId, await this.business.saveRuleVersion(req.user.tenantId, this.context(req.user.tenantId), body, req.user.displayName)); }

  @Get("customer-coupons") customerCoupons(@Req() req: AuthenticatedRequest, @Query("customerId") customerId?: string) { return this.business.listCustomerCoupons(req.user.tenantId, this.context(req.user.tenantId), customerId); }
  @Post("customer-coupons/claim") async claimCoupon(@Req() req: AuthenticatedRequest, @Body() body: { templateId: string; customerId: string }) {
    const tenantId = req.user.tenantId;
    const key = explicitIdempotencyKey(req);
    const context = this.context(tenantId);
    // 不传键时保持原语义：第二次请求是合法的第二次领取（受 perCustomerLimit 约束）。
    if (!key) return this.committed(tenantId, (await this.business.claimCoupon(tenantId, context, body.templateId, body.customerId)).coupon);
    const { result, replayed } = await this.idempotent.executeWithReplayFlag({
      tenantId,
      action: "coupon.claim",
      key,
      // 有显式键时 fallbackKey 用不到，给同值以免误用。
      fallbackKey: key,
      request: { templateId: body.templateId, customerId: body.customerId },
      // tx 必须真的传下去：否则领券与幂等登记各自独立提交，
      // 事务回滚撤不回券和 claimedQuantity。
      run: (tx) => this.business.claimCoupon(tenantId, context, body.templateId, body.customerId, tx),
      // 领券没有"目标状态"可查，登记的那张券本身就是结果。
      replay: async (response) => (response ?? undefined) as { coupon: RentalCustomerCoupon; template: RentalCouponTemplate } | undefined
    });
    // 只有真正执行过才落缓存；回放说明缓存在首次执行时已经更新过。
    if (!replayed) this.business.applyCouponClaimToCache(tenantId, context, result.coupon, result.template);
    return this.committed(tenantId, result.coupon);
  }

  @Get("rewards") rewards(@Req() req: AuthenticatedRequest, @Query("customerId") customerId?: string) { return this.business.listRewards(req.user.tenantId, this.context(req.user.tenantId), customerId); }
  @Get("benefit-accounts") benefitAccounts(@Req() req: AuthenticatedRequest, @Query("customerId") customerId?: string) { return this.business.listBenefitAccounts(req.user.tenantId, this.context(req.user.tenantId), customerId); }
  @Post("rewards/grant") async grantReward(@Req() req: AuthenticatedRequest, @Body() body: GrantRentalRewardDto) { return this.committed(req.user.tenantId, await this.business.grantReward(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Post("rewards/:id/reverse") async reverseReward(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: { reason: string }) { return this.committed(req.user.tenantId, await this.business.reverseReward(req.user.tenantId, this.context(req.user.tenantId), id, body.reason)); }

  @Get("notification-templates") notificationTemplates(@Req() req: AuthenticatedRequest) { return this.business.listNotificationTemplates(req.user.tenantId, this.context(req.user.tenantId)); }
  @Post("notification-templates") async createNotificationTemplate(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalNotificationTemplateDto) { return this.committed(req.user.tenantId, await this.business.saveNotificationTemplate(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Put("notification-templates/:id") async updateNotificationTemplate(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalNotificationTemplateDto) { return this.committed(req.user.tenantId, await this.business.saveNotificationTemplate(req.user.tenantId, this.context(req.user.tenantId), { ...body, id })); }
  @Get("notification-logs") notificationLogs(@Req() req: AuthenticatedRequest) { return this.business.listNotificationLogs(req.user.tenantId, this.context(req.user.tenantId)); }
  @Post("notifications/send") async sendNotification(@Req() req: AuthenticatedRequest, @Body() body: SendRentalNotificationDto) {
    const tenantId = req.user.tenantId;
    const key = explicitIdempotencyKey(req);
    const context = this.context(tenantId);
    if (!key) return this.committed(tenantId, await this.business.sendNotification(tenantId, context, body));
    const { result, replayed } = await this.idempotent.executeWithReplayFlag({
      tenantId,
      action: "notification.send",
      key,
      fallbackKey: key,
      request: { templateId: body.templateId, recipient: body.recipient, variables: body.variables },
      // tx 必须真的传下去：否则通知记录独立提交，两个同键并发请求会各写一条日志，
      // 只有幂等表的一条记录获胜——接口看似回放，副作用已经发生两次。
      run: (tx) => this.business.sendNotification(tenantId, context, body, tx),
      replay: async (response) => (response ?? undefined) as RentalNotificationSendLogV1 | undefined
    });
    if (!replayed) this.business.applyNotificationLogToCache(tenantId, context, result);
    return this.committed(tenantId, result);
  }

  @Post("quotes") async quote(@Req() req: AuthenticatedRequest, @Body() body: RentalQuoteDto) { return this.committed(req.user.tenantId, await this.business.createQuote(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Get("quotes/:id") quoteDetail(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.business.getQuote(req.user.tenantId, this.context(req.user.tenantId), id); }
}
