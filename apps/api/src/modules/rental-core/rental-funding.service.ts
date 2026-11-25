/** 原Nest资金接线；同一数据库、Auth/ALS范围和企业应收供给Rental唯一事实服务。 */
import { Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { RentalFundingService as CoreRentalFundingService } from "@rental-os/rental-core/mysql-funding";
import { PrismaService } from "../database/prisma.service";
import { getRequestIdentity } from "../../common/request-identity";
import { requestRentalOrderVisibilityWhere } from "./rental-core-fact.repository";
import { RentalOrderReceivableRepository } from "./rental-order-receivable.repository";

@Injectable()
export class RentalFundingService extends CoreRentalFundingService<Prisma.TransactionClient> {
  constructor(prisma: PrismaService, @Optional() receivables?: RentalOrderReceivableRepository) {
    super(prisma, { getRequestIdentity, requestRentalOrderVisibilityWhere }, receivables);
  }
}
