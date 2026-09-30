import type { RentalCategoryDefinition, RentalPricingRate, RentalRuleConfig, TenantRentalBusinessSettings } from "@rental-os/shared";
import { categoryPricingRuleError } from "./category-pricing-rule-compatibility";

export interface CategoryTimedConfiguration<T> { id: string; effectiveFrom: Date | null; sequence: number; value: T }

/** Current and scheduled immutable configurations only. Historical snapshots remain executable under their original category. */
export function categoryCurrentAndFuture<T>(rows: CategoryTimedConfiguration<T>[], now: Date): CategoryTimedConfiguration<T>[] {
  const dated = rows.filter((row) => row.effectiveFrom && Number.isFinite(row.effectiveFrom.getTime()));
  const ordered = [...dated].sort((a, b) => b.effectiveFrom!.getTime() - a.effectiveFrom!.getTime() || b.sequence - a.sequence);
  const current = ordered.find((row) => row.effectiveFrom!.getTime() <= now.getTime());
  // Price versions have unique sequences. For rules, equal sequences preserve
  // every ambiguous candidate instead of silently picking a compatible one.
  const highestSequence = new Map<number, number>();
  for (const row of ordered) {
    const at = row.effectiveFrom!.getTime();
    highestSequence.set(at, Math.max(highestSequence.get(at) ?? -Infinity, row.sequence));
  }
  const winners = ordered.filter((row) => row.sequence === highestSequence.get(row.effectiveFrom!.getTime()));
  const future = winners.filter((row) => row.effectiveFrom!.getTime() > now.getTime());
  return current ? [...winners.filter((row) => row.effectiveFrom!.getTime() === current.effectiveFrom!.getTime()), ...future] : future;
}

export function categoryAdoptionBusinessCompatibility(target: RentalCategoryDefinition, input: {
  settings: TenantRentalBusinessSettings | null;
  locations: Array<{ id: string; type: string; status: string }>;
  prices: CategoryTimedConfiguration<RentalPricingRate[]>[];
  rules: CategoryTimedConfiguration<RentalRuleConfig>[];
}, now: Date) {
  const blockers: Array<{ domain: "settings" | "location" | "price" | "rule"; id: string; message: string }> = [];
  const add = (domain: typeof blockers[number]["domain"], id: string, message: string) => blockers.push({ domain, id, message });
  const model = target.businessModel;
  if (input.settings) {
    const settings = input.settings;
    if (settings.pricing.enabledUnits.some((unit) => !model.pricingUnits.includes(unit))) add("settings", "pricing.enabledUnits", "现有启用计价单位不在目标品类范围，请通过经营设置调整");
    if (!model.pricingUnits.includes(settings.pricing.defaultUnit) || !settings.pricing.enabledUnits.includes(settings.pricing.defaultUnit)) add("settings", "pricing.defaultUnit", "现有默认计价单位不兼容目标品类");
    if (settings.fulfillment.enabledModes.some((mode) => !model.fulfillmentModes.includes(mode))) add("settings", "fulfillment.enabledModes", "现有启用履约方式不在目标品类范围，请通过经营设置调整");
    if (!model.supportsHolidayPricing && (settings.pricing.holidayPricingEnabled || settings.calendar.holidayPricingEnabled)) add("settings", "holidayPricingEnabled", "目标品类不支持当前启用的节假日计价设置");
  }
  for (const location of input.locations) {
    if (location.status === "enabled" && !model.locationTypes.includes(location.type as typeof model.locationTypes[number])) add("location", location.id, "启用地点类型不在目标品类范围，请先处理地点");
  }
  const prices = categoryCurrentAndFuture(input.prices, now);
  for (const price of prices) {
    if (!Array.isArray(price.value) || price.value.some((rate) => !model.pricingUnits.includes(rate.unit))) add("price", price.id, "当前或未来价格版本包含目标品类不支持的计价单位，需通过价格发布机制处理");
  }
  const rules = categoryCurrentAndFuture(input.rules, now);
  const ruleCounts = new Map<number, number>();
  for (const rule of rules) {
    const at = rule.effectiveFrom!.getTime();
    ruleCounts.set(at, (ruleCounts.get(at) ?? 0) + 1);
  }
  for (const rule of rules) {
    if (ruleCounts.get(rule.effectiveFrom!.getTime())! > 1) add("rule", rule.id, "同一生效时点存在多个规则版本，请通过规则作废机制处理歧义");
  }
  for (const rule of rules) {
    const error = categoryPricingRuleError(model.pricingUnits, rule.value);
    if (error) add("rule", rule.id, error);
    const payment = rule.value.payment;
    if (!model.supportsPreauthorization && (payment.preauthorizationRequired || payment.depositMode === "preauthorization" || (rule.value.preauthorization && rule.value.preauthorization.mode !== "none"))) add("rule", rule.id, "当前或未来规则启用预授权，但目标品类不支持");
  }
  return { valid: blockers.length === 0, blockers, checkedPriceVersionIds: prices.map((row) => row.id), checkedRuleVersionIds: rules.map((row) => row.id),
    scope: "settings_locations_price_units_rule_pricing_preauthorization", complete: false as const };
}
