import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
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
import { RentalCoreService } from "./rental-core.service";
import { RentalBusinessService, type BusinessContext } from "./rental-business.service";

interface AuthenticatedRequest { user: SystemUserRow; }

@Controller("rental/v1")
export class RentalCoreController {
  constructor(
    private readonly service: RentalCoreService,
    private readonly business: RentalBusinessService
  ) {}

  private context(tenantId: string): BusinessContext {
    const profile = this.service.getProfile(tenantId);
    const category = this.service.listCategories().find((item) => item.code === profile.categoryCode);
    if (!category) throw new Error("租户经营品类定义不存在");
    return { profile, category, settings: this.service.getBusinessSettings(tenantId), groups: this.service.listItemGroups(tenantId), couponTemplates: this.service.listCouponTemplates(tenantId) };
  }
  // 必须先 await 业务结果再写快照：配置写方法已转为异步，若直接把 Promise 传进来
  // 就会与快照写入并发，快照可能捕获到变更前的状态。
  private async committed<T>(tenantId: string, result: T | Promise<T>): Promise<T> {
    const resolved = await result;
    await Promise.all([this.service.persist(tenantId), this.business.persist(tenantId)]);
    return resolved;
  }
  private emitOrderEvent(tenantId: string, eventCode: string, order: { orderNo: string; customerName: string; contactPhone?: string; customerId?: string }) {
    return this.business.emitNotificationEvent(tenantId, this.context(tenantId), eventCode, order.contactPhone ?? order.customerId, { customerName: order.customerName, orderNo: order.orderNo });
  }
  private completeCustomerOrderEvent(tenantId: string, order: { customerId?: string; status: string }) {
    if (order.customerId && order.status === "completed") this.business.handleCustomerEvent(tenantId, this.context(tenantId), order.customerId, "first_order_completed");
  }
  @Get("categories") categories() { return this.service.listCategories(); }
  @Get("tenant-profile") profile(@Req() req: AuthenticatedRequest) { return this.service.getProfile(req.user.tenantId); }
  @Put("tenant-profile") saveProfile(@Req() req: AuthenticatedRequest, @Body() body: SaveTenantRentalProfileRequest) { return this.committed(req.user.tenantId, this.service.saveProfile(req.user.tenantId, body)); }
  @Get("business-settings") businessSettings(@Req() req: AuthenticatedRequest) { return this.service.getBusinessSettings(req.user.tenantId); }
  @Put("business-settings") saveBusinessSettings(@Req() req: AuthenticatedRequest, @Body() body: SaveTenantRentalBusinessSettingsRequest) { return this.committed(req.user.tenantId, this.service.saveBusinessSettings(req.user.tenantId, body, req.user.displayName)); }
  @Get("coupon-templates") couponTemplates(@Req() req: AuthenticatedRequest) { return this.service.listCouponTemplates(req.user.tenantId); }
  @Post("coupon-templates") saveCouponTemplate(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalCouponTemplateRequest) { return this.committed(req.user.tenantId, this.service.saveCouponTemplate(req.user.tenantId, body)); }
  @Put("coupon-templates/:id") updateCouponTemplate(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalCouponTemplateRequest) { return this.committed(req.user.tenantId, this.service.saveCouponTemplate(req.user.tenantId, { ...body, id })); }
  @Get("locations") locations(@Req() req: AuthenticatedRequest) { return this.service.listLocations(req.user.tenantId); }
  @Get("fulfillment-operators") operators(@Req() req: AuthenticatedRequest) { return this.service.listOperators(req.user.tenantId); }
  @Post("fulfillment-operators") saveOperator(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalFulfillmentOperatorRequest) { return this.committed(req.user.tenantId, this.service.saveOperator(req.user.tenantId, body)); }
  @Put("fulfillment-operators/:id") updateOperator(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalFulfillmentOperatorRequest) { return this.committed(req.user.tenantId, this.service.saveOperator(req.user.tenantId, { ...body, id })); }
  @Post("locations") saveLocation(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalFulfillmentLocationRequest) { return this.committed(req.user.tenantId, this.service.saveLocation(req.user.tenantId, body)); }
  @Put("locations/:id") updateLocation(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalFulfillmentLocationRequest) { return this.committed(req.user.tenantId, this.service.saveLocation(req.user.tenantId, { ...body, id })); }
  @Get("item-groups") groups(@Req() req: AuthenticatedRequest) { return this.service.listItemGroups(req.user.tenantId); }
  @Post("item-groups") saveGroup(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalItemGroupRequest) { return this.committed(req.user.tenantId, this.service.saveItemGroup(req.user.tenantId, body)); }
  @Put("item-groups/:id") updateGroup(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalItemGroupRequest) { return this.committed(req.user.tenantId, this.service.saveItemGroup(req.user.tenantId, { ...body, id })); }
  @Get("assets") assets(@Req() req: AuthenticatedRequest) { return this.service.listAssets(req.user.tenantId); }
  @Post("assets") saveAsset(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalAssetRequest) { return this.committed(req.user.tenantId, this.service.saveAsset(req.user.tenantId, body)); }
  @Put("assets/:id") updateAsset(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalAssetRequest) { return this.committed(req.user.tenantId, this.service.saveAsset(req.user.tenantId, { ...body, id })); }
  @Get("stock-balances") stocks(@Req() req: AuthenticatedRequest) { return this.service.listStockBalances(req.user.tenantId); }
  @Put("stock-balances") saveStock(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalStockBalanceRequest) { return this.committed(req.user.tenantId, this.service.saveStockBalance(req.user.tenantId, body)); }
  @Post("availability") availability(@Req() req: AuthenticatedRequest, @Body() body: RentalAvailabilityRequest) { return this.service.availability(req.user.tenantId, body); }
  @Get("orders") orders(@Req() req: AuthenticatedRequest) { return this.service.listOrders(req.user.tenantId); }
  @Get("orders/:id") order(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.service.getOrder(req.user.tenantId, id); }
  @Post("orders") createOrder(@Req() req: AuthenticatedRequest, @Body() body: CreateRentalOrderRequest) {
    const context = this.context(req.user.tenantId);
    const quote = this.business.consumeQuote(req.user.tenantId, context, body.quoteId);
    const quotedLines = quote.request.lines.map((line) => `${line.itemGroupId}:${line.quantity}`).sort();
    const orderLines = body.lines.map((line) => `${line.itemGroupId}:${line.quantity}`).sort();
    if (quote.request.fulfillmentMode !== body.fulfillmentMode || quote.request.fulfillmentLocationId !== body.fulfillmentLocationId || quote.request.returnLocationId !== body.returnLocationId || quote.request.startAt !== body.startAt || quote.request.endAt !== body.endAt || quote.request.customerType !== body.customerType || quote.request.customerId !== body.customerId || JSON.stringify(quotedLines) !== JSON.stringify(orderLines)) {
      throw new BadRequestException("订单内容与服务端报价快照不一致");
    }
    const order = this.service.createOrder(req.user.tenantId, body, req.user.displayName, quote);
    this.business.markQuoteConsumed(req.user.tenantId, context, quote.id, order.id);
    this.business.lockCoupon(req.user.tenantId, context, quote.customerCouponId, order.id);
    this.emitOrderEvent(req.user.tenantId, "order.created", order);
    return this.committed(req.user.tenantId, order);
  }
  @Post("orders/:id/confirm") confirm(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const order = this.service.confirmOrder(req.user.tenantId, id);
    this.business.redeemCoupon(req.user.tenantId, this.context(req.user.tenantId), id);
    this.emitOrderEvent(req.user.tenantId, "order.confirmed", order);
    return this.committed(req.user.tenantId, order);
  }
  @Post("orders/:id/allocate") allocate(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.committed(req.user.tenantId, this.service.allocateOrder(req.user.tenantId, id)); }
  @Post("orders/:id/cancel") cancel(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: CancelRentalOrderRequest) {
    const context = this.context(req.user.tenantId);
    const current = this.service.getOrder(req.user.tenantId, id);
    const quote = this.business.getQuote(req.user.tenantId, context, current.quoteId);
    const charge = this.business.calculateCancellationCharge(req.user.tenantId, context, quote, undefined, Boolean(body.weatherException));
    const order = this.service.cancelOrder(req.user.tenantId, id, body.reason, charge);
    this.business.releaseCoupon(req.user.tenantId, this.context(req.user.tenantId), id);
    this.emitOrderEvent(req.user.tenantId, "order.cancelled", order);
    return this.committed(req.user.tenantId, order);
  }
  @Get("inspection-templates") templates(@Req() req: AuthenticatedRequest, @Query("stage") stage?: "pickup" | "return") { return this.service.listInspectionTemplates(req.user.tenantId, stage); }
  @Get("orders/:id/inspections") inspections(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.service.listInspections(req.user.tenantId, id); }
  @Post("orders/:id/inspections") createInspection(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: CreateRentalInspectionRequest) {
    const context = this.context(req.user.tenantId);
    const current = this.service.getOrder(req.user.tenantId, id);
    const template = this.service.listInspectionTemplates(req.user.tenantId).find((row) => row.id === body.templateId);
    const returnedAt = new Date().toISOString();
    const overdueCharge = template?.stage === "return" ? this.business.calculateOverdueCharge(req.user.tenantId, context, this.business.getQuote(req.user.tenantId, context, current.quoteId), returnedAt) : 0;
    const result = this.service.createInspection(req.user.tenantId, id, body, req.user.displayName);
    if (overdueCharge > 0) this.service.applyOverdueCharge(req.user.tenantId, id, overdueCharge, returnedAt);
    if (template?.stage === "return") {
      const damageCharge = this.business.calculateDamageCharge(req.user.tenantId, context, this.business.getQuote(req.user.tenantId, context, current.quoteId), body.exceptions ?? []);
      if (damageCharge > 0) this.service.applyDamageCharge(req.user.tenantId, id, damageCharge, (body.exceptions ?? []).map((item) => item.description).join("；") || "归还检查损坏费用");
      this.completeCustomerOrderEvent(req.user.tenantId, result.order);
    }
    this.emitOrderEvent(req.user.tenantId, result.inspection.stage === "pickup" ? "pickup.completed" : "return.completed", result.order);
    return this.committed(req.user.tenantId, result);
  }
  @Post("orders/:id/handover/:stage") handover(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("stage") stage: string) {
    if (stage !== "pickup" && stage !== "return") throw new BadRequestException("交接阶段无效");
    const context = this.context(req.user.tenantId);
    const current = this.service.getOrder(req.user.tenantId, id);
    const returnedAt = new Date().toISOString();
    const overdueCharge = stage === "return" ? this.business.calculateOverdueCharge(req.user.tenantId, context, this.business.getQuote(req.user.tenantId, context, current.quoteId), returnedAt) : 0;
    const order = this.service.completeHandoverWithoutInspection(req.user.tenantId, id, stage, overdueCharge);
    if (stage === "return") this.completeCustomerOrderEvent(req.user.tenantId, order);
    this.emitOrderEvent(req.user.tenantId, stage === "pickup" ? "pickup.completed" : "return.completed", order);
    return this.committed(req.user.tenantId, order);
  }
}
