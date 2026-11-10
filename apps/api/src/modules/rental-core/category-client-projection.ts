/** Core-owned read-only customer field projection. It never exposes asset/operator fields, grants input rights or calculates prices. */
import { RentalCategoryCode, type RentalCategoryDefinition, type ClientCatalogResponse } from "@rental-os/shared";

const builtins = new Set<string>(Object.values(RentalCategoryCode));
export function hasLegacyClientCategoryProjection(code: string) { return builtins.has(code); }
const legacyDisplayFields = new Set(["brand", "model", "manufacturer", "equipmentType", "role", "mount", "sensor", "people", "season", "material", "dimensions", "capacity", "trim", "modelYear", "seats", "transmission", "energyType", "power", "ratedLoad", "ratedLoadUnit"]);

/** Explicit legacy display compatibility for builtin bodies without visibility declarations. Dynamic identities require an explicit flag. */
export function clientCategoryFields(definition: RentalCategoryDefinition) {
  return definition.businessModel.assetFields.filter(field => field.scope === "item_group" &&
    (field.clientVisible === true || field.clientVisible === undefined && builtins.has(definition.code) && legacyDisplayFields.has(field.code)));
}

export function clientCategoryMetadata(definition: RentalCategoryDefinition, categoryVersionId?: string): NonNullable<ClientCatalogResponse["categoryMetadata"]> {
  return { structureVersion: 1, categoryVersionId, definitionVersion: definition.version, name: definition.name,
    icon: definition.display?.icon,
    fields: clientCategoryFields(definition).map(field => ({ code: field.code, label: field.label, type: field.type,
      ...(field.unit ? { unit: field.unit } : {}), ...(field.options ? { options: [...field.options] } : {}) })) };
}

export function clientItemAttributes(definition: RentalCategoryDefinition, attributes: Record<string, unknown>) {
  const values: Record<string, string | number | boolean> = {}, labels: Record<string, string> = {};
  for (const field of clientCategoryFields(definition)) {
    const value = attributes[field.code];
    const valid = field.type === "number" ? typeof value === "number" && Number.isFinite(value)
      : field.type === "boolean" ? typeof value === "boolean"
      : typeof value === "string" && value.length <= 2000 && (field.type !== "select" || field.options?.includes(value));
    if (!valid) continue;
    values[field.code] = value as string | number | boolean; labels[field.code] = field.label;
  }
  return { attributes: values, attributeLabels: labels };
}
