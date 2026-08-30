import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import { RentalCoreOrderStatus } from "@store-rental/shared";
import { createHash } from "node:crypto";
import type {
  CreateRentalInspectionRequest,
  CreateRentalOrderRequest,
  CancelRentalOrderRequest,
  RentalAvailabilityRequest,
  SaveRentalAssetRequest,
  SaveRentalCouponTemplateRequest,
  SaveRentalFulfillmentLocationRequest,
  SaveRentalFulfillmentOperatorRequest,
  SaveRentalItemGroupRequest,
  SaveRentalStockBalanceRequest,
  SaveTenantRentalBusinessSettingsRequest,
  SaveTenantRentalProfileRequest,
  SystemUserRow
} from "@store-rental/shared";
import {
  SaveRentalFulfillmentLocationDto,
  SaveRentalFulfillmentOperatorDto,
  SaveRentalItemGroupDto
} from "./rental-core-request.dto";
import {
  CancelRentalOrderDto,
  CreateRentalInspectionDto,
  CreateRentalOrderDto,
  PartialReturnRentalOrderDto,
  RentalAvailabilityDto,
  SaveRentalAssetDto,
  SaveRentalCouponTemplateDto,
  SaveRentalStockBalanceDto,
  SaveTenantRentalProfileDto,
  SubstituteRentalBundleComponentDto,
} from "./rental-order-request.dto";
import {
  SaveTenantRentalBusinessSettingsDto,
} from "./rental-config-request.dto";
import { RentalCoreService } from "./rental-core.service";
import { RentalBusinessService, type BusinessContext } from "./rental-business.service";
import { RentalOrderConfirmationService } from "./rental-order-confirmation.service";
import { RentalIdempotentActionService } from "./rental-idempotent-action.service";
import { RentalServiceCapacityService } from "./rental-service-capacity.service";

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

@Controller("rental/v1")
export class RentalCoreController {
  constructor(
    private readonly service: RentalCoreService,
    private readonly business: RentalBusinessService,
    private readonly orderConfirmation: RentalOrderConfirmationService,
    private readonly idempotent: RentalIdempotentActionService,
    private readonly serviceCapacities: RentalServiceCapacityService
  ) {}

