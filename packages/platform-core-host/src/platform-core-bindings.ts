/**
 * Core首次绑定消费原账号/会话、当前Core与成员使用权、原订阅和同事务审计。
 * 必要原初始化收据由仍获权的租户管理者只读核对，业务数据范围另由Core保持。
 */
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import type { PlatformCoreTransaction, PlatformCoreUsers, PlatformCoreTermPolicy, PlatformCoreAudit } from "./ports";
import type { CoreServerRegistration } from "@rental-os/core-contracts";
import { CoreBindingService, CoreAccessError, type CoreDeploymentAvailability, type CoreBindingRequest } from "@rental-os/core-host";
import { createMysqlCoreBindings } from "@rental-os/core-host/mysql-bindings";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { hasEffectivePermission } from "@rental-os/platform-server/permission-match";
import { PlatformCoreAccess } from "./platform-core-access";

function managesTenantCores(user: SystemUserRow): boolean {
  return user.isSaasAdmin !== true && (user.isPlatformAdmin === true
    || user.dataScope === "all" && hasEffectivePermission(user.permissions, "system:user:manage"));
}

export function composePlatformCoreBindings<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  users: PlatformCoreUsers<Tx>;
  audit: Pick<PlatformCoreAudit<Tx>, "recordCoreBindingReceipt">;
  term: PlatformCoreTermPolicy<Tx>;
  deployment: CoreDeploymentAvailability;
  registrations: ReadonlyMap<string, CoreServerRegistration>;
  /** 有容器的Core由自身适配在同一原事务核定容器归属及可初始化范围。 */
  authorizeContainer?(transaction: Tx, user: SystemUserRow,
    scope: import("@rental-os/core-contracts").CoreScopeReference): Promise<void>;
  /** 服务端来源约束只在原收据缺失后进入，租约留在原绑定事务；不能由客户端自证。 */
  mutationPrecondition?(transaction: Tx, request: CoreBindingRequest): Promise<{ revalidate(): Promise<void> }>;
}) {
  const precondition = input.mutationPrecondition;
  const principals = new PlatformPrincipalAuthority<Tx>(input.users);
  const access = new PlatformCoreAccess<Tx>(input.term, input.deployment);
  const runtime = createMysqlCoreBindings<Tx>(input.database, {
    async lockPrincipal(transaction, request) {
      const lease = await principals.lock(transaction, request.actor, request.scope.tenantId);
      if (!managesTenantCores(lease.user)) throw new CoreAccessError("denied", "绑定及原初始化收据需要当前租户管理权限");
      const authorize = async () => {
        const user = await lease.revalidate();
        if (!managesTenantCores(user)) throw new CoreAccessError("denied", "当前Core初始化管理权限已变化");
        if (request.purpose === "initialize") {
          await access.requireMember(transaction, user, request.scope.coreId);
          if (request.scope.container) {
            if (!input.authorizeContainer) throw new CoreAccessError("core_unavailable", "该Core缺少容器初始化授权适配");
            await input.authorizeContainer(transaction, user, request.scope);
          }
          await access.requireNewBusiness(transaction, request.scope.tenantId);
        }
        await lease.revalidate();
        return user;
      };
      return async () => {
        await authorize();
        let mutation: { revalidate(): Promise<void> } | undefined;
        return { actor: lease.principal, scope: request.scope, canInitialize: request.purpose === "initialize",
          canReadOriginal: request.purpose === "original_receipt",
          beforeMutation: precondition ? async () => {
            const current = await precondition(transaction, request);
            if (!current || typeof current.revalidate !== "function")
              throw new CoreAccessError("core_unavailable", "Core绑定来源参加者未返回有效同事务租约");
            mutation = current;
          } : undefined,
          revalidate: async () => { await mutation?.revalidate(); await authorize(); } };
      };
    },
    audit: (transaction, receipt) => input.audit.recordCoreBindingReceipt(transaction, receipt)
  });
  return { service: new CoreBindingService(runtime.execution, input.registrations, input.deployment),
    principals, resolveTransaction: runtime.resolveTransaction };
}
