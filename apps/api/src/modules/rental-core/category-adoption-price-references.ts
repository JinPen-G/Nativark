import { categoryCurrentAndFuture, type CategoryTimedConfiguration } from "./category-adoption-business-compatibility";

/** Match pricing execution's pricingGroupId ?? itemGroupId target selection.
 * Historical versions and expired/disabled plans are not rewritten or checked.
 * Input entities must be read from the adopting tenant/space in the same transaction. */
export function categoryAdoptionPriceReferences(input: {
  groups: Array<{ id: string }>; pricingGroups: Array<{ id: string }>;
  prices: CategoryTimedConfiguration<unknown>[];
  adjustments: Array<{ id: string; status: string; finalRates: unknown }>;
  plans: Array<{ id: string; status: string; effectiveTo: Date | null; rates: unknown }>;
}, now: Date) {
  const targets = new Set([...input.groups, ...input.pricingGroups].map((row) => row.id));
  const blockers: Array<{ domain: "price_reference"; id: string; message: string }> = [];
  const check = (id: string, rates: unknown, requireRates = true) => {
    const seen = new Set<string>();
    if (!Array.isArray(rates) || (requireRates && rates.length === 0) || rates.some((rate) => {
      if (!rate || typeof rate !== "object" || Array.isArray(rate)) return true;
      const target = rate.pricingGroupId ?? rate.itemGroupId;
      if (typeof target !== "string" || !targets.has(target) || typeof rate.unit !== "string") return true;
      const key = JSON.stringify([target, rate.unit]);
      if (seen.has(key)) return true;
      seen.add(key); return false;
    })) blockers.push({ domain: "price_reference", id, message: "可执行价格引用不存在或不属于当前空间的定价分组/型号，或同一对象计价单位重复，请通过价格配置处理" });
  };
  // Expiring the final plan legitimately removes every rate from the immutable
  // space timeline. Readiness/quote checks still enforce actual price coverage.
  for (const row of categoryCurrentAndFuture(input.prices, now)) check(row.id, row.value, false);
  for (const row of input.adjustments) if (row.status === "pending") check(row.id, row.finalRates);
  for (const row of input.plans) if (row.status === "enabled" && (!row.effectiveTo || row.effectiveTo > now)) check(row.id, row.rates);
  return { valid: blockers.length === 0, blockers, complete: false as const, scope: "scoped_executable_price_target_references" };
}
