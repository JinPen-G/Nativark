/** 原组合的企业政策provider，只供给原数据源、命令和资格读取；政策单源在Rental包。 */
import { Injectable } from "@nestjs/common";
import { EnterprisePolicyService as RentalEnterprisePolicyService } from "@rental-os/rental-core/mysql-enterprise-policy";
import { PrismaService } from "../database/prisma.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { EnterpriseCommandService } from "./enterprise-command.service";
export * from "@rental-os/rental-core/mysql-enterprise-policy";

@Injectable()
export class EnterprisePolicyService extends RentalEnterprisePolicyService {
  constructor(prisma: PrismaService, commands: EnterpriseCommandService, access: EnterpriseAccessService) {
    super(prisma, commands, access);
  }
}
