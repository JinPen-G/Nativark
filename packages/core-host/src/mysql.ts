/**
 * 平台Core管理事实的私有MySQL适配，独立表不导入Rental模型；原身份/审计沿宿主供给。
 * 一次管理操作先锁人员/租户再锁tenant/Core，失败连同回执审计回滚，不自动执行迁移。
 */
import { type Sql } from "@prisma/client/runtime/library";
import { MemberCoreAssignmentSchema, TenantCoreGrantSchema, type MemberCoreAssignment, type TenantCoreGrant } from "@rental-os/core-contracts";
import { CoreAccessError, type CoreAccessReceipt, type CoreAccessRepository, type CoreManagementExecution, type CoreManagementLease, type CoreManagementRequest } from "./access";

export interface CoreHostSqlTransaction {
  $executeRaw(query: TemplateStringsArray | Sql, ...values: unknown[]): Promise<number>;
  $queryRaw<T>(query: TemplateStringsArray | Sql, ...values: unknown[]): Promise<T>;
}
export interface CoreHostSqlClient<Tx extends CoreHostSqlTransaction> {
  $transaction<T>(work: (tx: Tx) => Promise<T>, options: { isolationLevel: "ReadCommitted" }): Promise<T>;
}
export interface MysqlCoreManagementAuthority<Tx extends CoreHostSqlTransaction> {
  authorize(tx: Tx, request: CoreManagementRequest): Promise<CoreManagementLease>;
  audit(tx: Tx, receipt: CoreAccessReceipt): Promise<void>;
}

class MysqlCoreAccessRepository implements CoreAccessRepository {
  constructor(private readonly tx: CoreHostSqlTransaction, private readonly tenantId: string, private readonly coreId: string,
    private readonly audit: (receipt: CoreAccessReceipt) => Promise<void>) {}

