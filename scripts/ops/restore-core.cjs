"use strict";

/**
 * OPS-01A/01C 共用的恢复内核：备份改写与克隆库校验。
 *
 * 为什么必须只有一份：这两段是数据安全的关键判定——改写不彻底就会把
 * 「验证备份」变成「覆盖源库」，校验放水就会给出一个看起来合格、实际什么都没验的结论。
 * 两处各留一份拷贝时，将来修好一处、另一处照旧漏，而漏的那次才是事故。
 *
 * 本模块只做**纯文本改写**与**基于注入的校验**（SQL 执行器由调用方传入），
 * 因此可以被专项直接断言，不需要真库。
 */

const { OpsTargetError } = require("./dedicated-env.cjs");

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 把 `mysqldump --databases` 产物改写成指向 `targetDatabase`，并拒绝仍指向源库的产物。
 *
 * 改写三处：`CREATE DATABASE`（整条删掉，库由调用方先建好）、`USE`、限定名
 * `` `src`.`table` ``。只改前两处不够——限定名会让单条语句仍然落到源库。
 *
 * 残留检查只看**可执行**语句：mysqldump 的头部与分节注释里也有库名
 * （`-- Current Database: ...`），那些不会被执行，不该因此拒绝一份好备份。
 * 但以 `!` 开头的 MySQL 版本注释是会被执行的，必须保留并一起扫描。
 */
function rewriteBackupForTarget(sqlText, sourceDatabase, targetDatabase) {
  if (!sourceDatabase || !targetDatabase) {
    throw new OpsTargetError("改写备份需要同时给出源库与目标库名");
  }
  if (sourceDatabase === targetDatabase) {
    throw new OpsTargetError("目标库与源库同名，拒绝改写——那是覆盖源库，不是恢复到克隆库");
  }
  const quoted = `\`${sourceDatabase}\``;
  const script = String(sqlText)
    .replace(new RegExp(`CREATE DATABASE[^;]*${escapeRegExp(quoted)}[^;]*;`, "gu"), "")
    .replace(new RegExp(`USE ${escapeRegExp(quoted)};`, "gu"), `USE \`${targetDatabase}\`;`)
    .split(`${quoted}.`).join(`\`${targetDatabase}\`.`);

  const executable = script
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/u.test(line))
    .join("\n")
    .replace(/\/\*(?![!])[\s\S]*?\*\//gu, "");
  const sourceIdentifier = `(?:\`${escapeRegExp(sourceDatabase)}\`|${escapeRegExp(sourceDatabase)})`;
  const dangerous = new RegExp(
    `(?:USE\\s+${sourceIdentifier}(?=\\s|;)|CREATE\\s+DATABASE[^;]*${sourceIdentifier}(?=\\s|;)|${sourceIdentifier}\\s*\\.)`,
    "imu"
  );
  if (dangerous.test(executable)) {
    throw new OpsTargetError("备份脚本中仍有指向源库的可执行语句，拒绝导入以免写回源库");
  }
  return script;
}

/** 抽样清单。表名取自实际 schema（Prisma 未 @@map 的模型是 PascalCase）。 */
const SAMPLE_TABLES = ["Tenant", "business_workspaces", "customer_profiles", "_prisma_migrations"];

/**
 * 比对克隆库与源库：表数量、已应用迁移条数、抽样表行数。
 *
 * `query` 由调用方注入（`(statement) => string`），因此本函数可在无库环境下被断言。
 * `expectSameMigrations` 为假时跳过迁移条数比对——升级演练会**故意**让克隆库
 * 比源库多出若干条迁移，那时相等才是异常。
 */
function verifyClone(query, sourceDatabase, targetDatabase, { expectSameMigrations = true } = {}) {
  const countTables = (db) => Number(query(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${db}'`));
  const sourceTables = countTables(sourceDatabase);
  const targetTables = countTables(targetDatabase);
  if (!targetTables) throw new OpsTargetError(`克隆库 ${targetDatabase} 没有任何表，导入未生效`);

  const migrationsOf = (db) => Number(query(`SELECT COUNT(*) FROM \`${db}\`._prisma_migrations WHERE finished_at IS NOT NULL`));
  const sourceMigrations = migrationsOf(sourceDatabase);
  const targetMigrations = migrationsOf(targetDatabase);
  if (expectSameMigrations) {
    if (sourceTables !== targetTables) {
      throw new OpsTargetError(`表数量不一致：源库 ${sourceTables}，克隆库 ${targetTables}`);
    }
    if (sourceMigrations !== targetMigrations) {
      throw new OpsTargetError(`迁移记录不一致：源库 ${sourceMigrations}，克隆库 ${targetMigrations}`);
    }
  }

  const rows = [];
  for (const table of SAMPLE_TABLES) {
    const exists = query(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${targetDatabase}' AND table_name='${table}'`);
    if (Number(exists) === 0) continue;
    const a = Number(query(`SELECT COUNT(*) FROM \`${sourceDatabase}\`.\`${table}\``));
    const b = Number(query(`SELECT COUNT(*) FROM \`${targetDatabase}\`.\`${table}\``));
    if (a !== b) throw new OpsTargetError(`表 ${table} 行数不一致：源库 ${a}，克隆库 ${b}`);
    rows.push(`${table}=${b}`);
  }
  // 一张都没比上就说明抽样清单和真实 schema 脱节了。此时「行数一致」是空话，
  // 让它通过等于给出一个看起来合格、实际什么都没验的结论。
  if (!rows.length) {
    throw new OpsTargetError(`抽样表在克隆库中全部不存在（清单：${SAMPLE_TABLES.join("、")}），无法证明数据已恢复`);
  }
  return { sourceTables, targetTables, sourceMigrations, targetMigrations, sampled: rows };
}

module.exports = { SAMPLE_TABLES, rewriteBackupForTarget, verifyClone };
