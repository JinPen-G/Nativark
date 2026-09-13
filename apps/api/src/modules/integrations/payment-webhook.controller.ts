import { Controller, HttpCode, Post, Req } from "@nestjs/common";
import { PaymentRuntimeService } from "./payment.runtime.service";

interface WebhookRequest {
  body?: unknown;
  rawBody?: Buffer;
  headers: Record<string, unknown>;
}

/**
 * 第三方支付回调入口。
 * 路由本身不带运营登录态，ApiAuthGuard 只对支付/退款回调精确路径放行；
 * 真正的安全边界是各支付平台的签名、商户标识、金额和事件幂等校验。
 */
@Controller("payments/webhooks")
export class PaymentWebhookController {
  constructor(private readonly payments: PaymentRuntimeService) {}

  @Post("alipay")
  @HttpCode(200)
  alipay(@Req() req: WebhookRequest) {
    return this.payments.handleAlipayCallback(req.body);
  }

  @Post("wechat_pay")
  @HttpCode(200)
  wechatPay(@Req() req: WebhookRequest) {
    return this.payments.handleWechatCallback({ body: req.body, rawBody: req.rawBody, headers: req.headers });
  }

  @Post("alipay/refund")
  @HttpCode(200)
  alipayRefund(@Req() req: WebhookRequest) {
    return this.payments.handleAlipayRefundCallback(req.body);
  }

  @Post("wechat_pay/refund")
  @HttpCode(200)
  wechatRefund(@Req() req: WebhookRequest) {
    return this.payments.handleWechatRefundCallback({ body: req.body, rawBody: req.rawBody, headers: req.headers });
  }
}
