import type { RentalCategoryDefinition } from "@rental-os/shared";

export interface CategoryAdoptionBundleComponent {
  componentItemGroupId: string; quantity: number; optional?: boolean; substitutionGroup?: string | null;
}

/** IDs must come from the adopting tenant/space, never unrestricted relation reads. */
export function categoryAdoptionProductGraph(target: RentalCategoryDefinition, input: {
  groups: Array<{ id: string; status: string; inventoryMode: string; bundleComponents: CategoryAdoptionBundleComponent[] }>;
  assets: Array<{ id: string; itemGroupId: string; locationId: string }>;
  locations: Array<{ id: string }>;
  pricingGroups: Array<{ id: string; status: string; defaultPricingUnit: string | null; members: Array<{ itemGroupId: string }> }>;
}) {
  const groups = new Map(input.groups.map((row) => [row.id, row]));
  const locations = new Set(input.locations.map((row) => row.id));
  const blockers: Array<{ domain: "pricing_group" | "asset_reference" | "bundle_reference"; id: string; message: string }> = [];
  for (const asset of input.assets) {
    const group = groups.get(asset.itemGroupId);
    if (!group || group.inventoryMode.toLowerCase() !== "serialized" || !locations.has(asset.locationId)) blockers.push({ domain: "asset_reference", id: asset.id, message: "资产关联型号或地点不属于当前空间，或型号不是序列化库存，请先处理资产资料" });
  }
  for (const group of input.pricingGroups) {
    if (group.status !== "enabled") continue;
    if (group.defaultPricingUnit !== null && !target.businessModel.pricingUnits.includes(group.defaultPricingUnit as typeof target.businessModel.pricingUnits[number])) blockers.push({ domain: "pricing_group", id: `${group.id}:defaultUnit`, message: "启用定价分组的默认计价单位不适用于目标品类，请通过定价分组配置调整" });
    if (!group.members.length || new Set(group.members.map((member) => member.itemGroupId)).size !== group.members.length || group.members.some((member) => !groups.has(member.itemGroupId))) blockers.push({ domain: "pricing_group", id: `${group.id}:members`, message: "启用定价分组缺少型号、成员重复或关联空间外型号，请通过定价分组配置处理" });
    const members = group.members.map(member => groups.get(member.itemGroupId));
    if (members.some(member => member?.status !== "enabled") || new Set(members.map(member => member?.inventoryMode.toLowerCase())).size > 1) {
      blockers.push({ domain: "pricing_group", id: `${group.id}:inventoryModes`, message: "启用定价分组成员须为启用且库存方式一致的型号，请通过定价分组配置处理" });
    }
  }
  for (const group of input.groups) {
    if (group.status !== "enabled") continue;
    if (group.inventoryMode.toLowerCase() !== "bundle") {
      if (group.bundleComponents.length) blockers.push({ domain: "bundle_reference", id: group.id, message: "非套装型号不能配置套装组成，请通过型号配置处理" });
      continue;
    }
    const seen = new Set<string>();
    const substitutions = new Map<string, CategoryAdoptionBundleComponent[]>();
    const invalidComponent = group.bundleComponents.some((component) => {
      const child = groups.get(component.componentItemGroupId);
      const substitution = component.substitutionGroup?.trim();
      if (substitution) substitutions.set(substitution, [...(substitutions.get(substitution) ?? []), component]);
      const invalid = !child || child.id === group.id || child.inventoryMode.toLowerCase() === "bundle" || !Number.isInteger(component.quantity) || component.quantity <= 0 || seen.has(component.componentItemGroupId)
        || (component.optional === true && !substitution)
        // 正常建档已去掉首尾空白。兼容检查不得把两套存量组码偷偷合并。
        || (component.substitutionGroup != null && component.substitutionGroup !== substitution);
      seen.add(component.componentItemGroupId); return invalid;
    });
    const invalidSubstitution = [...substitutions.values()].some((candidates) => candidates.length < 2 || candidates.filter((candidate) => !candidate.optional).length !== 1);
    if (!group.bundleComponents.length || invalidComponent || invalidSubstitution) blockers.push({ domain: "bundle_reference", id: group.id, message: "启用套装缺少组成、引用或数量不合法，或替代组缺少唯一默认项及候选，请通过型号配置处理" });
  }
  return { valid: blockers.length === 0, blockers, complete: false as const, scope: "scoped_asset_bundle_and_pricing_group_graph" };
}
