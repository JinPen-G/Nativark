import { BadRequestException } from "@nestjs/common";
import {
  RENTAL_PRICING_UNIT_CODES,
  type RentalPricingRate,
  type RentalPricingUnit
} from "@store-rental/shared";
import { DEFAULT_BUSINESS_TIME_ZONE, businessDateKey, businessDateKeyFromIndex, businessDayIndex, businessInstantAt } from "./rental-business-day";

/**
 * 计费单位的可计费量与行金额计算。
 *
 * 职责边界（技术指南 5.4）：策略只回答"这段租期算几个计费单位"和"这么多单位值多少钱"；
 * 适用范围、最小起租量、版本与有效期属于价格计划，日期类型倍率属于营业日历，都不在此。
 * 因此策略**不得**把 0 兜成 1——最小起租量是计划的配置，策略替它兜底会让 minimumUnits
 * 配 0 或 2 时都被悄悄改写。
 */
/**
 * 计价上下文。用对象而不是继续加位置参数：时区之后又来了小时粒度与班次配置，
 * 五个位置参数里三个可选，调用方极易错位传参。
 *
 * 归属按需求 4.4.5 分开：小时粒度「按价格配置」，因此来自 `RentalPricingRate`；
 * 班次时长与边界「由经营空间规则定义」，因此来自已发布规则的快照。
 */
export interface RentalPricingContext {
  usageQuantity?: number;
  timeZone?: string;
  /** 小时粒度（分钟）。缺省 60；例如 30 表示不足半小时按半小时计。 */
  hourGranularityMinutes?: number;
  /** 班次时长（小时）。缺省 8。 */
  shiftHours?: number;
  /**
   * 班次边界：一天内各班次的起始小时（营业时区），如 `[0, 8, 16]`。
   * 给了边界就按「跨过几个班次窗口」计数（需求："每开始一个配置班次计一个单位"）；
   * 不给则退回按班次时长整除，与早前行为一致。
   */
  shiftStartHours?: number[];
}

export interface RentalPricingStrategy {
  readonly unit: RentalPricingUnit;
  /**
   * `timeZone` 只对按日界切分的单位（自然日、夜）有意义，其余单位忽略它。
   * 缺省时按 `DEFAULT_BUSINESS_TIME_ZONE`，因此既有调用方无需改动。
   */
  billableUnits(startAt: string, endAt: string, ctx?: RentalPricingContext): number;
  /**
   * 每个计费单位的取价依据：营业日期 + **取价时点**（需求 4.4.5/4.5.6 v2.9）。
   *
   * 自然日与夜按每个计费日期取价；小时、班次、24 小时、周、30 日月按**每个计费块
   * 开始时点**取价（at = 该时刻的 ISO 时间）；自然日首个单位用实际租期开始时点、
   * 后续单位用对应营业日期的开始时点。取价时点是分时价格（周期性时段/日期时间
   * 覆盖）的命中依据；使用量与日期无对应关系，返回空数组。
   *
   * 必须同时收 `endAt`：单位数量与取价时点要来自**同一组计费块**。班次配了边界时数量按
   * 「跨过几个班次窗口」计，若这里再按固定 `shiftHours` 从租期开始时刻推算，两套算法就会
   * 分叉——非等长班次（如边界 [0,6,18]）下取价日期会整体偏移，跨平假日直接算错钱。
   */
  billableUnitDates(startAt: string, endAt: string, units: number, ctx?: RentalPricingContext): Array<{ date: string; at: string }>;
  /** `unitMultipliers[i]` 为第 i 个单位的日期价格系数，缺省视为 1。 */
  amountPerItem(rate: RentalPricingRate, units: number, unitMultipliers?: number[]): number;
  /**
   * 单件租金的**结构化**结果，供金额、计算说明与日历快照消费同一份计算。
   *
   * 早前三处各算一遍：快照里的单价用 `amountPerItem(rate, 1, [1])` 现算，等于按「1 个单位」
   * 选阶梯档——租 7 天命中 80 元档时快照仍记基础价 100，快照无法复算报价。
   */
  priceBreakdown(rate: RentalPricingRate, units: number, unitMultipliers?: number[]): RentalPriceBreakdown;
  /** 行金额的推导说明，进入报价明细的"计算说明"。验收要求"相同输入可复算并解释来源"。 */
  explain(rate: RentalPricingRate, units: number, unitMultipliers?: number[]): string;
}

