/**
 * Core管理使用原Guard/ALS签名会话和原平台账号/角色映射，锁当前身份后再进入Core事务。
 * 本适配只验证租户级主体，具体Core/成员/业务范围由下游当前授权裁定。
 */
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CorePrincipal } from "@rental-os/core-contracts";
import type { SystemUserRow } from "@rental-os/shared";
import { getRequestIdentity } from "../../common/request-identity";
import type { PlatformRepository } from "../platform/platform.repository";

export interface OriginalCorePrincipalLease {
  readonly principal: CorePrincipal;
  readonly user: SystemUserRow;
  revalidate(): Promise<SystemUserRow>;
}

export class OriginalCorePrincipalAuthority {
  constructor(private readonly users: Pick<PlatformRepository, "findUserById">,
    private readonly clock: () => number = Date.now) {}

  current(): CorePrincipal {
    const identity = getRequestIdentity();
    if (!identity?.tenantId || !identity.userId || identity.audience !== "operator" || !identity.accessSession)
      throw new UnauthorizedException("缺少原Core管理会话身份");
    return { tenantId: identity.tenantId, subjectId: identity.userId, audience: identity.audience };
  }

  async lock(transaction: Prisma.TransactionClient, actor: CorePrincipal, tenantId: string, memberId?: string,
    enabling = true): Promise<OriginalCorePrincipalLease> {
    const identity = getRequestIdentity();
    const principal = this.current();
    if (actor.tenantId !== principal.tenantId || actor.subjectId !== principal.subjectId || actor.audience !== principal.audience)
      throw new ForbiddenException("Core管理请求与原签名主体不一致");
    const sessionId = identity!.accessSession!.sessionId, expiresAt = identity!.accessSession!.expiresAt;
    const workspaceId = identity!.workspaceId ?? null;
    const validTime = () => {
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= this.clock() / 1000)
        throw new UnauthorizedException("原Core管理访问令牌已到期");
    };
    validTime();
    for (const id of [...new Set([principal.tenantId, tenantId])].sort()) {
      const rows = await transaction.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM Tenant WHERE id = ${id} FOR UPDATE`;
      if (rows.length !== 1 || !["ACTIVE", "FROZEN", "DISABLED"].includes(rows[0].status)
        || (id === principal.tenantId || enabling) && rows[0].status !== "ACTIVE")
        throw new ForbiddenException("当前Core管理租户已不可用");
    }
    const targets = [{ tenantId: principal.tenantId, userId: principal.subjectId },
      ...(memberId ? [{ tenantId, userId: memberId }] : [])]
      .sort((left, right) => left.userId.localeCompare(right.userId));
    const roleIds = new Set<string>();
    const lockedUsers = new Set<string>();
    for (const target of targets) {
      if (lockedUsers.has(target.userId)) continue;
      lockedUsers.add(target.userId);
      const rows = await transaction.$queryRaw<Array<{ roleId: string | null }>>(Prisma.sql`
        SELECT roleId FROM \`User\` WHERE id = ${target.userId} AND tenantId = ${target.tenantId} FOR UPDATE`);
      if (rows.length !== 1) throw new ForbiddenException("Core管理账号或目标成员不存在");
      if (target.userId === principal.subjectId) {
        if (rows[0].roleId) roleIds.add(rows[0].roleId);
      } else {
        const member = await transaction.user.findFirst({ where: { id: target.userId, tenantId: target.tenantId },
          select: { isActive: true, isSaasAdmin: true } });
        if (!member || member.isSaasAdmin || enabling && !member.isActive)
          throw new ForbiddenException("目标成员不符合当前Core分配条件");
      }
    }
    await transaction.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${sessionId} AND userId = ${principal.subjectId} FOR UPDATE`;
    const assignments = await transaction.$queryRaw<Array<{ roleId: string }>>(Prisma.sql`
      SELECT roleId FROM \`UserRole\` WHERE userId = ${principal.subjectId} ORDER BY roleId FOR UPDATE`);
    assignments.forEach(assignment => roleIds.add(assignment.roleId));
    const permissionIds = new Set<string>();
    for (const roleId of [...roleIds].sort()) {
      const roles = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM \`Role\` WHERE id = ${roleId} AND tenantId = ${principal.tenantId} FOR UPDATE`);
      if (roles.length !== 1) throw new ForbiddenException("Core管理角色归属已变化");
      const permissions = await transaction.$queryRaw<Array<{ permissionId: string }>>(Prisma.sql`
        SELECT permissionId FROM \`RolePermission\` WHERE roleId = ${roleId} ORDER BY permissionId FOR UPDATE`);
      permissions.forEach(permission => permissionIds.add(permission.permissionId));
    }
    for (const permissionId of [...permissionIds].sort())
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM \`Permission\` WHERE id = ${permissionId} FOR UPDATE`);

    const read = async () => {
      validTime();
      const session = await transaction.authSession.findFirst({ where: { id: sessionId, userId: principal.subjectId,
        audience: "operator", revokedAt: null, expiresAt: { gt: new Date(this.clock()) } },
        select: { currentWorkspaceId: true, expiresAt: true } });
      if (!session || session.currentWorkspaceId !== workspaceId) throw new UnauthorizedException("原Core管理会话已经撤销或切换");
      const user = await this.users.findUserById(principal.subjectId, transaction);
      if (!user || user.id !== principal.subjectId || user.tenantId !== principal.tenantId || !user.isActive || user.mustChangePassword)
        throw new ForbiddenException("当前Core管理账号已不可用");
      validTime();
      if (session.expiresAt.getTime() <= this.clock()) throw new UnauthorizedException("原Core管理会话已到期");
      return user;
    };
    return { principal, user: await read(), revalidate: read };
  }
}
