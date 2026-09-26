import type { RentalPricingUnit, RentalRuleConfig } from "@rental-os/shared";

/** Reject pricing controls that cannot be evaluated with a category's supported units. */
export function categoryPricingRuleError(
  supportedUnits: readonly RentalPricingUnit[],
  config: Pick<RentalRuleConfig, "pricing" | "overdue">
): string | undefined {
  const units = new Set(supportedUnits);
  if (config.pricing?.hourToDayEnabled && (!units.has("hour") || !units.has("day_24h"))) {
    return "时租转日租仅适用于同时支持小时和24小时日租的品类";
  }
  if (config.overdue.feeMode === "hourly_to_daily" && !units.has("day_24h")) {
    return "逾时按小时折日需要当前品类支持24小时日租";
  }
  if (config.pricing?.shiftStartHours?.length && !units.has("shift")) {
    return "班次起始时刻仅适用于支持班次计价的品类";
  }
  return undefined;
}
