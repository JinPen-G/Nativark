/** 原客户治理Nest接线，供给同一数据库、主档/状态写入者与可选注销检查。 */
import { Inject, Injectable, Optional } from "@nestjs/common";
import { CustomerOperationsService as RentalCustomerOperationsService } from "@rental-os/rental-core/mysql-customer-governance";
import { PrismaService } from "../database/prisma.service";
import { SharedCustomerRepository } from "./shared-customer.repository";
import { CustomerOperationsRepository } from "./customer-operations.repository";
import { CustomerMergeService } from "./customer-merge.service";
export * from "@rental-os/rental-core/mysql-customer-governance";

@Injectable()
export class CustomerOperationsService extends RentalCustomerOperationsService {
  constructor(
    prisma: PrismaService,
    @Inject(SharedCustomerRepository) customers: SharedCustomerRepository,
    @Inject(CustomerOperationsRepository) operations: CustomerOperationsRepository,
    @Optional() closability?: CustomerMergeService
  ) { super(prisma, customers, operations, closability); }
}
