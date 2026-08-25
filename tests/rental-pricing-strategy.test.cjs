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
 * 时间一律写成显式 UTC（带 `Z`）。用不带时区的字面量会被 JS 按**运行机器的本地时区**
 * 解析，同一份断言在不同机器上结论不同——那种测试过不过取决于跑它的人在哪个时区。
 * 「自然日」「夜」按 UTC 日期边界切分，与营业日历既有的 `toISOString().slice(0,10)`
 * 键法保持一致；系统当前没有任何租户时区配置，见文件末尾的说明。
 */

const iso = (utc) => {
  assert.match(utc, /Z$/, `测试时间必须显式写成 UTC：${utc}`);
  return utc;
};
const units = (unit, start, end, usageQuantity) =>
  rentalPricingStrategy(unit).billableUnits(iso(start), iso(end), usageQuantity);

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

/* ---------- 自然日：按日期计，不是按 24 小时块计 ---------- */

// 需求 4.4 把「自然日」与「24 小时」列为**两个**计价单位，因此二者不能同义。
// 自然日的业务含义是「占用了几个日期」：周一晚租到周二早，门店的周一和周二
// 都无法把这件商品租给别人，因此计 2 日。
assert.equal(
  units("calendar_day", "2026-03-02T22:00:00Z", "2026-03-03T08:00:00Z"),
  2,
  "自然日：跨 2 个日期（共 10 小时）必须计 2 日，而不是按 24 小时折算成 1 日"
);
assert.equal(
  units("calendar_day", "2026-03-02T09:00:00Z", "2026-03-02T18:00:00Z"),
  1,
  "自然日：同一日期内必须计 1 日"
);
assert.equal(
  units("calendar_day", "2026-03-02T09:00:00Z", "2026-03-05T09:00:00Z"),
  4,
  "自然日：3/2 09:00→3/5 09:00 占用 3/2、3/3、3/4、3/5 四个日期，必须计 4 日"
);
// 边界：结束时刻正好落在零点，不应把下一个日期也算进来。
assert.equal(
  units("calendar_day", "2026-03-02T09:00:00Z", "2026-03-03T00:00:00Z"),
  1,
  "自然日：结束于次日零点整仍只占用 3/2 一个日期"
);

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
  units("night", "2026-03-02T09:00:00Z", "2026-03-02T18:00:00Z"),
  0,
  "夜：当日往返未过夜必须为 0，起租量兜底交给价格计划"
);
assert.equal(units("night", "2026-03-02T22:00:00Z", "2026-03-03T08:00:00Z"), 1, "夜：跨一个零点为 1 夜");
assert.equal(units("night", "2026-03-02T14:00:00Z", "2026-03-05T11:00:00Z"), 3, "夜：3/2 入 3/5 出为 3 夜");

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

console.log("rental pricing strategy tests passed: 单位语义、边界、非法输入、阶梯价、封顶价与计算说明均已覆盖");
