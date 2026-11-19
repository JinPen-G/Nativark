/** Rental 系统作业的当前准入。沿原租户父锁、Core 门禁和经营空间锁复验，复用宿主部署及订阅政策。
 * 不构造成员身份、不授予停用后的善后权限，也不读取或重发业务操作；原执行器继续负责对象、幂等和 unknown。
 */
import { createHash } from "node:crypto";
import { CoreBindingSchema, CoreScopeReferenceSchema, TenantCoreGrantSchema, isCoreVersionSupported } from "@rental-os/core-contracts";
import { CoreAccessError, coreBindingScopeKey, type CoreDeploymentAvailability } from "@rental-os/core-host";
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import type { PlatformCoreTermPolicy, PlatformCoreTransaction } from "@rental-os/platform-core-host";
import { RENTAL_APPLICATION_JOB_DESCRIPTORS, type RentalApplicationJobRequest,
  type RentalApplicationWorkerAuthority } from "./application-participants";
import { RENTAL_CORE_ID, RENTAL_CORE_VERSION, RENTAL_WORKSPACE_CONTAINER_TYPE } from "./core-identity";
import { RENTAL_DATA_READABLE } from "./data";
import type { RentalPlatformConfiguration } from "./platform-host";

export interface RentalWorkerAuthorityDependencies<Tx extends PlatformCoreTransaction> {
  database: CoreHostSqlClient<Tx>;
  /** 原统一订阅政策；新业务在已持有租户父锁的同一 ReadCommitted 事务中读取当前期限。 */
  term: PlatformCoreTermPolicy<Tx>;
  /** 与业务核心共用的原配置仓储，必须读取已保存档案及已采用品类，不以模板补齐。 */
  configuration: RentalPlatformConfiguration<Tx>;
  /** 用传入事务创建原部署观察器的可用性视图。公共 requireAvailable 自身没有事务参数，
   * 因此不能传绑定到另一个数据库连接的 availability 来声称完成同事务复验。 */
  deploymentForTransaction(transaction: Tx): CoreDeploymentAvailability;
}

/** 只为已登记的六项系统作业开放当前启用范围。没有成员主体的系统作业不冒充原用户委托任务。
 * 未传 transaction 时只开一段准入读取事务；传入时必须是业务原事务，调用方继续持锁至提交。
 * Core/租户/空间停用后的专项善后授权尚无公共政策端口，所有用途均拒绝，settlement 不是豁免。
 */
