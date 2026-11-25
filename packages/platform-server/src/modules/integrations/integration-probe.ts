/** 支付连接测试只消费宿主的原只读探针，资金执行、回调与原收据继续归业务宿主。 */
import type { TenantIntegrationRuntimeConfig } from "./tenant-integration.service";

export interface PaymentIntegrationProbe {
  testConnection(config: TenantIntegrationRuntimeConfig): Promise<string>;
}

export const INTEGRATION_PAYMENT_PROBE = Symbol("platform.integration-payment-probe");

/** 邮箱探针只验证加密连接/登录，不投递或修改邮件。 */
export interface EmailIntegrationProbe {
  testConnection(config: TenantIntegrationRuntimeConfig): Promise<string>;
}
export const INTEGRATION_EMAIL_PROBE = Symbol("platform.integration-email-probe");
