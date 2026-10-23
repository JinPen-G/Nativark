import { ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma, type RentalCategoryCode } from "@prisma/client";
import type { PrismaService } from "../database/prisma.service";

export function categoryScopeAllows(scope: string, tenantIds: unknown, tenantId: string) {
  return scope === "all" || (scope === "pilot" && Array.isArray(tenantIds) && tenantIds.includes(tenantId));
}
/** Lock order: category identity, then version policy. Governance writes use the same order. */
export async function assertCategoryAdoptionAllowed(
  db: Prisma.TransactionClient | PrismaService, tenantId: string, categoryCode: RentalCategoryCode,
  versionId: string, operation: "create" | "upgrade" | "restore"
) {
  const categories = await db.$queryRaw<Array<{ openingScope: string; openingTenantIds: unknown; recommendedVersionId: string | null }>>(Prisma.sql`SELECT openingScope, openingTenantIds, recommendedVersionId FROM rental_category_definitions WHERE code = ${categoryCode.toLowerCase()} FOR UPDATE`);
  const category = categories[0];
  if (!category) throw new ConflictException("租赁品类不存在");
  if (operation === "create" && !categoryScopeAllows(category.openingScope, category.openingTenantIds, tenantId)) {
    throw new ForbiddenException("该品类当前不允许本租户新开通空间");
  }
  const policies = await db.$queryRaw<Array<{ createScope: string; createTenantIds: unknown; upgradeScope: string; upgradeTenantIds: unknown; restoreScope: string; restoreTenantIds: unknown }>>(Prisma.sql`SELECT createScope, createTenantIds, upgradeScope, upgradeTenantIds, restoreScope, restoreTenantIds FROM rental_category_version_policies WHERE versionId = ${versionId} FOR UPDATE`);
  const version = await db.rentalCategoryVersion.findUnique({ where: { id: versionId } });
  if (!version || version.categoryCode !== categoryCode || !["published", "legacy_baseline"].includes(version.status)) {
    throw new ConflictException("目标品类版本不是可采用的发布版本");
  }
  const policy = policies[0];
  if (!policy || !categoryScopeAllows(policy[`${operation}Scope`], policy[`${operation}TenantIds`], tenantId)) {
    throw new ForbiddenException("本租户不在目标版本的采用范围内");
  }
}
