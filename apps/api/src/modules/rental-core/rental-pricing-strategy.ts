import { BadRequestException } from "@nestjs/common";
import {
  RENTAL_PRICING_UNIT_CODES,
  type RentalPricingRate,
  type RentalPricingUnit
} from "@store-rental/shared";

export interface RentalPricingStrategy {
  readonly unit: RentalPricingUnit;
  billableUnits(startAt: string, endAt: string, usageQuantity?: number): number;
  amountPerItem(rate: RentalPricingRate, units: number): number;
}

const durationHours = (startAt: string, endAt: string) =>
  Math.max(0, (new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000);

const durationStrategy = (unit: RentalPricingUnit, hoursPerUnit: number): RentalPricingStrategy => ({
  unit,
  billableUnits: (startAt, endAt) => Math.ceil(durationHours(startAt, endAt) / hoursPerUnit),
  amountPerItem: (rate, units) => rate.baseAmount * units
});

const strategies: Record<RentalPricingUnit, RentalPricingStrategy> = {
  hour: durationStrategy("hour", 1),
  shift: durationStrategy("shift", 8),
  day_24h: durationStrategy("day_24h", 24),
  calendar_day: durationStrategy("calendar_day", 24),
  night: durationStrategy("night", 24),
  week: durationStrategy("week", 168),
  month: durationStrategy("month", 720),
  package: {
    unit: "package",
    billableUnits: () => 1,
    amountPerItem: (rate, units) => rate.baseAmount * units
  },
  usage: {
    unit: "usage",
    billableUnits: (_startAt, _endAt, usageQuantity) => {
      if (!Number.isFinite(usageQuantity) || Number(usageQuantity) < 0) {
        throw new BadRequestException("按使用量计价时必须提供有效使用量");
      }
      return Math.ceil(Number(usageQuantity));
    },
    amountPerItem: (rate, units) =>
      rate.baseAmount + Math.max(0, units - (rate.includedUsage ?? 0)) * (rate.excessUsageAmount ?? rate.baseAmount)
  }
};

/**
 * Rental Core 的计费扩展入口。新增计费模型时新增策略并登记，不修改报价主流程。
 * 类型与启动期完整性检查保证每个公开计费单位都有且只有一个实现。
 */
export function rentalPricingStrategy(unit: RentalPricingUnit): RentalPricingStrategy {
  const strategy = strategies[unit];
  if (!strategy) throw new BadRequestException(`未注册的计费策略：${unit}`);
  return strategy;
}

export function assertRentalPricingStrategiesComplete() {
  for (const unit of RENTAL_PRICING_UNIT_CODES) {
    if (!strategies[unit] || strategies[unit].unit !== unit) {
      throw new Error(`计费策略注册不完整：${unit}`);
    }
  }
}

export const RENTAL_PRICING_STRATEGIES = Object.freeze({ ...strategies });
