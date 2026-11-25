/** 无业务Core的成员邀请使用原公共账号、角色与组织存储，并在原邀请事务内授权。
 * 只接受空业务范围；Core使用权和业务成员关系由已注册Core的真实参加者负责。 */
import { BadRequestException } from "@nestjs/common";
import type { TenantInvitationAccess, TenantInvitationAuthority } from "../messaging/messaging-store";
import { PlatformManagementRepository } from "./platform-management.repository";
import type { PlatformManagementDatabase, PlatformManagementTransaction } from "./platform-management.store";

export class PlatformMemberInvitationAuthority extends PlatformManagementRepository
  implements TenantInvitationAuthority<PlatformManagementTransaction> {
  constructor(database: PlatformManagementDatabase) { super(database); }

  async validateOperatorInvitationAccess(transaction: PlatformManagementTransaction, tenantId: string, actorUserId: string,
    input: TenantInvitationAccess) {
    const actor = await this.assertTenantManagementPermission(tenantId, actorUserId, "system:user:manage", transaction);
    if (!Array.isArray(input.roleIds) || !input.roleIds.length || input.roleIds.length > 8
      || new Set(input.roleIds).size !== input.roleIds.length) throw new BadRequestException("请选择有效的租户基础角色");
    if (!Array.isArray(input.workspaceAccesses) || input.workspaceAccesses.length !== 0)
      throw new BadRequestException("公共成员邀请不授予业务范围，请通过已注册Core配置成员使用权");
    const [roles, organization] = await Promise.all([
      transaction.role.findMany({ where: { tenantId, id: { in: input.roleIds }, isActive: true },
        include: { permissions: { include: { permission: true } } } }),
      input.organizationId ? transaction.organizationUnit.findFirst({ where: { tenantId, id: input.organizationId } })
        : Promise.resolve(undefined)
    ]);
    if (roles.length !== input.roleIds.length || input.organizationId && (!organization || organization.status !== "enabled"))
      throw new BadRequestException("角色或组织已变更，请重新核对邀请授权");
    if (roles.some(role => role.code === "TENANT_ADMIN" || role.fixedAllPermissions))
      throw new BadRequestException("成员邀请不能直接授予租户管理员身份，请在加入后通过原账号管理流程设置");
    return { actorName: actor.displayName, roleNames: input.roleIds.map(id => roles.find(role => role.id === id)!.name),
      workspaceNames: [] as string[] };
  }

  async acceptOperatorInvitationInTransaction(transaction: PlatformManagementTransaction, tenantId: string, actorUserId: string,
    input: TenantInvitationAccess & { account: string; displayName: string; isActive: boolean }, passwordHash: string) {
    await this.validateOperatorInvitationAccess(transaction, tenantId, actorUserId, input);
    const user = await this.saveUser(transaction, tenantId, { account: input.account, displayName: input.displayName,
      organizationId: input.organizationId, roleIds: input.roleIds, isActive: input.isActive,
      isSaasAdmin: false, isPlatformAdmin: false }, false);
    await transaction.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false,
      passwordChangedAt: new Date() } });
    await transaction.operationLog.create({ data: { tenantId, userId: actorUserId, action: "user.invitation.accept",
      detail: { targetType: "platform-user", targetId: user.id, roleIds: input.roleIds } } });
    return user.id;
  }
}
