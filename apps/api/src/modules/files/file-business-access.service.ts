/** 原Nest附件授权接线，复用Rental当前对象权限、公共ALS与原客户敏感资料参加者。 */
import { Injectable } from "@nestjs/common";
import { RentalFileBusinessAccessService } from "@rental-os/rental-core/file-access";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreFactRepository } from "../rental-core/rental-core-fact.repository";
import { RentalBusinessFactRepository } from "../rental-core/rental-business-fact.repository";
import { CustomerOperationsService } from "../platform/customer-operations.service";

@Injectable()
export class FileBusinessAccessService extends RentalFileBusinessAccessService {
  constructor(prisma: PrismaService, facts: RentalCoreFactRepository, businessFacts: RentalBusinessFactRepository, customers: CustomerOperationsService) {
    super(prisma, facts, businessFacts, customers);
  }
}
