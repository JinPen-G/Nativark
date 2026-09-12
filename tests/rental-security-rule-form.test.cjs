const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../apps/admin/src/features/settings/securityRuleForm.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const exported = {};
new Function("exports", "require", compiled)(exported, require);
const { normalizeSecurityRules } = exported;

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
