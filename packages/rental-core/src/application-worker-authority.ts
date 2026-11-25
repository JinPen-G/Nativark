/** Rental 系统作业的当前准入。沿原租户父锁、Core 门禁和经营空间锁复验，复用宿主部署及订阅政策。
 * 仅原登记执行器的五项历史收尾可消费已登记 disabled 授权；不构造成员身份，原执行器继续负责对象、幂等和 unknown。
 */
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { CoreBindingSchema, CoreScopeReferenceSchema, TenantCoreGrantSchema, isCoreVersionSupported } from "@rental-os/core-contracts";
import { CoreAccessError, coreBindingScopeKey, type CoreDeploymentAvailability, type CoreDeploymentAdmission } from "@rental-os/core-host";
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import type { PlatformCoreTermPolicy, PlatformCoreTransaction } from "@rental-os/platform-core-host";
import { RENTAL_APPLICATION_JOB_DESCRIPTORS, type RentalApplicationJobRequest,
  type RentalApplicationWorkerAuthority } from "./application-participants";
import { RENTAL_CORE_ID, RENTAL_CORE_VERSION, RENTAL_WORKSPACE_CONTAINER_TYPE } from "./core-identity";
import { RENTAL_DATA_READABLE } from "./data";
import type { RentalPlatformConfiguration } from "./platform-host";

// PCH-R04.4/.7：这是原执行器的闭集，不从 settlement/original_dispatch 等用途推断许可。
// 调价会建立新业务依据，不能借保留历史事实继续执行。未知作业同样拒绝。
const recoveryJobs = new Set<string>([
  "allocation_scan", "expire_pending_orders", "reconcile_pickup_overdue",
  "expire_payment_intents", "retry_due_notifications",
]);
const orderJobs = new Set<string>([
  "allocation_scan", "expire_pending_orders", "reconcile_pickup_overdue", "expire_payment_intents",
]);

export interface RentalWorkerAuthorityDependencies<Tx extends PlatformCoreTransaction> {
  database: CoreHostSqlClient<Tx>;
  /** 原统一订阅政策；新业务在已持有租户父锁的同一 ReadCommitted 事务中读取当前期限。 */
  term: PlatformCoreTermPolicy<Tx>;
  /** 与业务核心共用的原配置仓储，必须读取已保存档案及已采用品类，不以模板补齐。 */
  configuration: RentalPlatformConfiguration<Tx>;
  /** 用传入事务创建原部署观察器的可用性视图。公共 requireAvailable 自身没有事务参数，
   * 因此不能传绑定到另一个数据库连接的 availability 来声称完成同事务复验。 */
  deploymentForTransaction(transaction: Tx): CoreDeploymentAvailability;
  /** New-work admission holds the canonical row on this original transaction;
   * the five registered closeout jobs do not acquire an accepting requirement. */
  admissionForTransaction(transaction: Tx): CoreDeploymentAdmission;
}

/** 只为原登记系统作业核验当前范围。没有成员主体的系统作业不冒充原用户委托任务。
 * 未传 transaction 时只开一段准入读取事务；传入时必须是业务原事务，调用方继续持锁至提交。
 * registered disabled 只允许五项原收尾；租户/空间冻结、缺 grant/binding/deployment 仍拒绝。
 * 批次准入不证明某笔业务可执行：逐单事务核原订单，通知只由原队列/CAS 认领已保存记录。
 */
