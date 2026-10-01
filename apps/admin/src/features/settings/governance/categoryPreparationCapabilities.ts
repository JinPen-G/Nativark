import { RENTAL_CAPABILITY_MODULES, type CategoryCapabilityPreparationPatch, type RentalCapabilityConfig } from "@rental-os/shared";
import type { CategoryPreparationOperation, CategoryPreparationPreview } from "@/api/categoryPreparation";
export type CapabilityPreparationDrafts = Record<string, { expectedRevision: number; expectedImplementationVersion: string; fields: Record<string, string | number | boolean> }>;
export function preparationCapabilityDefinitions(preview: CategoryPreparationPreview) {
  return RENTAL_CAPABILITY_MODULES.filter((definition) => definition.configSchema.length > 0
    && (definition.applicableCategories === "all" || definition.applicableCategories.includes(preview.targetDefinition.code))
    && (definition.kind === "shared" || preview.targetDefinition.defaultCapabilities.includes(definition.code))
    && preview.entities.capabilities?.some((row) => row.code === definition.code && row.status === "enabled"));
}
export function initialCapabilityDrafts(preview: CategoryPreparationPreview, operation: CategoryPreparationOperation): CapabilityPreparationDrafts {
  const result: CapabilityPreparationDrafts = Object.create(null);
  const envelope = preview.preparation?.patches;
  const patches = !preview.stale && envelope?.operation === operation ? envelope.capabilityPatches ?? [] : [];
  for (const definition of preparationCapabilityDefinitions(preview)) {
    const row = preview.entities.capabilities!.find((instance) => instance.code === definition.code)!;
    const patch = patches.find((item) => item.code === row.code);
    const config = patch?.config ?? row.config;
    const fields: Record<string, string | number | boolean> = Object.create(null);
    for (const field of definition.configSchema) {
      const value = config[field.key];
      if (field.type === "compatibility_relations") fields[field.key] = JSON.stringify(value ?? [], null, 2);
      else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") fields[field.key] = value;
    }
    // Preserve stale preparation revisions: never silently turn an old patch into
    // an authorized write against today's instance. Explicit reload discards it.
    result[row.code] = { expectedRevision: patch?.expectedRevision ?? row.revision, expectedImplementationVersion: patch?.expectedImplementationVersion ?? row.implementationVersion, fields };
  }
  return result;
}
export function capabilityPreparationPatches(preview: CategoryPreparationPreview, drafts: CapabilityPreparationDrafts): CategoryCapabilityPreparationPatch[] {
  const definitions = preparationCapabilityDefinitions(preview);
  if (Object.keys(drafts).some((code) => !definitions.some((definition) => definition.code === code))) {
    throw new Error("能力状态或目标适用范围已变化，请重新读取并核对");
  }
  if (!preview.stale && preview.preparation?.patches.capabilityPatches?.some((patch) => !definitions.some((definition) => definition.code === patch.code))) {
    throw new Error("存在不再适用的能力预备配置，请核对能力状态");
  }
  return definitions.map((definition) => {
    const draft = drafts[definition.code];
    if (!draft) throw new Error("能力预备输入缺失，请重新读取并核对");
    const config: RentalCapabilityConfig = {};
    for (const field of definition.configSchema) {
      const value = draft.fields[field.key];
      if (value === undefined || value === "") { if (field.required) throw new Error(`${field.label}为必填`); continue; }
      if (field.type === "compatibility_relations") {
        let relations: unknown;
        try { relations = JSON.parse(String(value)); } catch { throw new Error(`${field.label}不是有效 JSON`); }
        if (!Array.isArray(relations)) throw new Error(`${field.label}必须是数组`);
        config[field.key] = relations;
      } else config[field.key] = value;
    }
    return { code: definition.code, expectedRevision: draft.expectedRevision, expectedImplementationVersion: draft.expectedImplementationVersion, config };
  });
}