  async lock(): Promise<void> {
    await this.tx.$executeRaw`INSERT INTO platform_core_access_locks (tenant_id, core_id) VALUES (${this.tenantId}, ${this.coreId})
      ON DUPLICATE KEY UPDATE core_id = VALUES(core_id)`;
    await this.tx.$queryRaw`SELECT tenant_id FROM platform_core_access_locks WHERE tenant_id = ${this.tenantId} AND core_id = ${this.coreId} FOR UPDATE`;
  }
  async grant(): Promise<TenantCoreGrant | undefined> {
    const rows = await this.tx.$queryRaw<Array<{ state: string; revision: bigint | number; operationId: string }>>`
      SELECT state, revision, operation_id AS operationId FROM platform_tenant_core_grants WHERE tenant_id = ${this.tenantId} AND core_id = ${this.coreId}`;
    return rows[0] ? TenantCoreGrantSchema.parse({ ...rows[0], revision: Number(rows[0].revision), tenantId: this.tenantId, coreId: this.coreId }) : undefined;
  }
  async assignment(userId: string): Promise<MemberCoreAssignment | undefined> {
    const rows = await this.tx.$queryRaw<Array<{ state: string; revision: bigint | number; operationId: string }>>`
      SELECT state, revision, operation_id AS operationId FROM platform_member_core_assignments
      WHERE tenant_id = ${this.tenantId} AND core_id = ${this.coreId} AND user_id = ${userId}`;
    return rows[0] ? MemberCoreAssignmentSchema.parse({ ...rows[0], revision: Number(rows[0].revision), tenantId: this.tenantId, coreId: this.coreId, userId }) : undefined;
  }
  async saveGrant(value: TenantCoreGrant): Promise<void> {
    this.own(value);
    await this.tx.$executeRaw`INSERT INTO platform_tenant_core_grants (tenant_id, core_id, state, revision, operation_id)
      VALUES (${this.tenantId}, ${this.coreId}, ${value.state}, ${value.revision}, ${value.operationId})
      ON DUPLICATE KEY UPDATE state = VALUES(state), revision = VALUES(revision), operation_id = VALUES(operation_id)`;
  }
  async saveAssignment(value: MemberCoreAssignment): Promise<void> {
    this.own(value);
    await this.tx.$executeRaw`INSERT INTO platform_member_core_assignments (tenant_id, core_id, user_id, state, revision, operation_id)
      VALUES (${this.tenantId}, ${this.coreId}, ${value.userId}, ${value.state}, ${value.revision}, ${value.operationId})
      ON DUPLICATE KEY UPDATE state = VALUES(state), revision = VALUES(revision), operation_id = VALUES(operation_id)`;
  }
  async receipt(operationId: string): Promise<CoreAccessReceipt | undefined> {
    const rows = await this.tx.$queryRaw<Array<{ kind: string; actorTenantId: string; actorId: string; fingerprint: string; result: unknown }>>`
      SELECT kind, actor_tenant_id AS actorTenantId, actor_id AS actorId, fingerprint, result FROM platform_core_management_operations
      WHERE tenant_id = ${this.tenantId} AND core_id = ${this.coreId} AND operation_id = ${operationId}`;
    if (!rows[0]) return undefined;
    const row = rows[0], actor = { tenantId: row.actorTenantId, subjectId: row.actorId, audience: "operator" as const };
    const receipt: CoreAccessReceipt = row.kind === "tenant_grant"
      ? { kind: row.kind, actor, fingerprint: row.fingerprint, result: TenantCoreGrantSchema.parse(row.result) }
      : row.kind === "member_assignment"
        ? { kind: row.kind, actor, fingerprint: row.fingerprint, result: MemberCoreAssignmentSchema.parse(row.result) }
        : (() => { throw new CoreAccessError("operation_conflict", "原Core管理操作类型未知"); })();
    this.own(receipt.result);
    if (receipt.result.operationId !== operationId) throw new CoreAccessError("operation_conflict", "原Core管理收据与操作键不符");
    return receipt;
  }
  async saveReceipt(receipt: CoreAccessReceipt): Promise<void> {
    this.own(receipt.result);
    await this.tx.$executeRaw`INSERT INTO platform_core_management_operations
      (tenant_id, core_id, operation_id, kind, actor_tenant_id, actor_id, fingerprint, result)
      VALUES (${this.tenantId}, ${this.coreId}, ${receipt.result.operationId}, ${receipt.kind}, ${receipt.actor.tenantId}, ${receipt.actor.subjectId},
        ${receipt.fingerprint}, ${JSON.stringify(receipt.result)})`;
    await this.audit(receipt);
  }
  private own(value: { tenantId: string; coreId: string }): void {
    if (value.tenantId !== this.tenantId || value.coreId !== this.coreId) throw new CoreAccessError("denied", "授权事实不属于当前租户Core事务");
  }
}

export function createMysqlCoreManagement<Tx extends CoreHostSqlTransaction>(client: CoreHostSqlClient<Tx>, authority: MysqlCoreManagementAuthority<Tx>): CoreManagementExecution {
  return {
    run(request, work) {
      return client.$transaction(async tx => {
        const lease = await authority.authorize(tx, request);
        if (request.actor.audience !== "operator" || lease.tenantId !== request.tenantId
          || lease.actor.tenantId !== request.actor.tenantId || lease.actor.subjectId !== request.actor.subjectId
          || lease.actor.audience !== request.actor.audience || request.kind === "tenant_grant" && !lease.canGrant
          || request.kind === "member_assignment" && (!lease.canAssign || lease.targetMemberId !== request.targetMemberId))
          throw new CoreAccessError("denied", "Core管理权限未通过当前原主体核验");
        const store = new MysqlCoreAccessRepository(tx, request.tenantId, request.coreId, receipt => authority.audit(tx, receipt));
        await store.lock();
        const result = await work(store, lease);
        await lease.revalidate();
        return result;
      }, { isolationLevel: "ReadCommitted" });
    }
  };
}
