/** 原邮件服务仅装配同一公共运行实现；原业务授权与原消息收据继续由调用方维护。 */
import { Injectable } from "@nestjs/common";
import { TenantEmailRuntimeService as PlatformEmailRuntime } from "@rental-os/platform-server/integration-email";
import { TenantIntegrationService } from "./tenant-integration.service";
@Injectable()
export class TenantEmailRuntimeService extends PlatformEmailRuntime {
  constructor(integrations: TenantIntegrationService) { super(integrations); }
}
