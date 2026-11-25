/** Rental品类准备/采用的私有宿主接点。原Auth提供当前空间租约，订阅服务提供
 * 同事务的期限/权益读取；业务绑定与原收据由Rental事务持有者提交。 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import type { CategoryPreparationPreview } from "./category-governance";
import type { RentalIdempotencyStore } from "./mysql-idempotency";
import type { WorkspaceCapabilityService } from "./workspace-capabilities";
import type { CapabilityHookRuntime } from "./capability-runtime";

export type RentalCategoryAdoptionStorage = Pick<PrismaClient, "$transaction">;
export type RentalCategoryAdoptionReceiptStore = Pick<RentalIdempotencyStore<Prisma.TransactionClient>, "find" | "record">;
export type RentalCategoryAdoptionCapabilities = Pick<WorkspaceCapabilityService, "prepareAdoptionConfigs" | "adoptionCompatibility">;
export type RentalCategoryAdoptionHooks = Pick<CapabilityHookRuntime,
  "registeredVersions" | "assertCategoryComposition" | "assertInspectionComposition">;

export interface RentalCategoryAdoptionAccessLease {
  user: SystemUserRow;
  revalidate(): Promise<SystemUserRow>;
}

export interface RentalCategoryAdoptionAuthority {
  lockRequestWorkspaceAccess(transaction: Prisma.TransactionClient): Promise<RentalCategoryAdoptionAccessLease>;
}

export interface RentalCategoryAdoptionCommercial {
  lockCategoryCommercialContext(
    tenantId: string, transaction: Prisma.TransactionClient, featureCodes: readonly string[]
  ): Promise<{ lockedFeatureCodes: readonly string[] }>;
  readCategoryCommercialContext(
    tenantId: string, transaction: Prisma.TransactionClient, now: Date, featureCodes?: readonly string[]
  ): Promise<CategoryPreparationPreview["commercialContext"]>;
}

export interface RentalCategoryAdoptionAvailability {
  enabled(): boolean;
}
