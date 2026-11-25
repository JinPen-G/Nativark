import { Body, Controller, Get, Param, Post, Req, Inject } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { RENTAL_HTTP_CORE, type RentalHttpApplications } from "./http-applications";
import { CreatePaymentRefundDto } from "./http-payment-refund.dto";
import { RENTAL_PAYMENT_HTTP, type RentalPaymentHttpApplication } from "./http-payment-applications";

interface AuthenticatedRequest { user: SystemUserRow; }

/** 运营端真实支付退款与恢复入口；实际动账前必须存在订单待退余额。 */
@Controller("rental/v1/orders")
export class PaymentOperationsController {
  constructor(
    @Inject(RENTAL_PAYMENT_HTTP.runtime) private readonly payments: RentalPaymentHttpApplication,
    @Inject(RENTAL_HTTP_CORE) private readonly core: Pick<RentalHttpApplications["core"], "resolveWorkspaceId">
  ) {}

  @Get(":orderId/payment-intents")
  listPaymentIntents(@Req() req: AuthenticatedRequest, @Param("orderId") orderId: string) {
    return this.payments.listPaymentIntents(req.user.tenantId, this.core.resolveWorkspaceId(req.user.tenantId), orderId);
  }

  @Get(":orderId/payment-intents/:intentId/refunds")
  listPaymentRefunds(@Req() req: AuthenticatedRequest, @Param("orderId") orderId: string, @Param("intentId") intentId: string) {
    return this.payments.listPaymentRefunds(req.user.tenantId, this.core.resolveWorkspaceId(req.user.tenantId), orderId, intentId);
  }

  @Post(":orderId/payment-intents/:intentId/refunds")
  createPaymentRefund(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Param("intentId") intentId: string,
    @Body() body: CreatePaymentRefundDto
  ) {
    return this.payments.createPaymentRefund(
      req.user.tenantId,
      this.core.resolveWorkspaceId(req.user.tenantId),
      orderId,
      intentId,
      body,
      req.user.displayName
    );
  }

  @Post(":orderId/payment-intents/:intentId/refunds/:refundId/refresh")
  refreshPaymentRefund(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Param("intentId") intentId: string,
    @Param("refundId") refundId: string
  ) {
    return this.payments.refreshPaymentRefund(
      req.user.tenantId,
      this.core.resolveWorkspaceId(req.user.tenantId),
      orderId,
      intentId,
      refundId
    );
  }
}
