const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" }
});

const {
  rentalPricingStrategy,
  assertRentalPricingStrategiesComplete,
  RENTAL_PRICING_STRATEGIES
} = require("../apps/api/src/modules/rental-core/rental-pricing-strategy.ts");
const {
  DEFAULT_BUSINESS_TIME_ZONE,
  businessDayIndex,
  businessDateKey,
  isValidTimeZone
} = require("../apps/api/src/modules/rental-core/rental-business-day.ts");
const { RENTAL_PRICING_UNIT_CODES } = require("../packages/shared/src/index.ts");

/**
 * 计费策略单元测试。
 *
 * 为什么这一份可以不连库：策略是**纯函数**——给定租期与费率算出可计费单位数和行金额，
 * 不读写任何持久化状态。这与本仓库"持久化语义只在 MySQL E2E 里验证"的约定不冲突：
 * 那条约定针对的是租户隔离、唯一约束、外键和过期过滤，这里一个都不涉及。
 *
 * 技术指南 5.4 要求"新增策略必须覆盖正常值、边界值、非法输入和既有报价回归"，
 * 而此前没有任何一份测试直接覆盖策略层，计价单位的语义错误因此可以一路走到线上。
 *
 * 时间一律写成**带显式偏移**的字面量（`Z` 或 `+08:00`）。不带时区的字面量会被 JS
 * 按运行机器的本地时区解析，同一份断言在不同机器上结论不同——那种测试过不过
 * 取决于跑它的人在哪个时区。
 *
 * 「自然日」「夜」按**营业时区**的日界切分（默认 Asia/Shanghai），与营业日历同一口径。
 * 因此本文件用 `+08:00` 书写这两个单位的用例：读起来就是门店挂钟时间。
 */

const iso = (value) => {
  assert.match(value, /(Z|[+-]\d{2}:\d{2})$/, `测试时间必须带显式时区偏移：${value}`);
  return value;
};
const units = (unit, start, end, usageQuantity, timeZone) =>
  rentalPricingStrategy(unit).billableUnits(iso(start), iso(end), { usageQuantity, timeZone });
/** 需要小时粒度、班次时长或班次边界时用这个，参数一目了然。 */
const unitsWith = (unit, start, end, ctx) =>
  rentalPricingStrategy(unit).billableUnits(iso(start), iso(end), ctx);

/* ---------- 注册表完整性 ---------- */

assertRentalPricingStrategiesComplete();
assert.equal(
  Object.keys(RENTAL_PRICING_STRATEGIES).length,
  RENTAL_PRICING_UNIT_CODES.length,
  "每个公开计费单位必须有且只有一个已注册策略（技术指南 5.4）"
);
for (const unit of RENTAL_PRICING_UNIT_CODES) {
  assert.equal(RENTAL_PRICING_STRATEGIES[unit].unit, unit, `策略 ${unit} 的自述单位必须与注册键一致`);
}

/* ---------- 自然日：按营业时区的日期计，不是按 24 小时块计 ---------- */

// 需求 4.4 把「自然日」与「24 小时」列为**两个**计价单位，因此二者不能同义。
// 自然日的业务含义是「占用了几个日期」：周一晚租到周二早，门店的周一和周二
// 都无法把这件商品租给别人，因此计 2 日。
// 下面一律用 +08:00 书写，即门店挂钟时间（默认营业时区 Asia/Shanghai）。
assert.equal(
  units("calendar_day", "2026-03-02T22:00:00+08:00", "2026-03-03T08:00:00+08:00"),
  2,
  "自然日：跨 2 个日期（共 10 小时）必须计 2 日，而不是按 24 小时折算成 1 日"
);
assert.equal(
  units("calendar_day", "2026-03-02T09:00:00+08:00", "2026-03-02T18:00:00+08:00"),
  1,
  "自然日：同一日期内必须计 1 日"
);
assert.equal(
  units("calendar_day", "2026-03-02T09:00:00+08:00", "2026-03-05T09:00:00+08:00"),
  4,
  "自然日：3/2 09:00→3/5 09:00 占用 3/2、3/3、3/4、3/5 四个日期，必须计 4 日"
);
// 边界：结束时刻正好落在营业日零点，不应把下一个日期也算进来。
assert.equal(
  units("calendar_day", "2026-03-02T09:00:00+08:00", "2026-03-03T00:00:00+08:00"),
  1,
  "自然日：结束于次日零点整仍只占用 3/2 一个日期"
);

