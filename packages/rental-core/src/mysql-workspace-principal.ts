/** Rental 经营空间会话与成员权限读取，沿宿主的原账号和角色投影取得当前身份。
 * 会话操作复用调用方原事务，按租户、账号、会话、成员、角色及权限顺序持锁。
 * 明确空间要求启用的成员关系，业务动作和 Core 准入由原 Auth/Guard 裁定。 */
import { ConflictException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Prisma, WorkspaceStatus as PrismaWorkspaceStatus } from "@prisma/client";
import type { RoleScope, SystemDataScope, SystemUserRow } from "@rental-os/platform-contracts";
import type { BusinessWorkspace } from "./contracts";

/** 原 Auth 提供的会话身份，供同一事务中的读取与撤权复验使用。 */
export interface WorkspaceSessionIdentity {
  tenantId: string; userId: string; workspaceId: string; sessionId: string;
  audience: "operator" | "staff";
}

type WorkspaceRow = Prisma.BusinessWorkspaceGetPayload<object>;
type WorkspaceRole = Pick<Prisma.RoleGetPayload<object>,
  "id" | "name" | "isActive" | "fixedAllPermissions" | "scope" | "dataScope" | "buttonPermissions"
> & { permissions: Array<{ permission: { code: string } }> };
type WorkspaceMember = Pick<Prisma.WorkspaceMemberGetPayload<object>, "dataScope" | "locationScope">
  & { role: WorkspaceRole | null };

interface WorkspaceMemberReader {
  findFirst(input: {
    where: { userId: string; workspaceId: string; isActive: true; workspace: { status: "ACTIVE" } };
    include: { role: { include: { permissions: { include: { permission: true } } } } };
  }): PromiseLike<WorkspaceMember | null>;
}

/** 仅暴露六个读取入口实际使用的经营空间查询，兼容两种宿主生成客户端。 */
export interface RentalWorkspacePrincipalStorage {
  workspaceMember: WorkspaceMemberReader & {
    findMany(input: {
      where: { userId: string; isActive: true; workspace: { status: "ACTIVE" } };
      include: { workspace: true };
      orderBy: { createdAt: "asc" };
    }): PromiseLike<Array<{ workspace: WorkspaceRow }>>;
  };
}

export interface RentalWorkspacePrincipalTransaction {
  /** 原身份回调在本事务中读取该委托，可信主体入口先核对其存在。 */
  readonly user: unknown;
  workspaceMember: WorkspaceMemberReader;
  businessWorkspace: {
    findFirst(input: {
      where: { id: string; tenantId: string; status: "ACTIVE" };
      select: { id: true };
    }): PromiseLike<{ id: string } | null>;
  };
  authSession: {
    findFirst(input: {
      where: { id: string; userId: string; revokedAt: null; expiresAt: { gt: Date } };
      select: { audience: true; currentWorkspaceId: true };
    }): PromiseLike<{ audience: string; currentWorkspaceId: string | null } | null>;
  };
  $queryRaw<T = unknown>(query: Prisma.Sql): PromiseLike<T>;
}

export interface RentalWorkspacePrincipalParticipants<Transaction extends RentalWorkspacePrincipalTransaction> {
  findUserById(userId: string, transaction?: Transaction): PromiseLike<SystemUserRow | undefined>;
  projectWorkspace(row: WorkspaceRow): BusinessWorkspace;
  projectRoleScope(scope: WorkspaceRole["scope"]): RoleScope;
  projectDataScope(scope: WorkspaceRole["dataScope"]): SystemDataScope;
}

export class RentalWorkspacePrincipalRepository<Transaction extends RentalWorkspacePrincipalTransaction> {
  constructor(
    private readonly prisma: RentalWorkspacePrincipalStorage,
    private readonly native: RentalWorkspacePrincipalParticipants<Transaction>
  ) {}

