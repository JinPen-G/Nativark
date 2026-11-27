/**
 * 客户模型写入口归属检查。
 *
 * 为什么需要它：`customerProfile / customerAccount / customerMembership / customerMembershipReview / customerCorporateProfile`
 * 客户模型曾同时被多个文件直接 create / update / upsert，每处都各自复制一遍脱敏、
 * 状态与幂等规则——同一条不变量（会员状态不能被注册重试改写、证件号只存掩码）
 * 要在多处各守一次，漏一处就是静默偏差。现在写入口只有
 * `packages/rental-core/src/mysql-customer-master.ts` 一个；其余文件只能经它的方法写。
 *
 * 本脚本静态扫描显式选择的宿主及 Rental 源码下所有 .ts，匹配
 * `.<model>.(create|update|upsert|delete|createMany|updateMany|deleteMany)(`，
 * 任何出现在仓储之外的写调用都让脚本失败。读取（findFirst、findMany、count 等）不受限。
 */

const fs = require("node:fs");
const path = require("node:path");

const { checkedPath } = require("./controller-sources.cjs");
let ROOT = path.resolve(__dirname, ".."), owner;
const selectedRoots = [], args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (!args[i + 1]) throw new Error("客户写入检查参数缺少值");
  if (args[i] === "--source-root") ROOT = path.resolve(args[++i]);
  else if (args[i] === "--scan-root") selectedRoots.push(args[++i]);
  else if (args[i] === "--owner") owner = args[++i];
  else throw new Error("只接受 --source-root / --scan-root / --owner");
}
if (!selectedRoots.length || !owner) throw new Error("客户写入检查必须显式选择 --scan-root 和 --owner");
const SCAN_ROOTS = selectedRoots.map(directory => checkedPath(ROOT, directory, "directory"));
const OWNER = checkedPath(ROOT, owner);
if (!SCAN_ROOTS.some(directory => OWNER.startsWith(directory + path.sep))) throw new Error("客户唯一写入口必须在所选扫描范围内");

const MODELS = ["customerProfile", "customerAccount", "customerMembership", "customerMembershipReview", "customerCorporateProfile"];
const WRITES = ["create", "update", "upsert", "delete", "createMany", "updateMany", "deleteMany"];
const WRITE_PATTERN = new RegExp(`\\.(${MODELS.join("|")})\\.(${WRITES.join("|")})\\(`, "gu");

function walk(dir, out = []) {
  checkedPath(ROOT, dir, "directory");
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`客户写入扫描不接受链接：${full}`);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && full.endsWith(".ts") && !full.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const violations = [];
let ownerWrites = 0;
let scanned = 0;

for (const file of SCAN_ROOTS.flatMap(root => walk(root))) {
  scanned += 1;
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/u);
  lines.forEach((line, index) => {
    WRITE_PATTERN.lastIndex = 0;
    let match;
    while ((match = WRITE_PATTERN.exec(line)) !== null) {
      if (path.resolve(file) === OWNER) {
        ownerWrites += 1;
        continue;
      }
      violations.push({
        file: path.relative(ROOT, file).split(path.sep).join("/"),
        line: index + 1,
        call: `${match[1]}.${match[2]}`
      });
    }
  });
}

if (!fs.existsSync(OWNER)) {
  console.error(`[customer-write-ownership] 写入口文件不存在: ${path.relative(ROOT, OWNER)}`);
  process.exit(1);
}

if (violations.length > 0) {
  console.error("[customer-write-ownership] 以下客户模型写调用不在 mysql-customer-master.ts 内：");
  for (const item of violations) {
    console.error(`  ${item.file}:${item.line}  ${item.call}`);
  }
  console.error("请改为调用 SharedCustomerRepository 的写方法（均接受可选 tx）。");
  process.exit(1);
}

console.log(
  `[customer-write-ownership] 扫描 ${scanned} 个文件，${MODELS.length} 个客户模型的 ${ownerWrites} 处写调用全部位于 mysql-customer-master.ts。`
);
