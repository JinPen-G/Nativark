/** 标准宿主以原账号/空间投影和配置仓储供给 Rental，不复制角色或品类规则。
 * Core授权、成员分配、原会话及绑定按同一事务读取；客户/员工仍使用原专用 HTTP 授权。
 * 此组合不启动服务、创建空间、执行迁移或批准卸载。 */
import type { CoreReadiness, CoreScopeReference } from "@rental-os/core-contracts";
import { CoreAccessError, type CoreDeploymentAvailability } from "@rental-os/core-host";
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { PlatformCoreAccess, type PlatformCoreTermPolicy, type PlatformCoreTransaction,
  type PlatformCoreUsers } from "@rental-os/platform-core-host";
import type { TenantRentalProfile, TenantRentalBusinessSettings } from "./contracts";
import { createRentalServer, isRentalCoreScope, RENTAL_CORE_ID } from "./server";
import { readRentalRemoval } from "./mysql-removal";

export interface RentalPlatformUsers<Tx extends PlatformCoreTransaction> extends PlatformCoreUsers<Tx> {
  /** 原空间成员/角色投影；不接受租户级账号权限代替已撤销的空间成员关系。 */
  resolveTrustedWorkspacePrincipal(binding: { tenantId: string; userId: string; workspaceId: string },
    transaction: Tx): Promise<{ user: SystemUserRow; workspaceId: string } | undefined>;
}

export interface RentalPlatformConfiguration<Tx extends PlatformCoreTransaction> {
  loadWorkspaceSnapshot(tenantId: string, workspaceId: string, transaction: Tx):
    Promise<{ tenantId: string; workspaceId: string; profile?: TenantRentalProfile; businessSettings?: TenantRentalBusinessSettings }>;
  /** 同原Native和采用锁仅取完整档案/设置；未提供的旧宿主保留全量读取。 */
  readReadinessConfiguration?(tenantId: string, workspaceId: string, transaction: Tx):
    Promise<{ tenantId: string; workspaceId: string; profile?: TenantRentalProfile; businessSettings?: TenantRentalBusinessSettings }>;
}

export function composeRentalPlatformHost<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  users: RentalPlatformUsers<Tx>;
  configuration: RentalPlatformConfiguration<Tx>;
  term: PlatformCoreTermPolicy<Tx>;
  deployment: CoreDeploymentAvailability;
  /** SQL 宿主用调用方原事务观察部署，避免持主体锁时再等待根连接。 */
  deploymentForTransaction?: (transaction: Tx) => CoreDeploymentAvailability;
}) {
  const principals = new PlatformPrincipalAuthority<Tx>(input.users);
  const access = new PlatformCoreAccess<Tx>(input.term, input.deployment, input.deploymentForTransaction);

  const requireScope = async (transaction: Tx, user: SystemUserRow, scope: CoreScopeReference) => {
    if (user.isSaasAdmin || scope.tenantId !== user.tenantId || !isRentalCoreScope(scope))
      throw new CoreAccessError("denied", "Rental范围与当前成员不一致");
    // 租户绑定只服务租户级会员/渠道；容器业务仍须当前原经营空间成员关系。
    if (!scope.container) return;
    const current = await input.users.resolveTrustedWorkspacePrincipal({ tenantId: scope.tenantId,
      userId: user.id, workspaceId: scope.container!.id }, transaction);
    if (!current || current.user.id !== user.id || current.user.tenantId !== user.tenantId
      || current.workspaceId !== scope.container!.id || !current.user.isActive || current.user.mustChangePassword)
      throw new CoreAccessError("denied", "原经营空间成员关系或账号已不可用");
  };

  const readReadiness = async (transaction: Tx, binding: CoreScopeReference): Promise<CoreReadiness> => {
    if (!binding.container) {
      // 租户业务无需品类档案，但全部所选数据/能力必须由真实部署观察证明可用。
      const deployment = input.deploymentForTransaction?.(transaction) ?? input.deployment;
      await deployment.requireAvailable(RENTAL_CORE_ID, binding.tenantId);
      return { status: "ready" };
    }
    const workspaceId = binding.container!.id;
    // 原仓储持空间采用锁并解析已保存配置，不从模板或恢复缓存补造当前档案。
    const snapshot = input.configuration.readReadinessConfiguration
      ? await input.configuration.readReadinessConfiguration(binding.tenantId, workspaceId, transaction)
      : await input.configuration.loadWorkspaceSnapshot(binding.tenantId, workspaceId, transaction);
    if (snapshot.tenantId !== binding.tenantId || snapshot.workspaceId !== workspaceId)
      throw new CoreAccessError("denied", "Rental配置不属于当前业务绑定");
    const missing = [
      ...(!snapshot.profile ? [{ code: "rental_profile", message: "经营空间尚未保存租赁档案" }] : []),
      ...(!snapshot.businessSettings ? [{ code: "rental_settings", message: "经营空间尚未保存业务设置" }] : [])
    ];
    return missing.length ? { status: "configuration_required", missing } : { status: "ready" };
  };

  const server = createRentalServer({
    resolveAuthorizedBinding: request => input.database.$transaction(async transaction => {
      const lease = await principals.lock(transaction, request.principal, request.scope.tenantId);
      await access.requireMember(transaction, lease.user, RENTAL_CORE_ID);
      await access.requireBusinessAdmission(transaction, RENTAL_CORE_ID);
      await requireScope(transaction, lease.user, request.scope);
      const binding = await access.binding(transaction, request.scope);
      await requireScope(transaction, await lease.revalidate(), request.scope);
      return binding;
    }, { isolationLevel: "ReadCommitted" }),
    readReadiness: binding => input.database.$transaction(async transaction => {
      // 直接业务就绪读取须停新；共用配置读取仍供原绑定复用，不替代首次初始化门禁。
      await access.requireBusinessAdmission(transaction, RENTAL_CORE_ID);
      return readReadiness(transaction, binding);
    }, { isolationLevel: "ReadCommitted" }),
    assessRemoval: tenantId => input.database.$transaction(transaction => readRentalRemoval(transaction, tenantId),
      { isolationLevel: "ReadCommitted" })
  });

  return {
    server,
    /** 交给公共绑定组合，在其原事务内只关联已经由 Rental 正式创建和配置的经营空间。 */
    async authorizeContainer(transaction: Tx, user: SystemUserRow, scope: CoreScopeReference): Promise<void> {
      await requireScope(transaction, user, scope);
      // 首次关联不能把缺档案的空间写成已就绪；后续配置修改仍走 Rental 原接口。
      const readiness = await readReadiness(transaction, scope);
      if (readiness.status !== "ready") throw new CoreAccessError("core_unavailable", "请先完成该Rental经营空间的原业务配置");
      await requireScope(transaction, user, scope);
    }
  };
}
