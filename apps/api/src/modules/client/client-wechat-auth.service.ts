/** 原微信客户认证的Nest接线，保留八项实例及Optional日志，登录/绑定规则由Rental单源执行。 */
import { Injectable, Optional } from "@nestjs/common";
import { ClientWechatAuthService as RentalClientWechatAuthService } from "@rental-os/rental-core/mysql-client-wechat-auth";
import { OperationLogService } from "../../common/operation-log.service";
import { SecretBox } from "../../common/secret-box";
import { PrismaService } from "../database/prisma.service";
import { CustomerRegistrationService } from "../platform/customer-registration.service";
import { CustomerOperationsRepository } from "../platform/customer-operations.repository";
import { SharedCustomerRepository } from "../platform/shared-customer.repository";
import { ClientAuthService } from "./client-auth.service";
import { WechatMiniProgramAdapter } from "./wechat-mini-program.adapter";

@Injectable()
export class ClientWechatAuthService extends RentalClientWechatAuthService {
  constructor(prisma: PrismaService, secretBox: SecretBox, adapter: WechatMiniProgramAdapter,
    registration: CustomerRegistrationService, customers: SharedCustomerRepository,
    operations: CustomerOperationsRepository, auth: ClientAuthService,
    @Optional() operationLog?: OperationLogService) {
    super(prisma, secretBox, adapter, registration, customers, operations, auth, operationLog);
  }
}
