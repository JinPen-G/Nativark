interface ScopedRow { id: string }
interface MarketingReferences {
  groups: ScopedRow[];
  pricingGroups: ScopedRow[];
  locations: ScopedRow[];
  discounts: Array<{ id: string; status: string; effectiveTo: Date | null; applicableItemGroupIds: unknown; applicablePricingGroupIds: unknown }>;
  coupons: Array<{ id: string; status: string; applicableItemGroupIds: unknown }>;
  services: Array<{ id: string; status: string; applicableItemGroupIds: unknown; applicableLocationIds: unknown; mandatoryRule: unknown }>;
}

/** Only current configuration references, never issued coupons or order snapshots.
 * All records must be queried using the server's adopting tenant and workspace. */
export function categoryAdoptionMarketingReferences(input: MarketingReferences, now: Date) {
  const groups = new Set(input.groups.map((row) => row.id));
  const pricingGroups = new Set(input.pricingGroups.map((row) => row.id));
  const locations = new Set(input.locations.map((row) => row.id));
  const blockers: Array<{ domain: "marketing_reference"; id: string; message: string }> = [];
  const check = (id: string, field: string, value: unknown, allowed: Set<string>, optional = false) => {
    if (optional && (value === null || value === undefined)) return;
    if (!Array.isArray(value) || value.some((ref) => typeof ref !== "string" || !allowed.has(ref))) {
      blockers.push({ domain: "marketing_reference", id: `${id}:${field}`, message: "营销配置引用不存在或不属于当前空间的型号、定价分组或履约地点，请通过对应配置处理" });
    }
  };
  for (const discount of input.discounts) {
    if (discount.status !== "enabled" || (discount.effectiveTo && discount.effectiveTo < now)) continue;
    check(discount.id, "itemGroups", discount.applicableItemGroupIds, groups);
    check(discount.id, "pricingGroups", discount.applicablePricingGroupIds, pricingGroups);
  }
  for (const coupon of input.coupons) {
    // Reward issuance uses active templates independently of public claim dates.
    // Do not infer retirement from a closed claim window or rewrite issued rights.
    if (!["active", "scheduled"].includes(coupon.status)) continue;
    check(coupon.id, "itemGroups", coupon.applicableItemGroupIds, groups);
  }
  for (const service of input.services) {
    if (service.status !== "enabled") continue;
    check(service.id, "itemGroups", service.applicableItemGroupIds, groups);
    check(service.id, "locations", service.applicableLocationIds, locations, true);
    if (service.mandatoryRule && typeof service.mandatoryRule === "object" && !Array.isArray(service.mandatoryRule)) {
      check(service.id, "mandatoryItemGroups", (service.mandatoryRule as Record<string, unknown>).itemGroupIds, groups, true);
    }
    // Mandatory-rule shape and supported fulfillment modes are checked separately.
  }
  return { valid: blockers.length === 0, blockers, scope: "scoped_current_marketing_entity_references", complete: false as const };
}
