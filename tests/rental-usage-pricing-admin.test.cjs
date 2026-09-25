const assert = require("node:assert/strict");
const fs = require("node:fs");

const ts = require("typescript");
const helperPath = require.resolve("../apps/admin/src/features/commercial/pricing-group-initial-rate.ts");
const helperSource = fs.readFileSync(helperPath, "utf8");
const helperJs = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const helperModule = { exports: {} };
new Function("module", "exports", helperJs)(helperModule, helperModule.exports);
const { toPricingGroupRequest } = helperModule.exports;
const page = fs.readFileSync("apps/admin/src/features/commercial/PricingGroupPage.tsx", "utf8");
const locale = fs.readFileSync("apps/admin/src/app/locale.tsx", "utf8");

const timeRequest = toPricingGroupRequest({
  code: "DAY",
  name: "自然日",
  memberItemGroupIds: ["model-a"],
  initialRates: [{
    unit: "calendar_day",
    baseAmount: 100,
    usageMode: "progressive",
    includedUsage: 20,
    excessUsageAmount: 9,
    usagePrecision: 2,
    tiers: [{ minUnits: 1, unitAmount: 3 }]
  }]
});
assert.deepEqual(JSON.parse(JSON.stringify(timeRequest.initialRates)), [{ unit: "calendar_day", baseAmount: 100 }],
  "时间租赁基本价不得携带用量规则字段");

const flatUsage = toPricingGroupRequest({
  code: "METER-FLAT",
  name: "用量计价",
  memberItemGroupIds: ["model-a"],
  initialRates: [{ unit: "usage", baseAmount: 50, includedUsage: 20, usagePrecision: 1, usageMode: "flat", excessUsageAmount: 2 }]
});
assert.deepEqual(JSON.parse(JSON.stringify(flatUsage.initialRates)), [{
  unit: "usage", baseAmount: 50, includedUsage: 20, usagePrecision: 1, excessUsageAmount: 2
}], "统一超额单价模式应保存包含量、精度与单价");

const progressiveUsage = toPricingGroupRequest({
  code: "METER-TIERED",
  name: "阶梯用量计价",
  memberItemGroupIds: ["model-a"],
  initialRates: [{
    unit: "usage", baseAmount: 50, includedUsage: 20, usagePrecision: 2, usageMode: "progressive",
    excessUsageAmount: 999,
    tiers: [{ minUnits: 1, unitAmount: 2 }, { minUnits: 101, unitAmount: 1.5 }],
    maxAmount: 500
  }]
});
assert.deepEqual(JSON.parse(JSON.stringify(progressiveUsage.initialRates)), [{
  unit: "usage", baseAmount: 50, includedUsage: 20, usagePrecision: 2,
  tierMode: "progressive", tiers: [{ minUnits: 1, unitAmount: 2 }, { minUnits: 101, unitAmount: 1.5 }], maxAmount: 500
}], "累进模式应传阶梯和封顶，不得同时传统一超额单价");

assert.match(page, /用量计费规则/u);
assert.match(page, /基础价包含用量/u);
assert.match(page, /用量计量精度/u);
assert.match(page, /超额分段累进/u);
assert.match(page, /单件本次租期封顶/u);

for (const key of ["用量计费规则", "基础价包含用量", "用量计量精度", "超额计费方式", "统一超额单价", "超额分段累进", "单件本次租期封顶（可选）"]) {
  assert.match(locale, new RegExp(`\\"${key}\\"\\s*:`), `英文词典缺少管理端文案：${key}`);
}

console.log("用量计费初始配置专项：字段序列化与后台配置入口全部通过");