/* ---------- 日界必须随营业时区变化 ---------- */

// 这组是「按租户配置时区」这件事的**区分性**证据：同一段绝对时间，
// 在不同营业时区里跨越的日期数不同，因此计价必须随时区变化。
// 北京 3/2 06:00–20:00 是同一天；同一段时间在 UTC 里是 3/1 22:00–3/2 12:00，跨两个日期。
assert.equal(
  units("calendar_day", "2026-03-02T06:00:00+08:00", "2026-03-02T20:00:00+08:00", undefined, "Asia/Shanghai"),
  1,
  "上海时区：当日 06:00–20:00 必须计 1 日"
);
assert.equal(
  units("calendar_day", "2026-03-02T06:00:00+08:00", "2026-03-02T20:00:00+08:00", undefined, "UTC"),
  2,
  "同一段时间按 UTC 日界会跨 2 个日期——这正是早前多收一天的成因"
);
// 缺省时区必须等价于显式传 Asia/Shanghai，否则调用方漏传就会算出另一个价。
assert.equal(
  units("calendar_day", "2026-03-02T06:00:00+08:00", "2026-03-02T20:00:00+08:00"),
  units("calendar_day", "2026-03-02T06:00:00+08:00", "2026-03-02T20:00:00+08:00", undefined, DEFAULT_BUSINESS_TIME_ZONE),
  "缺省营业时区必须与显式传入默认值结果一致"
);
assert.equal(DEFAULT_BUSINESS_TIME_ZONE, "Asia/Shanghai", "默认营业时区应为 Asia/Shanghai");

/* ---------- 夏令时：这是不能用固定偏移的原因 ---------- */

// 纽约 2026-03-08 02:00 进入夏令时，那天本地只有 23 小时。
// 用「时间戳 + 固定偏移再取整」的算法会在这一天把日界算错；按 IANA 时区换算不会。
assert.equal(
  units("calendar_day", "2026-03-07T20:00:00-05:00", "2026-03-08T20:00:00-04:00", undefined, "America/New_York"),
  2,
  "夏令时切换日：3/7 20:00 → 3/8 20:00 占用 2 个本地日期"
);
assert.equal(
  businessDayIndex("2026-03-09T00:30:00-04:00", "America/New_York") -
    businessDayIndex("2026-03-07T23:30:00-05:00", "America/New_York"),
  2,
  "跨夏令时切换的日序号差必须是 2 天，不受该日只有 23 小时影响"
);

/* ---------- 时区标识校验 ---------- */

assert.equal(isValidTimeZone("Asia/Shanghai"), true, "已知时区必须通过校验");
assert.equal(isValidTimeZone("UTC"), true, "UTC 必须通过校验");
assert.equal(isValidTimeZone("Not/AZone"), false, "未知时区必须被拒绝，否则会在报价时才炸成 500");
assert.equal(isValidTimeZone(""), false, "空时区必须被拒绝");
assert.equal(businessDateKey("2026-03-01T22:00:00Z", "Asia/Shanghai"), "2026-03-02", "日期键必须按营业时区换算");
assert.equal(businessDateKey("2026-03-01T22:00:00Z", "UTC"), "2026-03-01", "同一时刻在 UTC 下是前一天");

/* ---------- 24 小时：按时长进位 ---------- */

assert.equal(units("day_24h", "2026-03-02T09:00:00Z", "2026-03-03T10:00:00Z"), 2, "24 小时：25 小时必须进位为 2");
assert.equal(units("day_24h", "2026-03-02T09:00:00Z", "2026-03-03T09:00:00Z"), 1, "24 小时：整 24 小时为 1");
assert.equal(
  units("day_24h", "2026-03-02T22:00:00Z", "2026-03-03T08:00:00Z"),
  1,
  "24 小时：跨日但不足 24 小时仍为 1——这正是它与自然日的区别"
);

/* ---------- 夜：按过夜数计 ---------- */

