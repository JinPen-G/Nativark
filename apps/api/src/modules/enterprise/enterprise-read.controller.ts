/** Enterprise customer readers use the existing client Guard and current grants.
 * Responses contain curated original order facts within the trusted workspace. */
import { Controller, Get, Header, Inject, Optional, Param, Query, Req, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { ClientRequestContext } from "../client/client-auth.service";
import { PrismaService } from "../database/prisma.service";
import { CustomerCorporateSettlementService } from "../platform/customer-corporate-settlement.service";
import { RentalEnterpriseReadPort } from "../rental-core/rental-enterprise-read.port";
import { RentalFundingService } from "../rental-core/rental-funding.service";
import { EnterpriseOrderReaderService } from "./enterprise-order-reader.service";
import { EnterpriseOrderExportQueryDto, EnterpriseOrdersQueryDto } from "./enterprise-order-query.dto";

interface EnterpriseCustomerRequest {
  client?: ClientRequestContext;
}

@Controller("client/v1/enterprise")
export class EnterpriseReadController {
  private readonly finances?: RentalEnterpriseReadPort;

  constructor(private readonly orders: EnterpriseOrderReaderService,
    @Optional() @Inject(PrismaService) prisma?: PrismaService,
    @Optional() @Inject(RentalFundingService) funding?: RentalFundingService,
    @Optional() @Inject(CustomerCorporateSettlementService) credit?: CustomerCorporateSettlementService) {
    if (prisma) this.finances = new RentalEnterpriseReadPort(prisma, funding, credit);
  }

  private customer(request: EnterpriseCustomerRequest) {
    if (!request.client) throw new UnauthorizedException("请先登录当前商户客户账号");
    return request.client;
  }

  private financialReader() {
    if (!this.finances) throw new ServiceUnavailableException("企业Core财务读取尚未装配");
    return this.finances;
  }

  @Get("corporates/:corporateId/history-workspaces")
  @Header("Cache-Control", "no-store")
  @Header("Vary", "Authorization")
  historyWorkspaces(@Req() request: EnterpriseCustomerRequest, @Param("corporateId") corporateId: string) {
    const context = this.customer(request);
    return this.financialReader().historicalWorkspaceBasis(context, corporateId);
  }

  @Get("corporates/:corporateId/finance")
  @Header("Cache-Control", "no-store")
  @Header("Vary", "Authorization")
  corporateFinance(@Req() request: EnterpriseCustomerRequest, @Param("corporateId") corporateId: string) {
    const context = this.customer(request);
    return this.financialReader().corporateFinancialProjection(context, corporateId);
  }

  @Get("corporates/:corporateId/orders/:orderId/finance")
  @Header("Cache-Control", "no-store")
  @Header("Vary", "Authorization")
  orderFinance(@Req() request: EnterpriseCustomerRequest, @Param("corporateId") corporateId: string,
    @Param("orderId") orderId: string) {
    const context = this.customer(request);
    return this.financialReader().orderFinancialProjection(context, corporateId, orderId);
  }

  @Get("corporates/:corporateId/orders")
  @Header("Cache-Control", "no-store")
  @Header("Vary", "Authorization")
  listOrders(@Req() request: EnterpriseCustomerRequest, @Param("corporateId") corporateId: string,
    @Query() query: EnterpriseOrdersQueryDto) {
    return this.orders.list(this.customer(request), corporateId, query);
  }

  @Get("corporates/:corporateId/orders/export-rows")
  @Header("Cache-Control", "no-store")
  @Header("Vary", "Authorization")
  exportOrders(@Req() request: EnterpriseCustomerRequest, @Param("corporateId") corporateId: string,
    @Query() query: EnterpriseOrderExportQueryDto) {
    return this.orders.exportRows(this.customer(request), corporateId, query);
  }

  @Get("corporates/:corporateId/orders/:orderId")
  @Header("Cache-Control", "no-store")
  @Header("Vary", "Authorization")
  orderDetail(@Req() request: EnterpriseCustomerRequest, @Param("corporateId") corporateId: string,
    @Param("orderId") orderId: string) {
    return this.orders.detail(this.customer(request), corporateId, orderId);
  }
}
