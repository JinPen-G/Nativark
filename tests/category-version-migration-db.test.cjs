"use strict";

// CAT-GOV-02: clone the current database READ-ONLY, deploy into a newly
// generated dedicated database, compare business facts, then clean up only
// the database created by this process. Never deploy to the source database.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { isDeepStrictEqual } = require("node:util");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const {
  parseDatabaseUrl, buildDatabaseUrl, buildCloneDatabaseName,
  isOwnedCloneDatabase, quoteSqlString, redact
} = require("../scripts/ops/dedicated-env.cjs");
const { rewriteBackupForTarget } = require("../scripts/ops/restore-core.cjs");
const { runMysql, sql, CONTAINER } = require("../scripts/ops/runtime.cjs");

const root = path.resolve(__dirname, "..");
const envFile = process.env.CAT_GOV_ENV_FILE || path.join(root, ".env");
const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").split(/\r?\n/u)
  .filter((line) => /^[A-Z][A-Z_0-9]*=/u.test(line))
  .map((line) => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at + 1).trim().replace(/^['"]|['"]$/gu, "")];
  }));
const sourceUrl = process.env.CAT_GOV_SOURCE_URL || env.DATABASE_URL;
const source = parseDatabaseUrl(sourceUrl);
const rootPassword = process.env.OPS_ADMIN_PASSWORD || env.OPS_ADMIN_PASSWORD || env.MYSQL_ROOT_PASSWORD;
if (!rootPassword) throw new Error("缺少专用库管理凭据");
if (!["localhost", "127.0.0.1"].includes(source.host) || source.port !== 3306) {
  throw new Error("只允许读取本机 MySQL 来源；拒绝远程或不匹配的 Docker 端点");
}
if (source.database !== "rental_os") {
  throw new Error("未确认的共享来源库名，拒绝复制");
}
const admin = { ...source, user: "root", password: rootPassword };
const clone = buildCloneDatabaseName("rental_os_e2e_catgov", "drill");
if (!isOwnedCloneDatabase(clone) || clone === source.database) throw new Error("专用库命名校验失败");
const account = `${quoteSqlString(source.user)}@'%'`;
let created = false;
let granted = false;

function checkMysql(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label}失败：${redact(String(result.stderr || result.stdout || "未知错误"), [source.password, rootPassword])}`);
  }
  return result;
}
function counts(target, database) {
  return Object.fromEntries([
    "Tenant", "business_workspaces", "rental_orders", "rental_quotes", "customer_profiles"
  ].map((table) => [table, Number(sql(target, `SELECT COUNT(*) FROM \`${database}\`.\`${table}\``))]));
}

