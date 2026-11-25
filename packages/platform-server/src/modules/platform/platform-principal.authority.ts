/** 公共管理锁定原会话、租户、账号及角色权限，同事务复验可变事实。
 * Core管理与公共管理共用此身份围栏；不写业务表、不从签名wid授予业务workspace。 */
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { PlatformPrincipal, SystemUserRow } from "@rental-os/platform-contracts";
import { getRequestIdentity } from "../../common/request-identity";
import type { PlatformAuthTransaction } from "./platform-auth-data-store";

export interface PlatformPrincipalLease {
  readonly principal: PlatformPrincipal;
  readonly user: SystemUserRow;
  revalidate(): Promise<SystemUserRow>;
}

export class PlatformPrincipalAuthority<Tx extends PlatformAuthTransaction = PlatformAuthTransaction> {
  constructor(private readonly users: { findUserById(id: string, transaction?: Tx): Promise<SystemUserRow | undefined> },
    private readonly clock: () => number = Date.now) {}

  current(): PlatformPrincipal {
    const identity = getRequestIdentity();
    if (!identity?.tenantId || !identity.userId || identity.audience !== "operator" || !identity.accessSession)
      throw new UnauthorizedException("缺少原公共管理会话身份");
    return { tenantId: identity.tenantId, subjectId: identity.userId, audience: identity.audience };
  }

  async lock(transaction: Tx, actor: Omit<PlatformPrincipal, "audience"> & { audience: "operator" | "staff" | "client" }, tenantId: string, memberId?: string,
    enabling = true): Promise<PlatformPrincipalLease> {
    const principal = this.current(), identity = getRequestIdentity()!;
    if (actor.tenantId !== principal.tenantId || actor.subjectId !== principal.subjectId || actor.audience !== principal.audience)
      throw new ForbiddenException("管理请求与原签名主体不一致");
    if (memberId === principal.subjectId && tenantId !== principal.tenantId)
      throw new ForbiddenException("目标成员不属于指定租户");
    const sessionId = identity.accessSession!.sessionId, expiresAt = identity.accessSession!.expiresAt;
    // 原Guard仍使用业务workspace；新公共Guard保留签名范围证据但清空业务workspace。
    const workspaceId = identity.accessSession!.workspaceId === undefined ? identity.workspaceId ?? null : identity.accessSession!.workspaceId;
    const validTime = () => {
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= this.clock() / 1000)
        throw new UnauthorizedException("原管理访问令牌已到期");
    };
    validTime();
    for (const id of [...new Set([principal.tenantId, tenantId])].sort()) {
      const rows = await transaction.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM Tenant WHERE id = ${id} FOR UPDATE`;
      // raw SQL返回MySQL @map值，不能按Prisma客户端大写枚举判断或默认active。
      const status = rows.length === 1 ? rows[0].status.toLowerCase() : "";
      if (rows.length !== 1 || !["active", "frozen", "disabled"].includes(status)
        || (id === principal.tenantId || enabling) && status !== "active")
        throw new ForbiddenException("当前管理租户已不可用");
    }
    const targets = [{ tenantId: principal.tenantId, userId: principal.subjectId },
      ...(memberId ? [{ tenantId, userId: memberId }] : [])].sort((a, b) => a.userId.localeCompare(b.userId));
    const roleIds = new Set<string>(), lockedUsers = new Set<string>();
    for (const target of targets) {
      if (lockedUsers.has(target.userId)) continue;
      lockedUsers.add(target.userId);
      const rows = await transaction.$queryRaw<Array<{ roleId: string | null; isActive: number | boolean; isSaasAdmin: number | boolean }>>`
        SELECT roleId, isActive, isSaasAdmin FROM \`User\` WHERE id = ${target.userId} AND tenantId = ${target.tenantId} FOR UPDATE`;
      if (rows.length !== 1) throw new ForbiddenException("管理账号或目标成员不存在");
      if (target.userId === principal.subjectId) {
        if (rows[0].roleId) roleIds.add(rows[0].roleId);
      } else if (rows[0].isSaasAdmin === 1 || rows[0].isSaasAdmin === true
        || enabling && rows[0].isActive !== 1 && rows[0].isActive !== true)
        throw new ForbiddenException("目标成员不符合当前管理条件");
    }
    await transaction.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${sessionId} AND userId = ${principal.subjectId} FOR UPDATE`;
    const assignments = await transaction.$queryRaw<Array<{ roleId: string }>>`
      SELECT roleId FROM \`UserRole\` WHERE userId = ${principal.subjectId} ORDER BY roleId FOR UPDATE`;
    assignments.forEach(row => roleIds.add(row.roleId));
    const permissionIds = new Set<string>();
    for (const roleId of [...roleIds].sort()) {
      const roles = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM \`Role\` WHERE id = ${roleId} AND tenantId = ${principal.tenantId} FOR UPDATE`;
      if (roles.length !== 1) throw new ForbiddenException("管理角色归属已变化");
      const permissions = await transaction.$queryRaw<Array<{ permissionId: string }>>`
        SELECT permissionId FROM \`RolePermission\` WHERE roleId = ${roleId} ORDER BY permissionId FOR UPDATE`;
      permissions.forEach(row => permissionIds.add(row.permissionId));
    }
    for (const id of [...permissionIds].sort()) await transaction.$queryRaw`SELECT id FROM \`Permission\` WHERE id = ${id} FOR UPDATE`;
    const read = async () => {
      validTime();
      const session = await transaction.authSession.findFirst({ where: { id: sessionId, userId: principal.subjectId,
        audience: "operator", revokedAt: null, expiresAt: { gt: new Date(this.clock()) } } });
      if (!session || session.userId !== principal.subjectId || session.currentWorkspaceId !== workspaceId
        || (session.audience ?? "operator") !== "operator")
        throw new UnauthorizedException("原管理会话已经撤销或切换");
      const user = await this.users.findUserById(principal.subjectId, transaction);
      if (!user || user.id !== principal.subjectId || user.tenantId !== principal.tenantId || !user.isActive || user.mustChangePassword)
        throw new ForbiddenException("当前管理账号已不可用");
      validTime();
      if (session.expiresAt.getTime() <= this.clock()) throw new UnauthorizedException("原管理会话已到期");
      return user;
    };
    return { principal, user: await read(), revalidate: read };
  }
}
