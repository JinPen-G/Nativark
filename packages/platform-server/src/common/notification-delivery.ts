/** 公共短信投递的原结果和unknown错误身份。
 * 只描述确定响应与原回执查询；结果未知不证明失败或允许换键重发。 */
import { ServiceUnavailableException } from "@nestjs/common";
import type { TenantIntegrationProvider } from "@rental-os/platform-contracts/integration-provider";

export interface VerificationSmsResult {
  configured: boolean;
  provider?: TenantIntegrationProvider;
  externalRequestId?: string;
}

export interface NotificationSmsResult extends VerificationSmsResult {}

export type NotificationDeliveryQueryStatus = "pending" | "delivered" | "failed";

export interface NotificationDeliveryQueryResult {
  status: NotificationDeliveryQueryStatus;
  providerStatus: string;
  detail?: string;
}

/**
 * 请求已经离开本服务，但没有拿到服务商的确定响应。
 * 这种情况不能当作“发送失败”自动重试，否则服务商可能已经受理而造成重复短信。
 */
export class NotificationDeliveryUnknownError extends ServiceUnavailableException {
  constructor(message = "短信服务商响应未知，请先查询服务商投递记录") {
    super(message);
    this.name = "NotificationDeliveryUnknownError";
  }
}
