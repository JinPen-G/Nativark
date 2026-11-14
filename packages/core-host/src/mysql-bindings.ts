/**
 * Core绑定的MySQL私有事务适配。原人员锁→租户/Core锁→当前授权→初始化/绑定/收据/审计。
 * 事务句柄按范围与回调寿命校验，业务适配只能在本回调中解析其私有驱动。
 */
import { createHash } from "node:crypto";
import { CoreBindingSchema, CoreOperationReferenceSchema, type CoreBinding, type CoreScopeReference, type CoreTransaction } from "@rental-os/core-contracts";
import { CoreAccessError } from "./access";
import { coreBindingScopeKey, type CoreBindingExecution, type CoreBindingLease,
  type CoreBindingReceipt, type CoreBindingRepository, type CoreBindingRequest } from "./binding";
import type { CoreHostSqlClient, CoreHostSqlTransaction } from "./mysql";

export interface MysqlCoreBindingAuthority<Tx extends CoreHostSqlTransaction> {
  /** 锁原租户/会话/人员/角色，返回将在Core锁下复核当前授权和业务范围的回调。 */
  lockPrincipal(tx: Tx, request: CoreBindingRequest): Promise<() => Promise<CoreBindingLease>>;
  audit(tx: Tx, receipt: CoreBindingReceipt): Promise<void>;
}
export interface MysqlCoreBindingRuntime<Tx extends CoreHostSqlTransaction> {
  execution: CoreBindingExecution;
  /** 仅供宿主私有Core仓储适配，解析时须提供同一已核范围。 */
  resolveTransaction(handle: CoreTransaction, scope: CoreScopeReference): Tx;
}

class MysqlCoreBindingRepository implements CoreBindingRepository {
  private readonly scopeHash: string;
  constructor(private readonly tx: CoreHostSqlTransaction, private readonly scope: CoreScopeReference,
    private readonly audit: (receipt: CoreBindingReceipt) => Promise<void>) {
    this.scopeHash = createHash("sha256").update(coreBindingScopeKey(scope)).digest("hex");
  }

  async lock(initialize: boolean): Promise<void> {
    if (initialize) await this.tx.$executeRaw`INSERT INTO platform_core_access_locks (tenant_id, core_id) VALUES (${this.scope.tenantId}, ${this.scope.coreId})
      ON DUPLICATE KEY UPDATE core_id = VALUES(core_id)`;
    await this.tx.$queryRaw`SELECT tenant_id FROM platform_core_access_locks
      WHERE tenant_id = ${this.scope.tenantId} AND core_id = ${this.scope.coreId} FOR UPDATE`;
  }

  async binding(): Promise<CoreBinding | undefined> {
    const rows = await this.tx.$queryRaw<Array<{ bindingId: string; revision: bigint | number; dataVersion: string;
      containerType: string | null; containerId: string | null }>>`
      SELECT binding_id AS bindingId, revision, data_version AS dataVersion, container_type AS containerType, container_id AS containerId
      FROM platform_core_bindings WHERE tenant_id = ${this.scope.tenantId} AND core_id = ${this.scope.coreId} AND scope_hash = ${this.scopeHash}`;
    if (!rows[0]) return undefined;
    const row = rows[0];
    const binding = CoreBindingSchema.parse({ coreId: this.scope.coreId, tenantId: this.scope.tenantId,
      bindingId: row.bindingId, revision: Number(row.revision), dataVersion: row.dataVersion,
      ...(row.containerType !== null || row.containerId !== null ? { container: { type: row.containerType, id: row.containerId } } : {}) });
    this.own(binding);
    return binding;
  }

  async saveBinding(binding: CoreBinding): Promise<void> {
    this.own(binding);
    await this.tx.$executeRaw`INSERT INTO platform_core_bindings
      (tenant_id, core_id, scope_hash, container_type, container_id, binding_id, revision, data_version)
      VALUES (${binding.tenantId}, ${binding.coreId}, ${this.scopeHash}, ${binding.container?.type ?? null}, ${binding.container?.id ?? null},
        ${binding.bindingId}, ${binding.revision}, ${binding.dataVersion})`;
  }

