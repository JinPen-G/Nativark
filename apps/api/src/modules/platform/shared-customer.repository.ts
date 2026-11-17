/** 原组合API的Rental客户仓储provider，只注入同一数据源；实际写入由Rental包单源维护。 */
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { SharedCustomerRepository as RentalCustomerRepository } from "@rental-os/rental-core/mysql-customer-master";
import { PrismaService } from "../database/prisma.service";
export * from "@rental-os/rental-core/mysql-customer-master";
/** 原注册/流程调用方继续持有完整事务，仓储实际只消费自身的窄MySQL视图。 */
export type SharedCustomerTx = Prisma.TransactionClient;

@Injectable()
export class SharedCustomerRepository extends RentalCustomerRepository {
  constructor(prisma: PrismaService) { super(prisma); }
}
