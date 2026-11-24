/**
 * 工单Core的MySQL私有适配；执行器开启宿主事务，仓储不另开事务或读取默认租户。
 * 授权和人员锁由原宿主先取得，再用本租户Core锁保护原操作、工单和平台审计同事务。
 */
import { createHash } from "node:crypto";
import { empty, join, sqltag as sql, type Sql } from "@prisma/client/runtime/library";
import type { CorePhysicalDataObservation, CoreRemovalAssessment } from "@rental-os/core-contracts";
import { TicketError, TicketIdSchema, TicketSchema, TicketPageSchema, TicketStatusCountsSchema, TICKETS_DATA_VERSION,
  type ListTickets, type Ticket, type TicketPage, type TicketPageQuery, type TicketStatusCounts } from "./contracts";
import type { TicketAccess, TicketExecution, TicketExecutionRequest, TicketRepository, TicketStoredReceipt } from "./service";

interface TicketRow {
  id: string; tenantId: string; subject: string; description: string; createdBy: string;
  assigneeId: string | null; state: Ticket["state"]; revision: bigint | number; createdAt: Date; updatedAt: Date;
}
/** 仅声明实际使用的驱动方法；原Prisma事务对象可直接满足，不依赖组合库生成的行业模型。 */
export interface TicketsSqlTransaction {
  $executeRaw(query: TemplateStringsArray | Sql, ...values: unknown[]): Promise<number>;
  $queryRaw<T>(query: TemplateStringsArray | Sql, ...values: unknown[]): Promise<T>;
}
export interface TicketsSqlClient<TTransaction extends TicketsSqlTransaction> {
  $transaction<T>(work: (tx: TTransaction) => Promise<T>, options: { isolationLevel: "ReadCommitted" }): Promise<T>;
}
const columns = sql`id, tenant_id AS tenantId, subject, description, created_by AS createdBy,
  assignee_id AS assigneeId, state, revision, created_at AS createdAt, updated_at AS updatedAt`;
const ticket = (row: TicketRow): Ticket => TicketSchema.parse({ ...row, revision: Number(row.revision),
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });

class MysqlTicketRepository implements TicketRepository {
  constructor(private readonly tx: TicketsSqlTransaction, private readonly tenantId: string,
    private readonly audit: (receipt: TicketStoredReceipt) => Promise<void>) {}

  /** 仅在原宿主已锁当前授权/人员后调用；租户范围小样例采用一条锁行串行写入。 */
  async lock(): Promise<void> {
    await this.tx.$executeRaw`INSERT INTO example_tickets_tenant_locks (tenant_id) VALUES (${this.tenantId}) ON DUPLICATE KEY UPDATE tenant_id = VALUES(tenant_id)`;
    await this.tx.$queryRaw`SELECT tenant_id FROM example_tickets_tenant_locks WHERE tenant_id = ${this.tenantId} FOR UPDATE`;
  }

  async list(query: ListTickets, viewerId?: string): Promise<Ticket[]> {
    const rows = await this.tx.$queryRaw<TicketRow[]>(sql`SELECT ${columns} FROM example_tickets
      ${this.visibleWhere(query, viewerId)} ORDER BY created_at DESC, id DESC LIMIT ${query.limit} OFFSET ${query.offset}`);
    return rows.map(ticket);
  }

  async page(query: TicketPageQuery, viewerId?: string): Promise<TicketPage> {
    // 一个CTE固定正文和总数的同一范围/语句快照；末页为空仍返回真实total，供页面重读有效页。
    // LOCATE按原列排序规则匹配字面文本，百分号/下划线不作为通配符，值仍由原SQL模板参数化。
    const subject = query.subject ? sql`AND LOCATE(${query.subject}, subject) > 0` : empty;
    const assignment = query.assignment === "assigned" ? sql`AND assignee_id IS NOT NULL`
      : query.assignment === "unassigned" ? sql`AND assignee_id IS NULL` : empty;
    const rows = await this.tx.$queryRaw<Array<(TicketRow | { id: null }) & { total: bigint | number }>>(sql`
      WITH visible_tickets AS (SELECT ${columns} FROM example_tickets ${this.visibleWhere(query, viewerId)} ${subject} ${assignment})
      SELECT page.*, totals.total FROM (SELECT COUNT(*) AS total FROM visible_tickets) totals
      LEFT JOIN (SELECT * FROM visible_tickets ORDER BY createdAt DESC, id DESC LIMIT ${query.limit} OFFSET ${query.offset}) page ON TRUE
      ORDER BY page.createdAt DESC, page.id DESC`);
    if (!rows.length) throw new Error("工单分页查询缺少总数观察");
    return TicketPageSchema.parse({ total: Number(rows[0].total), rows: rows.flatMap(row => {
      if (row.id === null) return [];
      const { total: _total, ...value } = row;
      return [ticket(value)];
    }) });
  }

