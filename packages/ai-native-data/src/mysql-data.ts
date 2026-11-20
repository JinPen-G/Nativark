/** 固定 AI 数据贡献的 MySQL 结构计划，供所选宿主沿原迁移账核定可用性。
 * 只解析已校验材料和读取实际结构；不执行回填、迁移或推断旧库已经升级。
 * 原回填保留在完整迁移链中，其执行由同一 _prisma_migrations 收据裁定。 */
import { createHash } from "node:crypto";
import type { CoreMysqlDataPlan } from "@rental-os/core-host/mysql-deployment";
import { mysqlMigrationStatements, mysqlStructureFromMigrations } from "@rental-os/platform-core-host/mysql-structure";
import { readMysqlPhysicalData } from "@rental-os/platform-core-host/mysql-physical";
import { assertAiNativeDataContribution, type AiNativeDataContribution } from "./data";

// 本版唯一数据回填只分类原精确绑定的消费，不能作为结构 DDL 执行或重做。
const CREDIT_BACKFILL = {
  migrationId: "ai-native.20261027200000",
  statementSha256: "aaae5ab28e991689ab9795ba41b42b04b302b980fd24433764ef1ada4eb2839d"
} as const;

/** 材料来自宿主核定的同一安装包，不回读源码目录或另一份迁移。
 * readPhysical 只提供结构证据；宿主必须把本计划登记到原账观察器，
 * 完整 58 项原摘要、顺序和执行状态通过后才能核能力准入。 */
export function createAiNativeMysqlDataPlanFromContribution(contribution: AiNativeDataContribution): CoreMysqlDataPlan {
  assertAiNativeDataContribution(contribution);
  let hasCreditBackfill = false;
  const structureStatements: string[] = [];
  for (const migration of contribution.migrations) {
    for (const statement of mysqlMigrationStatements(migration.sql)) {
      if (/^UPDATE\b/i.test(statement)) {
        if (hasCreditBackfill || migration.id !== CREDIT_BACKFILL.migrationId
          || createHash("sha256").update(statement).digest("hex") !== CREDIT_BACKFILL.statementSha256)
          throw new Error("AI 数据计划包含未核定的回填语句");
        hasCreditBackfill = true;
      } else {
        // 未识别 DDL 或其他 DML 仍由严格结构解析器拒绝，不能静默省略。
        structureStatements.push(statement);
      }
    }
  }
  if (!hasCreditBackfill) throw new Error("AI 数据计划缺少本版原回填材料");
  const expected = mysqlStructureFromMigrations([structureStatements.join(";\n") + ";"]);
  const data = structuredClone(contribution.data), version = data.version;
  return {
    data,
    migrationNames: contribution.migrations.map(migration => migration.name),
    readPhysical: database => readMysqlPhysicalData(database, expected, version)
  };
}
