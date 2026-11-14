/**
 * 将独立Core授权服务接到原平台身份/角色及OperationLog同事务写入。
 * 受控宿主提供实际Core部署可用性，HTTP/后台入口由公共装配片消费本组合。
 */
import type { Prisma } from "@prisma/client";
import { CoreAccessService, CoreAccessError, type CoreAccessReceipt, type CoreDeploymentAvailability } from "@rental-os/core-host";
import { createMysqlCoreManagement } from "@rental-os/core-host/mysql";
import type { SystemUserRow } from "@rental-os/shared";
import type { OperationLogService } from "../../common/operation-log.service";
import type { PlatformRepository } from "../platform/platform.repository";
import type { PrismaService } from "../database/prisma.service";
import { OriginalCorePrincipalAuthority } from "./original-core-principal";

function managementAllowed(user: SystemUserRow, receiptKind: CoreAccessReceipt["kind"]): boolean {
  if (receiptKind === "tenant_grant") return user.isSaasAdmin === true
    && (user.permissions.includes("*") || user.permissions.includes("system:tenant:manage"));
  return user.isSaasAdmin !== true && (user.isPlatformAdmin === true
    || user.dataScope === "all" && user.permissions.includes("system:user:manage"));
}

export function composeOriginalCoreManagement(input: {
  database: PrismaService;
  users: Pick<PlatformRepository, "findUserById">;
  audit: Pick<OperationLogService, "recordCoreAccessReceipt">;
  deployment: CoreDeploymentAvailability;
}) {
  const principals = new OriginalCorePrincipalAuthority(input.users);
  const execution = createMysqlCoreManagement<Prisma.TransactionClient>(input.database, {
    async authorize(transaction, request) {
      const lease = await principals.lock(transaction, request.actor, request.tenantId, request.targetMemberId, request.enabling);
      if (!managementAllowed(lease.user, request.kind)
        || request.kind === "member_assignment" && request.tenantId !== lease.principal.tenantId)
        throw new CoreAccessError("denied", "当前原平台账号缺少该Core管理权限");
      return { actor: lease.principal, tenantId: request.tenantId, canGrant: request.kind === "tenant_grant",
        canAssign: request.kind === "member_assignment", targetMemberId: request.targetMemberId,
        async revalidate() {
          if (!managementAllowed(await lease.revalidate(), request.kind))
            throw new CoreAccessError("denied", "Core管理提交前原账号权限已变化");
        } };
    },
    audit: (transaction, receipt) => input.audit.recordCoreAccessReceipt(transaction, receipt)
  });
  return { service: new CoreAccessService(execution, input.deployment), principals };
}
