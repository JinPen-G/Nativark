/** 原Nest换货试算provider；同一Core、报价、配货、事务和可选容量按原顺序注入。
 * 试算与候选逻辑由Rental包唯一实现，当前Guard/客户/企业批准仍由原调用方核验。 */
import { Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { RentalExchangePreviewService as CoreRentalExchangePreviewService } from "@rental-os/rental-core/mysql-exchange-preview";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreService } from "./rental-core.service";
import { RentalBusinessService } from "./rental-business.service";
import { RentalAllocationService } from "./rental-allocation.service";
import { RentalServiceCapacityService } from "./rental-service-capacity.service";

@Injectable()
export class RentalExchangePreviewService extends CoreRentalExchangePreviewService<Prisma.TransactionClient> {
  constructor(core: RentalCoreService, business: RentalBusinessService, allocation: RentalAllocationService,
    prisma: PrismaService, @Optional() serviceCapacities?: RentalServiceCapacityService) {
    super(core, business, allocation, prisma, serviceCapacities);
  }
}
