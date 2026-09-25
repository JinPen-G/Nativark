import type { RentalPricingGroupInitialRate, SaveRentalPricingGroupRequest } from "@rental-os/shared";

export type PricingGroupFormRate = RentalPricingGroupInitialRate & { usageMode?: "flat" | "progressive" };
export type PricingGroupFormValues = Omit<SaveRentalPricingGroupRequest, "initialRates"> & { initialRates?: PricingGroupFormRate[] };

/** UI-only mode is converted to the rate contract; irrelevant usage fields never leak onto time rates. */
export function toPricingGroupRequest(values: PricingGroupFormValues, id?: string): SaveRentalPricingGroupRequest {
  const initialRates = values.initialRates?.map((rate) => {
    if (rate.unit !== "usage") {
      return {
        unit: rate.unit,
        baseAmount: rate.baseAmount,
        depositAmount: rate.depositAmount,
        depositMultiple: rate.depositMultiple,
        preAuthAmount: rate.preAuthAmount,
        preAuthMultiple: rate.preAuthMultiple
      };
    }
    const { usageMode, ...usageRate } = rate;
    return {
      ...usageRate,
      tierMode: usageMode === "progressive" ? "progressive" as const : undefined,
      tiers: usageMode === "progressive" ? usageRate.tiers : undefined,
      excessUsageAmount: usageMode === "flat" ? usageRate.excessUsageAmount : undefined
    };
  });
  return {
    ...values,
    id,
    initialRates,
    defaultPricingUnit: values.defaultPricingUnit ?? initialRates?.[0]?.unit
  };
}
