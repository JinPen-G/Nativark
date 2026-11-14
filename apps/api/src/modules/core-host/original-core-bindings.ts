/**
 * Core首次绑定消费原账号/会话、当前Core与成员使用权、原订阅和同事务审计。
 * 必要原初始化收据由仍获权的租户管理者只读核对，业务数据范围另由Core保持。
 */
import type { Prisma } from "@prisma/client";
import type { CoreServerRegistration } from "@rental-os/core-contracts";
import { CoreBindingService, CoreAccessError, type CoreDeploymentAvailability } from "@rental-os/core-host";
import { createMysqlCoreBindings } from "@rental-os/core-host/mysql-bindings";
import type { SystemUserRow } from "@rental-os/shared";
import type { OperationLogService } from "../../common/operation-log.service";
import type { PlatformRepository } from "../platform/platform.repository";
import type { PrismaService } from "../database/prisma.service";
import type { SubscriptionService } from "../subscription/subscription.service";
import { OriginalCorePrincipalAuthority } from "./original-core-principal";
import { OriginalCoreAccess } from "./original-core-access";

function managesTenantCores(user: SystemUserRow): boolean {
  return user.isSaasAdmin !== true && (user.isPlatformAdmin === true
    || user.dataScope === "all" && user.permissions.includes("system:user:manage"));
}

export function composeOriginalCoreBindings(input: {
  database: PrismaService;
  users: Pick<PlatformRepository, "findUserById">;
  audit: Pick<OperationLogService, "recordCoreBindingReceipt">;
  subscription: Pick<SubscriptionService, "readCategoryCommercialContext">;
  deployment: CoreDeploymentAvailability;
  registrations: ReadonlyMap<string, CoreServerRegistration>;
  /** 有容器的Core由自身适配在同一原事务核定容器归属及可初始化范围。 */
  authorizeContainer?(transaction: Prisma.TransactionClient, user: SystemUserRow,
    scope: import("@rental-os/core-contracts").CoreScopeReference): Promise<void>;
}) {
  const principals = new OriginalCorePrincipalAuthority(input.users);
  const access = new OriginalCoreAccess(input.subscription, input.deployment);
  const runtime = createMysqlCoreBindings<Prisma.TransactionClient>(input.database, {
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
        return user;
      };
      return async () => {
        await authorize();
        return { actor: lease.principal, scope: request.scope, canInitialize: request.purpose === "initialize",
          canReadOriginal: request.purpose === "original_receipt", revalidate: async () => { await authorize(); } };
      };
    },
    audit: (transaction, receipt) => input.audit.recordCoreBindingReceipt(transaction, receipt)
  });
  return { service: new CoreBindingService(runtime.execution, input.registrations, input.deployment),
    principals, resolveTransaction: runtime.resolveTransaction };
}
