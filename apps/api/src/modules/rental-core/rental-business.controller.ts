import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from "@nestjs/common";
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
  ApplyOfficialCalendarSourceDto,
  PublishRentalCalendarDto,
  RestoreRentalCalendarVersionDto,
  VoidRentalCalendarDto,
  RemoveRentalCalendarDayOverrideDto,
  SaveRentalCalendarDayDto,
  PreviewRentalCalendarRangeOverrideDto,
  ApplyRentalCalendarRangeOverrideDto,
  PreviewRentalCalendarRangeRemoveDto,
  ApplyRentalCalendarRangeRemoveDto,
  SaveRentalDiscountPlanDto,
  SaveRentalNotificationTemplateDto,
  SaveRentalPricingPlanDto,
  SaveRentalRuleVersionDto,
  SaveRentalValueAddedServiceDto,
} from "./rental-config-request.dto";
import { OfficialCalendarSourceService } from "./official-calendar-source.service";
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
    private readonly idempotent: RentalIdempotentActionService,
    private readonly officialSources: OfficialCalendarSourceService
  ) {}

  private context(tenantId: string): BusinessContext {
    const profile = this.core.getProfile(tenantId);
    const category = this.core.listCategories().find((item) => item.code === profile.categoryCode);
    if (!category) throw new Error("当前经营空间的品类定义不存在");
    return {
      profile,
      category,
      settings: this.core.getBusinessSettings(tenantId),
      groups: this.core.listItemGroups(tenantId),
      couponTemplates: this.core.listCouponTemplates(tenantId),
      locations: this.core.listLocations(tenantId),
      operators: this.core.listOperators(tenantId)
    };
  }

  /**
   * 是否可看到未发布的日历草稿（需求 4.5.8）：有编辑/发布/价格/规则任一管理权限者可看草稿以便编辑，
   * 只读的普通运营人员只应看到已发布日历。`*` 与平台管理员放行。
   */
  private canSeeCalendarDraft(user: SystemUserRow): boolean {
    const permissions = user.permissions ?? [];
    if (permissions.includes("*") || user.isPlatformAdmin) return true;
    return [
      "store-rental:calendar:edit",
      "store-rental:calendar:publish",
      "store-rental:price:manage",
      "store-rental:rules:manage"
    ].some((code) => permissions.includes(code));
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

  /**
   * 读取年度日历。附带「是否有官方更新」（需求 4.5.2：平台登记新官方版本后，为空间生成
   * 更新提示，**不得自动影响空间**）。因此这里只做比较与提示，不改任何状态。
   */
  @Get("calendars/:year") async calendar(@Req() req: AuthenticatedRequest, @Param("year") year: string) {
    const calendar = this.business.getCalendar(
      req.user.tenantId,
      this.context(req.user.tenantId),
      Number(year),
      this.canSeeCalendarDraft(req.user)
    );
    // 「有官方更新」只能在**同一来源**内比较：sequence 是 (来源, 年度) 内的局部序号，
    // 跨来源比大小会把「来源 A 的 v1.9」误报成「引用了来源 B v1.0 的空间该更新」。
    if (calendar.sourceVersionId) {
      // 已引用某来源：只和它自己的最新版比。版本不存在（被删/来源清理）就不提示，
      // 但**只**吞「不存在」——用 findVersionById 返回 undefined，数据库故障照常抛 5xx，
      // 不能用 getVersion().catch(() => undefined) 把基础设施错误也当成「无更新」。
      const referenced = await this.officialSources.findVersionById(calendar.sourceVersionId);
      if (!referenced) return calendar;
      const latest = await this.officialSources.latestVersionForYear(Number(year), referenced.sourceId);
      if (!latest) return calendar;
      return {
        ...calendar,
        latestOfficialSourceVersionId: latest.id,
        latestOfficialSourceVersion: latest.version,
        officialSourceUpdateAvailable: latest.id !== calendar.sourceVersionId
      };
    }
    // 从未引用任何官方来源：跨来源没有「全局最新版」概念（sequence/v1.x 只在各自来源内有效），
    // 因此**不返回** latestOfficialSourceVersion*，只按来源数量区分三种空状态：
    // 有可用来源（可选择）、登记过但全部停用（当前无可用）、从未登记。
    const summary = await this.officialSources.availableSourceSummaryForYear(Number(year));
    if (summary.available > 0) {
      return {
        ...calendar,
        officialSourceUpdateAvailable: false,
        officialSourceAvailableToSelect: true,
        availableOfficialSourceCount: summary.available
      };
    }
    if (summary.total > 0) {
      // 登记过但当前全部停用——不能显示「尚未登记」，那与事实不符。
      return { ...calendar, officialSourceUpdateAvailable: false, officialSourceRegisteredButUnavailable: true };
    }
    return calendar;
  }
  @Get("calendars/:year/versions") calendarVersions(@Req() req: AuthenticatedRequest, @Param("year") year: string) { return this.business.listCalendarVersions(req.user.tenantId, this.context(req.user.tenantId), Number(year)); }
  @Get("calendars/:year/versions/:version") calendarVersion(@Req() req: AuthenticatedRequest, @Param("year") year: string, @Param("version") version: string) { return this.business.getCalendarVersion(req.user.tenantId, this.context(req.user.tenantId), Number(year), version); }
  /**
   * 经营空间引用某个**公共官方来源版本**生成/更新本年度草稿（需求 4.5.2/4.5.8）。
   *
   * 空间侧不再接受原始官方日期：公共官方数据由 SaaS 平台管理员在注册表里维护，
   * 空间只能引用某一版并自行确认发布，否则「租户自行编造公共数据」且「导入即生效」。
   */
  @Post("calendars/:year/apply-official-source") async applyOfficialSource(
    @Req() req: AuthenticatedRequest,
    @Param("year") year: string,
    @Body() body: ApplyOfficialCalendarSourceDto
  ) {
    const version = await this.officialSources.getApplicableVersion(body.sourceVersionId);
    if (version.year !== Number(year)) {
      throw new BadRequestException(`该来源版本属于 ${version.year} 年度，与请求的 ${year} 年度不一致`);
    }
    return this.committed(
      req.user.tenantId,
      await this.business.importOfficialCalendar(req.user.tenantId, this.context(req.user.tenantId), {
        year: version.year,
        region: version.region,
        sourceName: version.sourceName,
        sourceUrl: version.sourceUrl,
        sourcePublishedAt: version.publishedAt,
        sourceVersionId: version.id,
        sourceVersion: version.version,
        days: version.days
      })
    );
  }
  /** 可引用的公共官方来源版本（只读）。空间人员据此选择要应用哪一版；只回有效来源。 */
  @Get("official-calendar-sources") officialSourceVersions(@Query("year") year?: string) {
    return this.officialSources.listVersions(undefined, year ? Number(year) : undefined, true);
  }
  /** 发布前影响预览（需求 4.5.8）。只读推演，不改任何状态、不触碰未来订单。 */
  @Get("calendars/:year/publish-preview") async calendarPublishPreview(@Req() req: AuthenticatedRequest, @Param("year") year: string) {
    const orders = await this.core.listOrders(req.user.tenantId);
    return this.business.previewCalendarPublish(
      req.user.tenantId,
      this.context(req.user.tenantId),
      Number(year),
      orders.map((order) => ({ id: order.id, orderNo: order.orderNo, status: order.status, startAt: order.startAt, endAt: order.endAt }))
    );
  }
  /** 覆盖审计流水（需求 4.5.3/4.5.8）。独立只追加表，不截断；可按版本过滤。 */
  @Get("calendars/:year/override-audits") calendarOverrideAudits(@Req() req: AuthenticatedRequest, @Param("year") year: string, @Query("version") version?: string) { return this.business.listCalendarOverrideAudits(req.user.tenantId, this.context(req.user.tenantId), Number(year), version); }
  @Put("calendars/:year/days/:date") async saveCalendarDay(@Req() req: AuthenticatedRequest, @Param("year") year: string, @Param("date") date: string, @Body() body: SaveRentalCalendarDayDto) { return this.committed(req.user.tenantId, await this.business.saveCalendarDay(req.user.tenantId, this.context(req.user.tenantId), Number(year), { ...body, date }, req.user.displayName)); }
  @Delete("calendars/:year/days/:date") async removeCalendarDayOverride(@Req() req: AuthenticatedRequest, @Param("year") year: string, @Param("date") date: string, @Body() body: RemoveRentalCalendarDayOverrideDto) { return this.committed(req.user.tenantId, await this.business.removeCalendarDayOverride(req.user.tenantId, this.context(req.user.tenantId), Number(year), date, body, req.user.displayName)); }
  /** 范围覆盖预览（需求 4.5.9）。POST 而非 GET：预览内容含未发布草稿，走编辑鉴权分支。 */
  @Post("calendars/:year/days/range-preview")
  @HttpCode(200)
  calendarRangePreview(@Req() req: AuthenticatedRequest, @Param("year") year: string, @Body() body: PreviewRentalCalendarRangeOverrideDto) { return this.business.previewCalendarRangeOverride(req.user.tenantId, this.context(req.user.tenantId), Number(year), body); }
  /** 应用范围覆盖：同事务全部成功或全部失败，一次 revision；既有覆盖须 overrideConfirmed。 */
  @Post("calendars/:year/days/range") async applyCalendarRange(@Req() req: AuthenticatedRequest, @Param("year") year: string, @Body() body: ApplyRentalCalendarRangeOverrideDto) { return this.committed(req.user.tenantId, await this.business.applyCalendarRangeOverride(req.user.tenantId, this.context(req.user.tenantId), Number(year), body, req.user.displayName)); }
  /** 范围移除预览：展示每个日期恢复后的取值与来源。 */
  @Post("calendars/:year/days/range-remove-preview")
  @HttpCode(200)
  calendarRangeRemovePreview(@Req() req: AuthenticatedRequest, @Param("year") year: string, @Body() body: PreviewRentalCalendarRangeRemoveDto) { return this.business.previewCalendarRangeRemove(req.user.tenantId, this.context(req.user.tenantId), Number(year), body); }
  /** 应用范围移除：只移除范围内带人工覆盖的日期，恢复下一优先级来源。 */
  @Post("calendars/:year/days/range-remove") async applyCalendarRangeRemove(@Req() req: AuthenticatedRequest, @Param("year") year: string, @Body() body: ApplyRentalCalendarRangeRemoveDto) { return this.committed(req.user.tenantId, await this.business.applyCalendarRangeRemove(req.user.tenantId, this.context(req.user.tenantId), Number(year), body, req.user.displayName)); }
  @Post("calendars/:year/publish") async publishCalendar(@Req() req: AuthenticatedRequest, @Param("year") year: string, @Body() body: PublishRentalCalendarDto) { return this.committed(req.user.tenantId, await this.business.publishCalendar(req.user.tenantId, this.context(req.user.tenantId), Number(year), body, req.user.displayName)); }
  @Post("calendars/:year/versions/:version/void") async voidCalendarVersion(@Req() req: AuthenticatedRequest, @Param("year") year: string, @Param("version") version: string, @Body() body: VoidRentalCalendarDto) { return this.committed(req.user.tenantId, await this.business.voidCalendarVersion(req.user.tenantId, this.context(req.user.tenantId), Number(year), version, body, req.user.displayName)); }
  /** 以某个历史版本的内容生成新草稿（需求 4.5.7 的「恢复旧规则」）。只产生草稿，仍需预检与发布。 */
  @Post("calendars/:year/versions/:version/restore") async restoreCalendarVersion(@Req() req: AuthenticatedRequest, @Param("year") year: string, @Param("version") version: string, @Body() body: RestoreRentalCalendarVersionDto) { return this.committed(req.user.tenantId, await this.business.restoreCalendarVersion(req.user.tenantId, this.context(req.user.tenantId), Number(year), version, body)); }

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
