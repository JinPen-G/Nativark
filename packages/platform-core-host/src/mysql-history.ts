/** 原 MySQL 迁移账和物理目录的只读采集。只接受宿主同一事务，不执行DDL、不写迁移账。
 * 保留原收据UUID/状态/时间及日志摘要；结构按原字段采集，不能用表数量替代物理合同。
 */
import { raw } from "@prisma/client/runtime/library";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
export type MysqlHistoryRow = readonly (string | number | null)[];
export interface MysqlHistoryObservation {
  profile: MysqlHistoryRow;
  receipts: readonly MysqlHistoryRow[];
  physical: readonly MysqlHistoryRow[];
}
const queries: readonly string[] = [
  "SELECT JSON_ARRAY('mysql-history-1', VERSION(), @@lower_case_table_names,\n  @@collation_database, @@transaction_isolation, @@foreign_key_checks) AS value ",
  "SELECT JSON_ARRAY('receipt', id, migration_name, checksum,\n  DATE_FORMAT(started_at, '%Y-%m-%dT%H:%i:%s.%f'),\n  DATE_FORMAT(finished_at, '%Y-%m-%dT%H:%i:%s.%f'),\n  DATE_FORMAT(rolled_back_at, '%Y-%m-%dT%H:%i:%s.%f'), applied_steps_count, SHA2(logs, 256)) AS value FROM `_prisma_migrations`",
  "SELECT JSON_ARRAY('table', TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION, ROW_FORMAT, CREATE_OPTIONS) AS value FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
  "SELECT JSON_ARRAY('column', TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE,\n  IS_NULLABLE, COLUMN_DEFAULT, COLLATION_NAME, EXTRA, GENERATION_EXPRESSION) AS value FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()",
  "SELECT JSON_ARRAY('index', TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME,\n  NON_UNIQUE, SUB_PART, COLLATION, INDEX_TYPE, IS_VISIBLE, EXPRESSION) AS value FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()",
  "SELECT JSON_ARRAY('check', t.TABLE_NAME, t.CONSTRAINT_NAME, t.ENFORCED, c.CHECK_CLAUSE) AS value FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c\n  ON BINARY c.CONSTRAINT_SCHEMA = BINARY t.CONSTRAINT_SCHEMA\n  AND BINARY c.CONSTRAINT_NAME = BINARY t.CONSTRAINT_NAME\n  WHERE t.TABLE_SCHEMA = DATABASE() AND t.CONSTRAINT_TYPE = 'CHECK'",
  "SELECT JSON_ARRAY('foreign-key', k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION, k.COLUMN_NAME,\n  BINARY k.REFERENCED_TABLE_SCHEMA = BINARY DATABASE(), k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,\n  k.POSITION_IN_UNIQUE_CONSTRAINT, r.MATCH_OPTION, r.DELETE_RULE, r.UPDATE_RULE) AS value FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r\n  ON BINARY r.CONSTRAINT_SCHEMA = BINARY k.CONSTRAINT_SCHEMA\n  AND BINARY r.TABLE_NAME = BINARY k.TABLE_NAME AND BINARY r.CONSTRAINT_NAME = BINARY k.CONSTRAINT_NAME\n  WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL",
  "SELECT JSON_ARRAY('trigger', TRIGGER_NAME, EVENT_OBJECT_TABLE) AS value FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()",
  "SELECT JSON_ARRAY('routine', ROUTINE_NAME, ROUTINE_TYPE) AS value FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()",
  "SELECT JSON_ARRAY('event', EVENT_NAME, STATUS) AS value FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()"
];
function value(row: { value: unknown }): MysqlHistoryRow {
  const result: unknown = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  if (!Array.isArray(result) || !result.every(item => item === null || typeof item === "string"
    || typeof item === "number" && Number.isFinite(item))) throw new Error("MySQL历史观察包含无效字段");
  return result;
}
export async function readMysqlHistory(database: Pick<CoreHostSqlTransaction, "$queryRaw">): Promise<MysqlHistoryObservation> {
  const read = async (query: string) => (await database.$queryRaw<Array<{ value: unknown }>>(raw(query))).map(value);
  const profile = await read(queries[0]);
  if (profile.length !== 1) throw new Error("MySQL历史观察缺少唯一数据库配置");
  const receipts = await read(queries[1]), physical: MysqlHistoryRow[] = [];
  for (const query of queries.slice(2)) physical.push(...await read(query));
  const after = await read(queries[1]);
  const fingerprint = (rows: readonly MysqlHistoryRow[]) => JSON.stringify(rows.map(row => JSON.stringify(row)).sort());
  if (fingerprint(receipts) !== fingerprint(after)) throw new Error("历史观察期间迁移账已变化");
  return { profile: profile[0], receipts, physical };
}
