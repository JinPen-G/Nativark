/** 原组合客户状态provider，供给同一客户主档写入者与存储；业务实现由Rental包维护。 */
import { Injectable, Optional } from "@nestjs/common";
import { CustomerOperationsRepository as RentalCustomerOperationsRepository } from "@rental-os/rental-core/mysql-customer-operations";
import { PrismaService } from "../database/prisma.service";
import { SharedCustomerRepository } from "./shared-customer.repository";
export * from "@rental-os/rental-core/mysql-customer-operations";

@Injectable()
export class CustomerOperationsRepository extends RentalCustomerOperationsRepository {
  constructor(prisma: PrismaService, @Optional() customers?: SharedCustomerRepository) {
    super(prisma, customers ?? new SharedCustomerRepository(prisma));
  }
}
