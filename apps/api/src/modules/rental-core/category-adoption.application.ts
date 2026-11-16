/** 原Nest接线；Rental包持有采用事务/原收据，实际Auth与订阅参加同一事务。 */
import { Inject, Injectable } from "@nestjs/common";
import { CategoryAdoptionApplication as RentalCategoryAdoptionApplication } from "@rental-os/rental-core/mysql-category-adoption";
import { PrismaService } from "../database/prisma.service";
import { AuthService } from "../auth/auth.service";
import { SubscriptionService } from "../subscription/subscription.service";
import { RentalIdempotencyRepository, type RentalIdempotencyStore } from "./rental-idempotency.repository";
import { WorkspaceCapabilityService } from "./workspace-capability.service";
import { CapabilityHookRuntime } from "./capability-hook.runtime";

@Injectable()
export class CategoryAdoptionApplication extends RentalCategoryAdoptionApplication {
  constructor(prisma: PrismaService,
    @Inject(RentalIdempotencyRepository) receipts: RentalIdempotencyStore,
    auth: AuthService, capabilities: WorkspaceCapabilityService,
    hooks: CapabilityHookRuntime, subscriptions: SubscriptionService) {
    super(prisma, receipts, auth, capabilities, hooks, subscriptions);
  }
}