// 「夜」用于露营、住宿类：当日租当日还没有过夜，夜数为 0。
// 不在策略里兜成 1——最小起租量是价格计划的职责（技术指南 5.4），
// 策略只如实回答"过了几夜"，否则 minimumUnits 配 0 或 2 时都会被策略悄悄改写。
assert.equal(
  units("night", "2026-03-02T09:00:00+08:00", "2026-03-02T18:00:00+08:00"),
  0,
  "夜：当日往返未过夜必须为 0，起租量兜底交给价格计划"
);
assert.equal(units("night", "2026-03-02T22:00:00+08:00", "2026-03-03T08:00:00+08:00"), 1, "夜：跨一个零点为 1 夜");
assert.equal(units("night", "2026-03-02T14:00:00+08:00", "2026-03-05T11:00:00+08:00"), 3, "夜：3/2 入 3/5 出为 3 夜");
assert.equal(
  units("night", "2026-03-02T06:00:00+08:00", "2026-03-02T20:00:00+08:00", undefined, "UTC"),
  1,
  "夜同样随营业时区变化：同一段时间按 UTC 日界会算出 1 夜"
);

/* ---------- 小时、班次、周、月 ---------- */

assert.equal(units("hour", "2026-03-02T09:00:00Z", "2026-03-02T09:30:00Z"), 1, "小时：半小时进位为 1");
assert.equal(units("hour", "2026-03-02T09:00:00Z", "2026-03-02T12:00:00Z"), 3, "小时：整 3 小时为 3");
assert.equal(units("shift", "2026-03-02T08:00:00Z", "2026-03-02T16:00:00Z"), 1, "班次：8 小时为 1 班");
assert.equal(units("shift", "2026-03-02T08:00:00Z", "2026-03-02T17:00:00Z"), 2, "班次：9 小时进位为 2 班");
assert.equal(units("week", "2026-03-02T00:00:00Z", "2026-03-09T00:00:00Z"), 1, "周：整 7 天为 1 周");
assert.equal(units("week", "2026-03-02T00:00:00Z", "2026-03-10T00:00:00Z"), 2, "周：8 天进位为 2 周");
assert.equal(units("month", "2026-03-02T00:00:00Z", "2026-04-01T00:00:00Z"), 1, "月：30 天为 1 月");

/* ---------- 整包 ---------- */

assert.equal(units("package", "2026-03-02T09:00:00Z", "2026-03-09T09:00:00Z"), 1, "整包：与时长无关，恒为 1");

/* ---------- 使用量：非法输入必须拒绝 ---------- */

assert.equal(units("usage", "2026-03-02T09:00:00Z", "2026-03-03T09:00:00Z", 120), 120, "使用量：按提供的用量计");
assert.equal(units("usage", "2026-03-02T09:00:00Z", "2026-03-03T09:00:00Z", 0.4), 1, "使用量：小数进位");
for (const bad of [undefined, null, -1, Number.NaN, Number.POSITIVE_INFINITY, "80"]) {
  assert.throws(
    () => units("usage", "2026-03-02T09:00:00Z", "2026-03-03T09:00:00Z", bad),
    /使用量/,
    `使用量：非法输入 ${JSON.stringify(bad)} 必须被拒绝，不能静默当成 0`
  );
}

/* ---------- 零长与倒挂租期 ---------- */

// 倒挂租期（结束早于开始）不能算出负数或非零单位。
// 报价主流程另有校验，这里守住策略自身不产出荒谬值。
for (const unit of ["hour", "day_24h", "calendar_day", "night", "week", "month", "shift"]) {
  const value = units(unit, "2026-03-05T09:00:00Z", "2026-03-02T09:00:00Z");
  assert.ok(value >= 0, `${unit}：倒挂租期不得算出负数单位，实际 ${value}`);
}

/* ---------- 未注册单位 ---------- */

assert.throws(() => rentalPricingStrategy("fortnight"), /未注册的计费策略/, "未注册单位必须明确拒绝");

/* ---------- 阶梯价与封顶价（需求 4.4）---------- */

const amount = (unit, rate, unitCount) => rentalPricingStrategy(unit).amountPerItem(rate, unitCount);
const amountWith = (unit, rate, unitCount, unitMultipliers) =>
  rentalPricingStrategy(unit).amountPerItem(rate, unitCount, unitMultipliers);
const explain = (unit, rate, unitCount) => rentalPricingStrategy(unit).explain(rate, unitCount);
const rateOf = (extra) => ({
  id: "rate_test",
  itemGroupId: "g",
  itemGroupCode: "G",
  itemGroupName: "测试组",
  unit: "day_24h",
  baseAmount: 100,
  weekendMultiplier: 1,
  holidayMultiplier: 1,
  depositAmount: 0,
  minimumUnits: 1,
  ...extra
});

