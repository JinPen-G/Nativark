/** 本 Core 的参数化 SQL 与原操作仓储；原身份锁先于租户写锁，审计与业务同事务。 */
import { empty, sqltag as sql, type Sql } from "@prisma/client/runtime/library";
import type { CoreRemovalAssessment } from "@rental-os/core-contracts";
import { IdSchema, ItemError, ItemSchema, type Item, type ListQuery } from "./contracts";
import type { ItemAccess, ItemExecution, ExecutionRequest, ItemRepository, StoredReceipt } from "./service";
import { readPhysicalData } from "./data-plan";

export interface SqlTransaction {
  $executeRaw(query: TemplateStringsArray | Sql, ...values: unknown[]): Promise<number>;
  $queryRaw<T>(query: TemplateStringsArray | Sql, ...values: unknown[]): Promise<T>;
}
export interface SqlClient<Tx extends SqlTransaction> {
  $transaction<T>(work: (tx: Tx) => Promise<T>, options: { isolationLevel: "ReadCommitted" }): Promise<T>;
}
type Row = Omit<Item, "revision" | "createdAt" | "updatedAt"> & { revision: bigint | number; createdAt: Date; updatedAt: Date };
const columns = sql`id, tenant_id AS tenantId, created_by AS createdBy, title, description, state, revision,
  created_at AS createdAt, updated_at AS updatedAt`;
const item = (row: Row): Item => ItemSchema.parse({ ...row, revision: Number(row.revision),
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });

class Repository implements ItemRepository {
  constructor(private readonly tx: SqlTransaction, private readonly tenantId: string, private readonly audit: (receipt: StoredReceipt) => Promise<void>) {}
  async lock() {
    await this.tx.$executeRaw`INSERT INTO {{TABLE_PREFIX}}_locks (tenant_id) VALUES (${this.tenantId}) ON DUPLICATE KEY UPDATE tenant_id = VALUES(tenant_id)`;
    await this.tx.$queryRaw`SELECT tenant_id FROM {{TABLE_PREFIX}}_locks WHERE tenant_id = ${this.tenantId} FOR UPDATE`;
  }
  async page(query: ListQuery, ownerId: string) {
    // 一次语句观察同时返回正文/总数；空末页仍有total，字面搜索不把%/_解释成通配。
    const rows = await this.tx.$queryRaw<Array<(Row | { id: null }) & { total: bigint | number }>>(sql`
      WITH visible_items AS (SELECT ${columns} FROM {{TABLE}} WHERE tenant_id = ${this.tenantId} AND created_by = ${ownerId}
        ${query.title ? sql`AND LOCATE(${query.title}, title) > 0` : empty} ${query.state ? sql`AND state = ${query.state}` : empty})
      SELECT page.*, totals.total FROM (SELECT COUNT(*) AS total FROM visible_items) totals
      LEFT JOIN (SELECT * FROM visible_items ORDER BY createdAt DESC, id DESC LIMIT ${query.limit} OFFSET ${query.offset}) page ON TRUE
      ORDER BY page.createdAt DESC, page.id DESC`);
    if (!rows.length) throw new Error("条目分页缺少总数观察");
    return { total: Number(rows[0].total), rows: rows.flatMap(row => { if (row.id === null) return [];
      const { total: _total, ...value } = row; return [item(value)]; }) };
  }
  async find(id: string) {
    const rows = await this.tx.$queryRaw<Row[]>(sql`SELECT ${columns} FROM {{TABLE}} WHERE tenant_id = ${this.tenantId} AND id = ${id}`);
    return rows[0] ? item(rows[0]) : undefined;
  }
  async create(value: Item) {
    this.own(value);
    await this.tx.$executeRaw`INSERT INTO {{TABLE}} (tenant_id, id, created_by, title, description, state, revision, created_at, updated_at)
      VALUES (${this.tenantId}, ${value.id}, ${value.createdBy}, ${value.title}, ${value.description}, ${value.state}, ${value.revision},
        ${new Date(value.createdAt)}, ${new Date(value.updatedAt)})`;
  }
  async update(value: Item, expectedRevision: number) {
    this.own(value);
    const changed = await this.tx.$executeRaw`UPDATE {{TABLE}} SET title = ${value.title}, description = ${value.description},
      state = ${value.state}, revision = ${value.revision}, updated_at = ${new Date(value.updatedAt)}
      WHERE tenant_id = ${this.tenantId} AND id = ${value.id} AND revision = ${expectedRevision}`;
    if (changed !== 1) throw new ItemError("revision_conflict", "条目已变化，请重新读取后操作");
  }
  async receipt(operationId: string): Promise<StoredReceipt | undefined> {
    const rows = await this.tx.$queryRaw<Array<{ actorId: string; fingerprint: string; result: unknown }>>`
      SELECT actor_id AS actorId, fingerprint, result FROM {{TABLE_PREFIX}}_operations WHERE tenant_id = ${this.tenantId} AND operation_id = ${operationId}`;
    if (!rows[0]) return undefined;
    const value = ItemSchema.parse(rows[0].result); this.own(value);
    return { operationId, actorId: rows[0].actorId, fingerprint: rows[0].fingerprint, item: value };
  }
  async saveReceipt(value: StoredReceipt) {
    this.own(value.item);
    await this.tx.$executeRaw`INSERT INTO {{TABLE_PREFIX}}_operations (tenant_id, operation_id, actor_id, fingerprint, item_id, result)
      VALUES (${this.tenantId}, ${value.operationId}, ${value.actorId}, ${value.fingerprint}, ${value.item.id}, ${JSON.stringify(value.item)})`;
    await this.audit(value);
  }
  private own(value: Item) { if (value.tenantId !== this.tenantId) throw new ItemError("denied", "条目不属于当前事务租户"); }
}
export interface MysqlAuthority<Tx extends SqlTransaction> {
  authorize(tx: Tx, request: ExecutionRequest): Promise<ItemAccess & { revalidate(): Promise<void> }>;
  audit(tx: Tx, receipt: StoredReceipt): Promise<void>;
}
export function createMysqlExecution<Tx extends SqlTransaction>(database: SqlClient<Tx>, authority: MysqlAuthority<Tx>): ItemExecution {
  return { run: (request, work) => database.$transaction(async tx => {
    const access = await authority.authorize(tx, request);
    if (access.tenantId !== request.principal.tenantId || access.userId !== request.principal.subjectId)
      throw new ItemError("denied", "原身份与事务主体不一致");
    const store = new Repository(tx, access.tenantId, receipt => authority.audit(tx, receipt));
    if (request.permission !== "read") await store.lock();
    const result = await work(store, access); await access.revalidate(); return result;
  }, { isolationLevel: "ReadCommitted" }) };
}