  async statusCounts(viewerId?: string): Promise<TicketStatusCounts> {
    // COUNT在同一语句快照读取全量可见范围；空集合也返回四个零，不受当前列表筛选/分页影响。
    const rows = await this.tx.$queryRaw<Array<Record<keyof TicketStatusCounts, bigint | number>>>(sql`
      SELECT COUNT(*) AS total,
        COUNT(CASE WHEN state = 'open' THEN 1 END) AS open,
        COUNT(CASE WHEN state = 'in_progress' THEN 1 END) AS in_progress,
        COUNT(CASE WHEN state = 'closed' THEN 1 END) AS closed
      FROM example_tickets ${this.visibleWhere({}, viewerId)}`);
    if (!rows.length) throw new Error("工单状态汇总缺少计数观察");
    const row = rows[0];
    return TicketStatusCountsSchema.parse({
      total: Number(row.total), open: Number(row.open), in_progress: Number(row.in_progress), closed: Number(row.closed)
    });
  }

  private visibleWhere(query: Pick<ListTickets, "state">, viewerId?: string): Sql {
    return sql`WHERE tenant_id = ${this.tenantId}
      ${viewerId === undefined ? empty : sql`AND (created_by = ${viewerId} OR assignee_id = ${viewerId})`}
      ${query.state ? sql`AND state = ${query.state}` : empty}`;
  }

  async find(id: string): Promise<Ticket | undefined> {
    const rows = await this.tx.$queryRaw<TicketRow[]>(sql`SELECT ${columns} FROM example_tickets
      WHERE tenant_id = ${this.tenantId} AND id = ${id}`);
    return rows[0] ? ticket(rows[0]) : undefined;
  }

  async create(value: Ticket): Promise<void> {
    this.own(value);
    await this.tx.$executeRaw`INSERT INTO example_tickets
      (tenant_id, id, subject, description, created_by, assignee_id, state, revision, created_at, updated_at)
      VALUES (${this.tenantId}, ${value.id}, ${value.subject}, ${value.description}, ${value.createdBy}, ${value.assigneeId},
        ${value.state}, ${value.revision}, ${new Date(value.createdAt)}, ${new Date(value.updatedAt)})`;
  }

  async update(value: Ticket, expectedRevision: number): Promise<void> {
    this.own(value);
    const changed = await this.tx.$executeRaw`UPDATE example_tickets SET assignee_id = ${value.assigneeId}, state = ${value.state},
      revision = ${value.revision}, updated_at = ${new Date(value.updatedAt)}
      WHERE tenant_id = ${this.tenantId} AND id = ${value.id} AND revision = ${expectedRevision}`;
    if (changed !== 1) throw new TicketError("revision_conflict", "工单已变化，请重新读取后操作");
  }

  async receipt(operationId: string): Promise<TicketStoredReceipt | undefined> {
    const rows = await this.tx.$queryRaw<Array<{ actorId: string; fingerprint: string; result: unknown }>>`
      SELECT actor_id AS actorId, fingerprint, result FROM example_ticket_operations
      WHERE tenant_id = ${this.tenantId} AND operation_id = ${operationId}`;
    if (!rows[0]) return undefined;
    const value = TicketSchema.parse(rows[0].result);
    this.own(value);
    return { operationId, actorId: rows[0].actorId, fingerprint: rows[0].fingerprint, ticket: value };
  }

  async saveReceipt(value: TicketStoredReceipt): Promise<void> {
    this.own(value.ticket);
    await this.tx.$executeRaw`INSERT INTO example_ticket_operations (tenant_id, operation_id, actor_id, fingerprint, ticket_id, result)
      VALUES (${this.tenantId}, ${value.operationId}, ${value.actorId}, ${value.fingerprint}, ${value.ticket.id}, ${JSON.stringify(value.ticket)})`;
    await this.audit(value);
  }

  private own(value: Ticket): void {
    if (value.tenantId !== this.tenantId) throw new TicketError("denied", "工单对象不属于当前事务租户");
  }
}

