import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { CategoryEntityPreparationPatch, RentalCategoryDefinition } from "@rental-os/shared";
import { lockActiveCategoryBinding, type CategoryWriteBinding } from "./category-active-write";
import { prepareCategoryAdoptionRecords, type CategoryPreparationRecord } from "./category-adoption-records";
import { normalizedRentalAttributeValue } from "./rental-category-attributes";

/** Plan claim changes from the locked source body and actual candidate facts.
 * Label/display changes do not rebuild constraints. Changed normalized values
 * rebuild their whole field so swaps remain atomic; retired fields release only
 * their own claims. Required/options changes are validated by the projection. */
export function affectedCategoryUniqueFields(
  source: RentalCategoryDefinition, target: RentalCategoryDefinition,
  before: { itemGroups: CategoryPreparationRecord[]; assets: CategoryPreparationRecord[] },
  after: { itemGroups: CategoryPreparationRecord[]; assets: CategoryPreparationRecord[] }
) {
  const result: Record<"item_group" | "asset", string[]> = { item_group: [], asset: [] };
  for (const scope of ["item_group", "asset"] as const) {
    const sourceFields = new Map(source.businessModel.assetFields.filter(field => field.scope === scope && field.unique).map(field => [field.code, field]));
    const targetFields = new Map(target.businessModel.assetFields.filter(field => field.scope === scope && field.unique).map(field => [field.code, field]));
    const oldRows = scope === "item_group" ? before.itemGroups : before.assets;
    const newRows = scope === "item_group" ? after.itemGroups : after.assets;
    const oldById = new Map(oldRows.map(row => [row.id, row]));
    for (const code of new Set([...sourceFields.keys(), ...targetFields.keys()])) {
      const oldField = sourceFields.get(code), newField = targetFields.get(code);
      const value = (row: CategoryPreparationRecord | undefined) => normalizedRentalAttributeValue(
        scope === "asset" && code === "serialNo" ? row?.serialNo : row?.attributes[code]);
      if (!oldField || !newField || oldField.type !== newField.type ||
        newRows.some(row => value(oldById.get(row.id)) !== value(row))) result[scope].push(code);
    }
    result[scope].sort();
  }
  return result;
}

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
  const { definition: source } = await lockActiveCategoryBinding(tx, tenantId, workspaceId, expected, target.code);
  const where = { tenantId, workspaceId };
  const [groups, assets] = await Promise.all([
    tx.rentalItemGroup.findMany({ where, orderBy: { id: "asc" } }),
    tx.rentalAsset.findMany({ where, orderBy: { id: "asc" } })
  ]);
  // Includes records created after preparation, not just IDs from the old preview.
  const records = prepareCategoryAdoptionRecords(target,
    groups.map((row) => ({ ...row, attributes: row.attributes as Record<string, unknown> })),
    assets.map((row) => ({ ...row, attributes: row.attributes as Record<string, unknown> })), patches, "collection");
  const affected = affectedCategoryUniqueFields(source, target, {
    itemGroups: groups.map(row => ({ ...row, attributes: row.attributes as Record<string, unknown> })),
    assets: assets.map(row => ({ ...row, attributes: row.attributes as Record<string, unknown> }))
  }, records);
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
  // Release all affected fields before creating their candidate claims. Unrelated
  // fields keep their original claim rows, including IDs and audit provenance.
  const claimFilters = (["item_group", "asset"] as const).filter(scope => affected[scope].length)
    .map(scope => ({ entityType: scope, fieldCode: { in: affected[scope] } }));
  if (claimFilters.length) await tx.rentalAttributeUniqueValue.deleteMany({ where: { ...where, OR: claimFilters } });
  for (const [entityType, claims] of [["item_group", records.itemGroupClaims], ["asset", records.assetClaims]] as const) {
    for (const claim of claims.filter(row => affected[entityType].includes(row.fieldCode))) {
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
    itemGroupClaimCount: records.itemGroupClaims.length, assetClaimCount: records.assetClaims.length,
    changedUniqueFields: affected };
}
