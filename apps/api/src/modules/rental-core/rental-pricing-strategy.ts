import { BadRequestException } from "@nestjs/common";
import {
  RENTAL_PRICING_UNIT_CODES,
  type RentalPricingRate,
  type RentalPricingUnit
} from "@store-rental/shared";
import { DEFAULT_BUSINESS_TIME_ZONE, businessDayIndex } from "./rental-business-day";

/**
 * 计费单位的可计费量与行金额计算。
 *
 * 职责边界（技术指南 5.4）：策略只回答"这段租期算几个计费单位"和"这么多单位值多少钱"；
 * 适用范围、最小起租量、版本与有效期属于价格计划，日期类型倍率属于营业日历，都不在此。
 * 因此策略**不得**把 0 兜成 1——最小起租量是计划的配置，策略替它兜底会让 minimumUnits
 * 配 0 或 2 时都被悄悄改写。
 */
export interface RentalPricingStrategy {
  readonly unit: RentalPricingUnit;
  /**
   * `timeZone` 只对按日界切分的单位（自然日、夜）有意义，其余单位忽略它。
   * 缺省时按 `DEFAULT_BUSINESS_TIME_ZONE`，因此既有调用方无需改动。
   */
  billableUnits(startAt: string, endAt: string, usageQuantity?: number, timeZone?: string): number;
  amountPerItem(rate: RentalPricingRate, units: number): number;
  /** 行金额的推导说明，进入报价明细的"计算说明"。验收要求"相同输入可复算并解释来源"。 */
  explain(rate: RentalPricingRate, units: number): string;
}

