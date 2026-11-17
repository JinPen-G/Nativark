/** Rental集成兼容入口。原数据库、真实业务依赖和已实现运行目录供给同一公共服务。 */
import { Injectable } from "@nestjs/common";
import { TenantIntegrationService as PlatformTenantIntegrationService } from "@rental-os/platform-server/tenant-integration";
import { OperationLogService } from "../../common/operation-log.service";
import { SecretBox } from "../../common/secret-box";
import { PrismaService } from "../database/prisma.service";
import { RentalIntegrationBusinessParticipant } from "./rental-integration-business.participant";
export * from "@rental-os/platform-server/tenant-integration";

@Injectable()
export class TenantIntegrationService extends PlatformTenantIntegrationService {
  constructor(prisma: PrismaService, secretBox: SecretBox, operationLog: OperationLogService) {
    super(prisma, secretBox, operationLog, new RentalIntegrationBusinessParticipant(prisma), {
      aliyun_sms: "sms", tencent_sms: "sms", alipay: "payment", wechat_pay: "payment", stripe: "payment",
      aliyun_oss: "file", tencent_cos: "file", s3_compatible: "file"
    });
  }
}
