/** 原企业结算provider只接原数据库、净实收及当前主体仓储；账务算法由Rental包持有。 */
import { Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { CustomerCorporateSettlementService as CustomerCorporateSettlementApplication } from "@rental-os/rental-core/mysql-customer-corporate-settlement";
import { PrismaService } from "../database/prisma.service";
import { RentalFundingService } from "../rental-core/rental-funding.service";
import { PlatformRepository } from "./platform.repository";

@Injectable()
export class CustomerCorporateSettlementService extends CustomerCorporateSettlementApplication<Prisma.TransactionClient> {
  constructor(
    prisma: PrismaService,
    @Optional() funding?: RentalFundingService,
    @Optional() principals?: PlatformRepository
  ) { super(prisma, funding, principals); }
}
