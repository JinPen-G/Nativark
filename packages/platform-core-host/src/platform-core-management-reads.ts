/**
 * 在原身份和租户管理权限锁下读取当前Core授权、成员分配及绑定修订。
 * 只读当前事实，未创建记录明确缺失，访问仍复核当前会话和管理权。
 */
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import type { PlatformCoreTransaction, PlatformCoreUsers, PlatformCoreTermPolicy } from "./ports";
import {
  CoreMemberAccessQuerySchema, CoreScopeBindingQuerySchema, CoreTenantAccessQuerySchema,
  MemberCoreAssignmentSchema, TenantCoreGrantSchema
} from "@rental-os/core-contracts";
import { CoreAccessError, type CoreDeploymentAvailability } from "@rental-os/core-host";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { PlatformCoreAccess } from "./platform-core-access";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { hasEffectivePermission } from "@rental-os/platform-server/permission-match";

function canManage(user: SystemUserRow, platform: boolean): boolean {
  if (platform) return user.isSaasAdmin === true && (user.permissions.includes("*") || user.permissions.includes("system:tenant:manage"));
  return user.isSaasAdmin !== true && (user.isPlatformAdmin === true
    || user.dataScope === "all" && hasEffectivePermission(user.permissions, "system:user:manage"));
}

export function composePlatformCoreManagementReads<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  users: PlatformCoreUsers<Tx>;
  term: PlatformCoreTermPolicy<Tx>;
  deployment: CoreDeploymentAvailability;
}) {
  const principals = new PlatformPrincipalAuthority<Tx>(input.users);
  const access = new PlatformCoreAccess<Tx>(input.term, input.deployment);
  const read = <T>(platform: boolean, tenantId: string, memberId: string | undefined,
    work: (transaction: Tx) => Promise<T>) => input.database.$transaction(async transaction => {
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
