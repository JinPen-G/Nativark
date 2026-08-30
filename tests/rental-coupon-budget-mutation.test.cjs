const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const cases = [
  {
    name: "移除预算上限条件",
    file: "apps/api/src/modules/rental-core/rental-business-fact.repository.ts",
    from: "lockedBudget + redeemedBudget + ${amount} <= totalBudget",
    to: "1 = 1",
    test: "tests/rental-coupon-budget.test.cjs"
  },
  {
    name: "报价回读当前模板面值",
    file: "apps/api/src/modules/rental-core/rental-business.service.ts",
    from: "customerCoupon.discountValue,\n        customerCoupon.maximumDiscount",
    to: "context.couponTemplates.find((row) => row.id === customerCoupon.templateId)?.discountValue ?? customerCoupon.discountValue,\n        customerCoupon.maximumDiscount",
    test: "tests/rental-business-v1.test.cjs"
  }
];

for (const item of cases) {
  const file = path.join(root, item.file);
  const original = fs.readFileSync(file, "utf8");
  assert.ok(original.includes(item.from), `${item.name}：找不到变异锚点`);
  try {
    fs.writeFileSync(file, original.replace(item.from, item.to));
    const result = spawnSync(process.execPath, [path.join(root, item.test)], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0, `${item.name}：变异存活，专项没有捕获缺陷`);
    console.log(`  ✓ ${item.name} 被专项捕获`);
  } finally {
    fs.writeFileSync(file, original);
  }
}

console.log("MKT-01B mutation test passed: 2/2 mutations killed.");
