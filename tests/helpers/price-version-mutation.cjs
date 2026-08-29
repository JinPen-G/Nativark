const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const TEST = path.join(ROOT, "tests/rental-price-version.test.cjs");
const SERVICE = "apps/api/src/modules/rental-core/rental-business.service.ts";
const FACT = "apps/api/src/modules/rental-core/rental-business-fact.repository.ts";

/** 每个变异都是本轮真实修掉的缺陷，用来证明新用例不是「跟着实现写的绿灯」。 */
const mutations = [
  [SERVICE,
   `        if ((latest?.id ?? null) !== (adjustment.baseVersionId ?? null)) {`,
   `        if (false) {`,
   "到期执行不校验基础版本是否被推进（原缺陷）"],
  [SERVICE,
   "    // 版本创建失败时计划现值已经落库，恰好留下这段注释声称要避免的状态。",
   "    // 版本创建失败时计划现值已经落库，恰好留下这段注释声称要避免的状态。\n    await this.configStore.upsertPricingPlan(result);",
   "计划现值又在事务外先写一次（原缺陷）"],
  [SERVICE,
   `      priceVersionId: "versionId" in spaceVersion ? spaceVersion.versionId : undefined,`,
   "      priceVersionId: undefined,",
   "报价不记录命中的价格版本 id"],
  [FACT,
   "      priceVersionId: quote.priceVersionId ?? null,",
   "      priceVersionId: null,",
   "版本引用不落库（只存在于返回值）"]
];

let killed = 0;
const survivors = [];
for (const [relative, search, replace, label] of mutations) {
  const file = path.join(ROOT, relative);
  const original = fs.readFileSync(file, "utf8");
  if (!original.includes(search)) {
    survivors.push(`${label}（变异目标未找到，等于没测）`);
    console.log(`  ! 目标未找到：${label}`);
    continue;
  }
  fs.writeFileSync(file, original.replace(search, replace));
  try {
    execFileSync(process.execPath, [TEST], { cwd: ROOT, stdio: "pipe" });
    survivors.push(label);
    console.log(`  ✗ 存活：${label}`);
  } catch (error) {
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    const hit = out.split(/\r?\n/).find((line) => /AssertionError|Error:/.test(line)) ?? "";
    killed += 1;
    console.log(`  ✓ 被抓到：${label} → ${hit.slice(0, 100)}`);
  } finally {
    fs.writeFileSync(file, original);
  }
}

console.log(`\n变异结果：${killed}/${mutations.length} 被抓到，存活 ${survivors.length}`);
if (survivors.length) {
  console.log("存活项：");
  for (const item of survivors) console.log(`  - ${item}`);
  process.exit(1);
}