try {
  if (sql(admin, `SHOW DATABASES LIKE '${clone}'`)) throw new Error("专用库已存在，拒绝覆盖");
  sql(admin, `CREATE DATABASE \`${clone}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  created = true;
  sql(admin, `GRANT ALL PRIVILEGES ON \`${clone}\`.* TO ${account}`);
  granted = true;
  const dump = checkMysql(runMysql("mysqldump", source, [
    "--single-transaction", "--skip-lock-tables", "--no-tablespaces",
    "--set-gtid-purged=OFF", source.database
  ], { capture: true }), "只读备份").stdout;
  if (!dump || !dump.length) throw new Error("来源备份为空");
  const script = rewriteBackupForTarget(dump.toString("utf8"), source.database, clone);
  checkMysql(runMysql("mysql", admin, [clone], { input: script }), "导入专用库");

  const before = counts(admin, clone);
  const sourceCounts = counts(admin, source.database);
  if (JSON.stringify(before) !== JSON.stringify(sourceCounts)) throw new Error("克隆业务行数与来源不一致");
  const categoryNameDigest = (database) => sql(admin,
    `SELECT GROUP_CONCAT(CONCAT(\`code\`,':',HEX(\`name\`)) ORDER BY \`code\` SEPARATOR '|') FROM \`${database}\`.\`rental_category_definitions\``);
  if (categoryNameDigest(source.database) !== categoryNameDigest(clone)) {
    throw new Error("克隆品类名称与来源库字节不一致，不能用克隆结果判断来源差异");
  }
  const beforeMigrations = Number(sql(admin, `SELECT COUNT(*) FROM \`${clone}\`.\`_prisma_migrations\``));
  const url = buildDatabaseUrl(sourceUrl, { user: source.user, password: source.password, database: clone });
  const cli = path.join(root, "node_modules", "prisma", "build", "index.js");
  const prismaEnv = { ...process.env, DATABASE_URL: url };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const deploy = spawnSync(process.execPath, [cli, "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"], {
      cwd: root, encoding: "utf8", env: prismaEnv, maxBuffer: 16 * 1024 * 1024
    });
    checkMysql(deploy, `第 ${attempt + 1} 次迁移部署`);
  }
  const drift = spawnSync(process.execPath, [cli, "migrate", "diff",
    "--from-schema-datasource", "apps/api/prisma/schema.prisma",
    "--to-schema-datamodel", "apps/api/prisma/schema.prisma", "--exit-code"
  ], { cwd: root, encoding: "utf8", env: prismaEnv, maxBuffer: 16 * 1024 * 1024 });
  checkMysql(drift, "迁移后结构对齐检查");
  const afterMigrations = Number(sql(admin, `SELECT COUNT(*) FROM \`${clone}\`.\`_prisma_migrations\``));
  if (afterMigrations <= beforeMigrations) throw new Error("没有新增迁移，演练没有覆盖本次版本层");
  const after = counts(admin, clone);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("迁移改变了业务事实行数");
  const categories = Number(sql(admin, `SELECT COUNT(*) FROM \`${clone}\`.\`rental_category_definitions\``));
  const versions = Number(sql(admin, `SELECT COUNT(*) FROM \`${clone}\`.\`rental_category_versions\` WHERE \`status\`='legacy_baseline'`));
  const unbound = Number(sql(admin, `SELECT COUNT(*) FROM \`${clone}\`.\`business_workspaces\` WHERE \`categoryVersionId\` IS NULL`));
  const mismatch = Number(sql(admin, `SELECT COUNT(*) FROM \`${clone}\`.\`business_workspaces\` w JOIN \`${clone}\`.\`rental_category_versions\` v ON w.\`categoryVersionId\`=v.\`id\` WHERE w.\`categoryCode\`<>v.\`categoryCode\``));
  if (categories !== versions || unbound || mismatch) throw new Error("版本回填或空间绑定不一致");
  const definitionRows = sql(admin, `SELECT \`categoryCode\`, HEX(CAST(\`definition\` AS CHAR)) FROM \`${clone}\`.\`rental_category_versions\` WHERE \`status\`='legacy_baseline'`)
    .split(/\r?\n/u).filter(Boolean);
  const definitionDifferences = definitionRows.flatMap((line) => {
    const [code, hex] = line.split("\t");
    const stored = JSON.parse(Buffer.from(hex, "hex").toString("utf8"));
    const fixed = RENTAL_CATEGORY_DEFINITIONS.find((item) => item.code === code);
    if (!fixed) return [{ code, fields: ["missing_static_definition"] }];
    const fields = ["name", "description", "supportedInventoryModes", "defaultCapabilities", "terminology", "attributeSchema", "businessModel", "version"]
      .filter((field) => !isDeepStrictEqual(stored[field], JSON.parse(JSON.stringify(fixed[field]))));
    return fields.length ? [{
      code, fields, storedName: stored.name, runtimeName: fixed.name,
      storedVersion: stored.version, runtimeVersion: fixed.version,
      storedCapabilities: stored.defaultCapabilities,
      runtimeCapabilities: fixed.defaultCapabilities
    }] : [];
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reconcile = spawnSync(process.execPath, ["scripts/ops/reconcile-category-runtime.cjs"], {
      cwd: root, encoding: "utf8", env: prismaEnv, maxBuffer: 16 * 1024 * 1024
    });
    checkMysql(reconcile, `第 ${attempt + 1} 次运行定义核对`);
  }
  const runtimeVersions = Number(sql(admin, `SELECT COUNT(*) FROM \`${clone}\`.\`rental_category_versions\` WHERE \`sourceKind\`='builtin_runtime' AND \`status\`='published'`));
  const runtimeMismatches = Number(sql(admin, `SELECT COUNT(*) FROM \`${clone}\`.\`business_workspaces\` w JOIN \`${clone}\`.\`rental_category_definitions\` c ON w.\`categoryCode\`=c.\`code\` WHERE w.\`categoryVersionId\`<>c.\`recommendedVersionId\``));
  const adoptionAudits = Number(sql(admin, `SELECT COUNT(*) FROM \`${clone}\`.\`rental_category_adoption_audits\``));
  const governanceAudits = Number(sql(admin, `SELECT COUNT(*) FROM \`${clone}\`.\`rental_category_governance_audits\``));
  if (runtimeVersions !== categories || runtimeMismatches ||
      adoptionAudits !== before.business_workspaces * 2 || governanceAudits !== categories * 2) {
    throw new Error("运行定义核对后版本、空间绑定或幂等审计不一致");
  }
  if (JSON.stringify(after) !== JSON.stringify(counts(admin, clone))) throw new Error("运行定义核对改变了经营事实行数");
  const versionDigestSql = `SELECT GROUP_CONCAT(CONCAT(\`id\`,':',SHA2(CAST(\`definition\` AS CHAR),256)) ORDER BY \`id\` SEPARATOR '|') FROM \`${clone}\`.\`rental_category_versions\``;
  const categoryDigestSql = `SELECT GROUP_CONCAT(CONCAT(\`code\`,':',SHA2(CAST(JSON_OBJECT('name',\`name\`,'description',\`description\`,'businessModel',\`businessModel\`) AS CHAR),256)) ORDER BY \`code\` SEPARATOR '|') FROM \`${clone}\`.\`rental_category_definitions\``;
  const versionDigest = sql(admin, versionDigestSql);
  const categoryDigest = sql(admin, categoryDigestSql);
  const seedEnv = { ...prismaEnv,
    E2E_DEMO_PASSWORD: env.E2E_DEMO_PASSWORD,
    E2E_PLATFORM_PASSWORD: env.E2E_PLATFORM_PASSWORD
  };
  if (!seedEnv.E2E_DEMO_PASSWORD || !seedEnv.E2E_PLATFORM_PASSWORD) throw new Error("缺少 Seed 演练凭据");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const seed = spawnSync(process.execPath, [path.join(root, "node_modules", "ts-node", "dist", "bin.js"), "prisma/seed.ts"], {
      cwd: path.join(root, "apps", "api"), encoding: "utf8", env: seedEnv,
      maxBuffer: 16 * 1024 * 1024
    });
    checkMysql(seed, `第 ${attempt + 1} 次 Seed`);
    if (sql(admin, versionDigestSql) !== versionDigest || sql(admin, categoryDigestSql) !== categoryDigest) {
      throw new Error("Seed 覆盖了已存在的品类身份或发布版本正文");
    }
  }
  const uniqueness = spawnSync(process.execPath, ["tests/category-unique-claims-db.cjs"], {
    cwd: root, encoding: "utf8", env: prismaEnv, maxBuffer: 16 * 1024 * 1024
  });
  checkMysql(uniqueness, "型号动态属性并发唯一性");
  console.log(JSON.stringify({
    result: "passed", container: CONTAINER, clone, beforeMigrations, afterMigrations,
    categories, versions, runtimeVersions, runtimeMismatches, adoptionAudits, governanceAudits, unbound,
    businessRows: after, definitionDifferences
  }));
} finally {
  if (created && isOwnedCloneDatabase(clone)) {
    if (granted) sql(admin, `REVOKE ALL PRIVILEGES ON \`${clone}\`.* FROM ${account}`);
    sql(admin, `DROP DATABASE \`${clone}\``);
    console.log(`已清理专用克隆库 ${clone}`);
  }
}
