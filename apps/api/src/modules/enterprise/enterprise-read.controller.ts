/** Enterprise customer readers use the existing client Guard and current grants.
 * Responses contain curated original order facts within the trusted workspace. */
import { Controller, ForbiddenException, Get, Header, Inject, Optional, Param, Query, Req, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { RentalEnterpriseCorporateFinancialProjection, RentalEnterpriseOrderFinancialProjection } from "@rental-os/shared";
import { getRequestIdentity } from "../../common/request-identity";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
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
  private readonly exportAccess?: EnterpriseAccessService;

  constructor(private readonly orders: EnterpriseOrderReaderService,
    @Optional() @Inject(PrismaService) prisma?: PrismaService,
    @Optional() @Inject(RentalFundingService) funding?: RentalFundingService,
    @Optional() @Inject(CustomerCorporateSettlementService) credit?: CustomerCorporateSettlementService) {
    if (prisma) {
      this.finances = new RentalEnterpriseReadPort(prisma, funding, credit);
      this.exportAccess = new EnterpriseAccessService(prisma);
    }
  }

  private customer(request: EnterpriseCustomerRequest) {
    if (!request.client) throw new UnauthorizedException("请先登录当前商户客户账号");
    return request.client;
  }

  private financialReader() {
    if (!this.finances) throw new ServiceUnavailableException("企业Core财务读取尚未装配");
    return this.finances;
  }

  private async financialExport<T extends RentalEnterpriseCorporateFinancialProjection | RentalEnterpriseOrderFinancialProjection>(
    inputContext: ClientRequestContext, corporateId: string, required: readonly ("finance:read" | "orders:read")[],
    read: (context: ClientRequestContext) => Promise<T>
  ): Promise<T> {
    const context = Object.freeze({ ...inputContext });
    if (!this.exportAccess) throw new ServiceUnavailableException("企业财务导出读取尚未装配");
    const before = await this.exportAccess.requireWorkspaceAction(context, corporateId, "export:create");
    if (required.some(action => !before.actions.includes(action))) throw new ForbiddenException("企业财务导出缺少当前读取权限");
    const result = await read(context);
    // Close grants and the session/workspace in one fresh observation after
    // Core IO; no earlier export grant may authorize the delivered projection.
    const after = await this.exportAccess.requireWorkspaceAction(context, corporateId, "export:create");
    const identity = getRequestIdentity();
    if (!identity || identity.audience !== "client" || identity.isSaasAdmin || identity.staffApi || identity.dataScope !== undefined
      || identity.tenantId !== context.tenantId || identity.userId !== context.customerId || identity.workspaceId !== context.workspaceId
      || before.membershipId !== after.membershipId || before.permissionRevision !== after.permissionRevision
      || required.some(action => !after.actions.includes(action))
      || result.corporateCustomerId !== corporateId || result.permissionRevision !== after.permissionRevision) {
      throw new ForbiddenException("企业财务导出权限或当前经营空间已变化");
    }
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > 65536) throw new ServiceUnavailableException("企业财务导出超过完整投影上限");
    return result;
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

  @Get("corporates/:corporateId/finance/export-rows")
  @Header("Cache-Control", "no-store")
  @Header("Vary", "Authorization")
  exportCorporateFinance(@Req() request: EnterpriseCustomerRequest, @Param("corporateId") corporateId: string) {
    const context = this.customer(request);
    return this.financialExport(context, corporateId, ["finance:read"], subject => this.financialReader().corporateFinancialProjection(subject, corporateId));
  }

  @Get("corporates/:corporateId/orders/:orderId/finance")
  @Header("Cache-Control", "no-store")
  @Header("Vary", "Authorization")
  orderFinance(@Req() request: EnterpriseCustomerRequest, @Param("corporateId") corporateId: string,
    @Param("orderId") orderId: string) {
    const context = this.customer(request);
    return this.financialReader().orderFinancialProjection(context, corporateId, orderId);
  }

  @Get("corporates/:corporateId/orders/:orderId/finance/export-rows")
  @Header("Cache-Control", "no-store")
  @Header("Vary", "Authorization")
  exportOrderFinance(@Req() request: EnterpriseCustomerRequest, @Param("corporateId") corporateId: string,
    @Param("orderId") orderId: string) {
    const context = this.customer(request);
    return this.financialExport(context, corporateId, ["finance:read", "orders:read"], subject => this.financialReader().orderFinancialProjection(subject, corporateId, orderId));
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
