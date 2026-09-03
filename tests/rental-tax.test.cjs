const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// 价内税：标价即含税，税额由含税额反算，客户看到的应付金额不变。
// 这里钉住两件事：反算公式本身，以及"规则没配税时行为与新增字段之前完全一致"。
const { effectiveTaxRule, inclusiveTaxAmount } = require("../apps/api/src/modules/rental-core/rental-rule-defaults");

let passed = 0;
const ok = (message) => {
  passed += 1;
  console.log(`  PASS  ${message}`);
};

/* ---------- 缺省：不配税就是不计税 ---------- */

assert.deepEqual(effectiveTaxRule({}), { rate: 0, inclusive: true });
ok("规则整组缺省时税率为 0，存量快照的复算结果不变");

assert.equal(inclusiveTaxAmount(1000, 0), 0);
ok("税率 0 时税额为 0（香港等无增值税的空间）");

/* ---------- 反算公式：含税额 × r / (1 + r) ---------- */

assert.equal(inclusiveTaxAmount(300, 0.13), 34.51);
ok("300 元含税、13% → 税额 34.51（300 × 13/113）");

assert.equal(inclusiveTaxAmount(300, 0.06), 16.98);
ok("300 元含税、6% → 税额 16.98（服务类税率）");

assert.equal(inclusiveTaxAmount(1130, 0.13), 130);
ok("1130 元含税、13% → 税额正好 130，不含税额 1000");

// 不含税 + 税额必须能凑回含税额，这是价内税的定义。
const gross = 888.88;
const tax = inclusiveTaxAmount(gross, 0.13);
assert.ok(Math.abs(gross - tax - 786.62) < 0.01);
ok("不含税额 + 税额 = 含税额，误差在分以内");

/* ---------- 边界：非法输入不抛错，返回 0 ---------- */

assert.equal(inclusiveTaxAmount(0, 0.13), 0);
ok("含税额为 0 时税额为 0");

assert.equal(inclusiveTaxAmount(-100, 0.13), 0);
ok("含税额为负（理论上不该出现）时返回 0，不算出负税额");

assert.equal(inclusiveTaxAmount(100, -0.13), 0);
assert.equal(inclusiveTaxAmount(100, Number.NaN), 0);
ok("税率非法时返回 0 而不是抛错——规则整组缺省是合法状态，报价不该因此失败");

/* ---------- 押金不计税：调用方只传租赁应付，这里断言口径不被误用 ---------- */

// 报价：应付 300（含税） + 押金 500，税额只能按 300 算。
assert.equal(inclusiveTaxAmount(300, 0.13), 34.51);
assert.notEqual(inclusiveTaxAmount(800, 0.13), 34.51);
ok("税额只能按租赁应付反算；把押金加进去会算出完全不同的税额");

console.log(`\n价内税专项：${passed} 项全部通过`);
