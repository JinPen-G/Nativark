/**
 * 工单Core的MySQL私有适配；执行器开启宿主事务，仓储不另开事务或读取默认租户。
 * 授权和人员锁由原宿主先取得，再用本租户Core锁保护原操作、工单和平台审计同事务。
 */
import { empty, sqltag as sql, type Sql } from "@prisma/client/runtime/library";
import { TicketError, TicketSchema, type ListTickets, type Ticket } from "./contracts";
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
    const scope = viewerId === undefined ? empty : sql`AND (created_by = ${viewerId} OR assignee_id = ${viewerId})`;
    const state = query.state ? sql`AND state = ${query.state}` : empty;
    const rows = await this.tx.$queryRaw<TicketRow[]>(sql`SELECT ${columns} FROM example_tickets
      WHERE tenant_id = ${this.tenantId} ${scope} ${state} ORDER BY created_at DESC, id DESC LIMIT ${query.limit} OFFSET ${query.offset}`);
    return rows.map(ticket);
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
  authorize(tx: TTransaction, request: TicketExecutionRequest): Promise<TicketAccess>;
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
        return work(store, access);
      }, { isolationLevel: "ReadCommitted" });
    }
  };
}
