const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// PRICE-02A（需求 4.5.9）：范围覆盖纯函数的语义边界。
// 这些函数决定「范围提交改什么、不改什么、恢复成什么」，是原子应用的前置事实，
// 因此在纯函数层把非法输入与字段叠加语义钉死，MySQL E2E（15r）再验真实链路。
const {
  expandCalendarRange,
  assertRangeDateTimeScope,
  applyRangeFieldsToDay,
  deriveRestoredDay,
  changedFieldNames,
  originSnapshotOf
} = require("../apps/api/src/modules/rental-core/calendar-range");

let passed = 0;
const ok = (message) => {
  passed += 1;
  console.log(`  PASS  ${message}`);
};

const baseDay = (overrides = {}) => ({
  date: "2044-05-01",
  dayType: "weekend",
  name: "周末",
  pricingMultiplier: 1.1,
  closed: false,
  source: "week_rule",
  ...overrides
});

const scope = { kind: "range", batchId: "b1", rangeStart: "2044-05-01", rangeEnd: "2044-05-10" };
const meta = { reason: "测试覆盖", operator: "张三", at: "2044-01-01T00:00:00.000Z" };

/* ---------- expandCalendarRange ---------- */

assert.deepEqual(expandCalendarRange(2044, "2044-05-01", "2044-05-03"), ["2044-05-01", "2044-05-02", "2044-05-03"]);
ok("范围展开：含端点逐日展开");
assert.deepEqual(expandCalendarRange(2044, "2044-05-01", "2044-05-01"), ["2044-05-01"]);
ok("范围展开：单日范围退化为一天");

const crossYear = (() => { try { expandCalendarRange(2044, "2044-12-31", "2045-01-01"); return null; } catch (caught) { return caught; } })();
assert.ok(crossYear && crossYear.code === "range_cross_year");
assert.match(crossYear.message, /跨年度/);
ok("范围展开：跨年度请求被拒绝（400 语义，提示按年度拆分）");

for (const [start, end, label] of [
  ["2044-02-30", "2044-03-01", "静默滚动的日期（2026-02-30）"],
  ["2044-05-01T00:00:00Z", "2044-05-02", "带时间的日期键"],
  ["2044/05/01", "2044/05/02", "非标准分隔符"]
]) {
  const error = (() => { try { expandCalendarRange(2044, start, end); return null; } catch (caught) { return caught; } })();
  assert.ok(error && error.code === "range_invalid_date", label);
}
ok("范围展开：无效日期键（滚动日/带时间/分隔符）一律拒绝");

const reversed = (() => { try { expandCalendarRange(2044, "2044-05-10", "2044-05-01"); return null; } catch (caught) { return caught; } })();
assert.ok(reversed && reversed.code === "range_order");
ok("范围展开：结束早于开始被拒绝");

const wrongYear = (() => { try { expandCalendarRange(2044, "2045-01-01", "2045-01-31"); return null; } catch (caught) { return caught; } })();
assert.ok(wrongYear && wrongYear.code === "range_cross_year");
ok("范围展开：与年度参数不一致的范围被拒绝");

/* ---------- assertRangeDateTimeScope ---------- */

assertRangeDateTimeScope("2044-05-01", "2044-05-03", "2044-05-01T02:00:00.000Z", "2044-05-03T10:00:00.000Z");
ok("日期时间范围：合法时点通过");

for (const [start, end, label] of [
  ["2044-05-02T00:00:00.000Z", "2044-05-03T10:00:00.000Z", "起时点不在起始日"],
  ["2044-05-01T02:00:00.000Z", "2044-05-04T10:00:00.000Z", "止时点不在结束日"]
]) {
  const error = (() => { try { assertRangeDateTimeScope("2044-05-01", "2044-05-03", start, end); return null; } catch (caught) { return caught; } })();
  assert.ok(error && error.code === "range_datetime_mismatch", label);
}
ok("日期时间范围：时点必须分别落在范围端点日期当天");

const missingPair = (() => {
  try {
    assertRangeDateTimeScope("2044-05-01", "2044-05-03", "2044-05-01T02:00:00.000Z");
    return null;
  } catch (caught) {
    return caught;
  }
})();
assert.ok(missingPair && missingPair.code === "range_datetime_mismatch");
ok("日期时间范围：只给一个时点被拒绝");

assertRangeDateTimeScope("2044-05-01", "2044-05-03");
ok("日期时间范围：纯日期范围不需要时点");

/* ---------- applyRangeFieldsToDay ---------- */

