import type { RentalCategoryDefinition } from "@rental-os/shared";

/** IDs must come from the adopting tenant/space, never unrestricted relation reads. */
export function categoryAdoptionProductGraph(target: RentalCategoryDefinition, input: {
  groups: Array<{ id: string; status: string; inventoryMode: string; bundleComponents: Array<{ componentItemGroupId: string; quantity: number }> }>;
  assets: Array<{ id: string; itemGroupId: string; locationId: string }>;
  locations: Array<{ id: string }>;
  pricingGroups: Array<{ id: string; status: string; defaultPricingUnit: string | null; members: Array<{ itemGroupId: string }> }>;
}) {
  const groups = new Map(input.groups.map((row) => [row.id, row]));
  const locations = new Set(input.locations.map((row) => row.id));
  const blockers: Array<{ domain: "pricing_group" | "asset_reference" | "bundle_reference"; id: string; message: string }> = [];
  for (const asset of input.assets) {
    if (!groups.has(asset.itemGroupId) || !locations.has(asset.locationId)) blockers.push({ domain: "asset_reference", id: asset.id, message: "资产关联型号或地点不属于当前空间，请先处理资产资料" });
  }
  for (const group of input.pricingGroups) {
    if (group.status !== "enabled") continue;
    if (group.defaultPricingUnit !== null && !target.businessModel.pricingUnits.includes(group.defaultPricingUnit as typeof target.businessModel.pricingUnits[number])) blockers.push({ domain: "pricing_group", id: `${group.id}:defaultUnit`, message: "启用定价分组的默认计价单位不适用于目标品类，请通过定价分组配置调整" });
    if (group.members.some((member) => !groups.has(member.itemGroupId))) blockers.push({ domain: "pricing_group", id: `${group.id}:members`, message: "启用定价分组关联了不属于当前空间的型号，请通过定价分组配置处理" });
  }
  for (const group of input.groups) {
    if (group.status !== "enabled" || group.inventoryMode.toLowerCase() !== "bundle") continue;
    const seen = new Set<string>();
    if (group.bundleComponents.some((component) => {
      const child = groups.get(component.componentItemGroupId);
      const invalid = !child || child.id === group.id || child.inventoryMode.toLowerCase() === "bundle" || !Number.isInteger(component.quantity) || component.quantity <= 0 || seen.has(component.componentItemGroupId);
      seen.add(component.componentItemGroupId); return invalid;
    })) blockers.push({ domain: "bundle_reference", id: group.id, message: "启用套装组成引用空间外型号、自身或嵌套套装，或组成数量不合法，请通过型号配置处理" });
  }
  return { valid: blockers.length === 0, blockers, complete: false as const, scope: "scoped_asset_bundle_and_pricing_group_graph" };
}
