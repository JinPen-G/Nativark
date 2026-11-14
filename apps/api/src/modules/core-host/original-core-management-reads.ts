/**
 * 在原身份和租户管理权限锁下读取当前Core授权、成员分配及绑定修订。
 * 只读当前事实，未创建记录明确缺失，访问仍复核当前会话和管理权。
 */
import type { Prisma } from "@prisma/client";
import {
  CoreMemberAccessQuerySchema, CoreScopeBindingQuerySchema, CoreTenantAccessQuerySchema,
  MemberCoreAssignmentSchema, TenantCoreGrantSchema
} from "@rental-os/core-contracts";
import { CoreAccessError, type CoreDeploymentAvailability } from "@rental-os/core-host";
import type { SystemUserRow } from "@rental-os/shared";
import type { PlatformRepository } from "../platform/platform.repository";
import type { PrismaService } from "../database/prisma.service";
import type { SubscriptionService } from "../subscription/subscription.service";
import { OriginalCoreAccess } from "./original-core-access";
import { OriginalCorePrincipalAuthority } from "./original-core-principal";

function canManage(user: SystemUserRow, platform: boolean): boolean {
  if (platform) return user.isSaasAdmin === true && (user.permissions.includes("*") || user.permissions.includes("system:tenant:manage"));
  return user.isSaasAdmin !== true && (user.isPlatformAdmin === true
    || user.dataScope === "all" && user.permissions.includes("system:user:manage"));
}

export function composeOriginalCoreManagementReads(input: {
  database: PrismaService;
  users: Pick<PlatformRepository, "findUserById">;
  subscription: Pick<SubscriptionService, "readCategoryCommercialContext">;
  deployment: CoreDeploymentAvailability;
}) {
  const principals = new OriginalCorePrincipalAuthority(input.users);
  const access = new OriginalCoreAccess(input.subscription, input.deployment);
  const read = <T>(platform: boolean, tenantId: string, memberId: string | undefined,
    work: (transaction: Prisma.TransactionClient) => Promise<T>) => input.database.$transaction(async transaction => {
      const actor = principals.current();
      if (!platform && tenantId !== actor.tenantId) throw new CoreAccessError("denied", "读取Core管理事实须在当前租户内");
      const lease = await principals.lock(transaction, actor, tenantId, memberId, false);
      if (!canManage(lease.user, platform)) throw new CoreAccessError("denied", "当前主体缺少Core管理读取权限");
      const result = await work(transaction);
      if (!canManage(await lease.revalidate(), platform)) throw new CoreAccessError("denied", "Core管理读取时权限已变化");
      return result;
    }, { isolationLevel: "ReadCommitted" });

  return {
    tenantGrant(value: unknown) {
      const query = CoreTenantAccessQuerySchema.parse(value);
      return read(true, query.tenantId, undefined, async transaction => {
        const rows = await transaction.$queryRaw<Array<{ state: string; revision: bigint | number; operationId: string }>>`
          SELECT state, revision, operation_id AS operationId FROM platform_tenant_core_grants
          WHERE tenant_id = ${query.tenantId} AND core_id = ${query.coreId}`;
        if (!rows[0]) return { status: "unavailable" as const };
        return { status: "recorded" as const, grant: TenantCoreGrantSchema.parse({ ...rows[0], revision: Number(rows[0].revision),
          tenantId: query.tenantId, coreId: query.coreId }) };
      });
    },
    memberAssignment(value: unknown) {
      const query = CoreMemberAccessQuerySchema.parse(value);
      const actor = principals.current();
      return read(false, actor.tenantId, query.userId, async transaction => {
        const rows = await transaction.$queryRaw<Array<{ state: string; revision: bigint | number; operationId: string }>>`
          SELECT state, revision, operation_id AS operationId FROM platform_member_core_assignments
          WHERE tenant_id = ${actor.tenantId} AND core_id = ${query.coreId} AND user_id = ${query.userId}`;
        if (!rows[0]) return { status: "unavailable" as const };
        return { status: "recorded" as const, assignment: MemberCoreAssignmentSchema.parse({ ...rows[0], revision: Number(rows[0].revision),
          tenantId: actor.tenantId, coreId: query.coreId, userId: query.userId }) };
      });
    },
    binding(value: unknown) {
      const query = CoreScopeBindingQuerySchema.parse(value);
      const actor = principals.current();
      return read(false, actor.tenantId, undefined, async transaction => {
        const binding = await access.binding(transaction, { ...query, tenantId: actor.tenantId });
        return binding ? { status: "recorded" as const, binding } : { status: "unavailable" as const };
      });
    }
  };
}
