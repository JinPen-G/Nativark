/** 现有 SaaS 身份管理同一公共数据库的部署准入；不读取客户端租户、授予业务权或执行停机。
 * 平台父行先于配置行，避免原配置外键的隐式父锁与控制行产生反向等待。 */
import { randomUUID } from "node:crypto";
import { CoreAccessError, CoreDeploymentAdmissionService, type CoreDeploymentAvailability } from "@rental-os/core-host";
import { createMysqlCoreDeploymentAdmissionExecution } from "@rental-os/core-host/mysql-deployment-admission";
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import type { PlatformCoreTransaction, PlatformCoreUsers } from "./ports";

const canManage = (user: SystemUserRow) => user.isSaasAdmin === true
  && (user.permissions.includes("*") || user.permissions.includes("system:tenant:manage"));

export function composePlatformCoreAdmission<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  users: PlatformCoreUsers<Tx>;
  deployment: CoreDeploymentAvailability;
}) {
  const principals = new PlatformPrincipalAuthority<Tx>(input.users);
  const execution = createMysqlCoreDeploymentAdmissionExecution(input.database, {
    async lock(transaction, request) {
      const lease = await principals.lock(transaction, request.actor, "tenant_platform");
      if (!canManage(lease.user)) throw new CoreAccessError("denied", "部署准入控制需要当前 SaaS 管理权限");
      return { actor: lease.principal, canManage: true, revalidate: async () => {
        if (!canManage(await lease.revalidate())) throw new CoreAccessError("denied", "部署准入提交前管理权限已变化");
      } };
    },
    async audit(transaction, receipt) {
      const detail = JSON.stringify({ operator: receipt.actor.subjectId, targetType: "core-deployment-admission",
        targetId: receipt.result.coreId, metadata: { operationId: receipt.result.operationId, revision: receipt.result.revision,
          actorTenantId: receipt.actor.tenantId, state: receipt.result.state, fingerprint: receipt.fingerprint } });
      await transaction.$executeRaw`INSERT INTO OperationLog (id, tenantId, userId, action, detail, createdAt)
        VALUES (${randomUUID()}, ${"tenant_platform"}, ${receipt.actor.subjectId}, ${"core.deployment-admission.changed"}, ${detail}, NOW(3))`;
    }
  });
  return { service: new CoreDeploymentAdmissionService(execution, input.deployment), principals };
}
