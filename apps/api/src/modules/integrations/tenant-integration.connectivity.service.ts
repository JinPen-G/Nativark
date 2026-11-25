/** 原连接测试装配同一公共服务，供给实际短信、对象存储和Rental支付探针。 */
import { Injectable } from "@nestjs/common";
import { TenantIntegrationConnectivityService as PlatformConnectivityService } from "@rental-os/platform-server/integration-connectivity";
import { FileStorageRuntimeService } from "./file-storage.runtime.service";
import { PaymentRuntimeService } from "./payment.runtime.service";
import { TenantIntegrationRuntimeService } from "./tenant-integration.runtime.service";
import { TenantIntegrationService } from "./tenant-integration.service";
import { TenantEmailRuntimeService } from "./tenant-email.runtime.service";

@Injectable()
export class TenantIntegrationConnectivityService extends PlatformConnectivityService {
  constructor(integrations: TenantIntegrationService, sms: TenantIntegrationRuntimeService,
    fileStorage: FileStorageRuntimeService, payment: PaymentRuntimeService, email: TenantEmailRuntimeService) { super(integrations, sms, fileStorage, payment, email); }
}
