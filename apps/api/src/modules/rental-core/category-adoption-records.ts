import { BadRequestException, ConflictException } from "@nestjs/common";
import { CATEGORY_PREPARATION_LIMITS, type CategoryEntityPreparationPatch, type RentalCategoryDefinition } from "@rental-os/shared";
import { prepareRentalCategoryUniqueClaims } from "./rental-category-attributes";

export interface CategoryPreparationRecord {
  id: string; updatedAt: Date; attributes: Record<string, unknown>;
  serialNo?: string | null; inventoryMode?: string;
}
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Pure candidate projection. Retired fields and media remain stored but do not become new active fields. */
export function prepareCategoryAdoptionRecords(
  definition: RentalCategoryDefinition, groups: CategoryPreparationRecord[], assets: CategoryPreparationRecord[], patches: CategoryEntityPreparationPatch[],
  source: "batch" | "collection" = "batch"
) {
  const maxEntities = source === "collection" ? CATEGORY_PREPARATION_LIMITS.collectionEntities : CATEGORY_PREPARATION_LIMITS.batchEntities;
  const maxBytes = source === "collection" ? CATEGORY_PREPARATION_LIMITS.collectionBytes : CATEGORY_PREPARATION_LIMITS.batchBytes;
  if (!Array.isArray(patches) || patches.length > maxEntities || Buffer.byteLength(JSON.stringify(patches)) > maxBytes) throw new BadRequestException("预备资料超过当前处理范围的安全上限，请核对准备集合");
  const seen = new Set<string>();
  const byIdentity = new Map<string, CategoryEntityPreparationPatch>();
  for (const patch of patches) {
    if (!object(patch) || Object.keys(patch).some((key) => !["entityType", "entityId", "expectedUpdatedAt", "values"].includes(key)) ||
        !["item_group", "asset"].includes(patch.entityType) || typeof patch.entityId !== "string" || !patch.entityId || patch.entityId.length > 191 ||
        typeof patch.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(patch.expectedUpdatedAt)) || new Date(patch.expectedUpdatedAt).toISOString() !== patch.expectedUpdatedAt || !object(patch.values)) throw new BadRequestException("预备实体、修订或字段格式不合法");
    const identity = `${patch.entityType}:${patch.entityId}`;
    if (seen.has(identity)) throw new BadRequestException("同一实体不能提交重复预备补丁");
    seen.add(identity); byIdentity.set(identity, patch);
    const fields = definition.businessModel.assetFields.filter((field) => field.scope === patch.entityType);
    for (const [key, value] of Object.entries(patch.values)) {
      if (["__proto__", "constructor", "prototype"].includes(key) || !fields.some((field) => field.code === key)) throw new BadRequestException(`预备资料包含未定义字段：${key}`);
      if (!["string", "number", "boolean"].includes(typeof value) || (typeof value === "number" && !Number.isFinite(value))) throw new BadRequestException("预备字段只能是已声明的文本、数字或布尔值");
    }
  }
  const project = (scope: "item_group" | "asset", records: CategoryPreparationRecord[]) => {
    const fields = definition.businessModel.assetFields.filter((field) => field.scope === scope);
    const supportsSerialNo = scope === "asset" && fields.some((field) => field.code === "serialNo");
    return records.map((row) => {
      const identity = `${scope}:${row.id}`;
      const patch = byIdentity.get(identity);
      if (patch && Date.parse(patch.expectedUpdatedAt) !== row.updatedAt.getTime()) throw new ConflictException("预备资料的来源实体已修改，请重新读取后准备");
      if (scope === "item_group" && !definition.supportedInventoryModes.includes(String(row.inventoryMode).toLowerCase() as typeof definition.supportedInventoryModes[number])) throw new ConflictException("现有型号库存方式不在目标品类支持范围，请先处理型号");
      const attributes = structuredClone(row.attributes);
      let serialNo = row.serialNo;
      for (const [key, value] of Object.entries(patch?.values ?? {})) {
        if (supportsSerialNo && key === "serialNo") {
          if (typeof value !== "string") throw new BadRequestException("序列号必须是文本");
          serialNo = value;
        }
        else attributes[key] = value;
      }
      const aliases = supportsSerialNo ? { serialNo } : {};
      const projected = Object.fromEntries(fields.filter((field) => !owns(aliases, field.code) && owns(attributes, field.code)).map((field) => [field.code, attributes[field.code]]));
      byIdentity.delete(identity);
      return { ...row, attributes, serialNo, projected, aliases, validateRequired: String(row.inventoryMode).toLowerCase() !== "bundle", changed: Boolean(patch) };
    });
  };
  const itemGroups = project("item_group", groups);
  const assetRows = project("asset", assets);
  if (byIdentity.size) throw new BadRequestException("预备资料引用了不属于当前空间的实体");
  const claims = (scope: "item_group" | "asset", records: typeof itemGroups) => prepareRentalCategoryUniqueClaims(definition.businessModel.assetFields, scope,
    records.map((row) => ({ id: row.id, attributes: row.projected, aliases: row.aliases, validateRequired: row.validateRequired })));
  return { itemGroups, assets: assetRows, itemGroupClaims: claims("item_group", itemGroups), assetClaims: claims("asset", assetRows) };
}
