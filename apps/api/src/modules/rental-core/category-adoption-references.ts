import type { RentalCategoryDefinition, RentalCompatibilityRelation } from "@rental-os/shared";

/** The IDs supplied here must come from queries scoped to the adopting tenant and space. */
export function categoryAdoptionCapabilityReferences(
  target: RentalCategoryDefinition,
  instances: Array<{ code: string; status: string; config: unknown }>,
  records: { groups: Array<{ id: string }>; assets: Array<{ id: string }> }
) {
  const groups = new Set(records.groups.map((row) => row.id));
  const assets = new Set(records.assets.map((row) => row.id));
  const fields = target.businessModel.assetFields;
  const blockers: Array<{ domain: "capability_reference"; id: string; message: string }> = [];
  for (const instance of instances) {
    if (instance.status !== "enabled" || instance.code !== "camera_compatibility") continue;
    // Syntax and implementation checks are performed by the capability service;
    // malformed JSON still fails closed rather than throwing a server error here.
    const relations = (instance.config as { relations?: unknown } | null)?.relations;
    if (relations === undefined) continue;
    if (!Array.isArray(relations)) {
      blockers.push({ domain: "capability_reference", id: instance.code, message: "能力兼容关系不是可读取的数组" });
      continue;
    }
    for (const raw of relations) {
      const relation = raw as Partial<RentalCompatibilityRelation> | null;
      for (const side of ["source", "target"] as const) {
        const ref = relation?.[side];
        let valid = false;
        if (ref?.kind === "item_group") valid = typeof ref.id === "string" && groups.has(ref.id.trim());
        if (ref?.kind === "asset") valid = typeof ref.id === "string" && assets.has(ref.id.trim());
        // Allocation merges model and asset attributes. serialNo is a separate
        // column, however, and is not present in that attribute payload.
        if (ref?.kind === "attribute" && typeof ref.field === "string" && typeof ref.value === "string") {
          const fieldCode = ref.field.trim();
          const value = ref.value.trim();
          valid = Boolean(value) && fields.some((field) => field.code === fieldCode && !(field.scope === "asset" && field.code === "serialNo")
            && ["string", "date", "select"].includes(field.type)
            && (field.type !== "select" || field.options?.includes(value)));
        }
        if (!valid) blockers.push({ domain: "capability_reference", id: `${instance.code}:${relation?.id ?? "invalid"}:${side}`, message: "兼容关系引用不属于当前空间，或目标版本不再支持该型号属性/选项" });
      }
    }
  }
  return { valid: blockers.length === 0, blockers, scope: "scoped_capability_entity_and_target_attribute_references", complete: false as const };
}
