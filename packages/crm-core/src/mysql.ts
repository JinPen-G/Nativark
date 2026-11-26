/**
 * CRM 自有 MySQL 持久化。授权先由宿主锁定，再锁设置行；业务、收据与审计同事务。
 * 初始化复用宿主绑定事务，不新建公共身份或修改底座数据模型。
 */
import { createHash } from "node:crypto";
import { empty, join, sqltag as sql } from "@prisma/client/runtime/library";
import type { CorePhysicalDataObservation, CoreRemovalAssessment } from "@rental-os/core-contracts";
import type { CoreHostSqlClient, CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import { CRM_DATA_VERSION, CrmError, CrmIdSchema, CrmPipelineSchema, CrmRevisionSchema, CrmSettingsSchema,
  type CrmPipeline, type CrmSettings } from "./contracts";
import type { CrmAccess, CrmExecution, CrmExecutionRequest, CrmRepository, CrmStoredReceipt } from "./ports";

export type CrmSqlTransaction = CoreHostSqlTransaction;
interface SettingsRow {
  tenantId: string; timeZone: string; defaultCurrency: string; revision: bigint | number; pipelineVersion: bigint | number;
  defaultSourceId: string; sources: unknown;
  createdBy: string; updatedBy: string; createdAt: Date; updatedAt: Date;
}
const settingsColumns = sql`tenant_id AS tenantId, time_zone AS timeZone, default_currency AS defaultCurrency,
  default_source_id AS defaultSourceId, sources,
  revision, pipeline_version AS pipelineVersion, created_by AS createdBy, updated_by AS updatedBy,
  created_at AS createdAt, updated_at AS updatedAt`;
const jsonValue = (value: unknown): unknown => typeof value === "string" ? JSON.parse(value) : value;

export class MysqlCrmRepository implements CrmRepository {
  private readonly tenantId: string;
  constructor(private readonly tx: CrmSqlTransaction, tenantId: string,
    private readonly audit: (receipt: CrmStoredReceipt) => Promise<void>) {
    this.tenantId = CrmIdSchema.parse(tenantId);
  }

  /** 仅串行日常配置写入；首次配置不存在时，由公共绑定事务持有原范围锁。 */
  async lockSettings(): Promise<void> {
    const rows = await this.tx.$queryRaw<Array<{ tenantId: string }>>`
      SELECT tenant_id AS tenantId FROM crm_settings WHERE tenant_id = ${this.tenantId} FOR UPDATE`;
    if (rows.length !== 1 || rows[0].tenantId !== this.tenantId)
      throw new CrmError("not_initialized", "CRM 尚未完成首次设置");
  }

  async settings(): Promise<CrmSettings | undefined> {
    const rows = await this.tx.$queryRaw<SettingsRow[]>(sql`SELECT ${settingsColumns} FROM crm_settings WHERE tenant_id = ${this.tenantId}`);
    if (!rows[0]) return undefined;
    if (rows.length !== 1) throw new Error("CRM 配置读取未返回唯一租户记录");
    const row = rows[0];
    const value = CrmSettingsSchema.parse({ ...row, sources: jsonValue(row.sources), revision: Number(row.revision), pipelineVersion: Number(row.pipelineVersion),
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
    this.own(value);
    return value;
  }

  async pipeline(version: number): Promise<CrmPipeline | undefined> {
    CrmRevisionSchema.parse(version);
    const rows = await this.tx.$queryRaw<Array<{ definition: unknown }>>`
      SELECT definition FROM crm_pipeline_versions WHERE tenant_id = ${this.tenantId} AND version = ${version}`;
    if (!rows[0]) return undefined;
    if (rows.length !== 1) throw new Error("CRM 流程版本读取未返回唯一记录");
    const value = CrmPipelineSchema.parse(jsonValue(rows[0].definition));
    if (value.version !== version) throw new Error("CRM 流程定义与持久化版本不一致");
    return value;
  }

  async initialize(settings: CrmSettings, pipeline: CrmPipeline): Promise<void> {
    const value = CrmSettingsSchema.parse(settings), flow = CrmPipelineSchema.parse(pipeline);
    this.own(value);
    if (value.revision !== 1 || value.pipelineVersion !== 1 || flow.version !== 1)
      throw new CrmError("already_initialized", "首次配置只能创建初始修订和流程版本");
    // 只插入版本，永不 upsert 历史定义。后续插入失败时由外层同一事务回滚全部初始化事实。
    await this.tx.$executeRaw`INSERT INTO crm_pipeline_versions (tenant_id, version, definition)
      VALUES (${this.tenantId}, ${flow.version}, ${JSON.stringify(flow)})`;
    await this.tx.$executeRaw`INSERT INTO crm_settings
      (tenant_id, time_zone, default_currency, default_source_id, sources, revision, pipeline_version, created_by, updated_by, created_at, updated_at)
      VALUES (${this.tenantId}, ${value.timeZone}, ${value.defaultCurrency}, ${value.defaultSourceId}, ${JSON.stringify(value.sources)}, ${value.revision}, ${value.pipelineVersion},
        ${value.createdBy}, ${value.updatedBy}, ${new Date(value.createdAt)}, ${new Date(value.updatedAt)})`;
  }

  async updateSettings(settings: CrmSettings, expectedRevision: number): Promise<void> {
    const value = CrmSettingsSchema.parse(settings);
    this.own(value);
    CrmRevisionSchema.parse(expectedRevision);
    if (value.revision !== expectedRevision + 1)
      throw new CrmError("revision_conflict", "CRM 配置必须按原修订递增");
    const changed = await this.tx.$executeRaw`UPDATE crm_settings SET time_zone = ${value.timeZone},
      default_currency = ${value.defaultCurrency}, revision = ${value.revision}, updated_by = ${value.updatedBy},
      updated_at = ${new Date(value.updatedAt)}
      WHERE tenant_id = ${this.tenantId} AND revision = ${expectedRevision} AND pipeline_version = ${value.pipelineVersion}`;
    if (changed !== 1) throw new CrmError("revision_conflict", "CRM 配置已变化，请重新读取后操作");
  }

  async receipt(operationId: string): Promise<CrmStoredReceipt | undefined> {
    CrmIdSchema.parse(operationId);
    const rows = await this.tx.$queryRaw<Array<{ actorId: string; fingerprint: string; result: unknown }>>`
      SELECT actor_id AS actorId, fingerprint, result FROM crm_setting_operations
      WHERE tenant_id = ${this.tenantId} AND operation_id = ${operationId}`;
    if (!rows[0]) return undefined;
    if (rows.length !== 1) throw new Error("CRM 原操作读取未返回唯一记录");
    const settings = CrmSettingsSchema.parse(jsonValue(rows[0].result));
    this.own(settings);
    return { operationId, actorId: CrmIdSchema.parse(rows[0].actorId), fingerprint: rows[0].fingerprint, settings };
  }

  async saveReceipt(receipt: CrmStoredReceipt): Promise<void> {
    const settings = CrmSettingsSchema.parse(receipt.settings);
    this.own(settings);
    CrmIdSchema.parse(receipt.operationId); CrmIdSchema.parse(receipt.actorId);
    if (!/^[a-f0-9]{64}$(?![\s\S])/.test(receipt.fingerprint)) throw new Error("CRM 原操作指纹不符合合同");
    await this.tx.$executeRaw`INSERT INTO crm_setting_operations (tenant_id, operation_id, actor_id, fingerprint, result)
      VALUES (${this.tenantId}, ${receipt.operationId}, ${receipt.actorId}, ${receipt.fingerprint}, ${JSON.stringify(settings)})`;
    await this.audit({ ...receipt, settings });
  }

  private own(settings: CrmSettings): void {
    if (settings.tenantId !== this.tenantId) throw new CrmError("denied", "CRM 对象不属于当前事务租户");
  }
}

export function createMysqlCrmRepository(tx: CrmSqlTransaction, tenantId: string,
  audit: (receipt: CrmStoredReceipt) => Promise<void>): MysqlCrmRepository {
  return new MysqlCrmRepository(tx, tenantId, audit);
}

export interface MysqlCrmAuthority<Tx extends CrmSqlTransaction> {
  authorize(tx: Tx, request: CrmExecutionRequest): Promise<CrmAccess & { revalidate(): Promise<void> }>;
  /** 原平台审计使用当前事务；失败必须抛出，不能吞掉后提交业务。 */
  audit(tx: Tx, receipt: CrmStoredReceipt): Promise<void>;
}
export function createMysqlCrmExecution<Tx extends CrmSqlTransaction>(client: CoreHostSqlClient<Tx>, authority: MysqlCrmAuthority<Tx>): CrmExecution {
  return { run(request, work) {
    return client.$transaction(async tx => {
      const access = await authority.authorize(tx, request);
      if (access.tenantId !== request.principal.tenantId || access.userId !== request.principal.subjectId)
        throw new CrmError("denied", "CRM 授权与当前事务主体不一致");
      const store = createMysqlCrmRepository(tx, access.tenantId, receipt => authority.audit(tx, receipt));
      if (request.mutation) await store.lockSettings();
      const result = await work(store, access);
      // 行锁不能冻结会话和订阅时间；敏感读取同样在释放正文前复核。
      await access.revalidate();
      return result;
    }, { isolationLevel: "ReadCommitted" });
  } };
}

/** 只接受本版数值范围约束的有限语法，不能通过去括号把不同布尔表达式误判为等价。 */
function numericCheck(clause: string): string | undefined {
  if (clause.length > 2048) return;
  const matches = [...clause.matchAll(/\s+|`(?:version|revision|pipeline_version)`|[a-z_]+|[0-9]+|>=|<=|[()]/gi)];
  if (matches.map(([token]) => token).join("") !== clause) return;
  const tokens = matches.map(([token]) => token.replace(/`/g, "").toLowerCase()).filter(token => !/^\s+$/.test(token));
  type Node = string | Node[];
  let offset = 0, depth = 0;
  const take = (expected: string) => { if (tokens[offset++] !== expected) throw new Error("unsupported check"); };
  const operand = (): Node => {
    if (tokens[offset] === "(") {
      if (++depth > 32) throw new Error("unsupported check");
      take("("); const result = expression(); take(")"); depth--; return result;
    }
    const token = tokens[offset++];
    if (!token || !/^(?:version|revision|pipeline_version|[0-9]+)$/.test(token)) throw new Error("unsupported check");
    return token;
  };
  const comparison = (): Node => {
    const left = operand(), operator = tokens[offset];
    if (operator === "between") {
      take("between"); const lower = operand(); take("and"); const upper = operand();
      return ["and", [">=", left, lower], ["<=", left, upper]];
    }
    if (operator === ">=" || operator === "<=") { offset++; return [operator, left, operand()]; }
    return left;
  };
  const expression = (): Node => {
    let result = comparison();
    while (tokens[offset] === "and") { take("and"); result = ["and", result, comparison()]; }
    return result;
  };
  try { const result = expression(); return offset === tokens.length ? JSON.stringify(result) : undefined; }
  catch { return; }
}

/** 读取真实 MySQL 元数据核定本版结构，零 DDL；迁移账和业务配置就绪仍由各自原入口检查。 */
export async function readCrmPhysicalData(reader: Pick<CrmSqlTransaction, "$queryRaw">,
  clock: () => Date = () => new Date()): Promise<CorePhysicalDataObservation | undefined> {
  const names = ["crm_pipeline_versions", "crm_settings", "crm_setting_operations"];
  const [tables, columns, indexes, checks, foreignKeys] = await Promise.all([
    reader.$queryRaw<Array<{ tableName: string; engine: string; collation: string }>>(sql`
      SELECT TABLE_NAME AS tableName, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${join(names)}) ORDER BY TABLE_NAME`),
    reader.$queryRaw<Array<{ tableName: string; name: string; type: string; nullable: string; collation: string | null; extra: string }>>(sql`
      SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLLATION_NAME AS collation, EXTRA AS extra
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${join(names)}) ORDER BY TABLE_NAME, ORDINAL_POSITION`),
    reader.$queryRaw<Array<{ tableName: string; name: string; position: number | bigint; columnName: string; nonUnique: number | bigint; prefix: number | bigint | null; direction: string }>>(sql`
      SELECT TABLE_NAME AS tableName, INDEX_NAME AS name, SEQ_IN_INDEX AS position, COLUMN_NAME AS columnName,
        NON_UNIQUE AS nonUnique, SUB_PART AS prefix, COLLATION AS direction FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${join(names)}) ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`),
    reader.$queryRaw<Array<{ tableName: string; name: string; enforced: string; clause: string }>>(sql`
      SELECT t.TABLE_NAME AS tableName, t.CONSTRAINT_NAME AS name, t.ENFORCED AS enforced, c.CHECK_CLAUSE AS clause
      FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c
        ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME
      WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME IN (${join(names)}) AND t.CONSTRAINT_TYPE = 'CHECK'
      ORDER BY t.TABLE_NAME, t.CONSTRAINT_NAME`),
    reader.$queryRaw<Array<{ tableName: string; name: string; position: number | bigint; columnName: string; targetTable: string; targetColumn: string; sameSchema: number | bigint; deleteRule: string; updateRule: string }>>(sql`
      SELECT k.TABLE_NAME AS tableName, k.CONSTRAINT_NAME AS name, k.ORDINAL_POSITION AS position, k.COLUMN_NAME AS columnName,
        k.REFERENCED_TABLE_NAME AS targetTable, k.REFERENCED_COLUMN_NAME AS targetColumn,
        (k.REFERENCED_TABLE_SCHEMA = DATABASE()) AS sameSchema, r.DELETE_RULE AS deleteRule, r.UPDATE_RULE AS updateRule
      FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND k.TABLE_NAME IN (${join(names)}) AND k.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`)
  ]);
  if (tables.length !== names.length || names.some(name => !tables.some(table => table.tableName === name))
    || tables.some(table => table.engine !== "InnoDB" || table.collation !== "utf8mb4_bin")) return;
  const expectedColumns: Record<string, Array<[string, string]>> = {
    crm_pipeline_versions: [["tenant_id", "varchar(36)"], ["version", "bigint unsigned"], ["definition", "json"]],
    crm_settings: [["tenant_id", "varchar(36)"], ["time_zone", "varchar(80)"], ["default_currency", "char(3)"], ["default_source_id", "varchar(36)"], ["sources", "json"], ["revision", "bigint unsigned"],
      ["pipeline_version", "bigint unsigned"], ["created_by", "varchar(36)"], ["updated_by", "varchar(36)"], ["created_at", "datetime(3)"], ["updated_at", "datetime(3)"]],
    crm_setting_operations: [["tenant_id", "varchar(36)"], ["operation_id", "varchar(36)"], ["actor_id", "varchar(36)"], ["fingerprint", "char(64)"], ["result", "json"]]
  };
  for (const [table, expected] of Object.entries(expectedColumns)) {
    const actual = columns.filter(column => column.tableName === table);
    if (actual.length !== expected.length || expected.some(([name, type], i) => {
      const column = actual[i];
      return column.name !== name || column.type !== type || column.nullable !== "NO" || column.extra !== ""
        || column.collation !== (/^(?:varchar|char)\(/.test(type) ? "utf8mb4_bin" : null);
    })) return;
  }
  const expectedIndexes: Array<[string, string, string[], number]> = [
    ["crm_pipeline_versions", "PRIMARY", ["tenant_id", "version"], 0],
    ["crm_settings", "PRIMARY", ["tenant_id"], 0],
    ["crm_settings", "crm_settings_pipeline", ["tenant_id", "pipeline_version"], 1],
    ["crm_setting_operations", "PRIMARY", ["tenant_id", "operation_id"], 0]
  ];
  for (const [table, name, expected, nonUnique] of expectedIndexes) {
    const actual = indexes.filter(index => index.tableName === table && index.name === name);
    if (actual.length !== expected.length || actual.some((index, i) => Number(index.position) !== i + 1 || index.columnName !== expected[i]
      || Number(index.nonUnique) !== nonUnique || index.prefix !== null || index.direction !== "A")) return;
  }
  if (indexes.some(index => Number(index.nonUnique) === 0 && !expectedIndexes.some(([table, name]) => index.tableName === table && index.name === name))) return;
  const expectedChecks = [
    ["crm_pipeline_versions", "crm_pipeline_version_valid", "version"],
    ["crm_settings", "crm_settings_revision_valid", "revision"],
    ["crm_settings", "crm_settings_pipeline_valid", "pipeline_version"]
  ];
  if (checks.length !== expectedChecks.length || expectedChecks.some(([table, name, field]) => {
    const check = checks.find(value => value.tableName === table && value.name === name);
    return !check || check.enforced !== "YES"
      || numericCheck(check.clause) !== JSON.stringify(["and", [">=", field, "1"], ["<=", field, "9007199254740991"]]);
  })) return;
  const expectedKeys: Array<[string, string, string[], string, string[]]> = [
    ["crm_settings", "crm_settings_pipeline_fk", ["tenant_id", "pipeline_version"], "crm_pipeline_versions", ["tenant_id", "version"]],
    ["crm_setting_operations", "crm_setting_operations_settings_fk", ["tenant_id"], "crm_settings", ["tenant_id"]]
  ];
  if (foreignKeys.length !== 3 || expectedKeys.some(([table, name, fields, target, targetFields]) => {
    const actual = foreignKeys.filter(key => key.tableName === table && key.name === name);
    return actual.length !== fields.length || actual.some((key, i) => Number(key.position) !== i + 1 || key.columnName !== fields[i]
      || key.targetTable !== target || key.targetColumn !== targetFields[i] || Number(key.sameSchema) !== 1
      || !["RESTRICT", "NO ACTION"].includes(key.deleteRule) || !["RESTRICT", "NO ACTION"].includes(key.updateRule));
  })) return;
  return { version: CRM_DATA_VERSION, observedAt: clock().toISOString(),
    sha256: createHash("sha256").update(JSON.stringify({ tables, columns, indexes, checks, foreignKeys },
      (_key, value) => typeof value === "bigint" ? value.toString() : value)).digest("hex") };
}

/** 停用不清空配置或历史；移除代码必须保留受权的配置、流程版本与原收据读取实现。 */
export async function readCrmRemoval(reader: Pick<CrmSqlTransaction, "$queryRaw">, tenantId?: string): Promise<CoreRemovalAssessment> {
  const tenant = tenantId === undefined ? undefined : CrmIdSchema.parse(tenantId);
  if (!await readCrmPhysicalData(reader)) return { blockers: [{ kind: "unknown", code: "crm_data_unavailable",
    message: "CRM 实际结构未核定，不能证明历史依赖已排空" }] };
  const where = tenant === undefined ? empty : sql`WHERE tenant_id = ${tenant}`;
  const rows = await reader.$queryRaw<Array<{ settings: number | bigint | boolean; pipelines: number | bigint | boolean; receipts: number | bigint | boolean }>>(sql`
    SELECT EXISTS(SELECT 1 FROM crm_settings ${where}) AS settings,
      EXISTS(SELECT 1 FROM crm_pipeline_versions ${where}) AS pipelines,
      EXISTS(SELECT 1 FROM crm_setting_operations ${where}) AS receipts`);
  if (rows.length !== 1 || [rows[0].settings, rows[0].pipelines, rows[0].receipts].some(value => ![true, false, 0, 1, 0n, 1n].includes(value)))
    throw new Error("CRM 移除依赖读取未返回完整存在性证据");
  const flag = (value: number | bigint | boolean) => value === true || value === 1 || value === 1n;
  const blockers: CoreRemovalAssessment["blockers"] = [];
  if (flag(rows[0].settings) || flag(rows[0].pipelines)) blockers.push({ kind: "history", code: "crm_configuration_retained", message: "存在 CRM 配置或历史流程版本，须保留受权读取实现" });
  if (flag(rows[0].receipts)) blockers.push({ kind: "history", code: "crm_receipts_retained", message: "存在 CRM 原操作收据，须保留原结果核对实现" });
  return { blockers };
}
