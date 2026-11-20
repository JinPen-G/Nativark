/** 原会话下读取本人Core使用权及当前租户管理候选；角色和授权仍来自原锁定事实。 */
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import type { PlatformCoreTransaction, PlatformCoreUsers } from "./ports";
import { CoreSessionContextSchema, CoreSessionSummarySchema, MemberCoreAssignmentSchema, TenantCoreGrantSchema,
  corePermissionCode, type CoreSessionContext } from "@rental-os/core-contracts";
import type { CoreDeployedCatalogue } from "@rental-os/core-host";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { hasEffectivePermission } from "@rental-os/platform-server/permission-match";

type AccessRow = { coreId: string; state: string; revision: bigint | number; operationId: string };
/** 受控宿主只投影一个 Core 的精确权限；原租户身份、其他 Core 和公共管理权不经过此投影。
 * 两次读取均在原身份事务内，结果只能与该 Core 清单及首次权限集合取交集，不解释通配码。 */
export interface PlatformCoreSessionPermissionProjection<Tx extends PlatformCoreTransaction> {
  readonly coreId: string;
  project(transaction: Tx, currentUser: SystemUserRow): Promise<readonly string[]>;
}

export function composePlatformCoreSessionReader<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  users: PlatformCoreUsers<Tx>;
  catalogue: CoreDeployedCatalogue;
  permissionProjection?: PlatformCoreSessionPermissionProjection<Tx>;
}) {
  const principals = new PlatformPrincipalAuthority<Tx>(input.users);
  const projection = input.permissionProjection;
  if (projection && (!input.catalogue.registrations.has(projection.coreId) || typeof projection.project !== "function"))
    throw new Error("Core 会话权限投影必须属于已登记的 Core 并提供真实读取器");
  const projectedCoreId = projection?.coreId, project = projection?.project.bind(projection);
  return () => input.database.$transaction(async (transaction: Tx) => {
    const actor = principals.current(), lease = await principals.lock(transaction, actor, actor.tenantId);
    const user = lease.user;
    const readProjection = async (currentUser: SystemUserRow) => {
      if (!project) return undefined;
      const permissions = await project(transaction, currentUser);
      if (!Array.isArray(permissions) || permissions.some(code => typeof code !== "string"))
        throw new Error("Core 会话权限投影必须返回精确权限集合");
      return new Set(permissions);
    };
    const permitted = (coreId: string, code: string, currentUser: SystemUserRow, projected: ReadonlySet<string> | undefined) =>
      coreId === projectedCoreId ? projected?.has(code) === true
        : currentUser.permissions.includes("*") || currentUser.permissions.includes(code);
    // 业务身份锁仍先于 Core 授权/成员分配锁；投影不替换公共租户身份。
    const initialProjection = await readProjection(user);
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
            .filter(code => permitted(id, code, user, initialProjection)) });
      }
    }
    // 等待授权查询期间角色或权限也可能变化；用返回前的原主体投影过滤精确权限。
    const current = await lease.revalidate();
    const currentProjection = await readProjection(current);
    context.canManageMembers = current.isSaasAdmin !== true && (current.isPlatformAdmin === true
      || current.dataScope === "all" && hasEffectivePermission(current.permissions, "system:user:manage"));
    if (!context.canManageMembers) context.assignable = [];
    context.cores.forEach(entry => { entry.permissions = entry.permissions.filter(code =>
      permitted(entry.core.id, code, current, currentProjection)); });
    return CoreSessionContextSchema.parse(context);
  }, { isolationLevel: "ReadCommitted" });
}