  /** 启用成员关系与启用空间共同决定可进入列表，沿原默认空间和编码顺序展示。 */
  async listUserWorkspaces(userId: string): Promise<BusinessWorkspace[]> {
    const members = await this.prisma.workspaceMember.findMany({
      where: {
        userId,
        isActive: true,
        workspace: { status: PrismaWorkspaceStatus.ACTIVE }
      },
      include: { workspace: true },
      orderBy: { createdAt: "asc" }
    });
    return members
      .map((member) => this.native.projectWorkspace(member.workspace))
      .sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.code.localeCompare(right.code));
  }

  /** 显式空间必须在当前成员列表中，默认读取优先原默认空间，再取首个可进入空间。 */
  async resolveSessionWorkspaceId(userId: string, requested?: string): Promise<string | undefined> {
    const available = await this.listUserWorkspaces(userId);
    if (!requested) return available.find((item) => item.isDefault)?.id ?? available[0]?.id;
    const match = available.find((item) => item.id === requested);
    if (!match) throw new ForbiddenException("无权进入该经营空间，或该空间已冻结/停用");
    return match.id;
  }

  /** 成员角色与范围沿原覆盖次序投影，历史空角色继续使用原租户级默认值。 */
  async findWorkspaceScopedUser(userId: string, workspaceId?: string, tenantUser?: SystemUserRow, transaction?: Transaction): Promise<SystemUserRow | undefined> {
    const base = tenantUser ?? await this.native.findUserById(userId, transaction);
    if (!base || !workspaceId) return base;
    const member = await (transaction ?? this.prisma).workspaceMember.findFirst({
      where: {
        userId,
        workspaceId,
        isActive: true,
        workspace: { status: PrismaWorkspaceStatus.ACTIVE }
      },
        include: { role: { include: { permissions: { include: { permission: true } } } } }
    });
    // 会话已经明确要求某个空间时，成员关系失效不能退回租户级账号。
    // 否则撤销成员后，旧 refresh/access session 会重新获得 base 用户权限。
    if (!member) return undefined;
    const next: SystemUserRow = { ...base };
    if (member.role?.isActive) {
      const role = member.role;
      const isAll = base.isPlatformAdmin || role.fixedAllPermissions;
      next.roleIds = [role.id];
      next.roleNames = [role.isActive ? role.name : `${role.name}（停用）`];
      next.scope = this.native.projectRoleScope(role.scope);
      next.permissions = isAll
        ? ["*"]
        : [
            ...new Set([
              ...role.permissions.map((item) => item.permission.code),
              ...(((role.buttonPermissions as string[] | null) ?? []) as string[])
            ])
          ];
      next.dataScope = isAll ? "all" : this.native.projectDataScope(role.dataScope);
    } else if (member.role) {
      // 停用角色不能继续通过 fixedAllPermissions、buttonPermissions 或成员范围放权。
      next.roleIds = [];
      next.roleNames = [];
      next.permissions = [];
    }
    // 成员关系上的数据范围优先级最高：它是"该账号在本空间"的显式授权。
    if (member.dataScope) next.dataScope = this.native.projectDataScope(member.dataScope);
    if (member.locationScope && typeof member.locationScope === "object" && !Array.isArray(member.locationScope)) {
      const scope = member.locationScope as { mode?: unknown; locationIds?: unknown };
      // 坏数据按零地点处理；员工入口不能因错误 JSON 静默退回全部地点。
      next.locationScope = scope.mode === "all"
        ? { mode: "all", locationIds: [] }
        : scope.mode === "selected" && Array.isArray(scope.locationIds) && scope.locationIds.every((id) => typeof id === "string")
          ? { mode: "selected", locationIds: scope.locationIds }
          : { mode: "selected", locationIds: [] };
    } else {
      next.locationScope = { mode: "all", locationIds: [] };
    }
    return next;
  }

  /** 原可信绑定在调用方事务中核租户、空间和当前成员，供 Auth 的原授权租约消费。 */
  async resolveTrustedWorkspacePrincipal(binding: { userId: string; tenantId: string; workspaceId: string }, transaction: Transaction) {
    if (!transaction?.user || !transaction.workspaceMember || !transaction.businessWorkspace) throw new ForbiddenException('可信身份事务未就绪');
    const tenantUser = await this.native.findUserById(binding.userId, transaction);
    if (!tenantUser || tenantUser.tenantId !== binding.tenantId) return undefined;
    const workspace = await transaction.businessWorkspace.findFirst({
      where: { id: binding.workspaceId, tenantId: binding.tenantId, status: PrismaWorkspaceStatus.ACTIVE }, select: { id: true }
    });
    if (!workspace) return undefined;
    const user = await this.findWorkspaceScopedUser(binding.userId, binding.workspaceId, tenantUser, transaction);
    if (!user || user.tenantId !== binding.tenantId) return undefined;
    return { user, tenantUser, workspaceId: binding.workspaceId, hasWorkspaces: true, workspaceValid: true };
  }

  /** 主体锁先于业务锁，原撤权写入者更新同一组行，角色与权限按原排序持锁。 */
  async lockWorkspaceSessionUser(tx: Transaction, expected: WorkspaceSessionIdentity): Promise<SystemUserRow> {
    const tenant = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM Tenant WHERE id = ${expected.tenantId} FOR UPDATE`);
    const users = await tx.$queryRaw<Array<{ id: string; roleId: string | null }>>(Prisma.sql`SELECT id, roleId FROM \`User\` WHERE id = ${expected.userId} AND tenantId = ${expected.tenantId} FOR UPDATE`);
    if (tenant.length !== 1 || users.length !== 1) throw new UnauthorizedException("账号或租户已失效");
    const sessions = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM auth_sessions WHERE id = ${expected.sessionId} AND userId = ${expected.userId} FOR UPDATE`);
    if (sessions.length !== 1) throw new UnauthorizedException("原会话已失效");
    const members = await tx.$queryRaw<Array<{ roleId: string | null }>>(Prisma.sql`SELECT roleId FROM workspace_members WHERE tenantId = ${expected.tenantId} AND workspaceId = ${expected.workspaceId} AND userId = ${expected.userId} FOR UPDATE`);
    if (members.length !== 1) throw new ForbiddenException("当前经营空间访问权已撤销");
    const assignments = await tx.$queryRaw<Array<{ roleId: string }>>(Prisma.sql`SELECT roleId FROM \`UserRole\` WHERE userId = ${expected.userId} ORDER BY roleId FOR UPDATE`);
    const roleIds = [...new Set([users[0].roleId, members[0].roleId, ...assignments.map(row => row.roleId)].filter((id): id is string => Boolean(id)))].sort();
    const permissionIds = new Set<string>();
    for (const roleId of roleIds) {
      const roles = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM \`Role\` WHERE id = ${roleId} AND tenantId = ${expected.tenantId} FOR UPDATE`);
      if (roles.length !== 1) throw new ForbiddenException("账号角色不属于当前租户或已失效");
      const permissions = await tx.$queryRaw<Array<{ permissionId: string }>>(Prisma.sql`SELECT permissionId FROM \`RolePermission\` WHERE roleId = ${roleId} ORDER BY permissionId FOR UPDATE`);
      for (const row of permissions) permissionIds.add(row.permissionId);
    }
    for (const permissionId of [...permissionIds].sort()) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM \`Permission\` WHERE id = ${permissionId} FOR UPDATE`);
    }
    return this.readWorkspaceSessionUser(tx, expected);
  }

  /** 在原主体锁下复验会话受众、当前空间、账号和成员，返回当前空间的角色投影。 */
  async readWorkspaceSessionUser(tx: Transaction, expected: WorkspaceSessionIdentity): Promise<SystemUserRow> {
    const session = await tx.authSession.findFirst({ where: {
      id: expected.sessionId, userId: expected.userId, revokedAt: null, expiresAt: { gt: new Date() }
    }, select: { audience: true, currentWorkspaceId: true } });
    if (!session || session.audience !== expected.audience) throw new UnauthorizedException("原会话已撤销、到期或受众不一致");
    if (session.currentWorkspaceId !== expected.workspaceId) throw new ConflictException("原会话经营空间已变化，操作未执行");
    const base = await this.native.findUserById(expected.userId, tx);
    if (!base || base.tenantId !== expected.tenantId) throw new UnauthorizedException("账号或租户已停用");
    const scoped = await this.findWorkspaceScopedUser(expected.userId, expected.workspaceId, base, tx);
    if (!scoped) throw new ForbiddenException("当前经营空间访问权已撤销或空间已停用");
    return scoped;
  }
}
