/** 原组合的管理申请provider，提供原资格和商户认证；批准事实不直接修改政策或资金。 */
import { Injectable, Optional } from "@nestjs/common";
import { EnterpriseManagementRequestService as RentalEnterpriseManagementRequestService } from "@rental-os/rental-core/mysql-enterprise-management-request";
import { PrismaService } from "../database/prisma.service";
import { EnterpriseCommandService } from "./enterprise-command.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { AuthService } from "../auth/auth.service";
export * from "@rental-os/rental-core/mysql-enterprise-management-request";

@Injectable()
export class EnterpriseManagementRequestService extends RentalEnterpriseManagementRequestService {
  constructor(prisma: PrismaService, commands: EnterpriseCommandService, access: EnterpriseAccessService, @Optional() auth?: AuthService) {
    super(prisma, commands, access, auth);
  }
}
