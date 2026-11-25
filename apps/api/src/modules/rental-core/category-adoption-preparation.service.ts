/** 原Nest接线；Rental包持有准备和原批次读取，保存不激活实体或切换业务绑定。 */
import { Injectable, Optional } from "@nestjs/common";
import { CategoryAdoptionPreparationService as RentalCategoryAdoptionPreparationService } from "@rental-os/rental-core/mysql-category-preparation";
import { PrismaService } from "../database/prisma.service";
import { AuthService } from "../auth/auth.service";
import { SubscriptionService } from "../subscription/subscription.service";
import { WorkspaceCapabilityService } from "./workspace-capability.service";
import { CapabilityHookRuntime } from "./capability-hook.runtime";
import { CategoryAdoptionApplication } from "./category-adoption.application";
export { CATEGORY_ADOPTION_MANAGE, assertCategoryPreparationPermission } from "@rental-os/rental-core/mysql-category-preparation";

@Injectable()
export class CategoryAdoptionPreparationService extends RentalCategoryAdoptionPreparationService {
  constructor(prisma: PrismaService, capabilities: WorkspaceCapabilityService,
    hooks: CapabilityHookRuntime, subscriptions: SubscriptionService,
    @Optional() auth?: AuthService, @Optional() adoptions?: CategoryAdoptionApplication) {
    super(prisma, capabilities, hooks, subscriptions, auth, adoptions);
  }
}
