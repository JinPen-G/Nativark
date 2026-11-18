/** 原组合会员provider，供给同一客户/注册/风险与企业政策实例；业务实现由Rental包维护。 */
import { Injectable, Optional } from "@nestjs/common";
import { MembershipService as RentalMembershipService } from "@rental-os/rental-core/mysql-membership";
import { PrismaService } from "../database/prisma.service";
import { CustomerOperationsRepository } from "./customer-operations.repository";
import { SharedCustomerRepository } from "./shared-customer.repository";
import { CustomerRegistrationService } from "./customer-registration.service";
import { EnterprisePolicyService } from "../enterprise/enterprise-policy.service";
import { EnterpriseCommandService } from "../enterprise/enterprise-command.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
export * from "@rental-os/rental-core/mysql-membership";

@Injectable()
export class MembershipService extends RentalMembershipService {
  constructor(
    prisma: PrismaService,
    operations: CustomerOperationsRepository,
    @Optional() customers?: SharedCustomerRepository,
    @Optional() registration?: CustomerRegistrationService,
    @Optional() enterprisePolicy?: EnterprisePolicyService
  ) {
    const actualCustomers = customers ?? new SharedCustomerRepository(prisma);
    // 原直接构造入口仍以同一数据源创建真实默认参加者；标准Core装配显式提供它们。
    super(prisma, operations, actualCustomers,
      registration ?? new CustomerRegistrationService(prisma, actualCustomers, operations),
      enterprisePolicy ?? new EnterprisePolicyService(prisma, new EnterpriseCommandService(prisma), new EnterpriseAccessService(prisma)));
  }
}
