import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { RentalInventoryMode } from "@rental-os/shared";
import { resolveRentalCategoryVersionBody } from "./rental-category-resolver.service";
import { prepareRentalCategoryUniqueClaims, reconcileRentalCategoryAttributes } from "./rental-category-attributes";
import { lockRentalBusinessTenant } from "./rental-business-fence";

export interface CategoryWriteBinding { categoryVersionId: string; adoptionRevision: number }

/** Caller holds the active space lock and owns this transaction. A collision
 * rolls back the entity and its declarations; it must never become a skipped
 * backfill row or release the previous value in a separate transaction. */
export async function replaceCategoryUniqueClaims(
  tx: Prisma.TransactionClient, tenantId: string, workspaceId: string,
  entityType: "item_group" | "asset", entityId: string,
  claims: readonly { fieldCode: string; label: string; normalizedValue: string }[]
) {
  await tx.rentalAttributeUniqueValue.deleteMany({ where: { tenantId, workspaceId, entityType, entityId } });
  for (const claim of claims) {
    try {
      await tx.rentalAttributeUniqueValue.create({ data: {
        id: `attruniq_${createHash("sha256").update(`${workspaceId}|${entityType}|${claim.fieldCode}|${claim.normalizedValue}`).digest("hex")}`,
        tenantId, workspaceId, entityType, entityId, fieldCode: claim.fieldCode,
        normalizedHash: createHash("sha256").update(claim.normalizedValue).digest("hex"), normalizedValue: claim.normalizedValue
      } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException(`${claim.label}已存在`);
      throw error;
    }
  }
}

/** Every configuration participating in adoption must share this transaction lock. */
export async function lockActiveCategoryBinding(
  tx: Prisma.TransactionClient, tenantId: string, workspaceId: string,
  expected?: CategoryWriteBinding, categoryCode?: string
) {
  await lockRentalBusinessTenant(tx, tenantId);
  const rows = await tx.$queryRaw<Array<{ categoryCode: string; categoryVersionId: string | null; categoryAdoptionRevision: number; status: string }>>(
    Prisma.sql`SELECT categoryCode, categoryVersionId, categoryAdoptionRevision, status FROM business_workspaces WHERE tenantId = ${tenantId} AND id = ${workspaceId} FOR UPDATE`
  );
  const workspace = rows[0];
  if (!workspace || workspace.status.toLowerCase() !== "active" || !workspace.categoryVersionId) throw new ConflictException("经营空间不可用或尚未绑定品类版本");
  if (expected && (workspace.categoryVersionId !== expected.categoryVersionId || workspace.categoryAdoptionRevision !== expected.adoptionRevision)) {
    throw new ConflictException("经营空间品类版本已变化，请刷新后重新保存");
  }
  const code = workspace.categoryCode.toLowerCase();
  if (categoryCode && code !== categoryCode) throw new ConflictException("经营配置与经营空间品类不一致");
  const version = await tx.rentalCategoryVersion.findUnique({ where: { id: workspace.categoryVersionId } });
  const definition = resolveRentalCategoryVersionBody(version, code);
  return { definition, binding: { categoryVersionId: workspace.categoryVersionId, adoptionRevision: workspace.categoryAdoptionRevision } };
}

/** Shares the space lock with adoption. Never trust claims computed before the transaction. */
export async function validateActiveCategoryWrite(
  tx: Prisma.TransactionClient, tenantId: string, workspaceId: string,
  input: { id: string; scope: "item_group" | "asset"; attributes: Record<string, unknown>; serialNo?: string; inventoryMode?: RentalInventoryMode; categoryCode?: string },
  expected?: CategoryWriteBinding,
  allowMediaWrite = false
) {
  const { definition } = await lockActiveCategoryBinding(tx, tenantId, workspaceId, expected, input.categoryCode);
  if (input.inventoryMode && !definition.supportedInventoryModes.includes(input.inventoryMode)) throw new BadRequestException("当前经营品类不支持该库存模式");
  const attributes = { ...input.attributes };
  // Media is maintained by the dedicated upload path, not a category attribute.
  if (input.scope === "item_group") delete attributes.__itemGroupMedia;
  const existing = input.scope === "item_group"
    ? await tx.rentalItemGroup.findFirst({ where: { id: input.id, tenantId, workspaceId }, select: { attributes: true } })
    : await tx.rentalAsset.findFirst({ where: { id: input.id, tenantId, workspaceId }, select: { attributes: true, serialNo: true } });
  const persisted = { ...((existing?.attributes ?? {}) as Record<string, unknown>) };
  const media = input.scope === "item_group"
    ? (!existing || allowMediaWrite ? input.attributes.__itemGroupMedia : persisted.__itemGroupMedia)
    : undefined;
  if (input.scope === "item_group") delete persisted.__itemGroupMedia;
  const reconciled = reconcileRentalCategoryAttributes(definition.businessModel.assetFields, input.scope, attributes, persisted);
  const supportsSerialNo = definition.businessModel.assetFields.some((field) => field.scope === "asset" && field.code === "serialNo");
  const oldSerialNo = existing && "serialNo" in existing && typeof existing.serialNo === "string" ? existing.serialNo : undefined;
  if (input.scope === "asset" && !supportsSerialNo && input.serialNo && input.serialNo !== oldSerialNo) throw new BadRequestException("存在未定义的品类字段：serialNo");
  const aliases = input.scope === "asset" && supportsSerialNo ? { serialNo: input.serialNo } : {};
  const claims = prepareRentalCategoryUniqueClaims(definition.businessModel.assetFields, input.scope, [{
    id: input.id, attributes: reconciled.active, aliases, validateRequired: input.inventoryMode !== "bundle"
  }]).map(({ fieldCode, label, normalizedValue }) => ({ fieldCode, label, normalizedValue }));
  return {
    claims,
    attributes: { ...reconciled.stored, ...(media !== undefined ? { __itemGroupMedia: media } : {}) },
    serialNo: supportsSerialNo ? input.serialNo : oldSerialNo
  };
}