// 无阶梯：按基础价线性计。
assert.equal(amount("day_24h", rateOf({}), 3), 300, "无阶梯时按基础价 × 单位数");

// 阶梯价按"整单重定价"，不是分段累加：满 7 天则 7 天全部按 70 计。
const tiered = rateOf({ tiers: [{ minUnits: 3, unitAmount: 90 }, { minUnits: 7, unitAmount: 70 }] });
assert.equal(amount("day_24h", tiered, 2), 200, "未达最低档时仍用基础价");
assert.equal(amount("day_24h", tiered, 3), 270, "刚好达到 3 天档：3 × 90");
assert.equal(amount("day_24h", tiered, 6), 540, "3 天档覆盖到 6 天：6 × 90");
assert.equal(amount("day_24h", tiered, 7), 490, "达到 7 天档后整单重定价：7 × 70，不是分段累加");
assert.equal(amount("day_24h", tiered, 10), 700, "更长租期沿用最高已达档位");
// 档位顺序不该影响结果——配置是人填的，不能要求它有序。
const unsorted = rateOf({ tiers: [{ minUnits: 7, unitAmount: 70 }, { minUnits: 3, unitAmount: 90 }] });
assert.equal(amount("day_24h", unsorted, 7), 490, "档位乱序配置必须得到同一结果");

// 封顶价：超过上限按上限收，且说明里要讲清封顶前的金额。
const capped = rateOf({ maxAmount: 250 });
assert.equal(amount("day_24h", capped, 3), 250, "封顶价必须生效");
assert.equal(amount("day_24h", capped, 2), 200, "未触及封顶时不受影响");
assert.match(explain("day_24h", capped, 3), /封顶 250（原 300）/, "封顶必须在计算说明里可追溯");
assert.equal(amount("day_24h", rateOf({ maxAmount: 0 }), 5), 0, "封顶 0 是合法配置（免租），不能当成未设置");

// 阶梯与封顶同时存在：先按档位算，再封顶。
const both = rateOf({ tiers: [{ minUnits: 5, unitAmount: 80 }], maxAmount: 300 });
assert.equal(amount("day_24h", both, 5), 300, "阶梯算出 400 后被封顶到 300");

// 非法档位（NaN / 缺字段）必须被忽略，而不是让整行金额变成 NaN。
const dirty = rateOf({ tiers: [{ minUnits: Number.NaN, unitAmount: 10 }, { minUnits: 2, unitAmount: Number.NaN }] });
assert.equal(amount("day_24h", dirty, 3), 300, "非法档位必须忽略并回落到基础价，不得算出 NaN");

// 使用量：封顶同样适用。
const usageRate = rateOf({ unit: "usage", baseAmount: 50, includedUsage: 100, excessUsageAmount: 2, maxAmount: 120 });
assert.equal(amount("usage", usageRate, 150), 120, "使用量行的封顶价必须生效（50 + 50×2 = 150 → 120）");
assert.equal(amount("usage", rateOf({ unit: "usage", baseAmount: 50, includedUsage: 100, excessUsageAmount: 2 }), 150), 150, "未封顶时按包干+超额计");
assert.match(explain("usage", usageRate, 150), /超额 50 × 2/, "超额用量必须在计算说明里可追溯");

// 计算说明必须能解释来源：单价、单位数都要出现。
assert.match(explain("day_24h", rateOf({}), 3), /基础价 100\/day_24h × 3/, "无阶梯时说明应给出基础价与单位数");
assert.match(explain("day_24h", tiered, 7), /阶梯价 70\/day_24h（满 7 day_24h）× 7/, "命中阶梯时说明应指明档位");

/* ---------- 逐单位日期价格（需求 4.4.5 禁止整段平均倍率）---------- */

// `endAt` 参与签名：单位数量与取价时点必须来自同一组计费块。除班次外的单位不依赖它，
// 因此默认给一个足够远的结束时刻；班次用例显式传真实结束时刻。
const dates = (unit, start, unitCount, tz = DEFAULT_BUSINESS_TIME_ZONE, extra, end) =>
  rentalPricingStrategy(unit)
    .billableUnitDates(
      iso(start),
      iso(end ?? "2099-01-01T00:00:00Z"),
      unitCount,
      { timeZone: tz, ...extra }
    )
    .map((point) => point.date);