export interface MysqlTicketsAuthority<TTransaction extends TicketsSqlTransaction> {
  /** 原Auth适配按固定顺序锁主体、受派成员及Core权限；不得到Core锁之后再补人员锁。 */
  authorize(tx: TTransaction, request: TicketExecutionRequest): Promise<TicketAccess & {
    /** 复核同一原主体/租约的有效期；行锁不能冻结时间，也不授权改用另一主体。 */
    revalidate(): Promise<void>;
  }>;
  /** 通过原平台审计入口使用同一事务；失败向上抛出，不返回空成功。 */
  audit(tx: TTransaction, receipt: TicketStoredReceipt): Promise<void>;
}

/** 私有MySQL入口只将受限工单仓储交给领域服务；未提供真实授权/审计实现时不能装配。 */
export function createMysqlTicketsExecution<TTransaction extends TicketsSqlTransaction>(client: TicketsSqlClient<TTransaction>, authority: MysqlTicketsAuthority<TTransaction>): TicketExecution {
  return {
    run(request, work) {
      return client.$transaction(async tx => {
        const { principal, permission } = request;
        const access = await authority.authorize(tx, request);
        if (access.tenantId !== principal.tenantId || access.userId !== principal.subjectId)
          throw new TicketError("denied", "工单授权与当前事务主体不一致");
        if (request.assigneeId && access.authorizedAssigneeId !== request.assigneeId)
          throw new TicketError("denied", "受派成员尚未通过当前事务授权");
        const store = new MysqlTicketRepository(tx, access.tenantId, receipt => authority.audit(tx, receipt));
        if (permission !== "read" && permission !== "read.all") await store.lock();
        const result = await work(store, access);
        // 人员/授权行锁保留当前修订，提交前另复核会自然流逝的会话/订阅期限。
        await access.revalidate();
        return result;
      }, { isolationLevel: "ReadCommitted" });
    }
  };
}

