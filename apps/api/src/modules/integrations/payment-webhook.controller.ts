import { Controller, HttpCode, HttpException, HttpStatus, Post, Req } from "@nestjs/common";
import { PaymentRuntimeService } from "./payment.runtime.service";
import { PaymentWebhookRateLimiter } from "./payment-webhook-rate-limit";

interface WebhookRequest {
  body?: unknown;
  rawBody?: Buffer;
  headers: Record<string, unknown>;
  ip?: string;
}

/**
 * 第三方支付回调入口。
 * 路由本身不带运营登录态，ApiAuthGuard 只对支付/退款回调精确路径放行；
 * 真正的安全边界是各支付平台的签名、商户标识、金额和事件幂等校验。
 * 进程内按 IP 限流只是在验签之前挡住明显的洪水，见 payment-webhook-rate-limit.ts。
 */
@Controller("payments/webhooks")
export class PaymentWebhookController {
  /** 不走 DI：限流器无依赖，放进容器只会让测试替换更麻烦。测试可直接覆盖此字段。 */
  private readonly rateLimiter = new PaymentWebhookRateLimiter();

  constructor(private readonly payments: PaymentRuntimeService) {}

  private assertRate(req: WebhookRequest) {
    if (!this.rateLimiter.allow(req.ip)) {
      throw new HttpException("支付回调请求过于频繁", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  @Post("alipay")
  @HttpCode(200)
  alipay(@Req() req: WebhookRequest) {
    this.assertRate(req);
    return this.payments.handleAlipayCallback(req.body);
  }

  @Post("wechat_pay")
  @HttpCode(200)
  wechatPay(@Req() req: WebhookRequest) {
    this.assertRate(req);
    return this.payments.handleWechatCallback({ body: req.body, rawBody: req.rawBody, headers: req.headers });
  }

  @Post("stripe")
  @HttpCode(200)
  stripe(@Req() req: WebhookRequest) {
    this.assertRate(req);
    return this.payments.handleStripeCallback({ body: req.body, rawBody: req.rawBody, headers: req.headers });
  }

  @Post("alipay/refund")
  @HttpCode(200)
  alipayRefund(@Req() req: WebhookRequest) {
    this.assertRate(req);
    return this.payments.handleAlipayRefundCallback(req.body);
  }

  @Post("wechat_pay/refund")
  @HttpCode(200)
  wechatRefund(@Req() req: WebhookRequest) {
    this.assertRate(req);
    return this.payments.handleWechatRefundCallback({ body: req.body, rawBody: req.rawBody, headers: req.headers });
  }
}
