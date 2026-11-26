/** Public AI physical expectations and the same Prisma migration ledger.
 * The historical billing backfill stays in the migration, never in a read probe. */
import { createHash } from "node:crypto";
import type { CoreMysqlDataPlan } from "@rental-os/core-host/mysql-deployment";
import { extendMysqlPublicForeignKeys, mysqlMigrationStatements, mysqlStructureFromMigrations,
  type MysqlForeignKeyExtension } from "@rental-os/platform-core-host/mysql-structure";
import { readMysqlPhysicalData } from "@rental-os/platform-core-host/mysql-physical";
import { assertPublicAiDataContribution, type PublicAiDataContribution } from "./public-data";

/** Selected Core extensions supply keys derived from their fixed migration bytes. */
export function createPublicAiMysqlDataPlan(contribution: PublicAiDataContribution,
  foreignKeys: readonly MysqlForeignKeyExtension[] = []): CoreMysqlDataPlan {
  assertPublicAiDataContribution(contribution);
  let backfills = 0;
  const structure: string[] = [];
  for (const item of contribution.migrations) for (const statement of mysqlMigrationStatements(item.sql)) {
    if (/^UPDATE\b/i.test(statement)) {
      if (++backfills !== 1 || createHash("sha256").update(statement).digest("hex")
        !== "aaae5ab28e991689ab9795ba41b42b04b302b980fd24433764ef1ada4eb2839d")
        throw new Error("公共 AI 数据计划含未核定回填");
    } else structure.push(statement);
  }
  if (backfills !== 1) throw new Error("公共 AI 数据计划缺少原回填材料");
  const expected = extendMysqlPublicForeignKeys(mysqlStructureFromMigrations([structure.join(";\n") + ";"]), foreignKeys);
  const data = structuredClone(contribution.data);
  return { data, migrationNames: contribution.migrations.map(item => item.name),
    readPhysical: database => readMysqlPhysicalData(database, expected, data.version) };
}
