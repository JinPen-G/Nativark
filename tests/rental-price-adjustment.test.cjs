const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// PRICE-03（需求 4.4.3/4.5.5 v2.9）：调价应用、逐行最终价预览、周期时段命中与重叠判定的纯函数语义。
const {
  periodicWindowHits,
  periodicWindowsOverlap,
  assertNoPeriodicOverlap,
  assertNoDatetimeOverrideOverlap,
  applyPriceAdjustment
} = require("../apps/api/src/modules/rental-core/rental-price-adjustments");

let passed = 0;
const ok = (message) => {
  passed += 1;
  console.log(`  PASS  ${message}`);
};

const rate = (overrides = {}) => ({
  id: "r1", itemGroupId: "g1", itemGroupCode: "KIT", itemGroupName: "套件",
  unit: "calendar_day", baseAmount: 100, weekendMultiplier: 1, holidayMultiplier: 1,
  depositAmount: 0, minimumUnits: 1, ...overrides
});

/* ---------- periodicWindowHits：周五 12:00 → 周一 00:00（需求 4.5.5 的原始例子） ---------- */

const weekendWindow = { fromWeekday: 5, fromTime: "12:00", toWeekday: 1, toTime: "00:00", multiplier: 1.5 };

// 命中：周五 14:00（+08）——「周五下午开始的租期按周末价」。
assert.equal(
  periodicWindowHits(weekendWindow, "2046-03-09T14:00:00+08:00", "Asia/Shanghai"),
  true,
  "周五 14:00 应命中周五 12:00 起的周末价时段"
);
// 不命中：周五 10:00（早于 12:00）。
assert.equal(periodicWindowHits(weekendWindow, "2046-03-09T10:00:00+08:00", "Asia/Shanghai"), false);
ok("周期时段：周五 12:00 起生效——14:00 命中、10:00 不命中（按取价时点判定）");

// 命中：周日 23:59；不命中：周一 00:00 整（区间 [start, end) 左闭右开）。
assert.equal(periodicWindowHits(weekendWindow, "2046-03-11T23:59:00+08:00", "Asia/Shanghai"), true);
assert.equal(periodicWindowHits(weekendWindow, "2046-03-12T00:00:00+08:00", "Asia/Shanghai"), false);
ok("周期时段：跨星期区间右端开——周一 00:00 整不再命中");

// 时区必须影响星期判定：同一 UTC 时刻在上海是周五 14:00，在 UTC 是周五 06:00（<12:00）。
assert.equal(periodicWindowHits(weekendWindow, "2046-03-09T06:00:00Z", "Asia/Shanghai"), true);
assert.equal(periodicWindowHits(weekendWindow, "2046-03-09T06:00:00Z", "UTC"), false);
ok("周期时段：按营业时区解释星期与时分，不得按 UTC");

/* ---------- periodicWindowsOverlap ---------- */

const w1 = { fromWeekday: 5, fromTime: "12:00", toWeekday: 5, toTime: "23:59", multiplier: 1.5 };
const w2 = { fromWeekday: 5, fromTime: "10:00", toWeekday: 5, toTime: "14:00", multiplier: 1.2 };
const w3 = { fromWeekday: 6, fromTime: "00:00", toWeekday: 6, toTime: "23:59", multiplier: 1.2 };
assert.equal(periodicWindowsOverlap(w1, w2), true, "周五 12-24 与周五 10-14 重叠");
assert.equal(periodicWindowsOverlap(w1, w3), false, "周五 12-24 与周六全天不重叠");
ok("重叠判定：同商品同单位的周期时段重叠可检测、不相交通过");

const overlapping = [{ fromWeekday: 5, fromTime: "12:00", toWeekday: 5, toTime: "23:59", multiplier: 1.5 }, w2];
const overlapError = (() => {
  try { assertNoPeriodicOverlap(overlapping, "测试计划"); return null; } catch (caught) { return caught; }
})();
assert.ok(overlapError && /重叠/.test(overlapError.message));
ok("重叠判定：保存/确认时抛出明确的重叠冲突");

/* ---------- applyPriceAdjustment ---------- */

const current = [rate(), rate({ id: "r2", itemGroupId: "g2", itemGroupCode: "KIT2", itemGroupName: "套件2", unit: "hour", baseAmount: 80 })];
const applied = applyPriceAdjustment(current, [
  { itemGroupId: "g1", unit: "calendar_day", op: "percent", value: 10 },
  { itemGroupId: "g2", unit: "hour", op: "fixed", value: -20 }
]);
assert.equal(applied.rates[0].baseAmount, 110, "百分比上调 10% → 110");
assert.equal(applied.rates[1].baseAmount, 60, "固定减 20 → 60");
assert.equal(applied.preview[0].beforeBaseAmount, 100);
assert.equal(applied.preview[0].afterBaseAmount, 110);
assert.equal(applied.preview[1].itemGroupCode, "KIT2");
ok("调价应用：百分比/固定额按最终价逐行预览（需求 4.4.3：不得只展示公式）");

const setZero = applyPriceAdjustment(current, [{ itemGroupId: "g1", unit: "calendar_day", op: "set_base", value: 0 }]);
assert.equal(setZero.rates[0].baseAmount, 0, "直接设价 0 是合法调价（免租）");
ok("调价应用：直接设价 0 合法（与未配置区分）");

const negative = (() => {
  try { applyPriceAdjustment(current, [{ itemGroupId: "g1", unit: "calendar_day", op: "fixed", value: -200 }]); return null; } catch (caught) { return caught; }
})();
assert.ok(negative && /负/.test(negative.message), "调整为负必须拒绝");
const missing = (() => {
  try { applyPriceAdjustment(current, [{ itemGroupId: "nope", unit: "calendar_day", op: "percent", value: 10 }]); return null; } catch (caught) { return caught; }
})();
assert.ok(missing && /不存在/.test(missing.message), "差异指向不存在的费率必须拒绝");
const duplicateChange = (() => {
  try {
    applyPriceAdjustment(current, [
      { itemGroupId: "g1", unit: "calendar_day", op: "fixed", value: 1 },
      { itemGroupId: "g1", unit: "calendar_day", op: "percent", value: 5 }
    ]);
    return null;
  } catch (caught) { return caught; }
})();
assert.ok(duplicateChange && /只能出现一次/.test(duplicateChange.message), "同一价格行重复调整必须拒绝");
ok("调价应用：负价与不存在的费率行均 fail-closed");

/* ---------- assertNoDatetimeOverrideOverlap ---------- */

assertNoDatetimeOverrideOverlap([
  { start: "2046-10-01T00:00:00+08:00", end: "2046-10-08T00:00:00+08:00", multiplier: 1.3 },
  { start: "2046-10-08T00:00:00+08:00", end: "2046-10-09T00:00:00+08:00", multiplier: 1.2 }
], "测试");
const dupOverride = (() => {
  try {
    assertNoDatetimeOverrideOverlap([
      { start: "2046-10-01T00:00:00+08:00", end: "2046-10-08T00:00:00+08:00", multiplier: 1.3 },
      { start: "2046-10-05T00:00:00+08:00", end: "2046-10-12T00:00:00+08:00", multiplier: 1.2 }
    ], "测试");
    return null;
  } catch (caught) { return caught; }
})();
assert.ok(dupOverride && /重叠/.test(dupOverride.message));
ok("一次性覆盖：区间重叠拒绝（无法唯一择价）、相邻区间通过");

console.log(`\nPrice adjustment unit tests passed: ${passed} assertion groups.`);
