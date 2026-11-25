/** 原客户合并Nest接线，复用同一主档、状态仓储和业务事务。 */
import { Inject, Injectable } from "@nestjs/common";
import { CustomerMergeService as RentalCustomerMergeService } from "@rental-os/rental-core/mysql-customer-merge";
import { PrismaService } from "../database/prisma.service";
import { SharedCustomerRepository } from "./shared-customer.repository";
import { CustomerOperationsRepository } from "./customer-operations.repository";
export * from "@rental-os/rental-core/mysql-customer-merge";

@Injectable()
export class CustomerMergeService extends RentalCustomerMergeService {
  constructor(
    prisma: PrismaService,
    @Inject(SharedCustomerRepository) customers: SharedCustomerRepository,
    @Inject(CustomerOperationsRepository) operations: CustomerOperationsRepository
  ) { super(prisma, customers, operations); }
}
