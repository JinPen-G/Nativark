/** 原员工收款Nest接线；原资金、核心与存储实例交给Rental唯一登记/确认实现。 */
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { StaffOfflinePaymentService as RentalStaffOfflinePaymentService } from "@rental-os/rental-core/mysql-staff-payments";
import { PrismaService } from "../database/prisma.service";
import { RentalFundingService } from "./rental-funding.service";
import { RentalCoreService } from "./rental-core.service";

@Injectable()
export class StaffOfflinePaymentService extends RentalStaffOfflinePaymentService<Prisma.TransactionClient> {
  constructor(prisma: PrismaService, funding: RentalFundingService, rentalCore: RentalCoreService) {
    super(prisma, funding, rentalCore);
  }
}
