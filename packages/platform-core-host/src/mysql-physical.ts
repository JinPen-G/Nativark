/** 当前平台物理数据观察；只读取information_schema，不执行迁移或把迁移清单当就绪。
 * 列/键/检查/外键必须与固定数据版本一致，可追加非唯一索引，不接受额外写入约束。 */
import { createHash } from "node:crypto";
import { join, sqltag as sql } from "@prisma/client/runtime/library";
import type { CorePhysicalDataObservation } from "@rental-os/core-contracts";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import { mysqlCheckShape, type MysqlTableShape } from "./mysql-structure";

export async function readMysqlPhysicalData(database: Pick<CoreHostSqlTransaction, "$queryRaw">,
  expected: readonly MysqlTableShape[], version: string): Promise<CorePhysicalDataObservation | undefined> {
  const tableNames = expected.map(table => table.name);
  if (!tableNames.length) throw new Error("物理平台检查必须有实际数据表");
  const [tables, columns, indexes, checks, foreignKeys] = await Promise.all([
    database.$queryRaw<Array<{ tableName: string; engine: string; collation: string }>>(sql`
      SELECT TABLE_NAME AS tableName, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${join(tableNames)}) ORDER BY TABLE_NAME`),
    database.$queryRaw<Array<{ tableName: string; name: string; type: string; nullable: string; collation: string | null; defaultValue: string | null; extra: string }>>(sql`
      SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
        COLLATION_NAME AS collation, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${join(tableNames)}) ORDER BY TABLE_NAME,ORDINAL_POSITION`),
    database.$queryRaw<Array<{ tableName: string; name: string; position: number | bigint; columnName: string; nonUnique: number | bigint; prefix: number | bigint | null }>>(sql`
      SELECT TABLE_NAME AS tableName, INDEX_NAME AS name, SEQ_IN_INDEX AS position, COLUMN_NAME AS columnName,
        NON_UNIQUE AS nonUnique, SUB_PART AS prefix FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${join(tableNames)}) ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`),
    database.$queryRaw<Array<{ tableName: string; name: string; clause: string; enforced: string }>>(sql`
      SELECT t.TABLE_NAME AS tableName,t.CONSTRAINT_NAME AS name,c.CHECK_CLAUSE AS clause,t.ENFORCED AS enforced
      FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c
        ON c.CONSTRAINT_SCHEMA=t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME=t.CONSTRAINT_NAME
      WHERE t.CONSTRAINT_SCHEMA=DATABASE() AND t.TABLE_NAME IN (${join(tableNames)}) AND t.CONSTRAINT_TYPE='CHECK'
      ORDER BY t.TABLE_NAME,t.CONSTRAINT_NAME`),
    database.$queryRaw<Array<{ tableName: string; name: string; position: number | bigint; columnName: string; targetTable: string;
      targetColumn: string; sameSchema: number | bigint; deleteRule: string; updateRule: string }>>(sql`
      SELECT k.TABLE_NAME AS tableName,k.CONSTRAINT_NAME AS name,k.ORDINAL_POSITION AS position,k.COLUMN_NAME AS columnName,
        k.REFERENCED_TABLE_NAME AS targetTable,k.REFERENCED_COLUMN_NAME AS targetColumn,(k.REFERENCED_TABLE_SCHEMA=DATABASE()) AS sameSchema,
        r.DELETE_RULE AS deleteRule,r.UPDATE_RULE AS updateRule FROM information_schema.KEY_COLUMN_USAGE k
      JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME IN (${join(tableNames)}) AND k.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION`)
  ]);
  if (tables.length !== expected.length) return;
  for (const table of expected) {
    const actual = tables.find(row => row.tableName === table.name);
    if (!actual || actual.engine !== "InnoDB" || actual.collation !== table.collation) return;
    const fields = columns.filter(row => row.tableName === table.name);
    if (fields.length !== table.columns.length || fields.some((row, index) => {
      const field = table.columns[index];
      return row.name !== field.name || row.type.toLowerCase() !== field.type || row.nullable !== (field.nullable ? "YES" : "NO")
        || row.collation !== field.collation
        || (row.defaultValue === null ? null : row.defaultValue.toLowerCase()) !== field.defaultValue
        || !["", "DEFAULT_GENERATED"].includes(row.extra.toUpperCase());
    })) return;
    const tableIndexes = indexes.filter(row => row.tableName === table.name);
    for (const index of table.indexes) {
      const rows = tableIndexes.filter(row => row.name === index.name);
      if (rows.length !== index.columns.length || rows.some((row, at) => Number(row.position) !== at + 1
        || row.columnName !== index.columns[at] || Number(row.nonUnique) !== (index.unique ? 0 : 1) || row.prefix !== null)) return;
    }
    if (tableIndexes.some(row => Number(row.nonUnique) === 0 && !table.indexes.some(index => index.name === row.name && index.unique))) return;
    const tableChecks = checks.filter(row => row.tableName === table.name);
    if (tableChecks.length !== table.checks.length || table.checks.some(check => {
      const expectedShape = mysqlCheckShape(check.clause);
      return !expectedShape || !tableChecks.some(row => row.name === check.name && row.enforced === "YES"
        && mysqlCheckShape(row.clause) === expectedShape);
    })) return;
    const keys = foreignKeys.filter(row => row.tableName === table.name);
    if (keys.length !== table.foreignKeys.reduce((count, key) => count + key.columns.length, 0)) return;
    for (const key of table.foreignKeys) {
      const rows = keys.filter(row => row.name === key.name);
      if (rows.length !== key.columns.length || rows.some((row, at) => Number(row.position) !== at + 1
        || row.columnName !== key.columns[at] || row.targetTable !== key.targetTable || row.targetColumn !== key.targetColumns[at]
        || Number(row.sameSchema) !== 1 || row.deleteRule !== key.deleteRule || row.updateRule !== key.updateRule)) return;
    }
  }
  return { version, observedAt: new Date().toISOString(), sha256: createHash("sha256").update(JSON.stringify(
    { tables, columns, indexes, checks, foreignKeys }, (_key, value) => typeof value === "bigint" ? value.toString() : value)).digest("hex") };
}
