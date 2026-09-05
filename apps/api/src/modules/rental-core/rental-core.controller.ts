import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Prisma } from "@prisma/client";
import { RentalCoreOrderStatus } from "@store-rental/shared";
import { createHash } from "node:crypto";
import type {
  CreateRentalInspectionRequest,
  CreateRentalOrderRequest,
  CancelRentalOrderRequest,
  RentalAvailabilityRequest,
  RentalMembershipSnapshot,
  RentalOrder,
  SaveRentalAssetRequest,
  SaveRentalCouponTemplateRequest,
  SaveRentalFulfillmentLocationRequest,
  SaveRentalFulfillmentOperatorRequest,
  SaveRentalItemGroupRequest,
  SaveRentalStockBalanceRequest,
  SaveTenantRentalBusinessSettingsRequest,
  SaveTenantRentalProfileRequest,
  RentalWorkspaceReportFilter,
  SystemUserRow
} from "@store-rental/shared";
import {
  SaveRentalFulfillmentLocationDto,
  SaveRentalFulfillmentOperatorDto,
  SaveRentalItemGroupDto,
  SaveRentalPricingGroupDto,
} from "./rental-core-request.dto";
import {
  CancelRentalOrderDto,
  ManageRentalAllocationDto,
  RentalOperationLockDto,
  CreateRentalInspectionDto,
  CreateRentalOrderDto,
  PartialReturnRentalOrderDto,
  ReviewRentalInspectionExceptionDto,
  RentalAvailabilityDto,
  RentalOrderExtensionDto,
  ReviewRentalExtensionRefundDto,
  SaveRentalAssetDto,
  SaveRentalCouponTemplateDto,
  SaveRentalStockBalanceDto,
  SaveTenantRentalProfileDto,
  SubstituteRentalBundleComponentDto,
} from "./rental-order-request.dto";
import { effectiveExtensionRule } from "./rental-rule-defaults";
import {
  SaveTenantRentalBusinessSettingsDto,
} from "./rental-config-request.dto";
import { renderOperationReportCsv } from "./rental-workspace-report.csv";
import { RentalCoreService } from "./rental-core.service";
import { RentalAllocationService } from "./rental-allocation.service";
import { RentalBusinessService, type BusinessContext } from "./rental-business.service";
import { RentalOrderConfirmationService } from "./rental-order-confirmation.service";
import { RentalIdempotentActionService } from "./rental-idempotent-action.service";
import { RentalWorkspaceReportRepository } from "./rental-workspace-report.repository";
import { resolveScopeWorkspaceId } from "./workspace-scope";
import { PrismaService } from "../database/prisma.service";
import { RentalServiceCapacityService } from "./rental-service-capacity.service";
import { RentalFundingService } from "./rental-funding.service";

/** 读取标准 Idempotency-Key 请求头。大小写不敏感，超长键直接拒绝。 */
/**
 * 上限必须与 `rental_order_idempotency_records.idempotencyKey` 的列宽一致。
 * Prisma 的 `String` 在 MySQL 下落成 `VARCHAR(191)`，放行更长的键会在写入时
 * 撞 MySQL 1406（Data too long）变成 500，而不是这里明确的 400。
 */
const IDEMPOTENCY_KEY_MAX_LENGTH = 191;