  private context(tenantId: string): BusinessContext {
    const profile = this.service.getProfile(tenantId);
    const category = this.service.listCategories().find((item) => item.code === profile.categoryCode);
    if (!category) throw new Error("当前经营空间的品类定义不存在");
    return { profile, category, settings: this.service.getBusinessSettings(tenantId), groups: this.service.listItemGroups(tenantId), couponTemplates: this.service.listCouponTemplates(tenantId), locations: this.service.listLocations(tenantId), operators: this.service.listOperators(tenantId) };
  }
  // 必须先 await 业务结果再写快照：配置写方法已转为异步，若直接把 Promise 传进来
  // 就会与快照写入并发，快照可能捕获到变更前的状态。
  private async committed<T>(tenantId: string, result: T | Promise<T>): Promise<T> {
    const resolved = await result;
    await Promise.all([this.service.persist(tenantId), this.business.persist(tenantId)]);
    return resolved;
  }
  private async emitOrderEvent(tenantId: string, eventCode: string, order: { orderNo: string; customerName: string; contactPhone?: string; customerId?: string }) {
    return await this.business.emitNotificationEvent(tenantId, this.context(tenantId), eventCode, order.contactPhone ?? order.customerId, { customerName: order.customerName, orderNo: order.orderNo });
  }
  @Get("categories") categories() { return this.service.listCategories(); }
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
      run: (tx) => this.service.allocateOrder(tenantId, id, tx, req.user.displayName),
      replay: async () => {
        const current = await this.service.getOrder(tenantId, id);
        return current.status === RentalCoreOrderStatus.ReadyForPickup ? current : undefined;
      }
    });
    return this.committed(tenantId, order);
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
    const fallbackHash = createHash("sha256").update(JSON.stringify([...body.items].sort((left, right) => left.allocationId.localeCompare(right.allocationId)))).digest("hex").slice(0, 32);
    const order = await this.idempotent.execute({
      tenantId,
      action: "order.partial-return",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.partial-return:${id}:${fallbackHash}`,
      request: { orderId: id, items: body.items },
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
  @Get("inspection-templates") templates(@Req() req: AuthenticatedRequest, @Query("stage") stage?: "pickup" | "return") { return this.service.listInspectionTemplates(req.user.tenantId, stage); }
  @Get("orders/:id/inspections") inspections(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.service.listInspections(req.user.tenantId, id); }
  @Post("orders/:id/inspections") async createInspection(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: CreateRentalInspectionDto) {
    const tenantId = req.user.tenantId;
    const context = this.context(tenantId);
    const current = await this.service.getOrder(tenantId, id);
    const template = this.service.listInspectionTemplates(tenantId).find((row) => row.id === body.templateId);
    const returnedAt = new Date().toISOString();
    // 逾期费与损坏费先按报价算好再一次性交给 service：迁库后每次"加载订单→改→存"
    // 都是独立事务，分三次调用会把一个业务动作拆成三个事务。
    const quote = this.business.getQuote(tenantId, context, current.quoteId);
    const charges = template?.stage === "return"
      ? {
          overdue: { amount: this.business.calculateOverdueCharge(tenantId, context, quote, returnedAt), returnedAt },
          damage: {
            amount: this.business.calculateDamageCharge(tenantId, context, quote, body.exceptions ?? []),
            detail: (body.exceptions ?? []).map((item) => item.description).join("；") || "归还检查损坏费用"
          }
        }
      : {};
    const stage = template?.stage;
    // 目标状态：取件检查后进入 renting，归还检查后进入 completed。
    const targetStatus = stage === "pickup" ? RentalCoreOrderStatus.Renting : RentalCoreOrderStatus.Completed;
    const { result, replayed } = await this.idempotent.executeWithReplayFlag({
      tenantId,
      action: "order.inspection",
      key: idempotencyKeyOf(req),
      // 键按订单 + 阶段：同一阶段的检查只应生效一次，换阶段是另一个动作。
      // 不纳入订单当前状态（理由见执行器注释），也不纳入 returnedAt——
      // 那是服务端每次取的当前时间，纳入后每次重试都算出新键，幂等直接失效。
      fallbackKey: `order.inspection:${id}:${stage ?? "unknown"}`,
      // returnedAt 同样不能进指纹，否则重试必然被判为"同键不同内容"而 409。
      request: { orderId: id, templateId: body.templateId, results: body.results, exceptions: body.exceptions ?? [] },
      orderId: id,
      run: async (tx) => {
        const created = await this.service.createInspection(tenantId, id, body, req.user.displayName, charges, tx);
        if (stage === "return") {
          await this.serviceCapacities.markUsedForOrder(tenantId, id, returnedAt, tx);
          await this.business.completeCustomerOrderEventInTransaction(tenantId, context, created.order.customerId, tx);
        }
        return created;
      },
      replay: async () => {
        const latest = await this.service.getOrder(tenantId, id);
        if (latest.status !== targetStatus) return undefined;
        const recorded = (await this.service.listInspections(tenantId, id)).filter((row) => row.stage === stage).at(-1);
        return recorded ? { inspection: recorded, order: latest } : undefined;
      }
    });
    if (stage === "return") await this.business.refreshFromDatabase();
    if (!replayed) {
      await this.emitOrderEvent(tenantId, result.inspection.stage === "pickup" ? "pickup.completed" : "return.completed", result.order);
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
    const overdueCharge = stage === "return" ? this.business.calculateOverdueCharge(tenantId, context, this.business.getQuote(tenantId, context, current.quoteId), returnedAt) : 0;
    const targetStatus = stage === "pickup" ? RentalCoreOrderStatus.Renting : RentalCoreOrderStatus.Completed;
    const { result: order, replayed } = await this.idempotent.executeWithReplayFlag({
      tenantId,
      action: "order.handover",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.handover:${id}:${stage}`,
      request: { orderId: id, stage },
      orderId: id,
      run: async (tx) => {
        const completed = await this.service.completeHandoverWithoutInspection(tenantId, id, stage, overdueCharge, tx, req.user.displayName);
        if (stage === "return") {
          await this.serviceCapacities.markUsedForOrder(tenantId, id, returnedAt, tx);
          await this.business.completeCustomerOrderEventInTransaction(tenantId, context, completed.customerId, tx);
        }
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
    }
    return this.committed(tenantId, order);
  }
}
