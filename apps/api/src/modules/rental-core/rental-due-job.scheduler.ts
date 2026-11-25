/** 原到期作业Nest接线；只供给同一七项依赖，计时/锁/业务执行由Rental包单源维护。 */
import { Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreService } from "./rental-core.service";
import { RentalBusinessService } from "./rental-business.service";
import { RentalIdempotentActionService } from "./rental-idempotent-action.service";
import { RentalServiceCapacityService } from "./rental-service-capacity.service";
import { CustomerCorporateSettlementService } from "../platform/customer-corporate-settlement.service";
import { PaymentRuntimeService } from "../integrations/payment.runtime.service";
import { RentalDueJobScheduler as RentalDueJobImplementation } from "@rental-os/rental-core/mysql-due-jobs";
export { rentalDueJobLockName, rentalDueJobsDisabled, rentalDueJobIntervalMs, RENTAL_DUE_JOB_BATCH_SIZE, RENTAL_DUE_JOB_DEFAULT_INTERVAL_MS, RENTAL_DUE_JOB_OPERATOR } from "@rental-os/rental-core/mysql-due-jobs";
export type { RentalDueJob } from "@rental-os/rental-core/mysql-due-jobs";

@Injectable()
export class RentalDueJobScheduler extends RentalDueJobImplementation<Prisma.TransactionClient> {
  constructor(prisma: PrismaService, core: RentalCoreService, business: RentalBusinessService,
    idempotent: RentalIdempotentActionService, serviceCapacities: RentalServiceCapacityService,
    @Optional() corporateSettlement?: CustomerCorporateSettlementService,
    @Optional() payments?: PaymentRuntimeService) {
    super(prisma, core, business, idempotent, serviceCapacities, corporateSettlement, payments);
  }
}