function idempotencyKeyOf(req: { headers?: Record<string, unknown> }): string | undefined {
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

interface AuthenticatedRequest { user: SystemUserRow; headers?: Record<string, unknown>; }
interface UploadedImageFile { originalname: string; mimetype: string; size: number; buffer: Buffer; }
interface BinaryResponse { setHeader(name: string, value: string): void; send(body: Buffer): void; }

/**
 * CAM-01A：控制器内的权限判定，口径与 Guard 的 hasAnyPermission 一致。
 *
 * 租户管理员（isPlatformAdmin）与通配 `*` 视为具备；SaaS 平台管理员不参与经营域动作。
 * 必须与 Guard 同口径，否则会出现「Guard 放行、控制器拒绝」或反之的错位。
 */
function hasPermissionCode(user: SystemUserRow, code: string) {
  if (user.isSaasAdmin) return false;
  if (user.isPlatformAdmin || user.permissions?.includes("*")) return true;
  return Boolean(user.permissions?.includes(code));
}

/**
 * 订单上已生效的续租租金合计。
 *
 * 提前归还退款按"未使用单位数 / 总单位数"折算，而 `quote.rentalAmount` 只覆盖原租期——
 * 续租那段的租金以 `type === "extension"` 的费用明细进的订单调整额。不把它加进基数，
 * 续过租的订单只会退到应退的一部分。待补款的续租不在明细里，也不在 `effectiveEndAt` 里，
 * 两边天然对齐。
 */
function extensionRentalOf(order: RentalOrder): number {
  return (order.chargeLines ?? [])
    .filter((line) => line.type === "extension")
    .reduce((sum, line) => sum + Number(line.amount ?? 0), 0);
}

/**
 * 每个计价目标仍未交回的数量。
 *
 * 逾期费必须按**实际仍在占用**的部分收：两件各日租 240、一件按时还、另一件逾时一小时，
 * 按原报价的全部数量算会收 20，而实际只有一件在逾期，应收 10。
 *
 * 已 `returned` / `released` 的分配项排除在外。本批要交回的仍计入——它确实逾期了，
 * 费用是先算后落账，此时订单上还没应用本批归还。
 */
function outstandingQuantitiesOf(order: RentalOrder): Record<string, number> {
  const result: Record<string, number> = {};
  for (const allocation of order.allocations ?? []) {
    if (allocation.status === "returned" || allocation.status === "released") continue;
    const line = order.lines?.find((row) => row.id === allocation.orderLineId);
    const target = line?.pricingGroupId ?? line?.itemGroupId ?? allocation.itemGroupId;
    if (!target) continue;
    result[target] = (result[target] ?? 0) + allocation.quantity;
  }
  return result;
}

@Controller("rental/v1")
export class RentalCoreController {
  constructor(
    private readonly service: RentalCoreService,
    private readonly allocation: RentalAllocationService,
    private readonly business: RentalBusinessService,
    private readonly orderConfirmation: RentalOrderConfirmationService,
    private readonly idempotent: RentalIdempotentActionService,
    private readonly workspaceReports: RentalWorkspaceReportRepository,
    private readonly prisma: PrismaService,
    private readonly serviceCapacities: RentalServiceCapacityService,
    private readonly funding: RentalFundingService
  ) {}

  private context(tenantId: string): BusinessContext {
    const profile = this.service.getProfile(tenantId);
    const category = this.service.listCategories().find((item) => item.code === profile.categoryCode);
    if (!category) throw new Error("当前经营空间的品类定义不存在");
    return { profile, category, settings: this.service.getBusinessSettings(tenantId), groups: this.service.listItemGroups(tenantId), pricingGroups: this.service.listPricingGroups(tenantId), couponTemplates: this.service.listCouponTemplates(tenantId), locations: this.service.listLocations(tenantId), operators: this.service.listOperators(tenantId) };
  }
  // 必须先 await 业务结果再写快照：配置写方法已转为异步，若直接把 Promise 传进来
  // 就会与快照写入并发，快照可能捕获到变更前的状态。
  private async committed<T>(tenantId: string, result: T | Promise<T>): Promise<T> {
    const resolved = await result;
    await Promise.all([this.service.persist(tenantId), this.business.persist(tenantId)]);
    return resolved;
  }
  private async emitOrderEvent(tenantId: string, eventCode: string, order: { id: string; orderNo: string; customerName: string; contactPhone?: string; customerId?: string }) {
    // 业务对象随事件传入，服务端据此生成空间级幂等键——同一订单同一事件重放不再二次发信。
    return await this.business.emitNotificationEvent(
      tenantId, this.context(tenantId), eventCode, order.contactPhone ?? order.customerId,
      { customerName: order.customerName, orderNo: order.orderNo },
      { type: "order", id: order.id }
    );
  }
  @Get("categories") categories() { return this.service.listCategories(); }
  /**
   * REPORT-01A：当前经营空间的经营报表。
   *
   * 空间**不由客户端传入**，一律从会话解析（`resolveScopeWorkspaceId`）：
   * 让页面传 workspaceId 等于允许查自己无权进入的空间的经营数据。
   * 品类只用于页面文案，指标公式与它无关。
   */
  @Get("reports/operations")
  async operationReport(
    @Req() req: AuthenticatedRequest,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("locationId") locationId?: string,
    @Query("customerId") customerId?: string,
    @Query("customerType") customerType?: string
  ) {
    const tenantId = req.user.tenantId;
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    return this.workspaceReports.getOperationReport(
      tenantId,
      workspaceId,
      this.service.getProfile(tenantId).categoryCode,
      this.reportFilter({ from, to, locationId, customerId, customerType }),
      // 币种从经营空间的业务设置取：报表仓储不读配置，避免同一事实两个来源。
      this.service.getBusinessSettings(tenantId).pricing.currency
    );
  }

  /**
   * REPORT-01B：报表导出（CSV）。
   *
   * 与上面的读取接口共用**同一个**仓储方法与同一组筛选解析，因此导出与页面
   * 必然是同一份数字。若导出自己再查一遍库，就会出现「页面一个数、导出另一个数」，
   * 且没人能说清哪个对。
   *
   * 权限与空间同样走会话：路由前缀命中 `reports` 分支，鉴权与页面读取一致。
   */
  @Get("reports/operations/export")
  async exportOperationReport(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: { setHeader: (name: string, value: string) => void },
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("locationId") locationId?: string,
    @Query("customerId") customerId?: string,
    @Query("customerType") customerType?: string
  ) {
    const tenantId = req.user.tenantId;
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const report = await this.workspaceReports.getOperationReport(
      tenantId,
      workspaceId,
      this.service.getProfile(tenantId).categoryCode,
      this.reportFilter({ from, to, locationId, customerId, customerType }),
      // 币种从经营空间的业务设置取：报表仓储不读配置，避免同一事实两个来源。
      this.service.getBusinessSettings(tenantId).pricing.currency
    );
    const stamp = report.generatedAt.replace(/[-:T]/g, "").slice(0, 14);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    // 文件名只用空间 id 与时间戳：客户名等业务数据不进 header，避免非 ASCII 与注入。
    res.setHeader("Content-Disposition", `attachment; filename="operation-report-${workspaceId}-${stamp}.csv"`);
    return renderOperationReportCsv(report);
  }

  /** 只收白名单里的筛选项；空串按未传处理，避免 `?locationId=` 变成"查 id 为空串的地点"。 */
  private reportFilter(input: Record<string, string | undefined>): RentalWorkspaceReportFilter {
    const pick = (value: string | undefined) => (value && value.trim() ? value.trim() : undefined);
    const customerType = pick(input.customerType);
    return {
      from: pick(input.from),
      to: pick(input.to),
      locationId: pick(input.locationId),
      customerId: pick(input.customerId),
      customerType: customerType as RentalWorkspaceReportFilter["customerType"]
    };
  }
  @Get("tenant-profile") profile(@Req() req: AuthenticatedRequest) { return this.service.getProfile(req.user.tenantId); }
  @Put("tenant-profile") saveProfile(@Req() req: AuthenticatedRequest, @Body() body: SaveTenantRentalProfileDto) { return this.committed(req.user.tenantId, this.service.saveProfile(req.user.tenantId, body)); }
  @Get("business-settings") businessSettings(@Req() req: AuthenticatedRequest) { return this.service.getBusinessSettings(req.user.tenantId); }
  @Put("business-settings") saveBusinessSettings(@Req() req: AuthenticatedRequest, @Body() body: SaveTenantRentalBusinessSettingsDto) { return this.committed(req.user.tenantId, this.service.saveBusinessSettings(req.user.tenantId, body, req.user.displayName)); }
  @Get("coupon-templates") couponTemplates(@Req() req: AuthenticatedRequest) { return this.service.listCouponTemplates(req.user.tenantId); }
  @Post("coupon-templates") saveCouponTemplate(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalCouponTemplateDto) { return this.committed(req.user.tenantId, this.service.saveCouponTemplate(req.user.tenantId, body)); }
  @Put("coupon-templates/:id") updateCouponTemplate(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalCouponTemplateDto) { return this.committed(req.user.tenantId, this.service.saveCouponTemplate(req.user.tenantId, { ...body, id })); }
  @Get("locations") locations(@Req() req: AuthenticatedRequest) { return this.service.listLocations(req.user.tenantId); }
  @Get("fulfillment-operators") operators(@Req() req: AuthenticatedRequest) { return this.service.listOperators(req.user.tenantId); }
  @Post("fulfillment-operators") saveOperator(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalFulfillmentOperatorDto) { return this.committed(req.user.tenantId, this.service.saveOperator(req.user.tenantId, body)); }
  @Put("fulfillment-operators/:id") updateOperator(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalFulfillmentOperatorDto) { return this.committed(req.user.tenantId, this.service.saveOperator(req.user.tenantId, { ...body, id })); }
  @Post("locations") saveLocation(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalFulfillmentLocationDto) { return this.committed(req.user.tenantId, this.service.saveLocation(req.user.tenantId, body)); }
  @Put("locations/:id") updateLocation(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalFulfillmentLocationDto) { return this.committed(req.user.tenantId, this.service.saveLocation(req.user.tenantId, { ...body, id })); }
  @Get("item-groups") groups(@Req() req: AuthenticatedRequest) { return this.service.listItemGroups(req.user.tenantId); }
  @Post("item-groups") saveGroup(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalItemGroupDto) { return this.committed(req.user.tenantId, this.service.saveItemGroup(req.user.tenantId, body)); }
  @Put("item-groups/:id") updateGroup(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalItemGroupDto) { return this.committed(req.user.tenantId, this.service.saveItemGroup(req.user.tenantId, { ...body, id })); }
  @Post("item-groups/:id/images")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  uploadItemGroupImage(@Req() req: AuthenticatedRequest, @Param("id") id: string, @UploadedFile() file?: UploadedImageFile) {
    if (!file) throw new BadRequestException("请选择要上传的产品型号图片");
    return this.committed(req.user.tenantId, this.service.addItemGroupImage(req.user.tenantId, id, file));
  }
  @Delete("item-groups/:id/images/:imageId")
  removeItemGroupImage(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("imageId") imageId: string) {
    return this.committed(req.user.tenantId, this.service.removeItemGroupImage(req.user.tenantId, id, imageId));
  }
  @Get("item-groups/:id/images/:imageId")
  async itemGroupImage(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("imageId") imageId: string, @Res() res: BinaryResponse) {
    const image = await this.service.readItemGroupImage(req.user.tenantId, id, imageId);
    res.setHeader("Content-Type", image.mimeType);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(image.fileName)}`);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(image.content);
  }
  @Get("pricing-groups") pricingGroups(@Req() req: AuthenticatedRequest) { return this.service.listPricingGroups(req.user.tenantId); }
  @Post("pricing-groups") async savePricingGroup(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalPricingGroupDto) {
    const tenantId = req.user.tenantId;
    if (!body.initialRates?.length) throw new BadRequestException("新建定价分组时至少填写一条基本价");
    const uniqueUnits = new Set(body.initialRates.map((row) => row.unit));
    if (uniqueUnits.size !== body.initialRates.length) throw new BadRequestException("同一个计价单位只能填写一条基本价");

    let group!: Awaited<ReturnType<RentalCoreService["savePricingGroup"]>>;
    let plan!: Awaited<ReturnType<RentalBusinessService["savePricingPlan"]>>;
    await this.prisma.$transaction(async (tx) => {
      group = await this.service.savePricingGroup(
        tenantId,
        { ...body, defaultPricingUnit: body.defaultPricingUnit ?? body.initialRates![0].unit },
        tx,
        true
      );
      const context = this.context(tenantId);
      const pricingGroups = [group, ...(context.pricingGroups ?? []).filter((row) => row.id !== group.id)];
      plan = await this.business.savePricingPlan(tenantId, { ...context, pricingGroups }, {
        code: `BASE-${group.code}-${group.id.slice(-8)}`,
        name: `${group.name} 基本价`,
        status: "enabled",
        effectiveFrom: new Date().toISOString(),
        changeReason: `新建定价分组“${group.name}”并设置基本价`,
        rates: body.initialRates!.map((row) => ({
          pricingGroupId: group.id,
          itemGroupId: group.id,
          unit: row.unit,
          baseAmount: row.baseAmount,
          weekendMultiplier: 1,
          holidayMultiplier: 1,
          depositAmount: 0,
          minimumUnits: 1
        }))
      }, req.user.displayName, tx, true);
    });
    this.service.commitPricingGroup(group);
    this.business.commitPricingPlan(tenantId, { ...this.context(tenantId), pricingGroups: [group, ...this.service.listPricingGroups(tenantId).filter((row) => row.id !== group.id)] }, plan);
    return this.committed(tenantId, group);
  }
  @Put("pricing-groups/:id") updatePricingGroup(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalPricingGroupDto) { return this.committed(req.user.tenantId, this.service.savePricingGroup(req.user.tenantId, { ...body, id })); }
  @Get("assets") assets(@Req() req: AuthenticatedRequest) { return this.service.listAssets(req.user.tenantId); }
  @Post("assets") saveAsset(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalAssetDto) { return this.committed(req.user.tenantId, this.service.saveAsset(req.user.tenantId, body)); }
  @Put("assets/:id") updateAsset(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalAssetDto) { return this.committed(req.user.tenantId, this.service.saveAsset(req.user.tenantId, { ...body, id })); }
  @Get("stock-balances") stocks(@Req() req: AuthenticatedRequest) { return this.service.listStockBalances(req.user.tenantId); }
  @Put("stock-balances") saveStock(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalStockBalanceDto) { return this.committed(req.user.tenantId, this.service.saveStockBalance(req.user.tenantId, body)); }
  @Post("availability") availability(@Req() req: AuthenticatedRequest, @Body() body: RentalAvailabilityDto) { return this.service.availability(req.user.tenantId, body); }
  @Get("orders") orders(@Req() req: AuthenticatedRequest) { return this.service.listOrders(req.user.tenantId); }
  @Get("orders/:id") order(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.service.getOrder(req.user.tenantId, id); }
  @Post("orders") async createOrder(@Req() req: AuthenticatedRequest, @Body() body: CreateRentalOrderDto) {
    const context = this.context(req.user.tenantId);
    // CAM-01A：带风险下单必须「有权限 + 填原因」。原因由 DTO 与能力 Hook 共同保证
    // （空原因不算确认），权限只能在这里判——Hook 上下文里没有鉴权信息，
    // 而 Guard 按路径判权限、看不到请求体，因此这道检查必须落在控制器。
    const OVERRIDE_PERMISSION = "rental-core:capability:override";
    if (body.capabilityExceptions?.length && !hasPermissionCode(req.user, OVERRIDE_PERMISSION)) {
      throw new ForbiddenException("确认能力风险提示需要「能力风险例外确认」权限");
    }
    // Review P1-6：把「谁、凭什么权限、什么时候」补齐后交给下单流程固化成不可变例外快照。
    // 这三项只有控制器知道（鉴权上下文在这里），因此必须在这里补，不能让客户端自报。
    const confirmations = (body.capabilityExceptions ?? []).map((row) => ({
      ...row,
      confirmedBy: req.user.displayName,
      confirmedWithPermission: OVERRIDE_PERMISSION,
      confirmedAt: new Date().toISOString()
    }));
    // 幂等键取标准的 Idempotency-Key 请求头；未传时下单侧退回 quoteId（报价一次性使用）。
    const { order, replayed } = await this.orderConfirmation.createOrder(
      req.user.tenantId,
      { ...body, capabilityExceptions: confirmations },
      req.user.displayName,
      context,
      idempotencyKeyOf(req)
    );
    // 回放时跳过通知：同键重试不该让客户收到第二条「订单已创建」。
    if (!replayed) await this.emitOrderEvent(req.user.tenantId, "order.created", order);
    return this.committed(req.user.tenantId, order);
  }
  @Post("orders/:id/confirm") async confirm(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const tenantId = req.user.tenantId;
    const { result: order, replayed } = await this.idempotent.executeWithReplayFlag({
      tenantId,
      action: "order.confirm",
      key: idempotencyKeyOf(req),
      // 兜底键**不得**纳入当前状态：状态会被本动作改掉，纳入后无键网络重试
      // 算出的键与首次登记的键不同，查不到记录就落回状态机报 409——幂等失效。
      // 非法转移由下面的 replay 拒绝：只有订单确实处于本动作的目标状态才回放，
      // 已完成订单再次确认因状态不符而返回 undefined，交由状态机给出 409。
      fallbackKey: `order.confirm:${id}`,
      request: { orderId: id },
      orderId: id,
      run: async (tx) => {
        await this.funding.assertReadyForConfirmation(tenantId, this.service.resolveWorkspaceId(tenantId), id, tx);
        const confirmed = await this.service.confirmOrder(tenantId, id, tx, req.user.displayName);
        await this.serviceCapacities.confirmForOrder(tenantId, id, new Date().toISOString(), tx);
        await this.business.redeemCouponInTransaction(tenantId, id, tx);
        return confirmed;
      },
      replay: async () => {
        const current = await this.service.getOrder(tenantId, id);
        // 只有已达成目标状态才算同一次意图的重试；否则交回状态机拒绝。
        return current.status === RentalCoreOrderStatus.Reserved ? current : undefined;
      }
    });
    // 内部权益已与订单同事务提交；此处只发布已提交的数据到进程缓存。
    await this.business.refreshFromDatabase();
    await this.business.refreshCouponTemplateCache(tenantId, this.context(tenantId));
    // 回放时跳过通知：通知是外部副作用，同键重试不该让客户收到第二条短信。
    if (!replayed) await this.emitOrderEvent(tenantId, "order.confirmed", order);
    return this.committed(tenantId, order);
  }
  @Post("orders/:id/allocate") async allocate(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const tenantId = req.user.tenantId;
    const order = await this.idempotent.execute({
      tenantId,
      action: "order.allocate",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.allocate:${id}`,
      request: { orderId: id },
      orderId: id,
      run: async (tx) => {
        const current = await this.service.getOrder(tenantId, id);
        const assigned = await this.allocation.manage(tenantId, id, { action: "preassign", expectedRevision: current.assignment?.revision ?? 0 }, tx, req.user.displayName);
        return this.allocation.manage(tenantId, id, { action: "lock", expectedRevision: assigned.assignment!.revision }, tx, req.user.displayName);
      },
      replay: async () => {
        const current = await this.service.getOrder(tenantId, id);
        return current.status === RentalCoreOrderStatus.ReadyForPickup ? current : undefined;
      }
    });
    return this.committed(tenantId, order);
  }
  @Get("orders/:id/allocation-candidates") async allocationCandidates(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.allocation.candidates(req.user.tenantId, id);
  }
  @Post("orders/:id/assignments") async manageAllocations(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: ManageRentalAllocationDto) {
    if (["unlock", "release", "reassign"].includes(body.action) && !hasPermissionCode(req.user, "store-rental:order:reassign")) throw new ForbiddenException("解锁、释放及改配需要独立的资源改配权限");
    const tenantId = req.user.tenantId;
    return this.idempotent.execute({ tenantId, action: "order.assignment", key: idempotencyKeyOf(req), fallbackKey: `assignment:${id}:${body.expectedRevision}`, orderId: id, request: { id, ...body },
      run: (tx) => this.allocation.manage(tenantId, id, body, tx, req.user.displayName),
      replay: async () => this.service.getOrder(tenantId, id) });
  }
  @Post("orders/:id/operation-lock") async operationLock(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: RentalOperationLockDto) {
    const allowed: RentalCoreOrderStatus[] = [];
    const operate = hasPermissionCode(req.user, "store-rental:order:operate");
    if (operate || hasPermissionCode(req.user, "store-rental:order:pickup")) allowed.push(RentalCoreOrderStatus.ReadyForPickup);
    if (operate || hasPermissionCode(req.user, "store-rental:order:return")) allowed.push(RentalCoreOrderStatus.Renting);
    return this.allocation.operationLock(req.user.tenantId, id, body.action, req.user.id, req.user.displayName, body.token, allowed);
  }
  @Post("orders/:id/substitute-bundle-component") async substituteBundleComponent(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: SubstituteRentalBundleComponentDto
  ) {
    const tenantId = req.user.tenantId;
    const fallbackHash = createHash("sha256")
      .update([body.orderLineId, body.fromItemGroupId, body.toItemGroupId].join(":"))
      .digest("hex")
      .slice(0, 32);
    const order = await this.idempotent.execute({
      tenantId,
      action: "order.bundle-component.substitute",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.bundle-substitute:${id}:${fallbackHash}`,
      request: { orderId: id, ...body },
      orderId: id,
      run: (tx) => this.service.substituteBundleComponent(tenantId, id, body, tx),
      replay: async () => {
        const current = await this.service.getOrder(tenantId, id);
        return current.status === RentalCoreOrderStatus.Reserved && current.reservations.some((row) =>
          row.orderLineId === body.orderLineId && row.itemGroupId === body.toItemGroupId
        ) ? current : undefined;
      }
    });
    return this.committed(tenantId, order);
  }
  @Post("orders/:id/partial-return") async partialReturn(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: PartialReturnRentalOrderDto
  ) {
    const tenantId = req.user.tenantId;
    const idempotencyKey = idempotencyKeyOf(req);
    // 部分归还是**天然可重复**的动作：数量库存租 3 件，先还 1 件、再还 1 件是两次
    // 真实归还，而两次请求体完全相同。此前兜底键是「订单 + 分配项内容哈希」，
    // 于是第二次被判成第一次的重试直接丢弃——客户还了两件，系统只记一件。
    //
    // 也不能改用「当前已归还进度」做兜底键：那会让第一次请求的网络重试因为进度
    // 已变而被当成新归还，重复扣减库存。可重复动作的幂等只能由调用方标识，
    // 因此这里 fail-closed：两个标识都没有就拒绝，宁可让调用方补一个，
    // 也不能静默丢掉一次真实归还。
    if (!idempotencyKey && !body.batchNo) {
      throw new BadRequestException(
        "部分归还必须提供 Idempotency-Key 请求头或 batchNo，用于区分多次真实归还与同一次的网络重试"
      );
    }
    const order = await this.idempotent.execute({
      tenantId,
      action: "order.partial-return",
      key: idempotencyKey,
      fallbackKey: `order.partial-return:${id}:${body.batchNo}`,
      request: { orderId: id, items: body.items, batchNo: body.batchNo },
      orderId: id,
      run: (tx) => this.service.partialReturnOrder(tenantId, id, body, tx),
      replay: async () => {
        const current = await this.service.getOrder(tenantId, id);
        return current.status === RentalCoreOrderStatus.Renting ? current : undefined;
      }
    });
    return this.committed(tenantId, order);
  }
  @Post("orders/:id/cancel") async cancel(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: CancelRentalOrderDto) {
    const context = this.context(req.user.tenantId);
    const current = await this.service.getOrder(req.user.tenantId, id);
    const quote = this.business.getQuote(req.user.tenantId, context, current.quoteId);
    const charge = this.business.calculateCancellationCharge(req.user.tenantId, context, quote, undefined, Boolean(body.weatherException));
    const { result: order, replayed: cancelReplayed } = await this.idempotent.executeWithReplayFlag({
      tenantId: req.user.tenantId,
      action: "order.cancel",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.cancel:${id}`,
      // 取消原因与天气例外参与指纹：同键换内容属调用方错误，
      // 必须报冲突而不是静默沿用第一次的原因与费用。
      request: { orderId: id, reason: body.reason, weatherException: Boolean(body.weatherException) },
      orderId: id,
      run: async (tx) => {
        const cancelled = await this.service.cancelOrder(req.user.tenantId, id, body.reason, charge, tx, req.user.displayName);
        await this.business.releaseCouponInTransaction(req.user.tenantId, id, tx);
        await this.serviceCapacities.releaseForOrder(req.user.tenantId, id, "order_cancelled", new Date().toISOString(), tx);
        return cancelled;
      },
      replay: async () => {
        const latest = await this.service.getOrder(req.user.tenantId, id);
        return latest.status === RentalCoreOrderStatus.Cancelled ? latest : undefined;
      }
    });
    await this.business.refreshFromDatabase();
    await this.business.refreshCouponTemplateCache(req.user.tenantId, context);
    if (!cancelReplayed) await this.emitOrderEvent(req.user.tenantId, "order.cancelled", order);
    return this.committed(req.user.tenantId, order);
  }
  /**
   * 续租的结算方式：个人与企业预付都要客户补款，企业月结不需要补款动作。
   *
   * 月结资格读**客户主档的企业授信**（`customer_corporate_credits`）：它以
   * `CustomerProfile.id` 为键，与订单快照里的 `corporateCustomerId` 同一套 id。
   * 不能读旧车辆域的 `Corporate` 表——那张表有自己独立的 uuid 主键，与订单上的
   * `customerId` 没有任何关联，按它查永远查不到，月结分支会静默变成死代码。
   *
   * 两道前提都必须成立：
   *
   * 1. **企业既是签约方也是付款方**（`enterpriseContractAndPayer`）。企业员工用个人
   *    身份付款的订单虽然也带企业信息，但钱是个人出的，仍然要补款。
   * 2. **授信记录仍然有效**且账期不是按单结。`suspended` / `revoked` 的企业不允许
   *    继续挂账——续租会让欠款接着涨。
   *
   * 查不到资格时一律回落到"要补款"——宁可多问客户一次，也不要把不该挂账的单
   * 挂进月结。已经逾期时按规则可强制先付：逾期说明履约已经出问题，这时继续挂账
   * 只会让欠款接着累积。
   */
  private async resolveExtensionSettlement(
    tenantId: string,
    order: { customerType: string; membershipSnapshot?: RentalMembershipSnapshot; endAt: string; effectiveEndAt?: string },
    forceImmediateWhenOverdue: boolean
  ): Promise<"immediate" | "monthly"> {
    const overdue = new Date(order.effectiveEndAt ?? order.endAt).getTime() < Date.now();
    if (overdue && forceImmediateWhenOverdue) return "immediate";
    const corporateCustomerId = order.membershipSnapshot?.enterpriseContractAndPayer
      ? order.membershipSnapshot.corporateCustomerId
      : undefined;
    if (!corporateCustomerId) return "immediate";
    const credit = await this.prisma.customerCorporateCredit.findFirst({
      where: { tenantId, customerId: corporateCustomerId, status: "active" },
      select: { billingCycle: true }
    });
    if (!credit || credit.billingCycle === "per_order") return "immediate";
    return "monthly";
  }

  private async priceExtension(tenantId: string, orderId: string, body: RentalOrderExtensionDto) {
    const context = this.context(tenantId);
    const order = await this.service.getOrder(tenantId, orderId);
    await this.service.assertOrderExtensionAvailable(tenantId, order, body.newEndAt);
    const previousExtensions = await this.service.listOrderExtensions(tenantId, orderId);
    const rule = effectiveExtensionRule(order.ruleSnapshot);
    const settlementMode = await this.resolveExtensionSettlement(tenantId, order, rule.forceImmediateWhenOverdue);
    return {
      order,
      priced: await this.business.quoteOrderExtension(tenantId, context, {
        order,
        previousExtensions,
        lines: order.lines,
        newEndAt: body.newEndAt,
        services: body.services,
        appliedAt: new Date().toISOString(),
        settlementMode,
        fulfillmentMode: order.fulfillmentMode,
        locationIds: [order.fulfillmentLocationId, order.returnLocationId].filter((value): value is string => Boolean(value)),
        customerType: order.customerType
      })
    };
  }

  @Get("orders/:id/extensions") extensions(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.service.listOrderExtensions(req.user.tenantId, id);
  }

  /** 续租试算：只算钱不落库，供客户/运营确认。APP 与后台共用。 */
  @Post("orders/:id/extensions/preview")
  async previewExtension(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: RentalOrderExtensionDto) {
    const { priced } = await this.priceExtension(req.user.tenantId, id, body);
    const { rateSnapshot, ruleSnapshot, ...preview } = priced;
    return preview;
  }

  @Post("orders/:id/extensions")
  async applyExtension(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: RentalOrderExtensionDto) {
    const tenantId = req.user.tenantId;
    const key = idempotencyKeyOf(req) ?? `order.extend:${id}:${body.newEndAt}`;
    const result = await this.idempotent.execute({
      tenantId,
      action: "order.extend",
      key: idempotencyKeyOf(req),
      // 新归还时间进兜底键：同一订单先后申请两次不同的延长，是两笔业务而不是重放。
      fallbackKey: `order.extend:${id}:${body.newEndAt}`,
      request: { orderId: id, newEndAt: body.newEndAt, services: body.services ?? [] },
      orderId: id,
      run: async (tx) => {
        const { priced } = await this.priceExtension(tenantId, id, body);
        const result = await this.service.requestOrderExtension(
          tenantId,
          id,
          priced,
          { idempotencyKey: key, memo: body.memo, operator: req.user.displayName },
          tx
        );
        await this.business.synchronizeExtensionCoupon(tenantId, result.extension, tx);
        return result;
      },
      replay: async () => {
        const rows = await this.service.listOrderExtensions(tenantId, id);
        const existing = rows.find((row) => row.idempotencyKey === key);
        return existing ? { order: await this.service.getOrder(tenantId, id), extension: existing } : undefined;
      }
    });
    return { order: await this.committed(tenantId, result.order), extension: result.extension };
  }

  /** 续租补款到账：记录生效、延长占用与租期（需求 4.6.9「完成补款后再延长」）。 */
  @Post("orders/:id/extensions/:extensionId/pay")
  async payExtension(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("extensionId") extensionId: string
  ) {
    const tenantId = req.user.tenantId;
    const result = await this.idempotent.execute({
      tenantId,
      action: "order.extend.pay",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.extend.pay:${extensionId}`,
      request: { orderId: id, extensionId },
      orderId: id,
      run: async (tx) => {
        await this.funding.assertExtensionPaid(tenantId, this.service.resolveWorkspaceId(tenantId), id, extensionId, tx);
        const result = await this.service.payOrderExtension(tenantId, id, extensionId, tx);
        await this.business.synchronizeExtensionCoupon(tenantId, result.extension, tx);
        return result;
      },
      replay: async () => {
        const rows = await this.service.listOrderExtensions(tenantId, id);
        const existing = rows.find((row) => row.id === extensionId && row.status === "effective");
        return existing ? { order: await this.service.getOrder(tenantId, id), extension: existing } : undefined;
      }
    });
    return { order: await this.committed(tenantId, result.order), extension: result.extension };
  }

  @Post("orders/:id/extensions/:extensionId/refund-review")
  async reviewExtensionRefund(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("extensionId") extensionId: string, @Body() body: ReviewRentalExtensionRefundDto) {
    const tenantId = req.user.tenantId;
    const result = await this.idempotent.execute({
      tenantId, action: "order.extend.refund-review", key: idempotencyKeyOf(req),
      fallbackKey: `order.extend.refund-review:${extensionId}`, request: { orderId: id, extensionId, ...body }, orderId: id,
      run: async (tx) => {
        const result = await this.service.reviewExtensionRefund(tenantId, id, extensionId, body, req.user.displayName, tx);
        await this.business.synchronizeExtensionCoupon(tenantId, result.extension, tx);
        return result;
      },
      replay: async () => {
        const rows = await this.service.listOrderExtensions(tenantId, id);
        const extension = rows.find((row) => row.id === extensionId && row.pricingSnapshot?.refundReview?.status === body.decision);
        return extension ? { order: await this.service.getOrder(tenantId, id), extension } : undefined;
      }
    });
    return { order: await this.committed(tenantId, result.order), extension: result.extension };
  }

  @Get("inspection-templates") templates(@Req() req: AuthenticatedRequest, @Query("stage") stage?: "pickup" | "return") { return this.service.listInspectionTemplates(req.user.tenantId, stage); }  @Get("orders/:id/inspections") inspections(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.service.listInspections(req.user.tenantId, id); }
  @Post("orders/:id/inspections") async createInspection(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: CreateRentalInspectionDto) {
    const tenantId = req.user.tenantId;
    const context = this.context(tenantId);
    const current = await this.service.getOrder(tenantId, id);
    const template = this.service.listInspectionTemplates(tenantId).find((row) => row.id === body.templateId);
    const returnedAt = new Date().toISOString();
    const stage = template?.stage;
    const partialReturn = stage === "return" && Boolean(body.returnItems?.length);
    // 带 returnItems 的归还检查是分批归还的**第二个入口**，与 partial-return 同一个坑：
    // 分配项内容哈希分不清"第二次归还相同数量"和"第一次的网络重试"。同样 fail-closed。
    const inspectionKey = idempotencyKeyOf(req);
    if (partialReturn && !inspectionKey && !body.returnBatchNo) {
      throw new BadRequestException(
        "分批归还检查必须提供 Idempotency-Key 请求头或 returnBatchNo，用于区分多次真实归还与同一次的网络重试"
      );
    }
    // 逾期费与提前归还退款都按规则直接计算；检查异常只保存建议，必须由结算人员另行审核。
    // 归还基准用订单的**当前**约定归还时间，续租过就是新时间，否则刚续上的单会被判逾期。
    const quote = this.business.getQuote(tenantId, context, current.quoteId);
    const scheduledEndAt = current.effectiveEndAt ?? current.endAt;
    const extensionPricing = stage === "return" && !partialReturn
      ? (await this.service.listOrderExtensions(tenantId, id)).filter((row) => row.status === "effective").at(-1)?.pricingSnapshot : undefined;
    const charges = stage === "return" && !partialReturn
      ? {
          overdue: { amount: this.business.calculateOverdueCharge(tenantId, context, quote, returnedAt, scheduledEndAt, outstandingQuantitiesOf(current)), returnedAt },
          earlyReturn: this.business.calculateEarlyReturnRefund(tenantId, context, quote, scheduledEndAt, returnedAt, extensionRentalOf(current), extensionPricing)
        }
      : {};
    if (stage === "pickup") await this.business.assertPickupOpenAt(tenantId, context, current.fulfillmentLocationId, returnedAt, current.fulfillmentMode);
    // 归还只进入待结算；资金账处理完后再独立关闭订单。
    const targetStatus = stage === "pickup" || partialReturn ? RentalCoreOrderStatus.Renting : RentalCoreOrderStatus.Settling;
    const { result, replayed } = await this.idempotent.executeWithReplayFlag({
      tenantId,
      action: "order.inspection",
      key: inspectionKey,
      // 键按订单 + 阶段：同一阶段的检查只应生效一次，换阶段是另一个动作。
      // 不纳入订单当前状态（理由见执行器注释），也不纳入 returnedAt——
      // 那是服务端每次取的当前时间，纳入后每次重试都算出新键，幂等直接失效。
      // 分批归还按调用方给的批次号区分，整单归还固定用 "whole"。
      fallbackKey: `order.inspection:${id}:${stage ?? "unknown"}:${body.returnBatchNo ?? "whole"}`,
      // returnedAt 同样不能进指纹，否则重试必然被判为"同键不同内容"而 409。
      request: { orderId: id, templateId: body.templateId, results: body.results, returnItems: body.returnItems ?? [], returnBatchNo: body.returnBatchNo, exceptions: body.exceptions ?? [] },
      orderId: id,
      run: async (tx) => {
        if (stage === "pickup") await this.funding.assertReadyForPickup(tenantId, this.service.resolveWorkspaceId(tenantId), id, tx);
        const created = await this.service.createInspection(tenantId, id, body, req.user.displayName, charges, tx);
        if (stage === "return" && !partialReturn) await this.serviceCapacities.settleReturnForOrder(tenantId, created.order, returnedAt, tx);
        return created;
      },
      replay: async () => {
        const latest = await this.service.getOrder(tenantId, id);
        if (latest.status !== targetStatus) return undefined;
        const recorded = (await this.service.listInspections(tenantId, id)).filter((row) => row.stage === stage).at(-1);
        return recorded ? { inspection: recorded, order: latest } : undefined;
      }
    });
    if (stage === "return" && !partialReturn) await this.business.refreshFromDatabase();
    if (!replayed) {
      if (!partialReturn) await this.emitOrderEvent(tenantId, result.inspection.stage === "pickup" ? "pickup.completed" : "return.completed", result.order);
      // 归还确实逾期（费用 > 0）才发逾期通知——这是真实业务事实，不是凭空造事件。
      // 与 return.completed 各自独立幂等，因此同一次归还两条通知都只发一次。
      if (stage === "return" && !partialReturn && charges.overdue && charges.overdue.amount > 0) {
        await this.emitOrderEvent(tenantId, "order.overdue", result.order);
      }
    }
    return this.committed(tenantId, result);
  }
  @Post("orders/:id/handover/:stage") async handover(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("stage") stage: string) {
    if (stage !== "pickup" && stage !== "return") throw new BadRequestException("交接阶段无效");
    const tenantId = req.user.tenantId;
    const context = this.context(tenantId);
    const current = await this.service.getOrder(tenantId, id);
    const returnedAt = new Date().toISOString();
    if (stage === "pickup") {
      // 需求 4.6.4：领取前必须重新校验……营业状态（4.5.4：报价与订单分别校验端点）。
      // 按实际领取时刻判定，早取/迟取都要看当前门店是否还办理领取。
      // 归还刻意不复查——停业不得让在租订单失去归还渠道（需求 4.5.4）。
      await this.business.assertPickupOpenAt(tenantId, context, current.fulfillmentLocationId, returnedAt, current.fulfillmentMode);
    }
    const handoverQuote = this.business.getQuote(tenantId, context, current.quoteId);
    const handoverDueAt = current.effectiveEndAt ?? current.endAt;
    const extensionPricing = stage === "return"
      ? (await this.service.listOrderExtensions(tenantId, id)).filter((row) => row.status === "effective").at(-1)?.pricingSnapshot : undefined;
    const overdueCharge = stage === "return" ? this.business.calculateOverdueCharge(tenantId, context, handoverQuote, returnedAt, handoverDueAt, outstandingQuantitiesOf(current)) : 0;
    const earlyReturnRefund = stage === "return"
      ? this.business.calculateEarlyReturnRefund(tenantId, context, handoverQuote, handoverDueAt, returnedAt, extensionRentalOf(current), extensionPricing)
      : undefined;
    const targetStatus = stage === "pickup" ? RentalCoreOrderStatus.Renting : RentalCoreOrderStatus.Settling;
    const { result: order, replayed } = await this.idempotent.executeWithReplayFlag({
      tenantId,
      action: "order.handover",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.handover:${id}:${stage}`,
      request: { orderId: id, stage },
      orderId: id,
      run: async (tx) => {
        if (stage === "pickup") await this.funding.assertReadyForPickup(tenantId, this.service.resolveWorkspaceId(tenantId), id, tx);
        const completed = await this.service.completeHandoverWithoutInspection(tenantId, id, stage, overdueCharge, tx, req.user.displayName, earlyReturnRefund);
        if (stage === "return") await this.serviceCapacities.settleReturnForOrder(tenantId, completed, returnedAt, tx);
        return completed;
      },
      replay: async () => {
        const latest = await this.service.getOrder(tenantId, id);
        return latest.status === targetStatus ? latest : undefined;
      }
    });
    if (stage === "return") await this.business.refreshFromDatabase();
    if (!replayed) {
      await this.emitOrderEvent(tenantId, stage === "pickup" ? "pickup.completed" : "return.completed", order);
      // 无检查直接交接的归还路径同样按真实逾期费判断是否发逾期通知。
      if (stage === "return" && overdueCharge > 0) {
        await this.emitOrderEvent(tenantId, "order.overdue", order);
      }
    }
    return this.committed(tenantId, order);
  }

  @Post("orders/:id/settle") async settle(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const tenantId = req.user.tenantId;
    const context = this.context(tenantId);
    const order = await this.idempotent.execute({
      tenantId,
      action: "order.settle",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.settle:${id}`,
      request: { orderId: id },
      orderId: id,
      run: async (tx) => {
        const inspectionRows = await tx.rentalInspectionRecord.findMany({
          where: { tenantId, workspaceId: this.service.resolveWorkspaceId(tenantId), orderId: id },
          select: { exceptions: true }
        });
        const hasPendingException = inspectionRows.some((row) =>
          (row.exceptions as unknown as Array<{ reviewStatus?: string }>).some((exception) => exception.reviewStatus === "pending")
        );
        if (hasPendingException) throw new ConflictException("仍有检查异常待审核，不能关闭订单");
        await this.funding.assertReadyToClose(tenantId, this.service.resolveWorkspaceId(tenantId), id, tx);
        const settled = await this.service.settleOrder(tenantId, id, tx, req.user.displayName);
        await this.business.completeCustomerOrderEventInTransaction(tenantId, context, settled.customerId, tx);
        return settled;
      },
      replay: async () => {
        const current = await this.service.getOrder(tenantId, id);
        return current.status === RentalCoreOrderStatus.Completed ? current : undefined;
      }
    });
    await this.business.refreshFromDatabase();
    return this.committed(tenantId, order);
  }

  @Post("orders/:id/inspections/:inspectionId/exceptions/:exceptionIndex/review")
  async reviewInspectionException(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("inspectionId") inspectionId: string,
    @Param("exceptionIndex") exceptionIndexText: string,
    @Body() body: ReviewRentalInspectionExceptionDto
  ) {
    const tenantId = req.user.tenantId;
    const workspaceId = this.service.resolveWorkspaceId(tenantId);
    const exceptionIndex = Number(exceptionIndexText);
    if (!Number.isInteger(exceptionIndex) || exceptionIndex < 0) throw new BadRequestException("异常序号无效");
    if (body.decision === "approved" && body.approvedChargeAmount === undefined) throw new BadRequestException("审核通过时必须填写最终费用");
    const result = await this.idempotent.execute({
      tenantId,
      action: "order.inspection-exception.review",
      key: idempotencyKeyOf(req),
      fallbackKey: `inspection-exception.review:${inspectionId}:${exceptionIndex}`,
      request: { orderId: id, inspectionId, exceptionIndex, ...body },
      orderId: id,
      run: async (tx) => {
        const row = await tx.rentalInspectionRecord.findFirst({ where: { id: inspectionId, tenantId, workspaceId, orderId: id } });
        if (!row) throw new BadRequestException("检查记录不存在");
        const exceptions = structuredClone(row.exceptions as unknown as Array<Record<string, unknown>>);
        const exception = exceptions[exceptionIndex];
        if (!exception) throw new BadRequestException("检查异常不存在");
        if (exception.reviewStatus !== "pending") throw new ConflictException("该检查异常已经审核，不能重复改写");
        const approvedAmount = body.decision === "approved" ? Number(body.approvedChargeAmount) : 0;
        const approved = await this.service.approveInspectionException(
          tenantId, id, inspectionId, exceptionIndex, approvedAmount,
          `${String(exception.description)}；审核：${body.reason}`, tx
        );
        Object.assign(exception, {
          reviewStatus: body.decision,
          approvedChargeAmount: approved.approvedChargeAmount,
          reviewReason: body.reason,
          reviewedBy: req.user.displayName,
          reviewedAt: new Date().toISOString()
        });
        await tx.rentalInspectionRecord.update({ where: { id: inspectionId }, data: { exceptions: exceptions as Prisma.InputJsonValue } });
        return { order: approved.order, inspectionId, exceptionIndex, exception };
      },
      replay: async () => {
        const row = await this.prisma.rentalInspectionRecord.findFirst({ where: { id: inspectionId, tenantId, workspaceId, orderId: id } });
        const exception = (row?.exceptions as unknown as Array<Record<string, unknown>> | undefined)?.[exceptionIndex];
        if (!exception || exception.reviewStatus !== body.decision) return undefined;
        return { order: await this.service.getOrder(tenantId, id), inspectionId, exceptionIndex, exception };
      }
    });
    return this.committed(tenantId, result);
  }
}
