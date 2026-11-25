/** 公共租户、账号角色与原签名会话的持久化仓储。
 * 登录/刷新/撤权仅访问平台表，业务空间和品类由Core适配补充。
 * 保留原角色映射与刷新事务；本仓储不创建业务绑定或授予Core使用权。 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import {
  RoleScope,
  TenantStatus,
  type SystemUserRow,
  type SystemDataScope,
  type PlatformTenantSummary,
} from "@rental-os/platform-contracts";
import { hashPassword, verifyPassword } from "../../common/password";
import { getRequestIdentity, type RequestIdentity } from "../../common/request-identity";
import { PlatformPrincipalAuthority } from "./platform-principal.authority";
import type { PlatformAuthDataStore, PlatformAuthTransaction, StoredPlatformUser,
  StoredPlatformTenant, StoredPlatformRoleScope, StoredPlatformDataScope, StoredTenantStatus } from "./platform-auth-data-store";

@Injectable()
export class PlatformIdentityRepository {
  constructor(protected readonly prisma: PlatformAuthDataStore) {}

  async findTenantByCode(code: string): Promise<PlatformTenantSummary | undefined> {
    const tenant = await this.prisma.tenant.findUnique({ where: { code } });
    return tenant ? this.toTenantIdentity(tenant) : undefined;
  }

  async getTenantIdentity(id: string): Promise<PlatformTenantSummary> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException("租户不存在");
    return this.toTenantIdentity(tenant);
  }

  async findUserForLogin(tenantCode: string, account: string, password: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { code: tenantCode } });
    if (!tenant || tenant.status !== "ACTIVE") return undefined;
    const user = await this.prisma.user.findFirst({
      where: { tenantId: tenant.id, account, isActive: true },
      include: this.userInclude(),
    });
    if (!user || !verifyPassword(user.passwordHash, password)) return undefined;
    const needsTenantOnboarding = Boolean(
      user.needsTenantOnboarding && user.mustChangePassword && user.isPlatformAdmin && !user.isSaasAdmin,
    );
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { tenant: this.toTenantIdentity(tenant), user: this.toUserRow(user), needsTenantOnboarding };
  }

  protected toTenantIdentity(tenant: StoredPlatformTenant): PlatformTenantSummary {
    return {
      tenantId: tenant.id,
      tenantCode: tenant.code,
      tenantName: tenant.name,
      operatorShortName: tenant.operatorShortName ?? undefined,
      tenantStatus: this.toTenantStatus(tenant.status),
      // 使用权目录由Core宿主读取；租户存在不蕴含已开通任何业务。
      enabledBusinessLines: [],
    };
  }

  async findUserById(id: string, transaction?: PlatformAuthTransaction): Promise<SystemUserRow | undefined> {
    const user = await (transaction ?? this.prisma).user.findFirst({
      where: { id, isActive: true, tenant: { status: "ACTIVE" } },
      include: this.userInclude(),
    });
    return user ? this.toUserRow(user) : undefined;
  }

  /** 租户共享管理只读基础账号角色；公开邀请接受时也按原邀请人当前权限复验。
   * 业务空间覆盖、签名字段和历史JSON都不能增加这里的管理权。 */
  async assertTenantManagementPermission(tenantId: string, actorUserId: string | undefined, permission: string,
    transaction: PlatformAuthTransaction = this.prisma): Promise<SystemUserRow> {
    const actor = actorUserId
      ? await transaction.user.findFirst({ where: { id: actorUserId, tenantId, isActive: true }, include: this.userInclude() })
      : null;
    if (!actor || actor.isSaasAdmin) throw new ForbiddenException("缺少当前租户管理身份");
    const user = this.toUserRow(actor);
    if (!user.isPlatformAdmin && (user.dataScope !== "all" || !user.permissions.includes(permission))) {
      throw new ForbiddenException(`租户管理操作需要完整租户范围及权限：${permission}`);
    }
    return user;
  }

  /** 敏感读取在审计及资料读取结束后，用原会话/主体围栏复验；外部等待不占持数据库锁。 */
  async revalidateTenantManagementRead(identity: Readonly<Partial<RequestIdentity>>, permission: string): Promise<void> {
    const assertSameIdentity = () => {
      if (!isDeepStrictEqual(identity, getRequestIdentity())) throw new ForbiddenException("读取期间身份或范围已变化");
    };
    assertSameIdentity();
    const authority = new PlatformPrincipalAuthority(this), principal = authority.current();
    await this.prisma.$transaction(async transaction => {
      const lease = await authority.lock(transaction, principal, principal.tenantId);
      if (lease.user.isSaasAdmin) throw new ForbiddenException("需要当前租户管理身份");
      await this.assertTenantManagementPermission(principal.tenantId, principal.subjectId, permission, transaction);
      await lease.revalidate();
      assertSameIdentity();
    });
    assertSameIdentity();
  }

  /** 改密回执的版本须在会话创建事务的用户行锁内核对，防止重置后继续签发。 */
  async createAuthSession(input: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    currentWorkspaceId?: string | null;
    audience?: "operator" | "staff";
  }, expectedVersion?: number) {
    if (expectedVersion === undefined) return this.prisma.authSession.create({ data: input });
    return this.prisma.$transaction(async transaction => {
      const users = await transaction.$queryRaw<Array<{ tokenVersion: number }>>`
        SELECT tokenVersion FROM User WHERE id = ${input.userId} FOR UPDATE`;
      if (users.length !== 1 || users[0].tokenVersion !== expectedVersion) {
        throw new ConflictException("密码已变化，请重新登录");
      }
      return transaction.authSession.create({ data: input });
    });
  }

  /** 单次刷新令牌的消费和新会话创建必须同事务完成，避免旧令牌已作废却没有替代会话。 */
  async rotateAuthSession(
    previousSessionId: string,
    input: {
      id: string;
      userId: string;
      refreshTokenHash: string;
      expiresAt: Date;
      currentWorkspaceId?: string | null;
      audience?: "operator" | "staff";
    },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.authSession.updateMany({
        where: { id: previousSessionId, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) return false;
      await tx.authSession.create({ data: input });
      return true;
    });
  }

  async getAuthSession(id: string, transaction?: PlatformAuthTransaction) {
    // Trusted browser consent uses the original session fence, in the caller's
    // transaction. Normal Web reads retain their original query/behavior.
    if (transaction) {
      if (!transaction.authSession || typeof transaction.$queryRaw !== "function")
        throw new ForbiddenException("浏览器身份事务未就绪");
      await transaction.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${id} FOR UPDATE`;
    }
    return (transaction ?? this.prisma).authSession.findFirst({
      where: { id, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { include: { tenant: true } } },
    });
  }

  async getAuthSessionByRefreshHash(refreshTokenHash: string) {
    return this.prisma.authSession.findFirst({
      where: { refreshTokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { include: { tenant: true } } },
    });
  }

  async revokeAuthSession(id: string): Promise<boolean> {
    const result = await this.prisma.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count === 1;
  }

  async revokeUserSessions(userId: string) {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changeUserPassword(userId: string, currentPassword: string, nextPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !verifyPassword(user.passwordHash, currentPassword)) {
      throw new BadRequestException("当前密码不正确");
    }
    if (!Number.isSafeInteger(user.tokenVersion)) throw new ConflictException("密码版本不可用，请重新登录");
    return this.prisma.$transaction(async transaction => {
      // 旧密码在事务外校验，写入仍须匹配该次哈希和版本，防止并发旧校验覆盖。
      const changed = await transaction.user.updateMany({
        where: { id: userId, passwordHash: user.passwordHash, tokenVersion: user.tokenVersion },
        data: {
          passwordHash: hashPassword(nextPassword),
          mustChangePassword: false,
          needsTenantOnboarding: false,
          passwordChangedAt: new Date(),
          tokenVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ConflictException("密码已变化，请重新登录后重试");
      await transaction.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return user.tokenVersion + 1;
    });
  }

  protected async findUserWithRoles(id: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id },
      include: this.userInclude(),
    });
  }

  protected userInclude() {
    return {
      organization: true,
      role: {
        include: {
          permissions: {
            include: { permission: true },
          },
        },
      },
      roleAssignments: {
        include: {
          role: {
            include: {
              permissions: {
                include: { permission: true },
              },
            },
          },
        },
      },
    } as const;
  }

  protected toUserRow(
    user: StoredPlatformUser,
  ): SystemUserRow {
    const roles = [
      ...user.roleAssignments.map((item) => item.role),
      ...(user.role ? [user.role] : []),
    ].filter((role, index, array) => array.findIndex((item) => item.id === role.id) === index);
    const activeRoles = roles.filter((role) => role.isActive);
    const isPlatformAdmin = user.isPlatformAdmin || activeRoles.some((role) => role.fixedAllPermissions);
    const permissions = isPlatformAdmin
      ? ["*"]
      : [
          ...new Set(
            activeRoles.flatMap((role) => [
              ...role.permissions.map((item) => item.permission.code),
              ...(((role.buttonPermissions as string[] | null) ?? []) as string[]),
            ]),
          ),
        ];

    return {
      id: user.id,
      tenantId: user.tenantId,
      account: user.account,
      displayName: user.displayName,
      phone: user.phone ?? undefined,
      organizationId: user.organizationId ?? undefined,
      organizationName: user.organization?.name,
      roleIds: roles.map((role) => role.id),
      roleNames: roles.map((role) => (role.isActive ? role.name : `${role.name}（停用）`)),
      scope:
        roles[0]?.scope !== undefined
          ? this.toSharedRoleScope(roles[0].scope)
          : user.organization
            ? this.toSharedRoleScope(user.organization.type)
            : RoleScope.Operator,
      isPlatformAdmin,
      isSaasAdmin: user.isSaasAdmin,
      mustChangePassword: user.mustChangePassword,
      isActive: user.isActive,
      permissions,
      dataScope: isPlatformAdmin ? "all" : this.resolveUserDataScope(activeRoles),
    };
  }

  protected toTenantStatus(status: StoredTenantStatus) {
    if (status === "FROZEN") {
      return TenantStatus.Frozen;
    }
    if (status === "DISABLED") {
      return TenantStatus.Disabled;
    }
    return TenantStatus.Active;
  }

  protected toSharedRoleScope(scope: StoredPlatformRoleScope): RoleScope {
    const value = String(scope);
    if (value === "CAR_SHOP") {
      return RoleScope.CarShop;
    }
    if (value === "STORE") {
      return RoleScope.Store;
    }
    if (value === "STATION") {
      return RoleScope.Station;
    }
    return RoleScope.Operator;
  }

  protected toSharedDataScope(scope?: StoredPlatformDataScope | SystemDataScope): SystemDataScope {
    if (scope === "ALL" || scope === "all") {
      return "all";
    }
    if (scope === "ORGANIZATION" || scope === "organization") {
      return "organization";
    }
    if (scope === "OWN" || scope === "own") {
      return "own";
    }
    return "store";
  }

  protected resolveUserDataScope(roles: Array<{ dataScope: StoredPlatformDataScope }>) {
    const order: SystemDataScope[] = ["own", "store", "organization", "all"];
    const scope = roles
      .map((role) => this.toSharedDataScope(role.dataScope))
      .sort((left, right) => order.indexOf(right) - order.indexOf(left))[0];
    return scope ?? "own";
  }
}