const durationHours = (startAt: string, endAt: string) =>
  Math.max(0, (new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000);

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * 阶梯价：取 `minUnits` 不超过实际单位数的最高档，用该档单价为**整单**计价。
 *
 * 选整单重定价而非分段累加，因为业务口径是"长租折扣"——租 7 天就按 7 天的日单价算，
 * 而不是前 3 天一个价、后 4 天另一个价。分段累加还会让"计算说明"变成一串区间，
 * 客服无法一眼核对。档位缺失或都不满足时回落到 baseAmount。
 */
function tierFor(rate: RentalPricingRate, units: number) {
  const tiers = (rate.tiers ?? [])
    .filter((tier) => Number.isFinite(tier.minUnits) && Number.isFinite(tier.unitAmount) && tier.minUnits <= units)
    .sort((left, right) => right.minUnits - left.minUnits);
  return tiers[0];
}

function unitAmountFor(rate: RentalPricingRate, units: number) {
  return tierFor(rate, units)?.unitAmount ?? rate.baseAmount;
}

/** 封顶价：行租金上限。undefined 表示不封顶；0 是合法上限（免租）。 */
function applyCap(rate: RentalPricingRate, amount: number) {
  return rate.maxAmount === undefined ? amount : Math.min(amount, rate.maxAmount);
}

function describeLine(rate: RentalPricingRate, units: number, gross: number) {
  const tier = tierFor(rate, units);
  const parts = [
    tier
      ? `阶梯价 ${tier.unitAmount}/${rate.unit}（满 ${tier.minUnits} ${rate.unit}）× ${units}`
      : `基础价 ${rate.baseAmount}/${rate.unit} × ${units} ${rate.unit}`
  ];
  if (rate.maxAmount !== undefined && gross > rate.maxAmount) {
    parts.push(`封顶 ${rate.maxAmount}（原 ${money(gross)}）`);
  }
  return parts.join("；");
}

const durationStrategy = (unit: RentalPricingUnit, hoursPerUnit: number): RentalPricingStrategy => ({
  unit,
  billableUnits: (startAt, endAt) => Math.ceil(durationHours(startAt, endAt) / hoursPerUnit),
  amountPerItem: (rate, units) => applyCap(rate, unitAmountFor(rate, units) * units),
  explain: (rate, units) => describeLine(rate, units, unitAmountFor(rate, units) * units)
});

const strategies: Record<RentalPricingUnit, RentalPricingStrategy> = {
  hour: durationStrategy("hour", 1),
  shift: durationStrategy("shift", 8),
  day_24h: durationStrategy("day_24h", 24),
  week: durationStrategy("week", 168),
  month: durationStrategy("month", 720),

  /**
   * 自然日：按**占用的日期个数**计，与 24 小时块无关。
   *
   * 需求 4.4 把「自然日」与「24 小时」列为两个单位，二者必须不同义：周一 22:00 租到
   * 周二 08:00 只有 10 小时，但门店的周一和周二都无法再把它租给别人，因此计 2 日。
   * 早前两者共用 24 小时折算，`calendar_day` 实际是 `day_24h` 的别名，
   * 所有跨日短租都少收一天。
   */
  calendar_day: {
    unit: "calendar_day",
    billableUnits: (startAt, endAt, _usageQuantity, timeZone = DEFAULT_BUSINESS_TIME_ZONE) => {
      const start = new Date(startAt).getTime();
      const end = new Date(endAt).getTime();
      if (end <= start) return 0;
      // 结束时刻正好落在营业日零点时不跨入新日期，因此对结束端取"最后一刻"的日序号。
      return (
        businessDayIndex(new Date(end - 1).toISOString(), timeZone) - businessDayIndex(startAt, timeZone) + 1
      );
    },
    amountPerItem: (rate, units) => applyCap(rate, unitAmountFor(rate, units) * units),
    explain: (rate, units) => describeLine(rate, units, unitAmountFor(rate, units) * units)
  },

  /**
   * 夜：按**过夜数**计，用于露营与住宿类。
   * 当日租当日还没有过夜，如实返回 0，由价格计划的 minimumUnits 决定是否兜底。
   */
  night: {
    unit: "night",
    billableUnits: (startAt, endAt, _usageQuantity, timeZone = DEFAULT_BUSINESS_TIME_ZONE) => {
      const start = new Date(startAt).getTime();
      const end = new Date(endAt).getTime();
      if (end <= start) return 0;
      return Math.max(
        0,
        businessDayIndex(new Date(end - 1).toISOString(), timeZone) - businessDayIndex(startAt, timeZone)
      );
    },
    amountPerItem: (rate, units) => applyCap(rate, unitAmountFor(rate, units) * units),
    explain: (rate, units) => describeLine(rate, units, unitAmountFor(rate, units) * units)
  },

  package: {
    unit: "package",
    billableUnits: () => 1,
    amountPerItem: (rate, units) => applyCap(rate, unitAmountFor(rate, units) * units),
    explain: (rate, units) => describeLine(rate, units, unitAmountFor(rate, units) * units)
  },

  usage: {
    unit: "usage",
    billableUnits: (_startAt, _endAt, usageQuantity) => {
      if (typeof usageQuantity !== "number" || !Number.isFinite(usageQuantity) || usageQuantity < 0) {
        throw new BadRequestException("按使用量计价时必须提供有效使用量");
      }
      return Math.ceil(usageQuantity);
    },
    amountPerItem: (rate, units) => {
      const included = rate.includedUsage ?? 0;
      const excessRate = rate.excessUsageAmount ?? rate.baseAmount;
      return applyCap(rate, rate.baseAmount + Math.max(0, units - included) * excessRate);
    },
    explain: (rate, units) => {
      const included = rate.includedUsage ?? 0;
      const excessRate = rate.excessUsageAmount ?? rate.baseAmount;
      const excess = Math.max(0, units - included);
      const gross = rate.baseAmount + excess * excessRate;
      const parts = [`包干 ${rate.baseAmount}（含 ${included} 用量）`];
      parts.push(excess > 0 ? `超额 ${excess} × ${excessRate}` : "未超额");
      if (rate.maxAmount !== undefined && gross > rate.maxAmount) {
        parts.push(`封顶 ${rate.maxAmount}（原 ${money(gross)}）`);
      }
      return parts.join("；");
    }
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