/** 停用保留数据；移除必须读取实际历史/未完成依赖，缺结构证据不能放行。 */
export async function assessRemoval(reader: Pick<SqlTransaction, "$queryRaw">, tenantId?: string): Promise<CoreRemovalAssessment> {
  if (!await readPhysicalData(reader)) return { blockers: [{ kind: "unknown", code: "items_data_unavailable", message: "条目实际结构尚未核定" }] };
  const tenant = tenantId === undefined ? undefined : IdSchema.parse(tenantId);
  const where = tenant === undefined ? empty : sql`WHERE tenant_id = ${tenant}`;
  const scope = tenant === undefined ? empty : sql`AND tenant_id = ${tenant}`;
  const rows = await reader.$queryRaw<Array<{ active: number | bigint; history: number | bigint; receipts: number | bigint }>>(sql`
    SELECT EXISTS(SELECT 1 FROM {{TABLE}} WHERE state = 'active' ${scope}) AS active,
      EXISTS(SELECT 1 FROM {{TABLE}} ${where}) AS history, EXISTS(SELECT 1 FROM {{TABLE_PREFIX}}_operations ${where}) AS receipts`);
  if (rows.length !== 1 || Object.values(rows[0]).some(value => ![0, 1, 0n, 1n].includes(value))) throw new Error("条目移除缺少完整依赖证据");
  const blockers: CoreRemovalAssessment["blockers"] = [];
  if (Number(rows[0].active)) blockers.push({ kind: "in_flight", code: "items_active", message: "仍有未归档条目" });
  if (Number(rows[0].history) || Number(rows[0].receipts)) blockers.push({ kind: "history", code: "items_history", message: "仍有条目或原操作回执，须保留受权读取实现" });
  return { blockers };
}