/** 只解析本版CHECK所需的IN/BETWEEN/比较/AND；括号保留表达式归属，不能把布尔子式当数值。 */
function ticketCheck(clause: string): string | undefined {
  if (clause.length > 4096) return;
  const matches = [...clause.matchAll(/\s+|_utf8mb4(?:'[a-z_]+'|\\'[a-z_]+\\')|'[a-z_]+'|`(?:state|revision)`|[a-z_]+|[0-9]+|>=|<=|[(),]/gi)];
  if (matches.map(token => token[0]).join("") !== clause) return;
  const tokens = matches.map(([token]) => token.includes("'")
    ? token.replace(/^_utf8mb4/i, "").replace(/\\'/g, "'") : token.replace(/`/g, "").toLowerCase()).filter(token => !/^\s+$/.test(token));
  type Node = string | Node[];
  let offset = 0, depth = 0;
  const take = (expected: string) => { if (tokens[offset++] !== expected) throw new Error("unsupported check"); };
  const operand = (): Node => {
    if (tokens[offset] === "(") {
      if (++depth > 32) throw new Error("unsupported check");
      take("("); const result = expression(); take(")"); depth--; return result;
    }
    const token = tokens[offset++];
    if (!token || !/^(?:state|revision|[0-9]+|'[a-z_]+')$/.test(token)) throw new Error("unsupported check");
    return token;
  };
  const comparison = (): Node => {
    const left = operand(), operator = tokens[offset];
    if (operator === "in") {
      take("in"); take("("); const values = [operand()];
      while (tokens[offset] === ",") { take(","); values.push(operand()); }
      take(")"); return ["in", left, values];
    }
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

/** 读取工单三表的真实列、事务引擎、键和受执行约束；缺项返回未就绪，零DDL/业务数据读写。 */
export async function readTicketsPhysicalData(reader: Pick<TicketsSqlTransaction, "$queryRaw">,
  clock: () => Date = () => new Date()): Promise<CorePhysicalDataObservation | undefined> {
  const tableNames = ["example_tickets_tenant_locks", "example_tickets", "example_ticket_operations"];
  const [tables, columns, indexes, checks, foreignKeys] = await Promise.all([
    reader.$queryRaw<Array<{ tableName: string; engine: string; collation: string }>>(sql`
      SELECT TABLE_NAME AS tableName, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${join(tableNames)}) ORDER BY TABLE_NAME`),
    reader.$queryRaw<Array<{ tableName: string; name: string; type: string; nullable: string; collation: string | null; extra: string }>>(sql`
      SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLLATION_NAME AS collation, EXTRA AS extra
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${join(tableNames)})
      ORDER BY TABLE_NAME, ORDINAL_POSITION`),
    reader.$queryRaw<Array<{ tableName: string; name: string; position: number | bigint; columnName: string; nonUnique: number | bigint; prefix: number | bigint | null; direction: string }>>(sql`
      SELECT TABLE_NAME AS tableName, INDEX_NAME AS name, SEQ_IN_INDEX AS position, COLUMN_NAME AS columnName,
        NON_UNIQUE AS nonUnique, SUB_PART AS prefix, COLLATION AS direction FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${join(tableNames)}) ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`),
    reader.$queryRaw<Array<{ tableName: string; name: string; enforced: string; clause: string }>>(sql`
      SELECT t.TABLE_NAME AS tableName, t.CONSTRAINT_NAME AS name, t.ENFORCED AS enforced, c.CHECK_CLAUSE AS clause
      FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c
        ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME
      WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME IN (${join(tableNames)}) AND t.CONSTRAINT_TYPE = 'CHECK'
      ORDER BY t.TABLE_NAME, t.CONSTRAINT_NAME`),
    reader.$queryRaw<Array<{ tableName: string; name: string; position: number | bigint; columnName: string; targetTable: string; targetColumn: string; sameSchema: number | bigint; deleteRule: string; updateRule: string }>>(sql`
      SELECT k.TABLE_NAME AS tableName, k.CONSTRAINT_NAME AS name, k.ORDINAL_POSITION AS position, k.COLUMN_NAME AS columnName,
        k.REFERENCED_TABLE_NAME AS targetTable, k.REFERENCED_COLUMN_NAME AS targetColumn,
        (k.REFERENCED_TABLE_SCHEMA = DATABASE()) AS sameSchema, r.DELETE_RULE AS deleteRule, r.UPDATE_RULE AS updateRule
      FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND k.TABLE_NAME IN (${join(tableNames)}) AND k.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`)
  ]);
  if (tables.length !== tableNames.length || tableNames.some(name => !tables.some(table => table.tableName === name))
    || tables.some(table => table.engine !== "InnoDB" || table.collation !== "utf8mb4_bin")) return;
  const expectedColumns: Record<string, Array<[string, string, boolean?]>> = {
    example_tickets_tenant_locks: [["tenant_id", "varchar(36)"]],
    example_tickets: [["tenant_id", "varchar(36)"], ["id", "varchar(36)"], ["subject", "varchar(160)"], ["description", "text"],
      ["created_by", "varchar(36)"], ["assignee_id", "varchar(36)", true], ["state", "varchar(20)"], ["revision", "bigint unsigned"],
      ["created_at", "datetime(3)"], ["updated_at", "datetime(3)"]],
    example_ticket_operations: [["tenant_id", "varchar(36)"], ["operation_id", "varchar(36)"], ["actor_id", "varchar(36)"],
      ["fingerprint", "char(64)"], ["ticket_id", "varchar(36)"], ["result", "json"]]
  };
  for (const [table, expected] of Object.entries(expectedColumns)) {
    const actual = columns.filter(column => column.tableName === table);
    if (actual.length !== expected.length || expected.some(([name, type, nullable], index) => {
      const column = actual[index], text = /^(?:varchar|char)\(|^text$/.test(type);
      return column.name !== name || column.type !== type || column.nullable !== (nullable ? "YES" : "NO") || column.extra !== ""
        || column.collation !== (text ? "utf8mb4_bin" : null);
    })) return;
  }
  const expectedIndexes: Array<[string, string, string[], number]> = [
    ["example_tickets_tenant_locks", "PRIMARY", ["tenant_id"], 0],
    ["example_tickets", "PRIMARY", ["tenant_id", "id"], 0],
    ["example_tickets", "example_tickets_creator", ["tenant_id", "created_by", "created_at", "id"], 1],
    ["example_tickets", "example_tickets_assignee", ["tenant_id", "assignee_id", "created_at", "id"], 1],
    ["example_tickets", "example_tickets_state", ["tenant_id", "state", "created_at", "id"], 1],
    ["example_ticket_operations", "PRIMARY", ["tenant_id", "operation_id"], 0],
    ["example_ticket_operations", "example_ticket_operations_object", ["tenant_id", "ticket_id"], 1]
  ];
  for (const [table, name, expected, nonUnique] of expectedIndexes) {
    const actual = indexes.filter(index => index.tableName === table && index.name === name);
    if (actual.length !== expected.length || actual.some((index, position) => Number(index.position) !== position + 1
      || index.columnName !== expected[position] || Number(index.nonUnique) !== nonUnique || index.prefix !== null || index.direction !== "A")) return;
  }
  // 可加非唯一索引调优；额外唯一约束会改变本版允许的业务写入，须按数据版本处理。
  if (indexes.some(index => Number(index.nonUnique) === 0 && !expectedIndexes.some(([table, name]) => index.tableName === table && index.name === name))) return;
  if (checks.length !== 2 || checks.some(check => check.tableName !== "example_tickets" || check.enforced !== "YES")) return;
  const state = checks.find(check => check.name === "example_tickets_state_valid"), revision = checks.find(check => check.name === "example_tickets_revision_valid");
  if (!state || !revision || ticketCheck(state.clause) !== JSON.stringify(["in", "state", ["'open'", "'in_progress'", "'closed'"]])
    || ticketCheck(revision.clause) !== JSON.stringify(["and", [">=", "revision", "1"], ["<=", "revision", "9007199254740991"]])) return;
  if (foreignKeys.length !== 2 || foreignKeys.some((key, index) => key.tableName !== "example_ticket_operations"
    || key.name !== "example_ticket_operations_ticket" || Number(key.position) !== index + 1
    || key.columnName !== ["tenant_id", "ticket_id"][index] || key.targetTable !== "example_tickets"
    || key.targetColumn !== ["tenant_id", "id"][index] || Number(key.sameSchema) !== 1
    || !["RESTRICT", "NO ACTION"].includes(key.deleteRule) || !["RESTRICT", "NO ACTION"].includes(key.updateRule))) return;
  return { version: TICKETS_DATA_VERSION, observedAt: clock().toISOString(),
    // MySQL元数据整型可能由Prisma返回bigint；摘要编码保留原整数而不经有损浮点转换。
    sha256: createHash("sha256").update(JSON.stringify({ tables, columns, indexes, checks, foreignKeys },
      (_key, value) => typeof value === "bigint" ? value.toString() : value)).digest("hex") };
}

/** 部署移除读取全Core，可选租户仅限定依赖观察；停用不要求历史排空，也不删除数据。 */
export async function readTicketsRemoval(reader: Pick<TicketsSqlTransaction, "$queryRaw">,
  tenantId?: string): Promise<CoreRemovalAssessment> {
  const tenant = tenantId === undefined ? undefined : TicketIdSchema.parse(tenantId);
  if (!await readTicketsPhysicalData(reader)) return { blockers: [{ kind: "unknown", code: "tickets_data_unavailable",
    message: "工单实际数据结构未核定，不能证明业务和历史依赖已排空" }] };
  const where = tenant === undefined ? empty : sql`WHERE tenant_id = ${tenant}`;
  const scope = tenant === undefined ? empty : sql`AND tenant_id = ${tenant}`;
  const rows = await reader.$queryRaw<Array<{ unfinished: number | bigint | boolean; history: number | bigint | boolean; receipts: number | bigint | boolean }>>(sql`
    SELECT EXISTS(SELECT 1 FROM example_tickets WHERE state <> 'closed' ${scope}) AS unfinished,
      EXISTS(SELECT 1 FROM example_tickets ${where}) AS history,
      EXISTS(SELECT 1 FROM example_ticket_operations ${where}) AS receipts`);
  const flag = (value: number | bigint | boolean) => value === true || value === 1 || value === 1n;
  if (rows.length !== 1 || [rows[0].unfinished, rows[0].history, rows[0].receipts].some(value => ![true, false, 0, 1, 0n, 1n].includes(value)))
    throw new Error("工单移除依赖读取未返回完整存在性证据");
  const blockers: CoreRemovalAssessment["blockers"] = [];
  if (flag(rows[0].unfinished)) blockers.push({ kind: "in_flight", code: "tickets_unfinished", message: "存在未关闭工单，须保留其原业务处理者" });
  if (flag(rows[0].history)) blockers.push({ kind: "history", code: "tickets_history_retained", message: "存在历史工单，须保留受权历史读取实现" });
  if (flag(rows[0].receipts)) blockers.push({ kind: "history", code: "tickets_receipts_retained", message: "存在工单原操作收据，须保留原结果核对实现" });
  return { blockers };
}
