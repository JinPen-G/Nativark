/** 原Nest订单确认入口，供给同一12项依赖。业务提交、原键恢复和批准仍由Rental单源执行。 */
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { RentalOrderConfirmationService as CoreOrderConfirmation } from "@rental-os/rental-core/mysql-order-confirmation";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreService } from "./rental-core.service";
import { RentalBusinessService } from "./rental-business.service";
import { RentalCoreFactRepository, type RentalCoreFactStore } from "./rental-core-fact.repository";
import { RentalBusinessFactRepository, type RentalBusinessFactStore } from "./rental-business-fact.repository";
import { RentalIdempotencyRepository, type RentalIdempotencyStore } from "./rental-idempotency.repository";
import { CapabilityHookRuntime } from "./capability-hook.runtime";
import { CustomerCorporateService } from "../platform/customer-corporate.service";
import { CustomerOperationsService } from "../platform/customer-operations.service";
import { RentalServiceCapacityService } from "./rental-service-capacity.service";
import { MembershipService } from "../platform/membership.service";
import { EnterprisePolicyService } from "../enterprise/enterprise-policy.service";

@Injectable()
export class RentalOrderConfirmationService extends CoreOrderConfirmation<Prisma.TransactionClient> {
  constructor(
    prisma: PrismaService,
    core: RentalCoreService,
    business: RentalBusinessService,
    @Inject(RentalCoreFactRepository) coreFacts: RentalCoreFactStore,
    @Inject(RentalBusinessFactRepository) businessFacts: RentalBusinessFactStore,
    @Inject(RentalIdempotencyRepository) idempotency: RentalIdempotencyStore,
    @Optional() hooks?: CapabilityHookRuntime,
    @Optional() subjects?: CustomerCorporateService,
    @Optional() customerOperations?: CustomerOperationsService,
    @Optional() serviceCapacities?: RentalServiceCapacityService,
    @Optional() memberships?: MembershipService,
    @Optional() enterprisePolicies?: EnterprisePolicyService
  ) {
    super(prisma, core, business, coreFacts, businessFacts, idempotency, hooks, subjects,
      customerOperations, serviceCapacities, memberships, enterprisePolicies);
  }
}