  async receipt(operationId: string): Promise<CoreBindingReceipt | undefined> {
    const rows = await this.tx.$queryRaw<Array<{ actorId: string; actorTenantId: string; fingerprint: string; operation: unknown; binding: unknown }>>`
      SELECT actor_id AS actorId, actor_tenant_id AS actorTenantId, fingerprint, operation, binding
      FROM platform_core_binding_operations WHERE tenant_id = ${this.scope.tenantId} AND core_id = ${this.scope.coreId}
        AND scope_hash = ${this.scopeHash} AND operation_id = ${operationId}`;
    if (!rows[0]) return undefined;
    const row = rows[0];
    const operation = CoreOperationReferenceSchema.parse(row.operation), binding = CoreBindingSchema.parse(row.binding);
    this.own(operation);
    this.own(binding);
    if (operation.operationId !== operationId) throw new CoreAccessError("operation_conflict", "原绑定收据与操作键不符");
    return { actor: { tenantId: row.actorTenantId, subjectId: row.actorId, audience: "operator" },
      fingerprint: row.fingerprint, operation, binding };
  }

  async saveReceipt(receipt: CoreBindingReceipt): Promise<void> {
    this.own(receipt.operation);
    this.own(receipt.binding);
    await this.tx.$executeRaw`INSERT INTO platform_core_binding_operations
      (tenant_id, core_id, scope_hash, operation_id, actor_tenant_id, actor_id, fingerprint, operation, binding)
      VALUES (${this.scope.tenantId}, ${this.scope.coreId}, ${this.scopeHash}, ${receipt.operation.operationId},
        ${receipt.actor.tenantId}, ${receipt.actor.subjectId}, ${receipt.fingerprint}, ${JSON.stringify(receipt.operation)}, ${JSON.stringify(receipt.binding)})`;
    await this.audit(receipt);
  }

  private own(scope: CoreScopeReference): void {
    if (coreBindingScopeKey(scope) !== coreBindingScopeKey(this.scope))
      throw new CoreAccessError("denied", "绑定或原操作不属于当前Core范围");
  }
}

export function createMysqlCoreBindings<Tx extends CoreHostSqlTransaction>(
  client: CoreHostSqlClient<Tx>, authority: MysqlCoreBindingAuthority<Tx>
): MysqlCoreBindingRuntime<Tx> {
  const handles = new WeakMap<object, { scopeKey: string; tx: Tx }>();
  return {
    execution: {
      run(request, work) {
        return client.$transaction(async tx => {
          const readAuthority = await authority.lockPrincipal(tx, request);
          const scope = structuredClone(request.scope);
          const repository = new MysqlCoreBindingRepository(tx, scope, receipt => authority.audit(tx, receipt));
          await repository.lock(request.purpose === "initialize");
          const lease = await readAuthority();
          if (request.actor.audience !== "operator" || lease.actor.tenantId !== request.actor.tenantId
            || lease.actor.subjectId !== request.actor.subjectId || lease.actor.audience !== request.actor.audience
            || coreBindingScopeKey(lease.scope) !== coreBindingScopeKey(scope)
            || request.purpose === "initialize" && !lease.canInitialize
            || request.purpose === "original_receipt" && !lease.canReadOriginal)
            throw new CoreAccessError("denied", "绑定事务缺少当前原身份或受权范围");
          const handle = Object.freeze({}) as CoreTransaction;
          handles.set(handle, { scopeKey: coreBindingScopeKey(scope), tx });
          try {
            const result = await work(repository, lease, handle);
            await lease.revalidate();
            return result;
          } finally {
            handles.delete(handle);
          }
        }, { isolationLevel: "ReadCommitted" });
      }
    },
    resolveTransaction(handle, scope) {
      const current = handles.get(handle);
      if (!current || current.scopeKey !== coreBindingScopeKey(scope))
        throw new CoreAccessError("denied", "Core事务句柄已经失效或不属于该范围");
      return current.tx;
    }
  };
}