/** 单件租金的结构化推导结果（需求 4.4.5：报价、说明与快照必须能复算同一笔钱）。 */
export interface RentalPriceBreakdown {
  /** 计费单位数（已含最低起租量兜底）。 */
  units: number;
  /** 实际采用的单位价：命中阶梯档时是该档单价，否则是基础价。 */
  unitAmount: number;
  /** 命中的阶梯档起始单位数；未命中阶梯时为 undefined。 */
  tierMinUnits?: number;
  /** 封顶前的原始金额（单价 × 逐单位系数之和）。 */
  grossAmount: number;
  /** 封顶后的单件金额；未配置封顶时等于 grossAmount。 */
  amount: number;
  /** 是否被封顶截断。 */
  capped: boolean;
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

/** 封顶价：**单件、单次租期**的上限（需求 4.4.5），因此在乘商品数量之前应用。 */
function applyCap(rate: RentalPricingRate, amount: number) {
  return rate.maxAmount === undefined ? amount : Math.min(amount, rate.maxAmount);
}

/**
 * 单件租金：阶梯单价 × 逐单位日期系数之和。
 *
 * 关于「求和 vs 平均」：`Σ(单价 × 系数_i) ≡ 单价 × 单位数 × mean(系数)`，两者**恒等**。
 * 因此改成求和本身不改变金额。需求 4.4.5 禁止的是**平均的取值集合错了**——
 * 早前对"租期覆盖的日历日期"取平均，而不是对"每个计费单位"取平均；当计费块与
 * 日期不一一对应时（小时、周、30 日月），两个集合元素个数不同，结果才真的不同。
 * 逐单位求和同时让"哪一个单位多少钱"可以逐条解释，这是平均值给不了的。
 */
function grossForUnits(rate: RentalPricingRate, units: number, unitMultipliers?: number[]) {
  const unitAmount = unitAmountFor(rate, units);
  let total = 0;
  for (let index = 0; index < units; index += 1) {
    total += unitAmount * (unitMultipliers?.[index] ?? 1);
  }
  return money(total);
}

/**
 * 单件租金的结构化推导：金额、说明与日历快照都从这里取，避免三处各算一遍。
 * 快照里的「实际单位价」必须按**总单位数**选阶梯档，按 1 个单位现算会记成基础价。
 */
function breakdownFor(
  rate: RentalPricingRate,
  units: number,
  unitMultipliers?: number[]
): RentalPriceBreakdown {
  const tier = tierFor(rate, units);
  const unitAmount = tier?.unitAmount ?? rate.baseAmount;
  const grossAmount = grossForUnits(rate, units, unitMultipliers);
  const amount = applyCap(rate, grossAmount);
  return {
    units,
    unitAmount,
    tierMinUnits: tier?.minUnits,
    grossAmount,
    amount,
    capped: amount < grossAmount
  };
}

function describeLine(rate: RentalPricingRate, units: number, gross: number, unitMultipliers?: number[]) {  const tier = tierFor(rate, units);
  const parts = [
    tier
      ? `阶梯价 ${tier.unitAmount}/${rate.unit}（满 ${tier.minUnits} ${rate.unit}）× ${units}`
      : `基础价 ${rate.baseAmount}/${rate.unit} × ${units} ${rate.unit}`
  ];
  // 逐单位系数只在确实存在非 1 系数时展开，否则说明会被一串 ×1.00 淹没。
  if (unitMultipliers?.some((value) => value !== 1)) {
    parts.push(`逐单位系数 ${unitMultipliers.slice(0, units).map((value) => value.toFixed(2)).join("+")}`);
  }
  if (rate.maxAmount !== undefined && gross > rate.maxAmount) {
    parts.push(`封顶 ${rate.maxAmount}（原 ${money(gross)}）`);
  }
  return parts.join("；");
}

/** 该单位一个计费块的时长（小时）。小时与班次可由配置覆盖，其余固定。 */
const blockHours = (unit: RentalPricingUnit, fixedHours: number, ctx?: RentalPricingContext) => {
  if (unit === "hour") {
    const minutes = ctx?.hourGranularityMinutes;
    // 只接受正有限值；非法配置回落到 60 分钟而不是算出 Infinity 或 0 个单位。
    return minutes && Number.isFinite(minutes) && minutes > 0 ? minutes / 60 : 1;
  }
  if (unit === "shift") {
    const hours = ctx?.shiftHours;
    return hours && Number.isFinite(hours) && hours > 0 ? hours : fixedHours;
  }
  return fixedHours;
};

/**
 * 按班次边界计数：租期跨过几个班次窗口就是几个单位。
 *
 * 与「按班次时长整除」的区别：边界为 `[0, 8, 16]` 时，07:00–09:00 只有 2 小时，
 * 但它横跨 00:00–08:00 与 08:00–16:00 两个班次，门店两个班次都无法再排给别人，
 * 因此计 2 个单位；整除法会算成 1 个。需求写的是"每开始一个配置班次计一个单位"。
 *
 * 边界按**营业时区**的当地小时解释，与自然日、日历同一日界口径。
 */
/**
 * 被租期跨过的班次窗口的**起始时点**（毫秒）。
 *
 * 单位数量与取价时点都从这一组时点派生，避免两套算法分叉：非等长班次（如边界
 * [0,6,18] 的 6/12/6 小时三班）下，按固定 `shiftHours` 从租期开始时刻推算会让取价日期
 * 整体偏移——17:00 起租跨 4 个班次时，真实块起点是 28 日 06:00、28 日 18:00、
 * 29 日 00:00、29 日 06:00，而固定 8 小时推算会得出 28、29、29、29。
 */
function shiftWindowStarts(startAt: string, endAt: string, ctx: RentalPricingContext): number[] {
  const timeZone = ctx.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE;
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (end <= start) return [];
  // 去重并排序：配置是人填的，不能要求它有序或不重复。
  const bounds = [...new Set(ctx.shiftStartHours ?? [])]
    .filter((hour) => Number.isFinite(hour) && hour >= 0 && hour < 24)
    .sort((left, right) => left - right);
  if (!bounds.length) return [];

  // 逐营业日枚举该日的班次起点，与 [start, end) 半开相交的窗口即被跨过。
  // 起租时刻本身所在的窗口一定算一个，因此从"起租日的前一天"开始枚举。
  const starts: number[] = [];
  const firstDay = businessDayIndex(startAt, timeZone);
  const lastDay = businessDayIndex(new Date(end - 1).toISOString(), timeZone);
  for (let day = firstDay - 1; day <= lastDay; day += 1) {
    const dateKey = businessDateKeyFromIndex(day);
    for (let index = 0; index < bounds.length; index += 1) {
      const windowStart = businessInstantAt(dateKey, bounds[index], timeZone);
      const windowEnd =
        index + 1 < bounds.length
          ? businessInstantAt(dateKey, bounds[index + 1], timeZone)
          : businessInstantAt(businessDateKeyFromIndex(day + 1), bounds[0], timeZone);
      if (windowStart < end && windowEnd > start) starts.push(windowStart);
    }
  }
  return starts.sort((left, right) => left - right);
}

/** 最低起租量超过实际窗口数时，沿真实班次边界继续生成取价时点。 */
function shiftWindowStartsForUnits(startAt: string, endAt: string, units: number, ctx: RentalPricingContext): number[] {
  const target = Math.max(0, units);
  if (!target) return [];
  const actual = shiftWindowStarts(startAt, endAt, ctx);
  if (actual.length >= target) return actual.slice(0, target);
  const timeZone = ctx.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE;
  const bounds = [...new Set(ctx.shiftStartHours ?? [])]
    .filter((hour) => Number.isFinite(hour) && hour >= 0 && hour < 24)
    .sort((left, right) => left - right);
  if (!bounds.length) return actual;
  const starts = [...actual];
  const seen = new Set(starts);
  let day = businessDayIndex(startAt, timeZone) - 1;
  while (starts.length < target) {
    const dateKey = businessDateKeyFromIndex(day);
    for (const hour of bounds) {
      const candidate = businessInstantAt(dateKey, hour, timeZone);
      if (candidate >= new Date(endAt).getTime() && !seen.has(candidate)) {
        starts.push(candidate);
        seen.add(candidate);
        if (starts.length >= target) break;
      }
    }
    day += 1;
  }
  return starts.sort((left, right) => left - right);
}

const durationStrategy = (unit: RentalPricingUnit, hoursPerUnit: number): RentalPricingStrategy => ({
  unit,
  billableUnits: (startAt, endAt, ctx) => {
    // 班次配了边界就按「跨过几个班次窗口」计数（需求："每开始一个配置班次计一个单位"）。
    if (unit === "shift" && ctx?.shiftStartHours?.length) {
      return shiftWindowStarts(startAt, endAt, ctx).length;
    }
    return Math.ceil(durationHours(startAt, endAt) / blockHours(unit, hoursPerUnit, ctx));
  },
  // 每个计费块按**块开始时刻**取价：date = 块开始所在的营业日期，at = 块开始时点（需求 4.4.5/4.5.6）。
  billableUnitDates: (startAt, endAt, units, ctx) => {
    const timeZone = ctx?.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE;
    // 班次配了边界时用与计数**同一组**窗口起点，不再按固定块长从起租时刻推算。
    if (unit === "shift" && ctx?.shiftStartHours?.length) {
      return shiftWindowStartsForUnits(startAt, endAt, units, ctx)
        .map((value) => ({ date: businessDateKey(new Date(value).toISOString(), timeZone), at: new Date(value).toISOString() }));
    }
    const hours = blockHours(unit, hoursPerUnit, ctx);
    return Array.from({ length: Math.max(0, units) }, (_, index) => {
      const at = new Date(startAt).getTime() + index * hours * 3_600_000;
      return { date: businessDateKey(new Date(at).toISOString(), timeZone), at: new Date(at).toISOString() };
    });
  },
  amountPerItem: (rate, units, unitMultipliers) => applyCap(rate, grossForUnits(rate, units, unitMultipliers)),
  priceBreakdown: (rate, units, unitMultipliers) => breakdownFor(rate, units, unitMultipliers),
  explain: (rate, units, unitMultipliers) =>
    describeLine(rate, units, grossForUnits(rate, units, unitMultipliers), unitMultipliers)
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
    billableUnits: (startAt, endAt, ctx) => {
      const timeZone = ctx?.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE;
      const start = new Date(startAt).getTime();
      const end = new Date(endAt).getTime();
      if (end <= start) return 0;
      // 结束时刻正好落在营业日零点时不跨入新日期，因此对结束端取"最后一刻"的日序号。
      return (
        businessDayIndex(new Date(end - 1).toISOString(), timeZone) - businessDayIndex(startAt, timeZone) + 1
      );
    },
    // 自然日按**每个计费日期**取价；首个单位取价时点 = 实际租期开始时点，后续 = 当日开始时点。
    billableUnitDates: (startAt, _endAt, units, ctx) => {
      const timeZone = ctx?.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE;
      const first = businessDayIndex(startAt, timeZone);
      return Array.from({ length: Math.max(0, units) }, (_, index) => {
        const date = businessDateKeyFromIndex(first + index);
        const at = index === 0 ? new Date(startAt).toISOString() : new Date(businessInstantAt(date, 0, timeZone)).toISOString();
        return { date, at };
      });
    },
    amountPerItem: (rate, units, unitMultipliers) => applyCap(rate, grossForUnits(rate, units, unitMultipliers)),
    priceBreakdown: (rate, units, unitMultipliers) => breakdownFor(rate, units, unitMultipliers),
    explain: (rate, units, unitMultipliers) =>
      describeLine(rate, units, grossForUnits(rate, units, unitMultipliers), unitMultipliers)
  },

  /**
   * 夜：按**过夜数**计，用于露营与住宿类。
   * 当日租当日还没有过夜，如实返回 0，由价格计划的 minimumUnits 决定是否兜底。
   */
  night: {
    unit: "night",
    billableUnits: (startAt, endAt, ctx) => {
      const timeZone = ctx?.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE;
      const start = new Date(startAt).getTime();
      const end = new Date(endAt).getTime();
      if (end <= start) return 0;
      return Math.max(
        0,
        businessDayIndex(new Date(end - 1).toISOString(), timeZone) - businessDayIndex(startAt, timeZone)
      );
    },
    // 第 i 夜按**入住那一天**取价：首夜取价时点 = 实际入住时刻，后续夜 = 当日开始时点。
    billableUnitDates: (startAt, _endAt, units, ctx) => {
      const timeZone = ctx?.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE;
      const first = businessDayIndex(startAt, timeZone);
      return Array.from({ length: Math.max(0, units) }, (_, index) => {
        const date = businessDateKeyFromIndex(first + index);
        const at = index === 0 ? new Date(startAt).toISOString() : new Date(businessInstantAt(date, 0, timeZone)).toISOString();
        return { date, at };
      });
    },
    amountPerItem: (rate, units, unitMultipliers) => applyCap(rate, grossForUnits(rate, units, unitMultipliers)),
    priceBreakdown: (rate, units, unitMultipliers) => breakdownFor(rate, units, unitMultipliers),
    explain: (rate, units, unitMultipliers) =>
      describeLine(rate, units, grossForUnits(rate, units, unitMultipliers), unitMultipliers)
  },

  package: {
    unit: "package",
    billableUnits: () => 1,
    // 整包只有一个单位，按起租时点取价。
    billableUnitDates: (startAt, _endAt, _units, ctx) => [
      { date: businessDateKey(startAt, ctx?.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE), at: new Date(startAt).toISOString() }
    ],
    amountPerItem: (rate, units, unitMultipliers) => applyCap(rate, grossForUnits(rate, units, unitMultipliers)),
    priceBreakdown: (rate, units, unitMultipliers) => breakdownFor(rate, units, unitMultipliers),
    explain: (rate, units, unitMultipliers) =>
      describeLine(rate, units, grossForUnits(rate, units, unitMultipliers), unitMultipliers)
  },

  usage: {
    unit: "usage",
    billableUnits: (_startAt, _endAt, ctx) => {
      const usageQuantity = ctx?.usageQuantity;
      if (typeof usageQuantity !== "number" || !Number.isFinite(usageQuantity) || usageQuantity < 0) {
        throw new BadRequestException("按使用量计价时必须提供有效使用量");
      }
      return Math.ceil(usageQuantity);
    },
    // 使用量按里程/工时等指标计费，与日期无一一对应关系，因此不参与逐日取价。
    billableUnitDates: () => [],
    amountPerItem: (rate, units) => {
      const included = rate.includedUsage ?? 0;
      const excessRate = rate.excessUsageAmount ?? rate.baseAmount;
      return applyCap(rate, rate.baseAmount + Math.max(0, units - included) * excessRate);
    },
    // 使用量不走阶梯/逐单位系数：金额是「包干 + 超额 × 超额单价」。
    // 快照里的「单位价」记超额单价，原始金额记封顶前的合计，口径与 explain 一致。
    priceBreakdown: (rate, units) => {
      const included = rate.includedUsage ?? 0;
      const excessRate = rate.excessUsageAmount ?? rate.baseAmount;
      const grossAmount = money(rate.baseAmount + Math.max(0, units - included) * excessRate);
      const amount = applyCap(rate, grossAmount);
      return { units, unitAmount: excessRate, grossAmount, amount, capped: amount < grossAmount };
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
