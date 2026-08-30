const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CATALOG = "apps/api/src/modules/rental-core/rental-service-catalog.ts";
const SERVICE = "apps/api/src/modules/rental-core/rental-business.service.ts";
const UNIT = path.join(ROOT, "tests/rental-service-catalog.test.cjs");
const QUOTE = path.join(ROOT, "tests/rental-business-v1.test.cjs");

/** 每个变异都是需求 4.4.11 点名禁止的一种做法。 */
const mutations = [
  [CATALOG, UNIT,
   "      return businessDayIndex(new Date(end - 1).toISOString(), timeZone) - businessDayIndex(startAt, timeZone) + 1;",
   "      return Math.max(1, Math.ceil((end - start) / 86_400_000));",
   "每自然日退回按 24 小时折算（原缺陷）"],
  [CATALOG, UNIT,
   "    if (!eligible) {",
   "    if (false) {",
   "不适用的服务静默通过，不再拒绝"],
  [CATALOG, UNIT,
   "    !service.applicableFulfillmentModes.length || service.applicableFulfillmentModes.includes(ctx.fulfillmentMode),",
   "    true,",
   "忽略适用履约方式"],
  [CATALOG, UNIT,
   "    !service.applicableLocationIds.length || ctx.locationIds.some((id) => service.applicableLocationIds.includes(id))",
   "    true",
   "忽略适用履约地点"],
  [CATALOG, UNIT,
   "    if (!Number.isInteger(quantity) || quantity < service.minimumQuantity || quantity > service.maximumQuantity) {",
   "    if (false) {",
   "不校验服务数量范围"],
  [CATALOG, UNIT,
   "    throw new ConflictException(",
   "    if (false) throw new ConflictException(",
   "条件强制服务漏选不再拒绝"],
  [CATALOG, UNIT,
   "      insuranceProviderStatus: service.serviceType === \"insurance\" ? service.insuranceProviderStatus : undefined,",
   "      insuranceProviderStatus: service.insuranceProviderStatus,",
   "损坏免赔也带上保险服务商状态（冒充保险）"],
  [CATALOG, UNIT,
   "    const ruleHit = service.selectionMode === \"mandatory\" ? mandatoryRuleHit(service.mandatoryRule, ctx) : undefined;",
   "    const ruleHit = undefined;",
   "强制服务不再标记业务规则要求"],
  [SERVICE, QUOTE,
   "      serviceSnapshots,",
   "      serviceSnapshots: [],",
   "报价不保存服务快照"]
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
    console.log(`  ✓ 被抓到：${label} → ${hit.slice(0, 90)}`);
  } finally {
    fs.writeFileSync(file, original);
  }
}

console.log(`\n变异结果：${killed}/${mutations.length} 被抓到，存活 ${survived.length}`);
if (survived.length) {
  for (const item of survived) console.log(`  - ${item}`);
  process.exit(1);
}
