/** Enterprise customer readers use the existing client Guard and current grants.
 * Responses contain curated original order facts within the trusted workspace. */
import { Controller, Get, Header, Param, Query, Req, UnauthorizedException } from "@nestjs/common";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseOrderReaderService } from "./enterprise-order-reader.service";
import { EnterpriseOrderExportQueryDto, EnterpriseOrdersQueryDto } from "./enterprise-order-query.dto";

interface EnterpriseCustomerRequest {
  client?: ClientRequestContext;
}

@Controller("client/v1/enterprise")
export class EnterpriseReadController {
  constructor(private readonly orders: EnterpriseOrderReaderService) {}

  private customer(request: EnterpriseCustomerRequest) {
    if (!request.client) throw new UnauthorizedException("请先登录当前商户客户账号");
    return request.client;
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
