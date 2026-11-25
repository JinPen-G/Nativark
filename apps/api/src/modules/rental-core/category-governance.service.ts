/** 原Nest接线；Rental包持有草稿、发布与采用政策，原认证和当前账号参与同一事务。 */
import { Injectable, Optional } from "@nestjs/common";
import { CategoryGovernanceService as RentalCategoryGovernanceService } from "@rental-os/rental-core/mysql-category-governance";
import { PrismaService } from "../database/prisma.service";
import { AuthService } from "../auth/auth.service";
import { PlatformRepository } from "../platform/platform.repository";
import { CapabilityHookRuntime } from "./capability-hook.runtime";
export { assertCategoryGovernancePermission, patchCategorySection } from "@rental-os/rental-core/mysql-category-governance";

@Injectable()
export class CategoryGovernanceService extends RentalCategoryGovernanceService {
  constructor(prisma: PrismaService, hooks: CapabilityHookRuntime,
    @Optional() auth?: AuthService, @Optional() principals?: PlatformRepository) {
    super(prisma, hooks, auth, principals);
  }
}
