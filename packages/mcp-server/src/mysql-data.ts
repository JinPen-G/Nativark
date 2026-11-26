/** MCP 的只读 MySQL 结构计划；原 SQL 和账本不由此执行、改写或补造。
 * 宿主须登记此计划到原迁移账观察器，结构通过不等于能力就绪。 */
import type { CorePlatformDataCapabilityRelease } from '@rental-os/core-contracts';
import type { CoreMysqlDataPlan } from '@rental-os/core-host/mysql-deployment';
import { mysqlCheckShape, mysqlMigrationStatements, mysqlStructureFromMigrations } from '@rental-os/platform-core-host/mysql-structure';
import { readMysqlPhysicalData } from '@rental-os/platform-core-host/mysql-physical';
import { readMcpDataPackage } from './data-capability.js';

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/u;
function name(value: string): string {
  if (!identifier.test(value)) throw new Error('MCP 结构材料包含未知标识符');
  return `\`${value}\``;
}
function names(value: string): string {
  return value.split(',').map(part => name(part.trim())).join(', ');
}

/** 原文件的语法只供解析器构造预期，转换结果不作为迁移材料，也不执行。 */
function structureSql(sql: string, tableCollation: string): string {
  return mysqlMigrationStatements(sql).map(statement => {
    if (/^CREATE TABLE\s+/i.test(statement)) {
      const normalized = statement
        .replace(/^CREATE TABLE\s+(\w+)/i, (_match, table: string) => `CREATE TABLE ${name(table)}`)
        .replace(/\)\s*ENGINE\s*=\s*InnoDB$/i, `) DEFAULT CHARACTER SET utf8mb4 COLLATE ${tableCollation}`)
        .replace(/^(\s*)(\w+)\s+(?=(?:VARCHAR|CHAR|JSON|INT|BIGINT|TINYINT|ENUM)\b)/gim,
          (_match, space: string, column: string) => `${space}${name(column)} `)
        .replace(/\bPRIMARY KEY\s*\(([^)]+)\)/gi, (_match, columns: string) => `PRIMARY KEY (${names(columns)})`)
        .replace(/\b(UNIQUE KEY|KEY)\s+(\w+)\s*\(([^)]+)\)/gi,
          (_match, kind: string, index: string, columns: string) => `${kind} ${name(index)} (${names(columns)})`)
        .replace(/\bCONSTRAINT\s+(\w+)/gi, (_match, constraint: string) => `CONSTRAINT ${name(constraint)}`)
        .replace(/\bFOREIGN KEY\s*\(([^)]+)\)\s+REFERENCES\s+(\w+)\s*\(([^)]+)\)/gi,
          (_match, columns: string, target: string, targets: string) => `FOREIGN KEY (${names(columns)}) REFERENCES ${name(target)} (${names(targets)})`);
      return normalized;
    }
    const index = /^CREATE\s+INDEX\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)$/i.exec(statement);
    if (index) return `CREATE INDEX ${name(index[1])} ON ${name(index[2])} (${names(index[3])})`;
    const alter = /^ALTER TABLE\s+(\w+)\s+ADD KEY\s+(\w+)\s*\(([^)]+)\)$/i.exec(statement);
    if (alter) return `ALTER TABLE ${name(alter[1])} ADD KEY ${name(alter[2])} (${names(alter[3])})`;
    throw new Error('MCP 固定材料包含未支持的结构语句');
  }).join(';\n') + ';';
}

/** tableCollation 必须由宿主按实际建表环境核定。旧 Prisma 账名只有在取得原执行证据后才能传入。 */
export function createMcpMysqlDataPlan(input: {
  files: ReadonlyMap<string, Uint8Array>;
  release: CorePlatformDataCapabilityRelease;
  tableCollation: string;
  originalMigrationNames?: readonly string[];
}): CoreMysqlDataPlan {
  if (typeof input.tableCollation !== 'string' || !/^[a-z0-9_]{1,64}$/u.test(input.tableCollation))
    throw new Error('MCP 物理检查缺少已核定的表排序规则');
  const fixed = readMcpDataPackage(input.files, input.release);
  const expected = mysqlStructureFromMigrations(fixed.migrations.map(migration => structureSql(migration.sql, input.tableCollation)));
  if (expected.length !== 30 || expected.some(table => table.checks.some(check => !mysqlCheckShape(check.clause))))
    throw new Error('MCP 结构材料不完整或包含未知检查约束');
  const data = structuredClone(fixed.release.data);
  const migrationNames = input.originalMigrationNames === undefined
    ? data.migrations.map(migration => `platform-capability.${migration.id}`) : [...input.originalMigrationNames];
  if (migrationNames.length !== data.migrations.length || new Set(migrationNames).size !== migrationNames.length
    || migrationNames.some(value => typeof value !== 'string' || !value || value.length > 255 || /[\u0000-\u001f\u007f]/u.test(value)))
    throw new Error('MCP 原迁移名与固定材料未逐项对应');
  return { data, migrationNames, readPhysical: database => readMysqlPhysicalData(database, expected, data.version) };
}