// PRICE-01：取价时点（需求 4.5.6 v2.9）——每个计费单位的命中时点必须显式可查。
const pricingPoints = (unit, start, unitCount, tz = DEFAULT_BUSINESS_TIME_ZONE, extra, end) =>
  rentalPricingStrategy(unit).billableUnitDates(
    iso(start),
    iso(end ?? "2099-01-01T00:00:00Z"),
    unitCount,
    { timeZone: tz, ...extra }
  );

// 自然日：逐个计费日期。
assert.deepEqual(
  dates("calendar_day", "2026-03-02T09:00:00+08:00", 3),
  ["2026-03-02", "2026-03-03", "2026-03-04"],
  "自然日必须按每个计费日期取价"
);
// 24 小时块：按**块开始时刻**所在营业日期取价，因此从 15:00 起租的第 2 块落在次日。
assert.deepEqual(
  dates("day_24h", "2026-03-02T15:00:00+08:00", 3),
  ["2026-03-02", "2026-03-03", "2026-03-04"],
  "24 小时块按块开始日期取价"
);
// 小时：同一天内的多个小时块都落在当天。
assert.deepEqual(
  dates("hour", "2026-03-02T22:00:00+08:00", 4),
  ["2026-03-02", "2026-03-02", "2026-03-03", "2026-03-03"],
  "小时块跨零点后应落到次日，逐块取价才能反映节假日"
);
// 周：每块 7 天。
assert.deepEqual(dates("week", "2026-03-02T09:00:00+08:00", 2), ["2026-03-02", "2026-03-09"], "周按块开始日期取价");
// 整包：只有一个单位，按起租日。
assert.deepEqual(dates("package", "2026-03-02T09:00:00+08:00", 1), ["2026-03-02"], "整包按起租日取价");
// 使用量与日期无一一对应。
assert.deepEqual(dates("usage", "2026-03-02T09:00:00+08:00", 5), [], "使用量不参与逐日取价");
// 取价时点：自然日首单位 = 实际租期开始时点，后续 = 营业日期开始时点（上海 00:00 = 前一日 16:00Z）。
assert.deepEqual(
  pricingPoints("calendar_day", "2026-03-02T09:00:00+08:00", 3).map((point) => point.at),
  ["2026-03-02T01:00:00.000Z", "2026-03-02T16:00:00.000Z", "2026-03-03T16:00:00.000Z"],
  "自然日取价时点：首单位用租期开始时点，后续用营业日期开始时点"
);
// 24 小时块：取价时点 = 每个块开始时刻。
assert.deepEqual(
  pricingPoints("day_24h", "2026-03-02T15:00:00+08:00", 2).map((point) => point.at),
  ["2026-03-02T07:00:00.000Z", "2026-03-03T07:00:00.000Z"],
  "24 小时块取价时点 = 块开始时刻"
);
// 时区必须影响日期序列。
assert.deepEqual(
  dates("calendar_day", "2026-03-02T06:00:00+08:00", 1, "UTC"),
  ["2026-03-01"],
  "同一时刻在 UTC 下属于前一天"
);

// 关于"求和 vs 平均"，先把数学说清楚，免得写出自我欺骗的断言：
//   Σ(单价 × 系数_i) ≡ 单价 × 单位数 × mean(系数)
// 两者**恒等**。所以"改成求和"本身不会改变任何金额，需求 4.4.5 禁止平均倍率
// 真正禁的是**平均的取值集合错了**：早前是对"租期覆盖的日历日期"取平均，
// 而不是对"每个计费单位"取平均。当计费块与日期不是一一对应时（小时、周、月），
// 两个集合的元素个数不同，结果才真的不同。
//
// 判别用例：3 个小时块中第 1 块在平日、后 2 块跨零点落在 1.5 倍的日期。
//   逐单位（正确）：100 + 150 + 150 = 400
//   按日期平均（早前）：日期集合 {平日 1.0, 次日 1.5} → 均值 1.25 → 100 × 3 × 1.25 = 375
assert.equal(amountWith("hour", rateOf({}), 3, [1, 1.5, 1.5]), 400, "逐单位取价：100+150+150=400（按日期平均会得 375）");
assert.equal(amountWith("calendar_day", rateOf({}), 3, [1, 1, 1.25]), 325, "自然日逐日取价：100+100+125");
assert.equal(amountWith("hour", rateOf({}), 4, [1, 1, 1.5, 1.5]), 500, "小时逐块取价：100+100+150+150");
// 封顶必须在**逐单位取价之后、乘数量之前**应用（需求 4.4.5 的固定顺序）。
assert.equal(
  amountWith("calendar_day", rateOf({ maxAmount: 260 }), 3, [1, 1, 1.25]),
  260,
  "封顶应作用在逐日求和之后：325 → 260"
);
// 阶梯先定单价，再逐单位乘系数。
assert.equal(
  amountWith("calendar_day", rateOf({ tiers: [{ minUnits: 3, unitAmount: 90 }] }), 3, [1, 1, 2]),
  360,
  "阶梯单价 90 后逐日取价：90+90+180"
);
// 缺省系数视为 1，既有调用方无需改动。
assert.equal(amountWith("calendar_day", rateOf({}), 3, undefined), 300, "缺省系数等价于全 1");
// 说明必须能看出逐单位系数。
assert.match(
  rentalPricingStrategy("calendar_day").explain(rateOf({}), 3, [1, 1, 1.25]),
  /逐单位系数 1\.00\+1\.00\+1\.25/,
  "计算说明必须展示逐单位系数"
);

