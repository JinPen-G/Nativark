/** 原组合的企业成员provider，注入同一命令、资格和客户仓储；邀请/交接由Rental包单源执行。 */
import { Injectable } from "@nestjs/common";
import { EnterpriseMembersService as RentalEnterpriseMembersService } from "@rental-os/rental-core/mysql-enterprise-members";
import { PrismaService } from "../database/prisma.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { SharedCustomerRepository } from "../platform/shared-customer.repository";
import { EnterpriseCommandService } from "./enterprise-command.service";
export * from "@rental-os/rental-core/mysql-enterprise-members";

@Injectable()
export class EnterpriseMembersService extends RentalEnterpriseMembersService {
  constructor(prisma: PrismaService, commands: EnterpriseCommandService, access: EnterpriseAccessService, customers: SharedCustomerRepository) {
    super(prisma, commands, access, customers);
  }
}
