/**
 * 将独立Core授权服务接到原平台身份/角色及OperationLog同事务写入。
 * 受控宿主提供实际Core部署可用性，HTTP/后台入口由公共装配片消费本组合。
 */
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import type { PlatformCoreTransaction, PlatformCoreUsers, PlatformCoreAudit } from "./ports";
import { CoreAccessService, CoreAccessError, type CoreAccessReceipt, type CoreDeploymentAvailability,
  type CoreManagementRequest } from "@rental-os/core-host";
import { createMysqlCoreManagement } from "@rental-os/core-host/mysql";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { hasEffectivePermission } from "@rental-os/platform-server/permission-match";

function managementAllowed(user: SystemUserRow, receiptKind: CoreAccessReceipt["kind"]): boolean {
  if (receiptKind === "tenant_grant") return user.isSaasAdmin === true
    && (user.permissions.includes("*") || user.permissions.includes("system:tenant:manage"));
  return user.isSaasAdmin !== true && (user.isPlatformAdmin === true
    || user.dataScope === "all" && hasEffectivePermission(user.permissions, "system:user:manage"));
}

export function composePlatformCoreManagement<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  users: PlatformCoreUsers<Tx>;
  audit: Pick<PlatformCoreAudit<Tx>, "recordCoreAccessReceipt">;
  deployment: CoreDeploymentAvailability;
  deploymentForTransaction?: (transaction: Tx) => CoreDeploymentAvailability;
  /** 仅供服务端装配：原身份/Core锁及原收据读取后，在同事务锁定并核对具体来源。
   * 不从HTTP输入选择参加者；原收据重读不进入来源复验。无此参加者保留通用管理行为。 */
  mutationPrecondition?(transaction: Tx, request: CoreManagementRequest): Promise<{ revalidate(): Promise<void> }>;
}) {
  const precondition = input.mutationPrecondition;
  const principals = new PlatformPrincipalAuthority<Tx>(input.users);
  const execution = createMysqlCoreManagement<Tx>(input.database, {
    async authorize(transaction, request) {
      const lease = await principals.lock(transaction, request.actor, request.tenantId, request.targetMemberId, request.enabling);
      if (!managementAllowed(lease.user, request.kind)
        || request.kind === "member_assignment" && request.tenantId !== lease.principal.tenantId)
        throw new CoreAccessError("denied", "当前原平台账号缺少该Core管理权限");
      let mutation: { revalidate(): Promise<void> } | undefined;
      return { actor: lease.principal, tenantId: request.tenantId, canGrant: request.kind === "tenant_grant",
        canAssign: request.kind === "member_assignment", targetMemberId: request.targetMemberId,
        deployment: input.deploymentForTransaction?.(transaction),
        beforeMutation: precondition ? async () => {
          const current = await precondition(transaction, request);
          if (!current || typeof current.revalidate !== "function")
            throw new CoreAccessError("core_unavailable", "Core管理来源参加者未返回有效同事务租约");
          mutation = current;
        } : undefined,
        async revalidate() {
          await mutation?.revalidate();
          if (!managementAllowed(await lease.revalidate(), request.kind))
            throw new CoreAccessError("denied", "Core管理提交前原账号权限已变化");
        } };
    },
    audit: (transaction, receipt) => input.audit.recordCoreAccessReceipt(transaction, receipt)
  });
  return { service: new CoreAccessService(execution, input.deployment), principals };
}
