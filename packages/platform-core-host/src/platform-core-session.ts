/** 原会话下读取本人Core使用权及当前租户管理候选；角色和授权仍来自原锁定事实。 */
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import type { PlatformCoreTransaction, PlatformCoreUsers } from "./ports";
import { CoreSessionContextSchema, CoreSessionSummarySchema, MemberCoreAssignmentSchema, TenantCoreGrantSchema,
  corePermissionCode, type CoreSessionContext } from "@rental-os/core-contracts";
import type { CoreDeployedCatalogue } from "@rental-os/core-host";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { hasEffectivePermission } from "@rental-os/platform-server/permission-match";

type AccessRow = { coreId: string; state: string; revision: bigint | number; operationId: string };
export function composePlatformCoreSessionReader<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  users: PlatformCoreUsers<Tx>;
  catalogue: CoreDeployedCatalogue;
}) {
  const principals = new PlatformPrincipalAuthority<Tx>(input.users);
  return () => input.database.$transaction(async (transaction: Tx) => {
    const actor = principals.current(), lease = await principals.lock(transaction, actor, actor.tenantId);
    const user = lease.user;
    const context: CoreSessionContext = { tenantId: actor.tenantId, subjectId: actor.subjectId, tenantHasRegisteredGrant: false,
      canManageMembers: user.isSaasAdmin !== true && (user.isPlatformAdmin === true
        || user.dataScope === "all" && hasEffectivePermission(user.permissions, "system:user:manage")), cores: [], assignable: [] };
    const registered = input.catalogue.registrations;
    // 无Core组合不依赖行业表或Core授权存储，公共会话仍可返回合法空目录。
    if (registered.size) {
      const grants = await transaction.$queryRaw<AccessRow[]>`
        SELECT core_id AS coreId, state, revision, operation_id AS operationId FROM platform_tenant_core_grants
        WHERE tenant_id = ${actor.tenantId} AND state = 'enabled' ORDER BY core_id FOR UPDATE`;
      const assignments = await transaction.$queryRaw<AccessRow[]>`
        SELECT core_id AS coreId, state, revision, operation_id AS operationId FROM platform_member_core_assignments
        WHERE tenant_id = ${actor.tenantId} AND user_id = ${actor.subjectId} ORDER BY core_id FOR UPDATE`;
      const byCore = new Map(assignments.map(row => [row.coreId, row]));
      for (const row of grants) {
        const registration = registered.get(row.coreId);
        if (!registration) continue;
        context.tenantHasRegisteredGrant = true;
        const { id, name, description, version, scope } = registration.manifest;
        const core = CoreSessionSummarySchema.parse({ id, name, description, version, scope });
        if (context.canManageMembers) context.assignable.push(core);
        const assigned = byCore.get(id);
        if (assigned?.state !== "assigned") continue;
        context.cores.push({ core,
          grant: TenantCoreGrantSchema.parse({ ...row, revision: Number(row.revision), tenantId: actor.tenantId }),
          assignment: MemberCoreAssignmentSchema.parse({ ...assigned, revision: Number(assigned.revision), tenantId: actor.tenantId, userId: actor.subjectId }),
          permissions: registration.manifest.permissions.map(permission => corePermissionCode(id, permission))
            .filter(code => user.permissions.includes("*") || user.permissions.includes(code)) });
      }
    }
    // 等待授权查询期间角色或权限也可能变化；用返回前的原主体投影过滤精确权限。
    const current = await lease.revalidate();
    context.canManageMembers = current.isSaasAdmin !== true && (current.isPlatformAdmin === true
      || current.dataScope === "all" && hasEffectivePermission(current.permissions, "system:user:manage"));
    if (!context.canManageMembers) context.assignable = [];
    context.cores.forEach(entry => { entry.permissions = entry.permissions.filter(code => current.permissions.includes("*") || current.permissions.includes(code)); });
    return CoreSessionContextSchema.parse(context);
  }, { isolationLevel: "ReadCommitted" });
}
