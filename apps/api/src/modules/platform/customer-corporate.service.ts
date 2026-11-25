/** 原企业资料provider供给同一客户主档和事务；业务实现由Rental包持有。 */
import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { CustomerCorporateService as CustomerCorporateApplication } from "@rental-os/rental-core/mysql-customer-corporate";
import { PrismaService } from "../database/prisma.service";
import { SharedCustomerRepository } from "./shared-customer.repository";

@Injectable()
export class CustomerCorporateService extends CustomerCorporateApplication<Prisma.TransactionClient> {
  constructor(
    prisma: PrismaService,
    @Inject(SharedCustomerRepository) customers: SharedCustomerRepository
  ) { super(prisma, customers); }
}
