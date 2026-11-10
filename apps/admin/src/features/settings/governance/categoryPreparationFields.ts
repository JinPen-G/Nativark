import { CATEGORY_PREPARATION_LIMITS, type CategoryEntityPreparationPatch, type CategoryPreparationEntityView } from "@rental-os/shared";
import type { CategoryPreparationOperation, CategoryPreparationPreview } from "@/api/categoryPreparation";
export type CategoryPreparationValues = Record<string, Record<string, string | number | boolean>>;
export const preparationEntityKey = (scope: "item_group" | "asset", id: string) => `${scope}:${id}`;
export function categoryPreparationInitialValues(preview: CategoryPreparationPreview, operation: CategoryPreparationOperation): CategoryPreparationValues {
  const result: CategoryPreparationValues = Object.create(null);
  const envelope = preview.preparation?.patches;
  const patches = !preview.stale && envelope?.operation === operation && Array.isArray(envelope.items) ? envelope.items : [];
  for (const [scope, records] of [["item_group", preview.entities.itemGroups], ["asset", preview.entities.assets]] as const) {
    for (const row of records) {
      const values: CategoryPreparationValues[string] = Object.create(null);
      const patch = patches.find((item) => item.entityType === scope && item.entityId === row.id && item.expectedUpdatedAt === row.updatedAt);
      for (const field of preview.targetDefinition.businessModel.assetFields.filter((item) => item.scope === scope)) {
        const current = scope === "asset" && field.code === "serialNo" ? row.serialNo : row.attributes[field.code];
        const value = patch?.values[field.code] ?? current;
        if (["string", "number", "boolean"].includes(typeof value)) values[field.code] = value as string | number | boolean;
      }
      result[preparationEntityKey(scope, row.id)] = values;
    }
  }
  return result;
}
export function categoryPreparationPatches(preview: CategoryPreparationPreview, values: CategoryPreparationValues): CategoryEntityPreparationPatch[] {
  const result: CategoryEntityPreparationPatch[] = [];
  for (const [scope, records] of [["item_group", preview.entities.itemGroups], ["asset", preview.entities.assets]] as const) {
    for (const row of records) {
      const patch: CategoryEntityPreparationPatch["values"] = Object.create(null);
      for (const field of preview.targetDefinition.businessModel.assetFields.filter((item) => item.scope === scope)) {
        const current = scope === "asset" && field.code === "serialNo" ? row.serialNo : row.attributes[field.code];
        const value = values[preparationEntityKey(scope, row.id)]?.[field.code];
        if (value !== undefined && value !== current) patch[field.code] = value;
      }
      if (Object.keys(patch).length) result.push({ entityType: scope, entityId: row.id, expectedUpdatedAt: row.updatedAt, values: patch });
    }
  }
  return result;
}

/** Page rendering never writes a current value back as a new edit. Stale staged
 * input remains visible with its warning until the user explicitly withdraws it. */
export function preparationEntityValue(row: CategoryPreparationEntityView, scope: "item_group" | "asset", code: string) {
  const value = row.prepared?.values[code] ?? (scope === "asset" && code === "serialNo" ? row.serialNo : row.attributes[code]);
  return ["string", "number", "boolean"].includes(typeof value) ? value as string | number | boolean : undefined;
}

/** A click saves one bounded batch. Remaining edits stay in the page draft, and
 * the caller removes submitted keys only after receiving a real saved receipt. */
export function nextPreparationBatch(patches: CategoryEntityPreparationPatch[]) {
  const result: CategoryEntityPreparationPatch[] = [];
  const encoder = new TextEncoder();
  let bytes = encoder.encode(JSON.stringify({ patches: [], removals: [] })).length;
  for (const patch of patches) {
    const additional = encoder.encode(JSON.stringify(patch)).length + (result.length ? 1 : 0);
    if (additional + bytes > CATEGORY_PREPARATION_LIMITS.batchBytes) {
      if (!result.length) throw new Error("单条预备资料过大，请减少本次修改内容");
      break;
    }
    if (result.length === CATEGORY_PREPARATION_LIMITS.batchEntities) break;
    result.push(structuredClone(patch)); bytes += additional;
  }
  return { patches: result, remainingCount: patches.length - result.length };
}