export function createRentalWorkerAuthority<Tx extends PlatformCoreTransaction>(
  input: RentalWorkerAuthorityDependencies<Tx>
): RentalApplicationWorkerAuthority<Tx> {
  if (typeof input?.database?.$transaction !== "function" || typeof input.term?.requireNewBusiness !== "function"
    || typeof input.configuration?.loadWorkspaceSnapshot !== "function" || typeof input.deploymentForTransaction !== "function"
    || typeof input.admissionForTransaction !== "function") {
    throw new CoreAccessError("core_unavailable", "Rental 作业缺少真实事务、订阅、配置或部署/停新参加者");
  }
  const configurationRead = new AsyncLocalStorage<{ readonly transaction: Tx; readonly requestKey: string; readonly parentKey: string; active: boolean }>();

  const verify = async (request: RentalApplicationJobRequest, transaction: Tx | undefined, includeWorkspace: boolean): Promise<void> => {
      // 先固定原请求，避免等待锁期间可变负载将租户、作业目的或空间替换为另一范围。
      const { coreId, implementationVersion, jobId, purpose, tenantId, workspaceId, orderId } = request ?? {};
      const definition = RENTAL_APPLICATION_JOB_DESCRIPTORS.find(job => job.id === jobId);
      if (!definition || coreId !== RENTAL_CORE_ID || implementationVersion !== RENTAL_CORE_VERSION
        || definition.purpose !== purpose || typeof tenantId !== "string" || !tenantId.trim()
        || typeof workspaceId !== "string" || !workspaceId.trim()
        || (orderId !== undefined && (typeof orderId !== "string" || !orderId.trim()))
        || (includeWorkspace && transaction !== undefined && orderJobs.has(jobId) && !orderId)) {
        throw new CoreAccessError("denied", "Rental 作业身份、执行版本、用途或原业务范围不符合登记");
      }
      const parsedScope = CoreScopeReferenceSchema.safeParse({ coreId, tenantId,
        container: { type: RENTAL_WORKSPACE_CONTAINER_TYPE, id: workspaceId } });
      if (!parsedScope.success) throw new CoreAccessError("denied", "Rental 作业原业务范围无效");
      const scope = parsedScope.data, scopeKey = coreBindingScopeKey(scope);
      const scopeHash = createHash("sha256").update(scopeKey).digest("hex");
      const parentKey = JSON.stringify([coreId, implementationVersion, jobId, purpose, tenantId, workspaceId]);
      const requestKey = JSON.stringify([parentKey, orderId]);
      const reading = configurationRead.getStore();
      if (reading && (!reading.active || reading.transaction !== transaction || reading.parentKey !== parentKey
        || ((includeWorkspace || orderId !== undefined) && reading.requestKey !== requestKey))) {
        throw new CoreAccessError("denied", "Rental 作业配置读取不能切换原事务、执行器或业务对象");
      }

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
        if (!grant?.success || (grant.data.state !== "enabled"
          && !(grant.data.state === "disabled" && recoveryJobs.has(jobId)))) {
          throw new CoreAccessError("denied", "Rental Core 当前未授权此原作业；停用后不能开始新业务或未知用途");
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
        if (!recoveryJobs.has(jobId)) {
          const admission = input.admissionForTransaction(tx);
          if (typeof admission?.requireAccepting !== "function")
            throw new CoreAccessError("core_unavailable", "Rental 新业务作业缺少同事务的部署停新读取器");
          await admission.requireAccepting(coreId);
        }
        if (includeWorkspace && !reading) {
          // 原逐单执行器已经持此订单锁；运输前短事务则在这里先锁原订单。
          // 禁止先 Workspace 后 Order，亦不能仅凭作业名称把别的空间/不存在的订单当收尾对象。
          if (orderId !== undefined) {
            const orders = await tx.$queryRaw<Array<{ id: string; tenantId: string; workspaceId: string }>>`
              SELECT id, tenantId, workspaceId FROM rental_orders
              WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND id = ${orderId} FOR UPDATE`;
            if (orders.length !== 1 || orders[0].id !== orderId || orders[0].tenantId !== tenantId
              || orders[0].workspaceId !== workspaceId) {
              throw new CoreAccessError("denied", "Rental 收尾作业缺少同租户同空间的原订单事实");
            }
          }
          // 与原配置写入及品类采用保持同一空间锁。批次只读准入没有后续订单锁。
          const workspaces = await tx.$queryRaw<Array<{ id: string; tenantId: string; status: string }>>`
            SELECT id, tenantId, status FROM business_workspaces
            WHERE tenantId = ${tenantId} AND id = ${workspaceId} FOR UPDATE`;
          if (workspaces.length !== 1 || workspaces[0].id !== workspaceId || workspaces[0].tenantId !== tenantId
            || typeof workspaces[0].status !== "string" || workspaces[0].status.toLowerCase() !== "active") {
            throw new CoreAccessError("denied", "Rental 作业经营空间已不可用或不属于原租户");
          }
          // 原 loadWorkspaceSnapshot→lockActiveCategoryBinding 会重新取 Tenant/Core fence。
          // 只在这段同事务同对象的同步等待链中重复父门禁，避免完整配置读取递归。
          // 外层仍须取得并核验真实配置后才返回；不缓存授权、不跳过其他事务/对象复验。
          const readingScope = { transaction: tx, requestKey, parentKey, active: true };
          const snapshot = await configurationRead.run(readingScope, async () => {
            try { return await input.configuration.loadWorkspaceSnapshot(tenantId, workspaceId, tx); }
            finally { readingScope.active = false; }
          });
          if (!snapshot || snapshot.tenantId !== tenantId || snapshot.workspaceId !== workspaceId
            || !snapshot.profile || !snapshot.businessSettings) {
            throw new CoreAccessError("core_unavailable", "Rental 作业经营空间缺少已保存的原业务配置");
          }
        }
        const deployment = input.deploymentForTransaction(tx);
        if (typeof deployment?.requireAvailable !== "function") {
          throw new CoreAccessError("core_unavailable", "Rental 作业缺少同事务的实际部署观察器");
        }
        await deployment.requireAvailable(coreId, tenantId);
        // 在其他异步读取之后判定自然流逝的期限。五项原收尾不新建订单/价格依据，仍由原状态机裁定。
        if (definition.purpose === "new_business") await input.term.requireNewBusiness(tx, tenantId);
      };
      if (transaction !== undefined) return check(transaction);
      return input.database.$transaction(check, { isolationLevel: "ReadCommitted" });
  };
  return Object.freeze({
    assertCurrent: (request: RentalApplicationJobRequest, transaction?: Tx) => verify(request, transaction, true),
    assertParentCurrent: (request: RentalApplicationJobRequest, transaction: Tx) => {
      if (!transaction) throw new CoreAccessError("denied", "Rental 作业父门禁需要原业务事务");
      return verify(request, transaction, false);
    }
  });
}
