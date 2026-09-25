const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });

const source = fs.readFileSync(path.join(__dirname, "../apps/admin/src/features/settings/securityRuleForm.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const exported = {};
new Function("exports", "require", compiled)(exported, require);
const { normalizeSecurityRules } = exported;
const { defaultRentalNoShowRule } = require("../packages/shared/src/rental-rule-defaults.ts");
const { effectiveNoShowRule } = require("../apps/api/src/modules/rental-core/rental-rule-defaults.ts");

const noShowDefault = { enabled: false, pickupGraceMinutes: 0, finalizationMinutes: 60, feeType: "none", feeValue: 0 };
assert.deepEqual(defaultRentalNoShowRule(), noShowDefault, "未配置爽约规则必须默认不自动收费");
assert.deepEqual(effectiveNoShowRule({}), noShowDefault, "服务端缺省必须与管理端共享默认一致");
const ruleSectionsSource = require("node:fs").readFileSync(require("node:path").join(__dirname, "../apps/admin/src/features/settings/governance/ruleSections.tsx"), "utf8");
assert.match(ruleSectionsSource, /noShow:\s*config\.cancellation\?\.noShow\s*\?\?\s*defaultRentalNoShowRule\(\)/u, "旧草稿编辑器必须复用默认值，不得隐式带入 100% 爽约费");
assert.doesNotMatch(ruleSectionsSource, /noShow:\s*config\.cancellation\?\.noShow\s*\?\?\s*\{\s*enabled:\s*true/u, "管理端不得在打开未配置草稿时自动启用爽约处理");

const baseConfig = {
  payment: { timing: "pickup", depositMode: "none", preauthorizationRequired: false, unpaidHoldMinutes: 15 }
};

{
  const result = normalizeSecurityRules({
    ...baseConfig,
    deposit: { mode: "fixed", maxAmount: 800, fixedAmount: 500 },
    preauthorization: { mode: "risk_surcharge", maxAmount: 2000, fixedAmount: 900, riskSurchargeAmount: 200 }
  }, true);
  assert.deepEqual(result.deposit, { mode: "fixed", maxAmount: 800 }, "押金切换模式后不能提交残留 fixedAmount");
  assert.deepEqual(result.preauthorization, { mode: "risk_surcharge", maxAmount: 2000, riskSurchargeAmount: 200 }, "风险附加模式不能提交残留 fixedAmount");
}

{
  const result = normalizeSecurityRules({
    ...baseConfig,
    deposit: { mode: "order_fixed", fixedAmount: 500 },
    preauthorization: { mode: "order_fixed", fixedAmount: 900, riskSurchargeAmount: 200 }
  }, true);
  assert.deepEqual(result.deposit, { mode: "order_fixed", fixedAmount: 500 }, "每单固定押金保留固定金额");
  assert.deepEqual(result.preauthorization, { mode: "order_fixed", fixedAmount: 900 }, "每单固定预授权不带风险附加字段");
}

{
  const result = normalizeSecurityRules({
    ...baseConfig,
    preauthorization: { mode: "risk_surcharge", maxAmount: 1000, riskSurchargeAmount: 50 }
  }, false);
  assert.deepEqual(result.preauthorization, { mode: "none" }, "品类不支持预授权时不提交任何预授权参数");
}

console.log("Rental security-rule form assertions passed.");
