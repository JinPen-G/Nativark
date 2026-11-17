/** 支付连接测试只消费宿主的原只读探针，资金执行、回调与原收据继续归业务宿主。 */
import type { TenantIntegrationRuntimeConfig } from "./tenant-integration.service";

export interface PaymentIntegrationProbe {
  testConnection(config: TenantIntegrationRuntimeConfig): Promise<string>;
}

export const INTEGRATION_PAYMENT_PROBE = Symbol("platform.integration-payment-probe");
