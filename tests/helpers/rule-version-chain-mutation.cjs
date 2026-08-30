const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CHAIN = "apps/api/src/modules/rental-core/rental-rule-version-chain.ts";
const UNIT = path.join(ROOT, "tests/rental-rule-version-chain.test.cjs");

/** 每个变异都是需求 4.6.1 / 4.6.14 点名禁止的一种做法，专项用例必须把它抓红。 */
const mutations = [
  [CHAIN, UNIT,
   "  const covering = issuedWithEffectiveFrom(versions).filter((row) => timeOf(row.effectiveFrom!) <= at);",
   "  const covering = issuedWithEffectiveFrom(versions);",
   "匹配不再按租期开始时间过滤（把未来版本也算进来）"],
  [CHAIN, UNIT,
   "  if (covering.length === 0) {",
   "  if (false) {",
   "无覆盖时回落而不报错"],
  [CHAIN, UNIT,
   "  if (winners.length > 1) {",
   "  if (false) {",
   "同点多版本不再报错，随机挑一条"],
  [CHAIN, UNIT,
   "  versions.filter((row) => isIssuedRuleVersion(row.status) && !!row.effectiveFrom);",
   "  versions.filter((row) => !!row.effectiveFrom);",
   "作废/草稿版本也参与匹配"],
  [CHAIN, UNIT,
   "  if (mine > nowAt) return \"pending\";",
   "  if (false) return \"pending\";",
   "未来生效版本不再显示为待生效"],
  [CHAIN, UNIT,
   "    (other) => other.id !== row.id && timeOf(other.effectiveFrom!) > mine && timeOf(other.effectiveFrom!) <= nowAt",
   "    (other) => other.id !== row.id && timeOf(other.effectiveFrom!) > mine",
   "待生效的未来版本把当前版本提前挤成已被替代"],
  [CHAIN, UNIT,
   "  if (clash) {",
   "  if (false) {",
   "发布允许与已发布版本撞点"],
  [CHAIN, UNIT,
   "  if (latest && timeOf(latest.effectiveFrom!) > at) {",
   "  if (false) {",
   "发布允许早于已有最新生效时点插队"],
  [CHAIN, UNIT,
   "export function assertRuleVersionEditable(status: RentalRuleVersionStatus, version: string): void {\n  if (status === \"draft\") return;",
   "export function assertRuleVersionEditable(status: RentalRuleVersionStatus, version: string): void {\n  return;",
   "已发布版本可被直接修改"],
  [CHAIN, UNIT,
   "  if (displayStatus === \"superseded\") {",
   "  if (false) {",
   "已被替代的历史版本可被作废"],
  [CHAIN, UNIT,
   "  return (Math.round((highest + 0.1) * 10) / 10).toFixed(1);",
   "  return (Math.round((highest + 0) * 10) / 10).toFixed(1);",
   "版本号不再自增，复用旧号"]
];

let killed = 0;
const survived = [];
for (const [relative, test, from, to, label] of mutations) {
  const file = path.join(ROOT, relative);
  const original = fs.readFileSync(file, "utf8");
  // 单行锚点对 CRLF/LF 不敏感；含 \n 的多行锚点按当前文件换行符归一后再匹配。
  const normalize = (text) => (original.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text);
  const fromN = normalize(from);
  const toN = normalize(to);
  if (!original.includes(fromN)) {
    survived.push(`${label}（变异目标未找到，等于没测）`);
    console.log(`  ! 目标未找到：${label}`);
    continue;
  }
  fs.writeFileSync(file, original.replace(fromN, toN));
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
