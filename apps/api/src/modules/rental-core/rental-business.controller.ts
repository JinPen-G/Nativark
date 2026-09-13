import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from "@nestjs/common";
import type {
  RentalCouponTemplate,
  RentalCustomerCoupon,
  RentalNotificationSendLogV1,
  SystemUserRow
} from "@rental-os/shared";
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
  CreateRentalPriceAdjustmentDto,
  CancelRentalPriceAdjustmentDto,
  RestoreRentalPriceVersionDto,
  SaveRentalDiscountPlanDto,
  SaveRentalNotificationTemplateDto,
  SaveRentalPricingPlanDto,
  SaveRentalRuleVersionDto,
  PublishRentalRuleVersionDto,
  RestoreRentalRuleVersionDto,
  VoidRentalRuleVersionDto,
  SaveRentalValueAddedServiceDto,
  SaveRentalServiceCapacityDto,
} from "./rental-config-request.dto";
import { OfficialCalendarSourceService } from "./official-calendar-source.service";
import { RentalCoreService } from "./rental-core.service";
import { RentalIdempotentActionService } from "./rental-idempotent-action.service";
import { RentalFundingService } from "./rental-funding.service";
import { RentalServiceCapacityService } from "./rental-service-capacity.service";
import {
  InitiateRentalFundingDto,
  RentalFundingAmountDto,
  RentalFundingReleaseDto,
  RentalFundingFailureDto,
} from "./rental-order-request.dto";

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
    private readonly funding: RentalFundingService,
    private readonly officialSources: OfficialCalendarSourceService,
    private readonly serviceCapacities: RentalServiceCapacityService
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
      pricingGroups: this.core.listPricingGroups(tenantId),
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
      "rental-os:calendar:edit",
      "rental-os:calendar:publish",
      "rental-os:price:manage",
      "rental-os:rules:manage"
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
  /** PRICE-03：空间级不可变价格版本历史。版本粒度是当前会话经营空间，不依赖 planId。 */
  @Get("pricing-versions") priceVersions(@Req() req: AuthenticatedRequest, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.business.listSpacePriceVersions(req.user.tenantId, this.context(req.user.tenantId), Number(page) || 1, Number(pageSize) || 20);
  }
  /** PRICE-03：空间级价格版本完整回放。 */
  @Get("pricing-versions/:sequence") priceVersion(@Req() req: AuthenticatedRequest, @Param("sequence") sequence: string) {
    return this.business.getSpacePriceVersion(req.user.tenantId, this.context(req.user.tenantId), Number(sequence));
  }
  /** 以历史完整快照追加一条恢复版本，历史版本不原地修改。 */
  @Post("pricing-versions/:sequence/restore") restorePriceVersion(@Req() req: AuthenticatedRequest, @Param("sequence") sequence: string, @Body() body: RestoreRentalPriceVersionDto) {
    return this.committed(req.user.tenantId, this.business.restoreSpacePriceVersion(req.user.tenantId, this.context(req.user.tenantId), Number(sequence), body.reason, req.user.displayName));
  }
  /** PRICE-03 兼容入口：planId 只作当前空间归属校验，实际返回仍是空间版本。 */
  @Get("pricing-plans/:id/versions") legacyPriceVersions(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.business.listPriceVersions(req.user.tenantId, this.context(req.user.tenantId), id, Number(page) || 1, Number(pageSize) || 20);
  }
  /** PRICE-03：调价计划列表，planId 仍代表发起调整的编辑计划。 */
  @Get("pricing-plans/:id/adjustments") listPriceAdjustments(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.business.listPriceAdjustments(req.user.tenantId, this.context(req.user.tenantId), id); }
  /** PRICE-03：执行到期的待生效调价（定时执行与立即执行走同一版本机制）。 */
  @Post("pricing-plans/adjustments/run-due") runDuePriceAdjustments(@Req() req: AuthenticatedRequest) { return this.committed(req.user.tenantId, this.business.runDuePriceAdjustments(req.user.tenantId, this.context(req.user.tenantId))); }
  /** PRICE-03：创建调价计划（差异 + 逐行最终价预览）。 */
  @Post("pricing-plans/:id/adjustments") createPriceAdjustment(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: CreateRentalPriceAdjustmentDto) { return this.business.createPriceAdjustment(req.user.tenantId, this.context(req.user.tenantId), id, body, req.user.displayName); }
  /** PRICE-03：确认——立即执行生成新版本；scheduledAt 在未来则进入待生效。 */
  @Post("pricing-plans/:id/adjustments/:aid/confirm") confirmPriceAdjustment(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("aid") aid: string) { return this.committed(req.user.tenantId, this.business.confirmPriceAdjustment(req.user.tenantId, this.context(req.user.tenantId), id, aid, req.user.displayName)); }
  /** PRICE-03：取消（草稿/待生效可取消，已生效不可撤回）。 */
  @Post("pricing-plans/:id/adjustments/:aid/cancel") cancelPriceAdjustment(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("aid") aid: string, @Body() body: CancelRentalPriceAdjustmentDto) { return this.business.cancelPriceAdjustment(req.user.tenantId, this.context(req.user.tenantId), id, aid, body.reason); }

  /** 运营端主入口：调价以经营空间为范围，不要求用户理解内部价格计划行。 */
  @Get("pricing-adjustments") listSpacePriceAdjustments(@Req() req: AuthenticatedRequest) { return this.business.listSpacePriceAdjustments(req.user.tenantId, this.context(req.user.tenantId)); }
  @Post("pricing-adjustments") createSpacePriceAdjustment(@Req() req: AuthenticatedRequest, @Body() body: CreateRentalPriceAdjustmentDto) { return this.business.createSpacePriceAdjustment(req.user.tenantId, this.context(req.user.tenantId), body, req.user.displayName); }
  @Post("pricing-adjustments/:aid/confirm") confirmSpacePriceAdjustment(@Req() req: AuthenticatedRequest, @Param("aid") aid: string) { return this.committed(req.user.tenantId, this.business.confirmSpacePriceAdjustment(req.user.tenantId, this.context(req.user.tenantId), aid, req.user.displayName)); }
  @Post("pricing-adjustments/:aid/cancel") cancelSpacePriceAdjustment(@Req() req: AuthenticatedRequest, @Param("aid") aid: string, @Body() body: CancelRentalPriceAdjustmentDto) { return this.business.cancelSpacePriceAdjustment(req.user.tenantId, this.context(req.user.tenantId), aid, body.reason); }

  @Get("discount-plans") discountPlans(@Req() req: AuthenticatedRequest) { return this.business.listDiscountPlans(req.user.tenantId, this.context(req.user.tenantId)); }
  @Post("discount-plans") async createDiscountPlan(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalDiscountPlanDto) { return this.committed(req.user.tenantId, await this.business.saveDiscountPlan(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Put("discount-plans/:id") async updateDiscountPlan(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalDiscountPlanDto) { return this.committed(req.user.tenantId, await this.business.saveDiscountPlan(req.user.tenantId, this.context(req.user.tenantId), { ...body, id })); }

  @Get("value-added-services") services(@Req() req: AuthenticatedRequest) { return this.business.listServices(req.user.tenantId, this.context(req.user.tenantId)); }
  @Post("value-added-services") async createService(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalValueAddedServiceDto) { return this.committed(req.user.tenantId, await this.business.saveService(req.user.tenantId, this.context(req.user.tenantId), body)); }
  @Put("value-added-services/:id") async updateService(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalValueAddedServiceDto) { return this.committed(req.user.tenantId, await this.business.saveService(req.user.tenantId, this.context(req.user.tenantId), { ...body, id })); }
  @Get("service-capacities") serviceCapacityList(@Req() req: AuthenticatedRequest, @Query("serviceId") serviceId?: string) {
    return this.serviceCapacities.listCapacities(req.user.tenantId, serviceId);
  }
  @Post("service-capacities") createServiceCapacity(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalServiceCapacityDto) {
    return this.serviceCapacities.saveCapacity(req.user.tenantId, body);
  }
  @Put("service-capacities/:id") updateServiceCapacity(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalServiceCapacityDto) {
    return this.serviceCapacities.saveCapacity(req.user.tenantId, { ...body, id });
  }

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
    // PRICE-02B：分时价格摘要（只读消费价格版本，与报价同一命中助手与营业时区）。
    const timePriceSummary = await this.business.timePriceSummaryForYear(req.user.tenantId, this.context(req.user.tenantId), Number(year));
    // 「有官方更新」只能在**同一来源**内比较：sequence 是 (来源, 年度) 内的局部序号，
    // 跨来源比大小会把「来源 A 的 v1.9」误报成「引用了来源 B v1.0 的空间该更新」。
    if (calendar.sourceVersionId) {
      // 已引用某来源：只和它自己的最新版比。版本不存在（被删/来源清理）就不提示，
      // 但**只**吞「不存在」——用 findVersionById 返回 undefined，数据库故障照常抛 5xx，
      // 不能用 getVersion().catch(() => undefined) 把基础设施错误也当成「无更新」。
      const referenced = await this.officialSources.findVersionById(calendar.sourceVersionId);
      if (!referenced) return { ...calendar, timePriceSummary };
      const latest = await this.officialSources.latestVersionForYear(Number(year), referenced.sourceId);
      if (!latest) return { ...calendar, timePriceSummary };
      return {
        ...calendar,
        timePriceSummary,
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
        timePriceSummary,
        officialSourceUpdateAvailable: false,
        officialSourceAvailableToSelect: true,
        availableOfficialSourceCount: summary.available
      };
    }
    if (summary.total > 0) {
      // 登记过但当前全部停用——不能显示「尚未登记」，那与事实不符。
      return { ...calendar, timePriceSummary, officialSourceUpdateAvailable: false, officialSourceRegisteredButUnavailable: true };
    }
    return { ...calendar, timePriceSummary };
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
      orders.map((order) => ({ id: order.id, orderNo: order.orderNo, status: order.status, startAt: order.startAt, endAt: order.endAt, effectiveEndAt: order.effectiveEndAt }))
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
  /** at 省略即按当前时间匹配；报价按租期开始时间匹配，因此这里也允许指定时点回放。 */
  @Get("rule-versions/current") currentRule(@Req() req: AuthenticatedRequest, @Query("at") at?: string) { return this.business.currentRule(req.user.tenantId, this.context(req.user.tenantId), at || undefined); }
  @Get("rule-versions/audits") ruleVersionAudits(@Req() req: AuthenticatedRequest, @Query("version") version?: string) { return this.business.listRuleVersionAudits(req.user.tenantId, this.context(req.user.tenantId), version || undefined); }
  @Get("rule-versions/:version") ruleVersion(@Req() req: AuthenticatedRequest, @Param("version") version: string) { return this.business.getRuleVersion(req.user.tenantId, this.context(req.user.tenantId), version); }
  @Get("rule-versions/:version/publish-preview") ruleVersionPublishPreview(@Req() req: AuthenticatedRequest, @Param("version") version: string, @Query("effectiveFrom") effectiveFrom?: string) { return this.business.previewRuleVersionPublish(req.user.tenantId, this.context(req.user.tenantId), version, effectiveFrom || undefined); }
  /** 只存草稿。已发布版本不可修改（需求 4.6.1），要改先 restore 成新草稿。 */
  @Post("rule-versions") async saveRule(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalRuleVersionDto) { return this.committed(req.user.tenantId, await this.business.saveRuleVersion(req.user.tenantId, this.context(req.user.tenantId), body, req.user.displayName)); }
  /** 以某个历史版本的内容生成新草稿。属编辑级动作，只认 rules:manage。 */
  @Post("rule-versions/:version/restore") async restoreRule(@Req() req: AuthenticatedRequest, @Param("version") version: string, @Body() body: RestoreRentalRuleVersionDto) { return this.committed(req.user.tenantId, await this.business.restoreRuleVersion(req.user.tenantId, this.context(req.user.tenantId), version, body.reason, req.user.displayName)); }
  /** 发布级动作，只认 rules:publish。 */
  @Post("rule-versions/:version/publish") async publishRule(@Req() req: AuthenticatedRequest, @Param("version") version: string, @Body() body: PublishRentalRuleVersionDto) { return this.committed(req.user.tenantId, await this.business.publishRuleVersion(req.user.tenantId, this.context(req.user.tenantId), version, body, req.user.displayName)); }
  @Post("rule-versions/:version/void") async voidRule(@Req() req: AuthenticatedRequest, @Param("version") version: string, @Body() body: VoidRentalRuleVersionDto) { return this.committed(req.user.tenantId, await this.business.voidRuleVersion(req.user.tenantId, this.context(req.user.tenantId), version, body.reason, req.user.displayName)); }

  // RULE-01B：押金/预授权模拟资金事件（需求 4.4.7、4.6.3）。只记录资金事实，不改订单状态机。
  @Get("orders/:orderId/funding-events") fundingEvents(@Req() req: AuthenticatedRequest, @Param("orderId") orderId: string) { return this.funding.listEvents(req.user.tenantId, this.core.resolveWorkspaceId(req.user.tenantId), orderId); }
  @Post("orders/:orderId/funding-events/initiate") @HttpCode(201) async initiateFunding(@Req() req: AuthenticatedRequest, @Param("orderId") orderId: string, @Body() body: InitiateRentalFundingDto) { return this.committed(req.user.tenantId, await this.funding.recordEvent(req.user.tenantId, this.core.resolveWorkspaceId(req.user.tenantId), orderId, { instrument: body.instrument, action: "initiate", idempotencyKey: body.idempotencyKey, reason: body.reason }, req.user.displayName)); }
  @Post("orders/:orderId/funding-events/append") @HttpCode(201) async appendFunding(@Req() req: AuthenticatedRequest, @Param("orderId") orderId: string, @Body() body: RentalFundingAmountDto) { return this.committed(req.user.tenantId, await this.funding.recordEvent(req.user.tenantId, this.core.resolveWorkspaceId(req.user.tenantId), orderId, { instrument: body.instrument, action: "append", amount: body.amount, idempotencyKey: body.idempotencyKey, reason: body.reason }, req.user.displayName)); }
  @Post("orders/:orderId/funding-events/capture") @HttpCode(201) async captureFunding(@Req() req: AuthenticatedRequest, @Param("orderId") orderId: string, @Body() body: RentalFundingAmountDto) { return this.committed(req.user.tenantId, await this.funding.recordEvent(req.user.tenantId, this.core.resolveWorkspaceId(req.user.tenantId), orderId, { instrument: body.instrument, action: "capture", amount: body.amount, idempotencyKey: body.idempotencyKey, reason: body.reason }, req.user.displayName)); }
  @Post("orders/:orderId/funding-events/refund") @HttpCode(201) async refundFunding(@Req() req: AuthenticatedRequest, @Param("orderId") orderId: string, @Body() body: RentalFundingAmountDto) { return this.committed(req.user.tenantId, await this.funding.recordEvent(req.user.tenantId, this.core.resolveWorkspaceId(req.user.tenantId), orderId, { instrument: body.instrument, action: "refund", amount: body.amount, idempotencyKey: body.idempotencyKey, reason: body.reason }, req.user.displayName)); }
  @Post("orders/:orderId/funding-events/release") @HttpCode(201) async releaseFunding(@Req() req: AuthenticatedRequest, @Param("orderId") orderId: string, @Body() body: RentalFundingReleaseDto) { return this.committed(req.user.tenantId, await this.funding.recordEvent(req.user.tenantId, this.core.resolveWorkspaceId(req.user.tenantId), orderId, { instrument: "preauthorization", action: "release", amount: body.amount, idempotencyKey: body.idempotencyKey, reason: body.reason }, req.user.displayName)); }
  @Post("orders/:orderId/funding-events/fail") @HttpCode(201) async failFunding(@Req() req: AuthenticatedRequest, @Param("orderId") orderId: string, @Body() body: RentalFundingFailureDto) { return this.committed(req.user.tenantId, await this.funding.recordEvent(req.user.tenantId, this.core.resolveWorkspaceId(req.user.tenantId), orderId, { instrument: body.instrument, action: "fail", amount: 0, idempotencyKey: body.idempotencyKey, reason: body.reason, failureCode: body.failureCode }, req.user.displayName)); }

  @Get("customer-coupons") async customerCoupons(@Req() req: AuthenticatedRequest, @Query("customerId") customerId?: string) { return this.business.listCurrentCustomerCoupons(req.user.tenantId, this.context(req.user.tenantId), customerId); }
  @Post("customer-coupons/:id/void") async voidCustomerCoupon(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: { reason: string }) {
    return this.committed(req.user.tenantId, await this.business.voidCustomerCoupon(req.user.tenantId, this.context(req.user.tenantId), id, body.reason));
  }
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
  @Post("notification-logs/retry-due") async retryDueNotifications(@Req() req: AuthenticatedRequest, @Query("limit") limit?: string) {
    const parsedLimit = limit ? Number(limit) : 20;
    return this.committed(req.user.tenantId, this.business.retryDueNotifications(req.user.tenantId, this.context(req.user.tenantId), Number.isFinite(parsedLimit) ? parsedLimit : 20));
  }
  @Post("notification-logs/:id/retry") async retryNotification(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.committed(req.user.tenantId, this.business.retryNotification(req.user.tenantId, this.context(req.user.tenantId), id));
  }
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
    // 人工发送不带幂等键，正常必得一条日志；`result` 为空只可能是并发回放，跳过入缓存即可。
    if (!replayed && result) this.business.applyNotificationLogToCache(tenantId, context, result);
    // 幂等事务提交后才允许真正调用第三方短信；这样数据库回滚不会产生外部副作用。
    const delivered = !replayed && result?.status === "queued"
      ? await this.business.retryNotification(tenantId, context, result.id)
      : result;
    return this.committed(tenantId, delivered);
  }

  @Post("quotes") async quote(@Req() req: AuthenticatedRequest, @Body() body: RentalQuoteDto) {
    const resolved = await this.core.resolvePricingGroupQuoteRequest(req.user.tenantId, body);
    return this.committed(req.user.tenantId, await this.business.createQuote(req.user.tenantId, this.context(req.user.tenantId), resolved));
  }
  @Get("quotes/:id") quoteDetail(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.business.getQuote(req.user.tenantId, this.context(req.user.tenantId), id); }
}
