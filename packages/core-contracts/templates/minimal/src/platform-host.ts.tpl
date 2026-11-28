/** 原平台身份、成员分配、Core准入、绑定及审计接入；没有默认租户或角色授权。 */
import { isCoreVersionSupported, type CoreScopeRequest } from "@rental-os/core-contracts";
import type { CoreDeploymentAvailability } from "@rental-os/core-host";
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { PlatformCoreAccess, type PlatformCoreTransaction, type PlatformCoreUsers, type PlatformCoreTermPolicy,
  type PlatformCoreBusinessAudit } from "@rental-os/platform-core-host";
import { CORE_ID, DATA_READABLE, ItemError } from "./contracts";
import { ItemService } from "./service";
import { createMysqlExecution, assessRemoval } from "./mysql";
import { createServer } from "./server";

export function composePlatformHost<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx> & Pick<Tx, "$queryRaw">; users: PlatformCoreUsers<Tx>;
  audit: PlatformCoreBusinessAudit<Tx>; term: PlatformCoreTermPolicy<Tx>; deployment: CoreDeploymentAvailability;
  deploymentForTransaction?: (tx: Tx) => CoreDeploymentAvailability;
}) {
  const principals = new PlatformPrincipalAuthority<Tx>(input.users);
  const access = new PlatformCoreAccess<Tx>(input.term, input.deployment, input.deploymentForTransaction);
  const execution = createMysqlExecution<Tx>(input.database, {
    async authorize(tx, request) {
      const lease = await principals.lock(tx, request.principal, request.principal.tenantId);
      const authorize = async () => {
        const user = await lease.revalidate();
        // 只消费平台已经核定的权限；此适配不登记角色、更不授予通配权限。
        if (user.isSaasAdmin || !(user.permissions.includes("*") || user.permissions.includes(`${CORE_ID}:item:${request.permission}`)))
          throw new ItemError("denied", "当前成员缺少条目操作权限");
        if (request.purpose === "business") {
          await access.requireMember(tx, user, CORE_ID);
          await access.requireBusinessAdmission(tx, CORE_ID);
          if (request.permission === "create") await access.requireNewBusiness(tx, user.tenantId);
        } else if (request.permission !== "read") throw new ItemError("denied", "原操作入口只允许读取");
        const binding = await access.binding(tx, { coreId: CORE_ID, tenantId: user.tenantId });
        if (!binding || !isCoreVersionSupported(binding.dataVersion, DATA_READABLE)) throw new ItemError("denied", "条目原绑定不可读");
        await lease.revalidate(); return user;
      };
      const user = await authorize();
      return { tenantId: user.tenantId, userId: user.id, revalidate: async () => { await authorize(); } };
    },
    audit: (tx, receipt) => input.audit.recordCoreBusinessReceipt(tx, { tenantId: receipt.item.tenantId,
      userId: receipt.actorId, coreId: CORE_ID, targetType: `${CORE_ID}.item`, targetId: receipt.item.id,
      operationId: receipt.operationId, revision: receipt.item.revision, fingerprint: receipt.fingerprint, state: receipt.item.state })
  });
  const resolveAuthorizedBinding = (request: CoreScopeRequest) => input.database.$transaction(async tx => {
    const lease = await principals.lock(tx, request.principal, request.scope.tenantId);
    if (lease.user.isSaasAdmin || request.scope.coreId !== CORE_ID || request.scope.container) throw new ItemError("denied", "条目范围不符");
    await access.requireMember(tx, lease.user, CORE_ID); await access.requireBusinessAdmission(tx, CORE_ID);
    const binding = await access.binding(tx, request.scope); await lease.revalidate(); return binding;
  }, { isolationLevel: "ReadCommitted" });
  return { service: new ItemService(execution), principals, server: createServer({ resolveAuthorizedBinding,
    // resolveAuthorizedBinding已退出原事务；此处复核原迁移账和实际结构后才返回就绪。
    readReadiness: async binding => { await input.deployment.requireAvailable(CORE_ID, binding.tenantId); return { status: "ready" }; },
    assessRemoval: tenantId => assessRemoval(input.database, tenantId) }) };
}