/* ---------- 小时粒度可配置（需求 4.4.5：按价格配置的小时粒度）---------- */

// 缺省 60 分钟。
assert.equal(unitsWith("hour", "2026-03-02T09:00:00Z", "2026-03-02T09:30:00Z", {}), 1, "缺省粒度：半小时进位为 1 小时");
// 30 分钟粒度：同样 30 分钟只算 1 个单位，但 45 分钟要算 2 个。
assert.equal(
  unitsWith("hour", "2026-03-02T09:00:00Z", "2026-03-02T09:30:00Z", { hourGranularityMinutes: 30 }),
  1,
  "30 分钟粒度：整 30 分钟为 1 个单位"
);
assert.equal(
  unitsWith("hour", "2026-03-02T09:00:00Z", "2026-03-02T09:45:00Z", { hourGranularityMinutes: 30 }),
  2,
  "30 分钟粒度：45 分钟不足两个粒度也按两个计（需求：不足一个粒度按一个粒度计）"
);
// 15 分钟粒度：3 小时 = 12 个单位。
assert.equal(
  unitsWith("hour", "2026-03-02T09:00:00Z", "2026-03-02T12:00:00Z", { hourGranularityMinutes: 15 }),
  12,
  "15 分钟粒度：3 小时为 12 个单位"
);
// 非法粒度必须回落到 60，而不是算出 Infinity 或 0。
for (const bad of [0, -30, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
  assert.equal(
    unitsWith("hour", "2026-03-02T09:00:00Z", "2026-03-02T12:00:00Z", { hourGranularityMinutes: bad }),
    3,
    `非法小时粒度 ${JSON.stringify(bad)} 必须回落到 60 分钟`
  );
}
// 逐单位日期序列也要按粒度推进：30 分钟粒度下，23:30 起租的第 2 个单位落到次日。
assert.deepEqual(
  dates("hour", "2026-03-02T23:30:00+08:00", 2, "Asia/Shanghai", { hourGranularityMinutes: 30 }),
  ["2026-03-02", "2026-03-03"],
  "小时粒度必须同时影响逐单位取价的日期序列"
);

/* ---------- 班次时长与边界可配置（需求 4.4.5：由经营空间规则定义）---------- */

// 缺省 8 小时。
assert.equal(unitsWith("shift", "2026-03-02T08:00:00Z", "2026-03-02T17:00:00Z", {}), 2, "缺省班次 8 小时：9 小时为 2 班");
// 12 小时班：同样 9 小时只算 1 班。
assert.equal(
  unitsWith("shift", "2026-03-02T08:00:00Z", "2026-03-02T17:00:00Z", { shiftHours: 12 }),
  1,
  "12 小时班：9 小时为 1 班"
);
assert.equal(
  unitsWith("shift", "2026-03-02T08:00:00Z", "2026-03-02T21:00:00Z", { shiftHours: 12 }),
  2,
  "12 小时班：13 小时为 2 班"
);
// 班次边界：配了边界就按「跨过几个班次窗口」计数，这与按时长整除**不同**。
// 边界 [0, 8, 16]，租期 07:00–09:00 只有 2 小时，但横跨 00-08 与 08-16 两个班次。
const boundaryCtx = { timeZone: "Asia/Shanghai", shiftStartHours: [0, 8, 16] };
assert.equal(
  unitsWith("shift", "2026-03-02T07:00:00+08:00", "2026-03-02T09:00:00+08:00", boundaryCtx),
  2,
  "班次边界：07:00–09:00 横跨两个班次窗口（按时长整除只会算 1 班）"
);
assert.equal(
  unitsWith("shift", "2026-03-02T09:00:00+08:00", "2026-03-02T15:00:00+08:00", boundaryCtx),
  1,
  "班次边界：完全落在 08-16 窗口内计 1 班"
);
assert.equal(
  unitsWith("shift", "2026-03-02T09:00:00+08:00", "2026-03-03T09:00:00+08:00", boundaryCtx),
  4,
  "班次边界：跨一整天从 08-16 到次日 08-16，共 4 个窗口"
);
// 边界配置乱序或重复不应改变结果——配置是人填的。
assert.equal(
  unitsWith("shift", "2026-03-02T07:00:00+08:00", "2026-03-02T09:00:00+08:00", {
    timeZone: "Asia/Shanghai",
    shiftStartHours: [16, 0, 8, 8]
  }),
  2,
  "班次边界乱序且重复时必须得到同一结果"
);
// 空边界回落到按时长整除。
assert.equal(
  unitsWith("shift", "2026-03-02T08:00:00Z", "2026-03-02T17:00:00Z", { shiftStartHours: [], shiftHours: 8 }),
  2,
  "空边界回落到按班次时长整除"
);

/* ---------- 非等长班次：单位数量与取价时点必须来自同一组计费块 ---------- */
// 边界 [0, 6, 18] 是 6/12/6 小时的三班制。Codex 复审给的场景：当地 8-28 17:00 → 8-29 07:00。
// 真实跨过的窗口起点是 28 日 06:00、28 日 18:00、29 日 00:00、29 日 06:00 → 取价日期 28,28,29,29。
// 早前 billableUnitDates 按固定 shiftHours 从起租时刻推算，会得出 28,29,29,29 —— 跨平假日直接算错钱。
const unevenCtx = { timeZone: "Asia/Shanghai", shiftStartHours: [0, 6, 18] };
assert.equal(
  unitsWith("shift", "2026-08-28T17:00:00+08:00", "2026-08-29T07:00:00+08:00", unevenCtx),
  4,
  "非等长班次 [0,6,18]：17:00→次日 07:00 跨 4 个班次窗口"
);
assert.deepEqual(
  dates("shift", "2026-08-28T17:00:00+08:00", 4, "Asia/Shanghai", { shiftStartHours: [0, 6, 18] }, "2026-08-29T07:00:00+08:00"),
  ["2026-08-28", "2026-08-28", "2026-08-29", "2026-08-29"],
  "非等长班次的取价日期必须来自真实窗口起点（28,28,29,29），不是按固定块长推算的 28,29,29,29"
);
// 完全落在单个窗口内时，取价日期是该窗口起点所在营业日——即使起租时刻在窗口中段。
assert.deepEqual(
  dates("shift", "2026-08-28T23:00:00+08:00", 1, "Asia/Shanghai", { shiftStartHours: [0, 6, 18] }, "2026-08-28T23:30:00+08:00"),
  ["2026-08-28"],
  "18:00 窗口内 23:00 起租，取价日期是窗口起点所在的 28 日"
);
// 跨零点：00:00 边界让新窗口从次日零点开始，取价日期随之进入次日。
assert.deepEqual(
  dates("shift", "2026-08-28T23:00:00+08:00", 2, "Asia/Shanghai", { shiftStartHours: [0, 6, 18] }, "2026-08-29T01:00:00+08:00"),
  ["2026-08-28", "2026-08-29"],
  "跨零点时第二个窗口起点落在次日，取价日期必须跟着走"
);
assert.deepEqual(
  dates("shift", "2026-08-28T23:00:00+08:00", 3, "Asia/Shanghai", { shiftStartHours: [0, 6, 18] }, "2026-08-28T23:30:00+08:00"),
  ["2026-08-28", "2026-08-29", "2026-08-29"],
  "最低起租 3 班时应沿真实边界继续到次日 00:00、06:00，不能重复最后一个日期"
);

console.log("rental pricing strategy tests passed: 单位语义、边界、非法输入、阶梯价、封顶价与计算说明均已覆盖");
