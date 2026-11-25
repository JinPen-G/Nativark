/** 原Nest企业应收接线；沿同一资金/订单事务核销，原现金、回款和债权只有一份算法。 */
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { RentalOrderReceivableRepository as CoreRentalOrderReceivableRepository } from "@rental-os/rental-core/mysql-order-receivables";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class RentalOrderReceivableRepository extends CoreRentalOrderReceivableRepository<Prisma.TransactionClient> {
  constructor(prisma: PrismaService) {
    super(prisma);
  }
}
