import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RentalInventoryMode } from "@rental-os/shared";
import { resolveRentalCategoryVersionBody } from "./rental-category-resolver.service";
import { prepareRentalCategoryUniqueClaims } from "./rental-category-attributes";

export interface CategoryWriteBinding { categoryVersionId: string; adoptionRevision: number }

/** Shares the space lock with adoption. Never trust claims computed before the transaction. */
export async function validateActiveCategoryWrite(
  tx: Prisma.TransactionClient, tenantId: string, workspaceId: string,
  input: { id: string; scope: "item_group" | "asset"; attributes: Record<string, unknown>; serialNo?: string; inventoryMode?: RentalInventoryMode; categoryCode?: string },
  expected?: CategoryWriteBinding
) {
  const rows = await tx.$queryRaw<Array<{ categoryCode: string; categoryVersionId: string | null; categoryAdoptionRevision: number; status: string }>>(
    Prisma.sql`SELECT categoryCode, categoryVersionId, categoryAdoptionRevision, status FROM business_workspaces WHERE tenantId = ${tenantId} AND id = ${workspaceId} FOR UPDATE`
  );
  const workspace = rows[0];
  if (!workspace || workspace.status.toLowerCase() !== "active" || !workspace.categoryVersionId) throw new ConflictException("经营空间不可用或尚未绑定品类版本");
  if (expected && (workspace.categoryVersionId !== expected.categoryVersionId || workspace.categoryAdoptionRevision !== expected.adoptionRevision)) {
    throw new ConflictException("经营空间品类版本已变化，请刷新后重新保存");
  }
  const code = workspace.categoryCode.toLowerCase();
  if (input.categoryCode && code !== input.categoryCode) throw new ConflictException("商品型号与经营空间品类不一致");
  const version = await tx.rentalCategoryVersion.findUnique({ where: { id: workspace.categoryVersionId } });
  const definition = resolveRentalCategoryVersionBody(version, code);
  if (input.inventoryMode && !definition.supportedInventoryModes.includes(input.inventoryMode)) throw new BadRequestException("当前经营品类不支持该库存模式");
  const attributes = { ...input.attributes };
  // Media is maintained by the dedicated upload path, not a category attribute.
  if (input.scope === "item_group") delete attributes.__itemGroupMedia;
  const supportsSerialNo = definition.businessModel.assetFields.some((field) => field.scope === "asset" && field.code === "serialNo");
  if (input.scope === "asset" && !supportsSerialNo && input.serialNo) throw new BadRequestException("存在未定义的品类字段：serialNo");
  const aliases = input.scope === "asset" && supportsSerialNo ? { serialNo: input.serialNo } : {};
  return prepareRentalCategoryUniqueClaims(definition.businessModel.assetFields, input.scope, [{
    id: input.id, attributes, aliases, validateRequired: input.inventoryMode !== "bundle"
  }]).map(({ fieldCode, label, normalizedValue }) => ({ fieldCode, label, normalizedValue }));
}
