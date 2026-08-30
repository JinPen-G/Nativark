const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const SELECTION = "apps/api/src/modules/rental-core/rental-discount-selection.ts";
const SERVICE = "apps/api/src/modules/rental-core/rental-business.service.ts";
const UNIT = path.join(ROOT, "tests/rental-discount-selection.test.cjs");
const QUOTE = path.join(ROOT, "tests/rental-business-v1.test.cjs");

/** 每个变异都是需求 4.4.10 点名禁止的一种做法，用来证明断言不是跟着实现写的绿灯。 */
const mutations = [
  [SELECTION, UNIT,
   "      if (right.candidateAmount !== left.candidateAmount) return right.candidateAmount - left.candidateAmount;",
   "",
   "互斥组改回按优先级择一（原缺陷）"],
  [SELECTION, UNIT,
   "  return left.code.localeCompare(right.code);",
   "  return 0;",
   "同额时不再稳定排序（回到看加载顺序）"],
  [SELECTION, UNIT,
   "  const stackable = orderedWinners.filter((row) => row.plan.stackableWithOtherPlans);",
   "  const stackable = orderedWinners;",
   "忽略叠加开关，任意方案都可叠加"],
  [SELECTION, UNIT,
   "    const base = running[target];",
   "    const base = ctx.bases[target];",
   "叠加时不按运行基数递减（重复按原始金额减免）"],
  [SELECTION, UNIT,
   "  const capped = plan.maximumDiscount === undefined ? raw : Math.min(raw, plan.maximumDiscount);",
   "  const capped = raw;",
   "最高减免封顶失效"],
  [SELECTION, UNIT,
   "  return money(Math.max(0, Math.min(base, capped)));",
   "  return money(Math.max(0, capped));",
   "减免可超过基数（费用项被优惠成负数）"],
  [SELECTION, UNIT,
   "    if (!record(\"threshold\", ctx.minimumSpendBase >= threshold, `优惠前租金 ${ctx.minimumSpendBase} / 满减门槛 ${threshold}`) && !skipReason) {",
   "    if (false) {",
   "满额固定减免不判门槛"],
  [SELECTION, UNIT,
   "    const gross = ctx.bases[plan.appliesTo];",
   "    const gross = ctx.bases.rental;",
   "作用对象一律按租金取基数"],
  [SERVICE, QUOTE,
   "      discountEvaluations: discountSelection.evaluations,",
   "      discountEvaluations: [],",
   "报价不保存逐方案评估"]
];

let killed = 0;
const survived = [];
for (const [relative, test, from, to, label] of mutations) {
  const file = path.join(ROOT, relative);
  const original = fs.readFileSync(file, "utf8");
  if (!original.includes(from)) {
    survived.push(`${label}（变异目标未找到，等于没测）`);
    console.log(`  ! 目标未找到：${label}`);
    continue;
  }
  fs.writeFileSync(file, original.replace(from, to));
  try {
    execFileSync(process.execPath, [test], { cwd: ROOT, stdio: "pipe" });
    survived.push(label);
    console.log(`  ✗ 存活：${label}`);
  } catch (error) {
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    const hit = out.split(/\r?\n/).find((line) => /AssertionError|Error:/.test(line)) ?? "";
    killed += 1;
    console.log(`  ✓ 被抓到：${label} → ${hit.slice(0, 92)}`);
  } finally {
    fs.writeFileSync(file, original);
  }
}

console.log(`\n变异结果：${killed}/${mutations.length} 被抓到，存活 ${survived.length}`);
if (survived.length) {
  for (const item of survived) console.log(`  - ${item}`);
  process.exit(1);
}