export function createRentalWorkerAuthority<Tx extends PlatformCoreTransaction>(
  input: RentalWorkerAuthorityDependencies<Tx>
): RentalApplicationWorkerAuthority<Tx> {
  if (typeof input?.database?.$transaction !== "function" || typeof input.term?.requireNewBusiness !== "function"
    || typeof input.configuration?.loadWorkspaceSnapshot !== "function" || typeof input.deploymentForTransaction !== "function") {
    throw new CoreAccessError("core_unavailable", "Rental 作业缺少真实事务、订阅、配置或部署授权参加者");
  }

  return Object.freeze({
    async assertCurrent(request: RentalApplicationJobRequest, transaction?: Tx): Promise<void> {
      // 先固定原请求，避免等待锁期间可变负载将租户、作业目的或空间替换为另一范围。
      const { coreId, implementationVersion, jobId, purpose, tenantId, workspaceId } = request ?? {};
      const definition = RENTAL_APPLICATION_JOB_DESCRIPTORS.find(job => job.id === jobId);
      if (!definition || coreId !== RENTAL_CORE_ID || implementationVersion !== RENTAL_CORE_VERSION
        || definition.purpose !== purpose || typeof tenantId !== "string" || !tenantId.trim()
        || typeof workspaceId !== "string" || !workspaceId.trim()) {
        throw new CoreAccessError("denied", "Rental 作业身份、执行版本、用途或原业务范围不符合登记");
      }
      const parsedScope = CoreScopeReferenceSchema.safeParse({ coreId, tenantId,
        container: { type: RENTAL_WORKSPACE_CONTAINER_TYPE, id: workspaceId } });
      if (!parsedScope.success) throw new CoreAccessError("denied", "Rental 作业原业务范围无效");
      const scope = parsedScope.data, scopeKey = coreBindingScopeKey(scope);
      const scopeHash = createHash("sha256").update(scopeKey).digest("hex");

      const check = async (tx: Tx): Promise<void> => {
        if (typeof tx?.$queryRaw !== "function") throw new CoreAccessError("core_unavailable", "Rental 作业原事务不可用");
        // 原幂等执行器已持 Tenant 共享父锁，不能在这里升级为排他锁造成两个作业互相等待。
        // Core 授权/订阅写入者持同一父行的排他锁；缺行时只拒绝，不创建准入或绑定事实。
        const tenants = await tx.$queryRaw<Array<{ id: string; status: string }>>`
          SELECT id, status FROM Tenant WHERE id = ${tenantId} LOCK IN SHARE MODE`;
        if (tenants.length !== 1 || tenants[0].id !== tenantId || typeof tenants[0].status !== "string"
          || tenants[0].status.toLowerCase() !== "active") {
          throw new CoreAccessError("denied", "Rental 作业所属租户已不可用；未登记冻结或停用后的作业善后权限");
        }
        const gates = await tx.$queryRaw<Array<{ tenantId: string; coreId: string }>>`
          SELECT tenant_id AS tenantId, core_id AS coreId FROM platform_core_access_locks
          WHERE tenant_id = ${tenantId} AND core_id = ${coreId} LOCK IN SHARE MODE`;
        if (gates.length !== 1 || gates[0].tenantId !== tenantId || gates[0].coreId !== coreId) {
          throw new CoreAccessError("denied", "Rental 作业缺少已登记的租户 Core 门禁");
        }
        const grants = await tx.$queryRaw<Array<{ state: string; revision: bigint | number; operationId: string }>>`
          SELECT state, revision, operation_id AS operationId FROM platform_tenant_core_grants
          WHERE tenant_id = ${tenantId} AND core_id = ${coreId} LOCK IN SHARE MODE`;
        const grant = grants.length === 1 ? TenantCoreGrantSchema.safeParse({ ...grants[0],
          revision: Number(grants[0].revision), tenantId, coreId }) : undefined;
        if (!grant?.success || grant.data.state !== "enabled") {
          throw new CoreAccessError("denied", "Rental Core 当前未获租户授权；停用后的作业善后政策尚未登记");
        }
        // 使用公共绑定键和 schema，锁定读取不受调用方较早的可重复读快照影响。
        const bindings = await tx.$queryRaw<Array<{ bindingId: string; revision: bigint | number; dataVersion: string;
          containerType: string | null; containerId: string | null }>>`
          SELECT binding_id AS bindingId, revision, data_version AS dataVersion,
            container_type AS containerType, container_id AS containerId
          FROM platform_core_bindings WHERE tenant_id = ${tenantId} AND core_id = ${coreId}
            AND scope_hash = ${scopeHash} LOCK IN SHARE MODE`;
        const binding = bindings.length === 1 ? CoreBindingSchema.safeParse({ coreId, tenantId,
          bindingId: bindings[0].bindingId, revision: Number(bindings[0].revision), dataVersion: bindings[0].dataVersion,
          container: { type: bindings[0].containerType, id: bindings[0].containerId } }) : undefined;
        if (!binding?.success || coreBindingScopeKey(binding.data) !== scopeKey
          || !isCoreVersionSupported(binding.data.dataVersion, RENTAL_DATA_READABLE)) {
          throw new CoreAccessError("denied", "Rental 作业原空间绑定缺失、范围不符或数据版本不兼容");
        }
        // 与原配置写入及品类采用保持同一空间锁；状态不能由订阅兼容或历史档案补成 active。
        const workspaces = await tx.$queryRaw<Array<{ id: string; tenantId: string; status: string }>>`
          SELECT id, tenantId, status FROM business_workspaces
          WHERE tenantId = ${tenantId} AND id = ${workspaceId} FOR UPDATE`;
        if (workspaces.length !== 1 || workspaces[0].id !== workspaceId || workspaces[0].tenantId !== tenantId
          || typeof workspaces[0].status !== "string" || workspaces[0].status.toLowerCase() !== "active") {
          throw new CoreAccessError("denied", "Rental 作业经营空间已不可用或不属于原租户");
        }
        const snapshot = await input.configuration.loadWorkspaceSnapshot(tenantId, workspaceId, tx);
        if (!snapshot || snapshot.tenantId !== tenantId || snapshot.workspaceId !== workspaceId
          || !snapshot.profile || !snapshot.businessSettings) {
          throw new CoreAccessError("core_unavailable", "Rental 作业经营空间缺少已保存的原业务配置");
        }
        const deployment = input.deploymentForTransaction(tx);
        if (typeof deployment?.requireAvailable !== "function") {
          throw new CoreAccessError("core_unavailable", "Rental 作业缺少同事务的实际部署观察器");
        }
        await deployment.requireAvailable(coreId, tenantId);
        // 在其他异步读取之后判定自然流逝的期限。配货、到期收尾和原通知投递仍受当前 Core 授权及原业务规则约束。
        if (definition.purpose === "new_business") await input.term.requireNewBusiness(tx, tenantId);
      };
      if (transaction !== undefined) return check(transaction);
      return input.database.$transaction(check, { isolationLevel: "ReadCommitted" });
    }
  });
}
