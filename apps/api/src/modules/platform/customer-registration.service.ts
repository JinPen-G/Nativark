/** 个人客户注册的原Nest参加者。客户端和后台共用Rental唯一实现及原客户行锁。 */
import { Injectable, Optional } from "@nestjs/common";
import { CustomerRegistrationService as RentalCustomerRegistrationService } from "@rental-os/rental-core/mysql-customer-registration";
import { PrismaService } from "../database/prisma.service";
import { CustomerOperationsRepository } from "./customer-operations.repository";
import { SharedCustomerRepository } from "./shared-customer.repository";
export * from "@rental-os/rental-core/mysql-customer-registration";

@Injectable()
export class CustomerRegistrationService extends RentalCustomerRegistrationService {
  constructor(
    prisma: PrismaService,
    @Optional() customers?: SharedCustomerRepository,
    @Optional() operations?: CustomerOperationsRepository
  ) {
    const actualCustomers = customers ?? new SharedCustomerRepository(prisma);
    super(actualCustomers, operations ?? new CustomerOperationsRepository(prisma, actualCustomers));
  }
}