const fullApply = applyRangeFieldsToDay(
  undefined,
  baseDay(),
  { dayType: "tenant_special", name: "特殊周", pricingMultiplier: 1.3, businessStatus: "limited", hours: { windows: [{ start: "09:00", end: "18:00" }] } },
  scope,
  meta
);
assert.equal(fullApply.source, "tenant_override");
assert.equal(fullApply.dayType, "tenant_special");
assert.equal(fullApply.businessStatus, "limited");
assert.equal(fullApply.closed, false, "限时营业不是停业");
assert.equal(fullApply.overrideBy, "张三");
assert.deepEqual(fullApply.overrideScope, scope);
assert.equal(fullApply.overriddenFrom.source, "week_rule");
ok("字段叠加：全新覆盖写入全部所选字段并记录 scope/操作者");

const partialApply = applyRangeFieldsToDay(undefined, baseDay({ pricingMultiplier: 1.5 }), { businessStatus: "closed" }, scope, meta);
assert.equal(partialApply.dayType, "weekend", "未选择的 dayType 保持原值");
assert.equal(partialApply.pricingMultiplier, 1.5, "未选择的系数保持原值");
assert.equal(partialApply.businessStatus, "closed");
assert.equal(partialApply.closed, true, "closed 由 businessStatus 同步");
ok("字段叠加：未选择字段保持原值（需求 4.5.9 的核心语义）");

const stacked = applyRangeFieldsToDay(
  applyRangeFieldsToDay(undefined, baseDay(), { businessStatus: "limited" }, scope, meta),
  baseDay(),
  { businessStatus: "open" },
  { ...scope, batchId: "b2" },
  { ...meta, reason: "第二批" }
);
assert.equal(stacked.businessStatus, "open");
assert.equal(stacked.overrideReason, "第二批");
assert.equal(stacked.overrideScope.batchId, "b2");
assert.equal(stacked.overriddenFrom.source, "week_rule", "反复覆盖沿用最早的非覆盖原值");
ok("字段叠加：在既有覆盖上修改时保留原始来源记录");

/* ---------- deriveRestoredDay ---------- */

const officialOrigin = { dayType: "statutory_holiday", name: "国庆节", pricingMultiplier: 1.25, closed: false, businessStatus: "open", source: "official_cn" };
const restoredOfficial = deriveRestoredDay(baseDay({ overriddenFrom: officialOrigin }), undefined);
assert.equal(restoredOfficial.source, "official_cn");
assert.equal(restoredOfficial.day.dayType, "statutory_holiday");
assert.equal(restoredOfficial.day.name, "国庆节");
ok("移除恢复：有 overriddenFrom 时恢复官方原值");

const restoredTemplate = deriveRestoredDay(baseDay(), baseDay({ date: "2044-05-01", dayType: "weekend", name: "周末", pricingMultiplier: 1.1, closed: false }));
assert.equal(restoredTemplate.source, "week_rule");
assert.equal(restoredTemplate.day.dayType, "weekend");
ok("移除恢复：无原始值时按每周模板现算（不得留空白日）");

const restoredDefault = deriveRestoredDay(baseDay(), undefined);
assert.equal(restoredDefault.day.dayType, "workday");
assert.equal(restoredDefault.day.source, "week_rule");
ok("移除恢复：连模板日都缺失时回落工作日而不是报错");

/* ---------- changedFieldNames / originSnapshotOf ---------- */

assert.deepEqual(
  changedFieldNames(
    { dayType: "weekend", name: "周末", pricingMultiplier: 1.1, closed: false, source: "week_rule" },
    { dayType: "tenant_special", name: "周末", pricingMultiplier: 1.1, closed: false, source: "tenant_override", businessStatus: "limited", hours: { windows: [{ start: "09:00", end: "18:00" }] } }
  ),
  ["dayType", "businessStatus", "hours"]
);
ok("变更字段：只列出真正变化的字段（供预览展示「将替换的字段」）");

assert.deepEqual(changedFieldNames(
  { dayType: "weekend", name: "周末", pricingMultiplier: 1.1, closed: false, source: "week_rule" },
  { dayType: "weekend", name: "周末", pricingMultiplier: 1.1, closed: false, source: "tenant_override" }
), []);
ok("变更字段：值相同的覆盖视为无变化");

assert.equal(originSnapshotOf(baseDay({ source: "official_cn" })).source, "official_cn");
assert.equal(originSnapshotOf(baseDay()).source, "week_rule");
ok("原值快照：来源只允许官方或每周模板（overriddenFrom 类型约束）");

console.log(`\nCalendar range unit tests passed: ${passed} assertion groups.`);
