/**
 * 客户模型写入口归属检查。
 *
 * 为什么需要它：`customerProfile / customerAccount / customerMembership / customerMembershipReview / customerCorporateProfile`
 * 客户模型曾同时被多个文件直接 create / update / upsert，每处都各自复制一遍脱敏、
 * 状态与幂等规则——同一条不变量（会员状态不能被注册重试改写、证件号只存掩码）
 * 要在多处各守一次，漏一处就是静默偏差。现在写入口只有
 * `apps/api/src/modules/platform/shared-customer.repository.ts` 一个；其余文件只能经它的方法写。
 *
 * 本脚本静态扫描 apps/api/src 下所有 .ts，匹配
 * `.<model>.(create|update|upsert|delete|createMany|updateMany|deleteMany)(`，
 * 任何出现在仓储之外的写调用都让脚本失败。读取（findFirst、findMany、count 等）不受限。
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_ROOT = path.join(ROOT, "apps", "api", "src");
const OWNER = path.join(ROOT, "apps", "api", "src", "modules", "platform", "shared-customer.repository.ts");

const MODELS = ["customerProfile", "customerAccount", "customerMembership", "customerMembershipReview", "customerCorporateProfile"];
const WRITES = ["create", "update", "upsert", "delete", "createMany", "updateMany", "deleteMany"];
const WRITE_PATTERN = new RegExp(`\\.(${MODELS.join("|")})\\.(${WRITES.join("|")})\\(`, "gu");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && full.endsWith(".ts") && !full.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const violations = [];
let ownerWrites = 0;
let scanned = 0;

for (const file of walk(SCAN_ROOT)) {
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
  console.error("[customer-write-ownership] 以下客户模型写调用不在 shared-customer.repository.ts 内：");
  for (const item of violations) {
    console.error(`  ${item.file}:${item.line}  ${item.call}`);
  }
  console.error("请改为调用 SharedCustomerRepository 的写方法（均接受可选 tx）。");
  process.exit(1);
}

console.log(
  `[customer-write-ownership] 扫描 ${scanned} 个文件，${MODELS.length} 个客户模型的 ${ownerWrites} 处写调用全部位于 shared-customer.repository.ts。`
);
