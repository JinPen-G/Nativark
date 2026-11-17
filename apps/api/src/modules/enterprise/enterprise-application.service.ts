/** 原组合的企业申请provider，复用原客户仓储及命令事务，实际审核由Rental包执行。 */
import { Injectable } from "@nestjs/common";
import { EnterpriseApplicationService as RentalEnterpriseApplicationService } from "@rental-os/rental-core/mysql-enterprise-application";
import { PrismaService } from "../database/prisma.service";
import { SharedCustomerRepository } from "../platform/shared-customer.repository";
import { EnterpriseCommandService } from "./enterprise-command.service";
export * from "@rental-os/rental-core/mysql-enterprise-application";

@Injectable()
export class EnterpriseApplicationService extends RentalEnterpriseApplicationService {
  constructor(prisma: PrismaService, customers: SharedCustomerRepository, commands: EnterpriseCommandService) {
    super(prisma, customers, commands);
  }
}
