import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { RentalDayType, RentalPricingRate } from "@rental-os/shared";
import { RentalPricingRateInputDto } from "./rental-config-request.dto";
import { assertNoDatetimeOverrideOverlap, assertNoPeriodicOverlap, periodicWindowSpanMinutes } from "./rental-price-adjustments";
import { categoryCurrentAndFuture, type CategoryTimedConfiguration } from "./category-adoption-business-compatibility";

const dayTypes: readonly string[] = ["workday", "weekend", "statutory_holiday", "makeup_workday", "tenant_special"] satisfies readonly RentalDayType[];

/** Actual rate input contract plus execution cross-field constraints. Generated
 * snapshot identifiers/labels are non-executable metadata, not input fields.
 * No defaults, coercion or writes to tenant facts/historical snapshots. */
export function categoryAdoptionRateErrors(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ["费率必须为对象"];
  try {
    const visiting = new WeakSet<object>();
    const safe = (node: unknown, depth = 0): boolean => {
      if (node === null || typeof node !== "object") return true;
      if (depth > 50 || visiting.has(node)) return false;
      visiting.add(node);
      const valid = Object.entries(node).every(([key, value]) => !["__proto__", "constructor", "prototype"].includes(key) && safe(value, depth + 1));
      visiting.delete(node); return valid;
    };
    if (!safe(raw)) return ["费率含不安全或不可读取的结构"];
    const request = Object.fromEntries(Object.entries(raw).filter(([key]) => !["id", "itemGroupCode", "itemGroupName", "pricingGroupCode", "pricingGroupName"].includes(key)));
    const projected = plainToInstance(RentalPricingRateInputDto, request, { enableImplicitConversion: false });
    if (validateSync(projected, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, validationError: { target: false, value: false } }).length) return ["费率字段不符合定价输入契约"];
    const rate = raw as RentalPricingRate;
    const errors: string[] = [];
    const tiers = rate.tiers ?? [];
    if (new Set(tiers.map((row) => row.minUnits)).size !== tiers.length) errors.push("阶梯价起始单位重复");
    if (rate.unit === "usage") {
      if (tiers.length) {
        if (rate.tierMode !== "progressive" || Math.min(...tiers.map((row) => row.minUnits)) !== 1 || rate.excessUsageAmount !== undefined) errors.push("使用量阶梯须分段累进、从第1单位开始，且不能同时配置统一超额单价");
      } else if (rate.tierMode !== undefined || rate.excessUsageAmount === undefined) errors.push("使用量计价须配置超额单价或合法分段阶梯");
    } else if (rate.tierMode === "progressive" || rate.includedUsage !== undefined || rate.excessUsageAmount !== undefined || rate.usagePrecision !== undefined) errors.push("使用量参数或累进阶梯不能用于时间计价");
    if (rate.dayTypePrices !== undefined && (rate.dayTypePrices === null || Object.entries(rate.dayTypePrices).some(([key, value]) => !dayTypes.includes(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0))) errors.push("日期类型价格系数无效");
    for (const window of rate.periodicWindows ?? []) {
      for (const time of [window.fromTime, window.toTime]) {
        const [hour, minute] = time.split(":").map(Number);
        if (minute > 59 || hour > 24 || (hour === 24 && minute !== 0)) errors.push("周期计价时刻无效");
      }
      if (periodicWindowSpanMinutes(window) <= 0) errors.push("周期计价时段不能为零长度");
    }
    assertNoPeriodicOverlap(rate.periodicWindows, "候选费率");
    assertNoDatetimeOverrideOverlap(rate.datetimeOverrides, "候选费率");
    return errors;
  } catch {
    return ["费率时段重叠、起止无效或结构无法执行，请通过定价配置修复"];
  }
}

export function categoryAdoptionPriceStructure(input: {
  prices: CategoryTimedConfiguration<unknown>[];
  adjustments: Array<{ id: string; status: string; finalRates: unknown }>;
  plans: Array<{ id: string; status: string; effectiveTo: Date | null; rates: unknown }>;
}, now: Date) {
  const blockers: Array<{ domain: "price_structure"; id: string; message: string }> = [];
  const check = (id: string, value: unknown, allowEmpty = false) => {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
      blockers.push({ domain: "price_structure", id, message: "可执行费率必须为有效数组" }); return;
    }
    value.forEach((rate, index) => {
      for (const message of categoryAdoptionRateErrors(rate)) blockers.push({ domain: "price_structure", id: `${id}:${index}`, message });
    });
  };
  for (const row of categoryCurrentAndFuture(input.prices, now)) check(row.id, row.value, true);
  for (const row of input.adjustments) if (row.status === "pending") check(row.id, row.finalRates);
  for (const row of input.plans) if (row.status === "enabled" && (!row.effectiveTo || row.effectiveTo > now)) check(row.id, row.rates);
  return { valid: blockers.length === 0, blockers, complete: false as const, scope: "executable_price_contract_and_parameter_combinations" };
}
