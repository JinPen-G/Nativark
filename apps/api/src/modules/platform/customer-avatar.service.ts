/** 原头像Nest接线，复用同一客户SQL存储与原文件策略。 */
import { Injectable } from "@nestjs/common";
import { CustomerAvatarService as RentalCustomerAvatarService } from "@rental-os/rental-core/mysql-customer-avatar";
import { PrismaService } from "../database/prisma.service";
export * from "@rental-os/rental-core/mysql-customer-avatar";

@Injectable()
export class CustomerAvatarService extends RentalCustomerAvatarService {
  constructor(prisma: PrismaService) { super(prisma); }
}
