import { Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import type {
  CreateRentalInspectionRequest,
  CreateRentalOrderRequest,
  RentalAvailabilityRequest,
  SaveRentalAssetRequest,
  SaveRentalCouponTemplateRequest,
  SaveRentalFulfillmentLocationRequest,
  SaveRentalItemGroupRequest,
  SaveRentalStockBalanceRequest,
  SaveTenantRentalBusinessSettingsRequest,
  SaveTenantRentalProfileRequest,
  SystemUserRow
} from "@store-rental/shared";
import { RentalCoreService } from "./rental-core.service";

interface AuthenticatedRequest { user: SystemUserRow; }

@Controller("rental/v1")
export class RentalCoreController {
  constructor(private readonly service: RentalCoreService) {}
  @Get("categories") categories() { return this.service.listCategories(); }
  @Get("tenant-profile") profile(@Req() req: AuthenticatedRequest) { return this.service.getProfile(req.user.tenantId); }
  @Put("tenant-profile") saveProfile(@Req() req: AuthenticatedRequest, @Body() body: SaveTenantRentalProfileRequest) { return this.service.saveProfile(req.user.tenantId, body); }
  @Get("business-settings") businessSettings(@Req() req: AuthenticatedRequest) { return this.service.getBusinessSettings(req.user.tenantId); }
  @Put("business-settings") saveBusinessSettings(@Req() req: AuthenticatedRequest, @Body() body: SaveTenantRentalBusinessSettingsRequest) { return this.service.saveBusinessSettings(req.user.tenantId, body, req.user.displayName); }
  @Get("coupon-templates") couponTemplates(@Req() req: AuthenticatedRequest) { return this.service.listCouponTemplates(req.user.tenantId); }
  @Post("coupon-templates") saveCouponTemplate(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalCouponTemplateRequest) { return this.service.saveCouponTemplate(req.user.tenantId, body); }
  @Put("coupon-templates/:id") updateCouponTemplate(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalCouponTemplateRequest) { return this.service.saveCouponTemplate(req.user.tenantId, { ...body, id }); }
  @Get("locations") locations(@Req() req: AuthenticatedRequest) { return this.service.listLocations(req.user.tenantId); }
  @Post("locations") saveLocation(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalFulfillmentLocationRequest) { return this.service.saveLocation(req.user.tenantId, body); }
  @Put("locations/:id") updateLocation(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalFulfillmentLocationRequest) { return this.service.saveLocation(req.user.tenantId, { ...body, id }); }
  @Get("item-groups") groups(@Req() req: AuthenticatedRequest) { return this.service.listItemGroups(req.user.tenantId); }
  @Post("item-groups") saveGroup(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalItemGroupRequest) { return this.service.saveItemGroup(req.user.tenantId, body); }
  @Put("item-groups/:id") updateGroup(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalItemGroupRequest) { return this.service.saveItemGroup(req.user.tenantId, { ...body, id }); }
  @Get("assets") assets(@Req() req: AuthenticatedRequest) { return this.service.listAssets(req.user.tenantId); }
  @Post("assets") saveAsset(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalAssetRequest) { return this.service.saveAsset(req.user.tenantId, body); }
  @Put("assets/:id") updateAsset(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalAssetRequest) { return this.service.saveAsset(req.user.tenantId, { ...body, id }); }
  @Get("stock-balances") stocks(@Req() req: AuthenticatedRequest) { return this.service.listStockBalances(req.user.tenantId); }
  @Put("stock-balances") saveStock(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalStockBalanceRequest) { return this.service.saveStockBalance(req.user.tenantId, body); }
  @Post("availability") availability(@Req() req: AuthenticatedRequest, @Body() body: RentalAvailabilityRequest) { return this.service.availability(req.user.tenantId, body); }
  @Get("orders") orders(@Req() req: AuthenticatedRequest) { return this.service.listOrders(req.user.tenantId); }
  @Get("orders/:id") order(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.service.getOrder(req.user.tenantId, id); }
  @Post("orders") createOrder(@Req() req: AuthenticatedRequest, @Body() body: CreateRentalOrderRequest) { return this.service.createOrder(req.user.tenantId, body, req.user.displayName); }
  @Post("orders/:id/confirm") confirm(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.service.confirmOrder(req.user.tenantId, id); }
  @Post("orders/:id/allocate") allocate(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.service.allocateOrder(req.user.tenantId, id); }
  @Post("orders/:id/cancel") cancel(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.service.cancelOrder(req.user.tenantId, id); }
  @Get("inspection-templates") templates(@Req() req: AuthenticatedRequest, @Query("stage") stage?: "pickup" | "return") { return this.service.listInspectionTemplates(req.user.tenantId, stage); }
  @Get("orders/:id/inspections") inspections(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.service.listInspections(req.user.tenantId, id); }
  @Post("orders/:id/inspections") createInspection(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: CreateRentalInspectionRequest) { return this.service.createInspection(req.user.tenantId, id, body, req.user.displayName); }
}
