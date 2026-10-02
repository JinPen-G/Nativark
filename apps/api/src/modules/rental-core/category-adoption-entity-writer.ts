import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { CategoryEntityPreparationPatch, RentalCategoryDefinition } from "@rental-os/shared";
import { lockActiveCategoryBinding, type CategoryWriteBinding } from "./category-active-write";
import { prepareCategoryAdoptionRecords } from "./category-adoption-records";

/** Internal entity phase only. The caller must use a ReadCommitted transaction,
 * lock adoption policy before space, and validate target eligibility, permissions,
 * all business dependencies, preparation revision and target definition first.
 * Binding and audit must be written in that SAME transaction. No public endpoint
 * invokes this phase until the complete adoption gate is implemented. */
export async function writePreparedCategoryEntities(
  tx: Prisma.TransactionClient, tenantId: string, workspaceId: string,
  expected: CategoryWriteBinding, target: RentalCategoryDefinition,
  patches: CategoryEntityPreparationPatch[]
) {
  await lockActiveCategoryBinding(tx, tenantId, workspaceId, expected, target.code);
  const where = { tenantId, workspaceId };
  const [groups, assets] = await Promise.all([
    tx.rentalItemGroup.findMany({ where, orderBy: { id: "asc" } }),
    tx.rentalAsset.findMany({ where, orderBy: { id: "asc" } })
  ]);
  // Includes records created after preparation, not just IDs from the old preview.
  const records = prepareCategoryAdoptionRecords(target,
    groups.map((row) => ({ ...row, attributes: row.attributes as Record<string, unknown> })),
    assets.map((row) => ({ ...row, attributes: row.attributes as Record<string, unknown> })), patches);
  for (const row of records.itemGroups.filter((record) => record.changed)) {
    const result = await tx.rentalItemGroup.updateMany({ where: { ...where, id: row.id, updatedAt: row.updatedAt },
      data: { attributes: row.attributes as Prisma.InputJsonValue } });
    if (result.count !== 1) throw new ConflictException("采用时型号资料已变化，请重新准备");
  }
  for (const row of records.assets.filter((record) => record.changed)) {
    const result = await tx.rentalAsset.updateMany({ where: { ...where, id: row.id, updatedAt: row.updatedAt },
      data: { attributes: row.attributes as Prisma.InputJsonValue, serialNo: row.serialNo } });
    if (result.count !== 1) throw new ConflictException("采用时资产资料已变化，请重新准备");
  }
  // Rebuild both scopes, including unchanged entities and removed unique fields.
  // This is never an asynchronous backfill of active constraints.
  await tx.rentalAttributeUniqueValue.deleteMany({ where: { ...where, entityType: { in: ["item_group", "asset"] } } });
  for (const [entityType, claims] of [["item_group", records.itemGroupClaims], ["asset", records.assetClaims]] as const) {
    for (const claim of claims) {
      try {
        await tx.rentalAttributeUniqueValue.create({ data: {
          id: `attruniq_${createHash("sha256").update(`${workspaceId}|${entityType}|${claim.fieldCode}|${claim.normalizedValue}`).digest("hex")}`,
          ...where, entityType, fieldCode: claim.fieldCode,
          normalizedHash: createHash("sha256").update(claim.normalizedValue).digest("hex"),
          normalizedValue: claim.normalizedValue, entityId: claim.entityId
        } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException(`${claim.label}已存在，采用未完成`);
        throw error;
      }
    }
  }
  return { changedItemGroupIds: records.itemGroups.filter((row) => row.changed).map((row) => row.id),
    changedAssetIds: records.assets.filter((row) => row.changed).map((row) => row.id),
    itemGroupClaimCount: records.itemGroupClaims.length, assetClaimCount: records.assetClaims.length };
}
