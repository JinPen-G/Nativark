/** Rental 经营空间会话与成员权限读取，沿宿主的原账号和角色投影取得当前身份。
 * 会话操作复用调用方原事务，按租户、账号、会话、成员、角色及权限顺序持锁。
 * 明确空间要求启用的成员关系，业务动作和 Core 准入由原 Auth/Guard 裁定。 */
import { prismaRuntime } from "@rental-os/platform-server/prisma-runtime";
import { ConflictException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { Prisma, WorkspaceStatus as PrismaWorkspaceStatus } from "@prisma/client";
import type { RoleScope, SystemDataScope, SystemUserRow } from "@rental-os/platform-contracts";
import type { BusinessWorkspace } from "./contracts";
import type { PlatformAuthTransaction } from "@rental-os/platform-server/auth-store";

/** 原 Auth 提供的会话身份，供同一事务中的读取与撤权复验使用。 */
export interface WorkspaceSessionIdentity {
  tenantId: string; userId: string; workspaceId: string; sessionId: string;
  audience: "operator" | "staff";
}

/** 原 Guard 的投影选择，由宿主代码决定；不能从请求字段指定。 */
export interface RentalMemberSessionIdentity extends Omit<WorkspaceSessionIdentity, "workspaceId"> {
  workspaceId: string | null;
  projection: "tenant" | "workspace";
  allowInvalidWorkspace: boolean;
}
export interface RentalMemberSessionPrincipal {
  user: SystemUserRow;
  configuredLocationScope: NonNullable<SystemUserRow["locationScope"]>;
}

/** 原会话及账号已复验，但经营空间/成员不可用。业务入口仍返回原 403；
 * 只有 Core 目录读取器可将它收缩为无 Rental 空间权限，不能吞掉其他身份或存储错误。 */
export class RentalWorkspaceUnavailableError extends ForbiddenException {
  constructor() { super("当前经营空间访问权已撤销或空间已停用"); }
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

/** Original public user projection and workspace/session delegates, without any
 * dependency on unrelated generated business or optional AI model delegates. */
export type RentalWorkspaceAccessTransaction = RentalWorkspacePrincipalTransaction & PlatformAuthTransaction;

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
        workspace: { status: ("ACTIVE" as const) }
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
        workspace: { status: ("ACTIVE" as const) }
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
      where: { id: binding.workspaceId, tenantId: binding.tenantId, status: ("ACTIVE" as const) }, select: { id: true }
    });
    if (!workspace) return undefined;
    const user = await this.findWorkspaceScopedUser(binding.userId, binding.workspaceId, tenantUser, transaction);
    if (!user || user.tenantId !== binding.tenantId) return undefined;
    return { user, tenantUser, workspaceId: binding.workspaceId, hasWorkspaces: true, workspaceValid: true };
  }

  /** 主体锁先于业务锁，原撤权写入者更新同一组行，角色与权限按原排序持锁。 */
  async lockWorkspaceSessionUser(tx: Transaction, expected: WorkspaceSessionIdentity): Promise<SystemUserRow> {
    return (await this.lockMemberSessionUser(tx, { ...expected, projection: "workspace", allowInvalidWorkspace: false })).user;
  }

  /** 普通业务共用原主体锁及角色投影。Tenant S 沿原业务父锁，可在已持 Tenant X 时复用，
   * 不升级 S→X；原空间会话事务仍默认 Tenant X。其余身份锁保持原排序及强度。 */
  async lockMemberSessionUser(tx: Transaction, expected: RentalMemberSessionIdentity,
    parentLock: "exclusive" | "shared" = "exclusive"): Promise<RentalMemberSessionPrincipal> {
    const tenant = await tx.$queryRaw<Array<{ id: string }>>(parentLock === "shared"
      ? prismaRuntime.sql`SELECT id FROM Tenant WHERE id = ${expected.tenantId} LOCK IN SHARE MODE`
      : prismaRuntime.sql`SELECT id FROM Tenant WHERE id = ${expected.tenantId} FOR UPDATE`);
    const users = await tx.$queryRaw<Array<{ id: string; roleId: string | null }>>(prismaRuntime.sql`SELECT id, roleId FROM \`User\` WHERE id = ${expected.userId} AND tenantId = ${expected.tenantId} FOR UPDATE`);
    if (tenant.length !== 1 || users.length !== 1) throw new UnauthorizedException("账号或租户已失效");
    const sessions = await tx.$queryRaw<Array<{ id: string }>>(prismaRuntime.sql`SELECT id FROM auth_sessions WHERE id = ${expected.sessionId} AND userId = ${expected.userId} FOR UPDATE`);
    if (sessions.length !== 1) throw new UnauthorizedException("原会话已失效");
    const members = expected.workspaceId === null ? [] : await tx.$queryRaw<Array<{ roleId: string | null }>>(prismaRuntime.sql`SELECT roleId FROM workspace_members WHERE tenantId = ${expected.tenantId} AND workspaceId = ${expected.workspaceId} AND userId = ${expected.userId} FOR UPDATE`);
    if (members.length > 1) throw new ForbiddenException("当前经营空间成员关系不唯一");
    const assignments = await tx.$queryRaw<Array<{ roleId: string }>>(prismaRuntime.sql`SELECT roleId FROM \`UserRole\` WHERE userId = ${expected.userId} ORDER BY roleId FOR UPDATE`);
    const roleIds = [...new Set([users[0].roleId, members[0]?.roleId, ...assignments.map(row => row.roleId)].filter((id): id is string => Boolean(id)))].sort();
    const permissionIds = new Set<string>();
    for (const roleId of roleIds) {
      const roles = await tx.$queryRaw<Array<{ id: string }>>(prismaRuntime.sql`SELECT id FROM \`Role\` WHERE id = ${roleId} AND tenantId = ${expected.tenantId} FOR UPDATE`);
      if (roles.length !== 1) throw new ForbiddenException("账号角色不属于当前租户或已失效");
      const permissions = await tx.$queryRaw<Array<{ permissionId: string }>>(prismaRuntime.sql`SELECT permissionId FROM \`RolePermission\` WHERE roleId = ${roleId} ORDER BY permissionId FOR UPDATE`);
      for (const row of permissions) permissionIds.add(row.permissionId);
    }
    for (const permissionId of [...permissionIds].sort()) {
      await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM \`Permission\` WHERE id = ${permissionId} FOR UPDATE`);
    }
    // 即使没有成员行，也先复验原会话及租户角色，不能用空间不可用掩盖撤销/切换。
    const scoped = await this.readMemberSessionUser(tx, expected);
    // 缺原成员锁时，后续读到的新成员不能使本次操作获得业务权。
    if (members.length !== 1 && expected.projection === "workspace" && !expected.allowInvalidWorkspace)
      throw new ForbiddenException("当前经营空间访问权已撤销");
    return scoped;
  }

  /** 在原主体锁下复验会话受众、当前空间、账号和成员，返回当前空间的角色投影。 */
  async readWorkspaceSessionUser(tx: Transaction, expected: WorkspaceSessionIdentity): Promise<SystemUserRow> {
    return (await this.readMemberSessionUser(tx, { ...expected, projection: "workspace", allowInvalidWorkspace: false })).user;
  }

  /** 原租户会员使用 tenantUser，其余路由使用当前空间投影；允许无效空间的精确管理路由
   * 沿原 Guard 返回租户主体。配置地点仍来自原 accessContext.user，避免改变租户会员投影。 */
  async readMemberSessionUser(tx: Transaction, expected: RentalMemberSessionIdentity): Promise<RentalMemberSessionPrincipal> {
    const session = await tx.authSession.findFirst({ where: {
      id: expected.sessionId, userId: expected.userId, revokedAt: null, expiresAt: { gt: new Date() }
    }, select: { audience: true, currentWorkspaceId: true } });
    if (!session || session.audience !== expected.audience) throw new UnauthorizedException("原会话已撤销、到期或受众不一致");
    if (session.currentWorkspaceId !== expected.workspaceId) throw new ConflictException("原会话经营空间已变化，操作未执行");
    const base = await this.native.findUserById(expected.userId, tx);
    if (!base || base.id !== expected.userId || base.tenantId !== expected.tenantId || !base.isActive || base.mustChangePassword)
      throw new UnauthorizedException("账号或租户已停用或需要重新验证");
    const scoped = expected.workspaceId === null ? undefined
      : await this.findWorkspaceScopedUser(expected.userId, expected.workspaceId, base, tx);
    if (!scoped && !expected.allowInvalidWorkspace) throw new RentalWorkspaceUnavailableError();
    return { user: expected.projection === "tenant" ? base : scoped ?? base,
      configuredLocationScope: (scoped ?? base).locationScope ?? { mode: "all", locationIds: [] } };
  }
}
