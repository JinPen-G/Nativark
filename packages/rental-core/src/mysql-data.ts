/** Rental新库数据计划，从本版不可变SQL观察实际结构与原Prisma账。
 * 只读取包内迁移；不执行DDL，不把旧混合库或迁移清单视为已部署。 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CoreMysqlDataPlan } from "@rental-os/core-host/mysql-deployment";
import { mysqlForeignKeyExtension, mysqlStructureFromMigrations, readMysqlPhysicalData,
  type MysqlForeignKeyExtension } from "@rental-os/platform-core-host";
import { createRentalDataRelease, RENTAL_DATA_MIGRATIONS, RENTAL_DATA_READABLE, RENTAL_DATA_VERSION } from "./data";

export interface RentalMysqlDataPlan extends CoreMysqlDataPlan {
  /** 宿主把所选Core的公共外键交给公共数据计划，两个所有者分别核实际结构。 */
  readonly publicForeignKeys: readonly MysqlForeignKeyExtension[];
}

export function createRentalMysqlDataPlan(): RentalMysqlDataPlan {
  const release = createRentalDataRelease({ version: RENTAL_DATA_VERSION, readable: RENTAL_DATA_READABLE,
    migrations: RENTAL_DATA_MIGRATIONS.map(migration => ({ ...migration,
      bytes: readFileSync(resolve(__dirname, "..", migration.file)) })) });
  const statements = release.migrationSql.join("\n").replace(/^\s*--.*$/gm, "")
    .split(";").map(statement => statement.trim()).filter(Boolean);
  const publicTables = new Set(["auth_sessions", "OperationLog"]);
  const publicForeignKeys: MysqlForeignKeyExtension[] = [], ownStatements: string[] = [];
  for (const statement of statements) {
    const table = /^ALTER TABLE `([^`]+)`/.exec(statement)?.[1];
    if (table && publicTables.has(table)) publicForeignKeys.push(mysqlForeignKeyExtension(statement));
    else ownStatements.push(statement);
  }
  const expected = mysqlStructureFromMigrations([ownStatements.join(";\n") + ";"]);
  return { data: release.data, migrationNames: release.deploymentMigrationNames, publicForeignKeys,
    readPhysical: database => readMysqlPhysicalData(database, expected, release.data.version) };
}
