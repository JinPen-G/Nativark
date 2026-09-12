import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  ConfigStatus,
  OrganizationType as PrismaOrganizationType,
  PermissionKind,
  Prisma,
  RentalCategoryCode as PrismaRentalCategoryCode,
  RoleScope as PrismaRoleScope,
  SystemDataScope as PrismaSystemDataScope,
  TenantStatus as PrismaTenantStatus,
  WorkspaceStatus as PrismaWorkspaceStatus,
} from "@prisma/client";
import type {
  BusinessWorkspace,
  BusinessWorkspaceStatus,
  CreateBusinessWorkspaceRequest,
  SaveWorkspaceMemberRequest,
  UpdateBusinessWorkspaceRequest,
  WorkspaceMember,
  GeneratePlatformNumberRequest,
  OrganizationSummary,
  PermissionModule,
  PlatformAuditLogQuery,
  PlatformAuditLogRow,
  PlatformAuditResult,
  PlatformDictionaryGroup,
  PlatformFilterPreset,
  PlatformFilterPresetQuery,
  PlatformNumberRule,
  SaveOrganizationRequest,
  SavePlatformFilterPresetRequest,
  SavePlatformDictionaryGroupRequest,
  SavePlatformNumberRuleRequest,
  SaveSystemRoleRequest,
  SaveSystemUserAccessRequest,
  SaveSystemUserRequest,
  SaveWorkspaceAccessRequest,
  SystemDataScope,
  SystemRoleRow,
  SystemRulesConfig,
  SystemUserRow,
  TenantBootstrapPreview,
  TenantBootstrapRequest,
  TenantBootstrapResult,
  TenantSummary,
  UpdateTenantRequest,
  UpdateTenantStatusRequest
} from "@store-rental/shared";
import { RoleScope, TenantStatus } from "@store-rental/shared";
import { generateTemporaryPassword, hashPassword, verifyPassword } from "../../common/password";
import {
  buildOrganizationWhere,
  buildSystemUserWhere
} from "../../common/data-permission";
import { PrismaService } from "../database/prisma.service";
import { getRequestWorkspaceId, requireRequestTenantId } from "../../common/request-identity";

type RoleWithPermissions = Awaited<
  ReturnType<PlatformRepository["findRoleWithPermissions"]>
>;

@Injectable()
export class PlatformRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listTenants(): Promise<TenantSummary[]> {
    const tenants = await this.prisma.tenant.findMany({
      where: { code: { not: "platform" } },
      include: {
        rentalProfile: { include: { category: true } },
        businessWorkspaces: { select: { categoryCode: true } },
        _count: { select: { users: true, organizations: true, rentalOrders: true } }
      },
      orderBy: { code: "asc" }
    });

    return tenants.map((tenant) => this.toTenantSummary(tenant));
  }

  async getTenant(id: string): Promise<TenantSummary> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        rentalProfile: { include: { category: true } },
        businessWorkspaces: { select: { categoryCode: true } },
        _count: { select: { users: true, organizations: true, rentalOrders: true } }
      }
    });
    if (!tenant) throw new NotFoundException("租户不存在");
    return this.toTenantSummary(tenant);
  }

  async updateTenant(id: string, input: UpdateTenantRequest, operator: SystemUserRow) {
    const name = input.tenantName.trim();
    if (!name) throw new BadRequestException("租户名称不能为空");
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.tenant.findUnique({ where: { id } });
      if (!current) throw new NotFoundException("租户不存在");
      if (current.code === "platform") throw new BadRequestException("SaaS 平台主体不能通过租户接口修改");
      await tx.tenant.update({ where: { id }, data: { name } });
      await tx.operationLog.create({
        data: {
          tenantId: id,
          userId: operator.id,
          action: "tenant.update",
          detail: { before: { name: current.name }, after: { name }, operator: operator.displayName }
        }
      });
    });
    return this.getTenant(id);
  }

  async updateTenantStatus(id: string, input: UpdateTenantStatusRequest, operator: SystemUserRow) {
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException("状态变更原因不能为空");
    const statusMap = {
      [TenantStatus.Active]: PrismaTenantStatus.ACTIVE,
      [TenantStatus.Frozen]: PrismaTenantStatus.FROZEN,
      [TenantStatus.Disabled]: PrismaTenantStatus.DISABLED
    } as const;
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.tenant.findUnique({ where: { id } });
      if (!current) throw new NotFoundException("租户不存在");
      if (current.code === "platform") throw new BadRequestException("SaaS 平台主体不能冻结或停用");
      await tx.tenant.update({
        where: { id },
        data: {
          status: statusMap[input.status],
          statusReason: reason,
          statusChangedAt: new Date(),
          statusChangedBy: operator.displayName
        }
      });
      if (input.status !== TenantStatus.Active) {
        await tx.authSession.updateMany({
          where: { user: { tenantId: id }, revokedAt: null },
          data: { revokedAt: new Date() }
        });
      }
      await tx.operationLog.create({
        data: {
          tenantId: id,
          userId: operator.id,
          action: "tenant.status.update",
          detail: { before: current.status, after: input.status, reason, operator: operator.displayName }
        }
      });
    });
    return this.getTenant(id);
  }

  async findTenantByCode(code: string): Promise<TenantSummary | undefined> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { code },
      include: { rentalProfile: { include: { category: true } } }
    });
    if (!tenant) {
      return undefined;
    }

    return {
      tenantId: tenant.id,
      tenantCode: tenant.code,
      tenantName: tenant.name,
      tenantStatus: this.toTenantStatus(tenant.status),
      enabledBusinessLines: ["rental_core"],
      categoryCode: this.toDomainCategoryCode(tenant.rentalProfile?.categoryCode),
      categoryName: tenant.rentalProfile?.category.name,
      capabilities: tenant.rentalProfile?.capabilities as TenantSummary["capabilities"]
    };
  }

  async findUserForLogin(tenantCode: string, account: string, password: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { code: tenantCode },
      include: { rentalProfile: { include: { category: true } } }
    });
    if (!tenant || tenant.status !== PrismaTenantStatus.ACTIVE) {
      return undefined;
    }

    const user = await this.prisma.user.findFirst({
      where: {
        tenantId: tenant.id,
        account,
        isActive: true
      },
      include: this.userInclude()
    });
    if (!user || !verifyPassword(user.passwordHash, password)) {
      return undefined;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    return {
      tenant: {
        tenantId: tenant.id,
        tenantCode: tenant.code,
        tenantName: tenant.name,
        tenantStatus: this.toTenantStatus(tenant.status),
        enabledBusinessLines: ["rental_core"],
        categoryCode: this.toDomainCategoryCode(tenant.rentalProfile?.categoryCode),
        categoryName: tenant.rentalProfile?.category.name,
        capabilities: tenant.rentalProfile?.capabilities as TenantSummary["capabilities"]
      },
      user: this.toUserRow(user)
    };
  }

  async findUserById(id: string): Promise<SystemUserRow | undefined> {
    const user = await this.prisma.user.findFirst({
      where: { id, isActive: true, tenant: { status: PrismaTenantStatus.ACTIVE } },
      include: this.userInclude()
    });
    return user ? this.toUserRow(user) : undefined;
  }

  async createAuthSession(input: { id: string; userId: string; refreshTokenHash: string; expiresAt: Date; currentWorkspaceId?: string | null }) {
    return this.prisma.authSession.create({ data: input });
  }

  /** 单次刷新令牌的消费和新会话创建必须同事务完成，避免旧令牌已作废却没有替代会话。 */
  async rotateAuthSession(
    previousSessionId: string,
    input: { id: string; userId: string; refreshTokenHash: string; expiresAt: Date; currentWorkspaceId?: string | null }
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.authSession.updateMany({
        where: { id: previousSessionId, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date() }
      });
      if (revoked.count !== 1) return false;
      await tx.authSession.create({ data: input });
      return true;
    });
  }

  async getAuthSession(id: string) {
    return this.prisma.authSession.findFirst({
      where: { id, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { include: { tenant: true } } }
    });
  }

  async getAuthSessionByRefreshHash(refreshTokenHash: string) {
    return this.prisma.authSession.findFirst({
      where: { refreshTokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { include: { tenant: true } } }
    });
  }

  async revokeAuthSession(id: string): Promise<boolean> {
    const result = await this.prisma.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    return result.count === 1;
  }

  async revokeUserSessions(userId: string) {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  async changeUserPassword(userId: string, currentPassword: string, nextPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !verifyPassword(user.passwordHash, currentPassword)) {
      throw new BadRequestException("当前密码不正确");
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: hashPassword(nextPassword),
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          tokenVersion: { increment: 1 }
        }
      }),
      this.prisma.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() }
      })
    ]);
  }

  /** 本机开发演示账号的统一重置；调用方已完成非生产环境与密码策略校验。 */
  async setLocalDemoAccountPassword(password: string) {
    const users = await this.prisma.user.findMany({
      where: { account: "admin", tenant: { code: { in: ["demo", "demo2", "platform"] } } },
      select: { id: true, tenant: { select: { code: true } } }
    });
    if (users.length !== 3) {
      throw new BadRequestException("本地演示账号尚未初始化，请先完成数据库初始化");
    }
    const expected = new Set(["demo", "demo2", "platform"]);
    if (users.some((user) => !expected.delete(user.tenant.code)) || expected.size > 0) {
      throw new BadRequestException("本地演示账号不完整，请先完成数据库初始化");
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const user of users) {
        await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash: hashPassword(password),
            mustChangePassword: false,
            passwordChangedAt: now,
            tokenVersion: { increment: 1 }
          }
        });
      }
      await tx.authSession.updateMany({
        where: { userId: { in: users.map((user) => user.id) }, revokedAt: null },
        data: { revokedAt: now }
      });
    });
  }

  /* ---------- SPACE-01：经营空间主档与成员关系 ---------- */

  /**
   * 空间范围只取自服务端会话，绝不接受客户端提交的 tenantId。
   * 需求 2.3：租户业务请求中的当前经营空间必须来自服务端验证过的会话上下文。
   */
  private workspaceTenantId(currentUser?: SystemUserRow): string {
    return currentUser?.tenantId ?? requireRequestTenantId();
  }

  /**
   * SPACE-03：按**经营空间**取品类与业务能力。
   *
   * 守卫原先用租户级 `tenant_rental_profiles` 的品类做 capability 与车辆域校验。
   * 同租户有多个空间且品类不同时那是错的：一个 camping 空间会被按 camera 的
   * 能力集放行。品类的事实源是 `business_workspaces.categoryCode`（需求 3），
   * 能力取该品类定义的默认能力集。
   */
  async getWorkspaceCategoryContext(
    tenantId: string,
    workspaceId: string
  ): Promise<{ categoryCode?: TenantSummary["categoryCode"]; categoryName?: string; capabilities?: TenantSummary["capabilities"] }> {
    const workspace = await this.prisma.businessWorkspace.findFirst({
      where: { id: workspaceId, tenantId },
      include: { category: { select: { name: true, defaultCapabilities: true } } }
    });
    if (!workspace) return {};
    return {
      categoryCode: this.toDomainCategoryCode(workspace.categoryCode),
      // categoryName 供前端直接展示；缺了它，切换空间后标题仍是旧品类名。
      categoryName: workspace.category.name,
      capabilities: workspace.category.defaultCapabilities as unknown as TenantSummary["capabilities"]
    };
  }

  async listBusinessWorkspaces(currentUser?: SystemUserRow): Promise<BusinessWorkspace[]> {
    return this.listBusinessWorkspacesForTenant(this.workspaceTenantId(currentUser));
  }

  async listBusinessWorkspacesForTenant(tenantId: string): Promise<BusinessWorkspace[]> {
    const rows = await this.prisma.businessWorkspace.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }]
    });
    return rows.map((row) => this.toWorkspace(row));
  }

  async createBusinessWorkspace(
    input: CreateBusinessWorkspaceRequest,
    currentUser?: SystemUserRow,
    /**
     * 在创建空间的**同一事务内**、提交之前执行。
     * 需求 4.1：新增空间必须原子创建空间档案与品类配置，抛错则一起回滚。
     */
    onBeforeCommit?: (tx: Prisma.TransactionClient, workspaceId: string, tenantId: string) => Promise<void>
  ): Promise<BusinessWorkspace> {
    return this.createBusinessWorkspaceForTenant(this.workspaceTenantId(currentUser), input, onBeforeCommit);
  }

  async createBusinessWorkspaceForTenant(
    tenantId: string,
    input: CreateBusinessWorkspaceRequest,
    onBeforeCommit?: (tx: Prisma.TransactionClient, workspaceId: string, tenantId: string) => Promise<void>
  ): Promise<BusinessWorkspace> {
    const code = input.code?.trim().toLowerCase();
    const name = input.name?.trim();
    if (!code || !name || !input.categoryCode) throw new BadRequestException("空间编码、名称和经营品类不能为空");
    if (code === "default") throw new BadRequestException("default 为升级兼容层保留编码，请使用其他编码");
    const categoryCode = this.toPrismaCategoryCode(input.categoryCode);
    const created = await this.prisma.$transaction(async (tx) => {
      if (!(await tx.rentalCategoryDefinition.findUnique({ where: { code: categoryCode } }))) {
        throw new BadRequestException("经营品类不存在");
      }
      if (await tx.businessWorkspace.findFirst({ where: { tenantId, code } })) {
        throw new BadRequestException("空间编码已存在");
      }
      const workspaceId = `ws_${randomUUID()}`;
      const created = await tx.businessWorkspace.create({
        data: {
          // 非默认空间的 id 与 defaultMarker 同值：marker 只用于让「每租户一个默认空间」
          // 成为唯一约束，非默认行必须各自唯一才不会互相冲突。
          id: workspaceId,
          tenantId,
          code,
          name,
          categoryCode,
          status: PrismaWorkspaceStatus.ACTIVE,
          isDefault: false,
          defaultMarker: workspaceId,
          // 新建空间默认 development：首期品类能力未全部实现前不能伪装为正式经营。
          // 调用方可显式请求 production；服务层会在同一事务里校验全部品类必选能力。
          runMode: input.runMode ?? "development"
        }
      });
      await onBeforeCommit?.(tx, workspaceId, tenantId);
      return created;
    });
    return this.toWorkspace(created);
  }

  async updateBusinessWorkspace(
    id: string,
    input: UpdateBusinessWorkspaceRequest,
    currentUser?: SystemUserRow
  ): Promise<BusinessWorkspace> {
    return this.updateBusinessWorkspaceForTenant(this.workspaceTenantId(currentUser), id, input);
  }

  async updateBusinessWorkspaceForTenant(
    tenantId: string,
    id: string,
    input: UpdateBusinessWorkspaceRequest
  ): Promise<BusinessWorkspace> {
    const name = input.name?.trim();
    if (input.name !== undefined && !name) throw new BadRequestException("空间名称不能为空");
    const updated = await this.prisma.$transaction(async (tx) => {
      // 用 tenantId 条件定位，避免越权改到别的租户的空间。
      const current = await tx.businessWorkspace.findFirst({ where: { id, tenantId } });
      if (!current) throw new NotFoundException("经营空间不存在");
      return tx.businessWorkspace.update({
        where: { id },
        data: {
          ...(name ? { name } : {}),
          ...(input.status ? { status: this.toPrismaWorkspaceStatus(input.status) } : {}),
          // 运行模式可改：存量空间补齐必选能力后需要一条显式「转正」路径。
          // 是否允许转正由服务层的能力门禁校验，不在这里放开。
          ...(input.runMode ? { runMode: input.runMode } : {})
        }
      });
    });
    return this.toWorkspace(updated);
  }

  async listWorkspaceMembers(workspaceId: string, currentUser?: SystemUserRow): Promise<WorkspaceMember[]> {
    const tenantId = this.workspaceTenantId(currentUser);
    const workspace = await this.prisma.businessWorkspace.findFirst({ where: { id: workspaceId, tenantId } });
    if (!workspace) throw new NotFoundException("经营空间不存在");
    const rows = await this.prisma.workspaceMember.findMany({
      where: { tenantId, workspaceId },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => this.toWorkspaceMember(row));
  }

  async saveWorkspaceMember(
    workspaceId: string,
    input: SaveWorkspaceMemberRequest,
    currentUser?: SystemUserRow
  ): Promise<WorkspaceMember> {
    const tenantId = this.workspaceTenantId(currentUser);
    if (!input.userId) throw new BadRequestException("账号不能为空");
    const saved = await this.prisma.$transaction(async (tx) => {
      const workspace = await tx.businessWorkspace.findFirst({ where: { id: workspaceId, tenantId } });
      if (!workspace) throw new NotFoundException("经营空间不存在");
      if (workspace.status !== PrismaWorkspaceStatus.ACTIVE) {
        throw new BadRequestException("冻结或停用的经营空间不能变更成员");
      }
      // 复合外键已在库层挡住跨租户成员，这里仍显式校验，为的是给出可读的 400
      // 而不是把数据库外键错误直接抛给调用方。
      const user = await tx.user.findFirst({ where: { id: input.userId, tenantId } });
      if (!user) throw new BadRequestException("账号不存在或不属于当前租户");
      if (input.roleId) {
        const role = await tx.role.findFirst({ where: { id: input.roleId, tenantId } });
        if (!role) throw new BadRequestException("角色不存在或不属于当前租户");
      }
      const data = {
        roleId: input.roleId ?? null,
        dataScope: input.dataScope ? this.toPrismaDataScope(input.dataScope) : null,
        isActive: input.isActive ?? true
      };
      return tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId, userId: input.userId } },
        create: { tenantId, workspaceId, userId: input.userId, ...data },
        update: data
      });
    });
    return this.toWorkspaceMember(saved);
  }

  private toWorkspace(row: {
    id: string;
    tenantId: string;
    code: string;
    name: string;
    categoryCode: PrismaRentalCategoryCode;
    status: PrismaWorkspaceStatus;
    isDefault: boolean;
    runMode?: string;
    createdAt: Date;
    updatedAt: Date;
  }): BusinessWorkspace {
    return {
      id: row.id,
      tenantId: row.tenantId,
      code: row.code,
      name: row.name,
      categoryCode: this.toDomainCategoryCode(row.categoryCode) as BusinessWorkspace["categoryCode"],
      status: row.status.toLowerCase() as BusinessWorkspaceStatus,
      isDefault: row.isDefault,
      // 未选到该列时按最保守的 production 处理：宁可挡住也不放开一个未核验的空间。
      runMode: (row.runMode as BusinessWorkspace["runMode"]) ?? "production",
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private toWorkspaceMember(row: {
    tenantId: string;
    workspaceId: string;
    userId: string;
    roleId: string | null;
    dataScope: PrismaSystemDataScope | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): WorkspaceMember {
    return {
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      userId: row.userId,
      roleId: row.roleId ?? undefined,
      dataScope: row.dataScope ? (row.dataScope.toLowerCase() as SystemDataScope) : undefined,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private toPrismaWorkspaceStatus(status: BusinessWorkspaceStatus): PrismaWorkspaceStatus {
    const map = {
      active: PrismaWorkspaceStatus.ACTIVE,
      frozen: PrismaWorkspaceStatus.FROZEN,
      disabled: PrismaWorkspaceStatus.DISABLED
    } as const;
    return map[status];
  }

  /* ---------- SPACE-02：会话空间上下文 ---------- */

  /**
   * 该账号可进入的经营空间：必须是**启用的成员关系**且空间本身启用。
   * 冻结/停用的空间不出现在可进入列表里，因此前端也拿不到可切换项。
   */
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
      .map((member) => this.toWorkspace(member.workspace))
      .sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.code.localeCompare(right.code));
  }

  /**
   * 校验并解析会话的当前经营空间。
   *
   * 传入 workspaceId 时逐项校验（成员关系启用、空间启用、租户匹配）；
   * 不传时按「默认空间优先，否则第一个可进入空间」解析。
   * 返回 undefined 表示该账号没有任何可进入空间（如平台管理租户）——
   * 这不是错误，但经营接口会对此 fail-closed。
   *
   * 跨租户由成员关系保证：`workspace_members` 的复合外键已使
   * 「账号在该空间有成员关系」蕴含两者同租户，因此按 userId 查成员即可，
   * 不需要也不应该再信任调用方传来的 tenantId。
   */
  async resolveSessionWorkspaceId(userId: string, requested?: string): Promise<string | undefined> {
    const available = await this.listUserWorkspaces(userId);
    if (!requested) return available.find((item) => item.isDefault)?.id ?? available[0]?.id;
    const match = available.find((item) => item.id === requested);
    if (!match) throw new ForbiddenException("无权进入该经营空间，或该空间已冻结/停用");
    return match.id;
  }

  /**
   * 按当前经营空间解析账号权限。
   *
   * 需求 3：同一账号可在不同空间拥有不同角色和数据范围。因此成员关系上的
   * roleId 一旦存在，就**取代**租户级角色参与权限计算；dataScope 同理。
   * 成员关系没配时沿用租户级默认值（升级兼容层的行为）。
   */
  async findWorkspaceScopedUser(userId: string, workspaceId?: string): Promise<SystemUserRow | undefined> {
    const base = await this.findUserById(userId);
    if (!base || !workspaceId) return base;
    const member = await this.prisma.workspaceMember.findFirst({
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
      next.scope = this.toSharedRoleScope(role.scope);
      next.permissions = isAll
        ? ["*"]
        : [
            ...new Set([
              ...role.permissions.map((item) => item.permission.code),
              ...(((role.buttonPermissions as string[] | null) ?? []) as string[])
            ])
          ];
      next.dataScope = isAll ? "all" : this.toSharedDataScope(role.dataScope);
    } else if (member.role) {
      // 停用角色不能继续通过 fixedAllPermissions、buttonPermissions 或成员范围放权。
      next.roleIds = [];
      next.roleNames = [];
      next.permissions = [];
    }
    // 成员关系上的数据范围优先级最高：它是"该账号在本空间"的显式授权。
    if (member.dataScope) next.dataScope = this.toSharedDataScope(member.dataScope);
    return next;
  }

  async setSessionWorkspace(sessionId: string, workspaceId: string | null, expectedWorkspaceId?: string | null): Promise<boolean> {
    const result = await this.prisma.authSession.updateMany({
      where: {
        id: sessionId,
        ...(expectedWorkspaceId === undefined
          ? {}
          : { currentWorkspaceId: expectedWorkspaceId })
      },
      data: { currentWorkspaceId: workspaceId }
    });
    return result.count === 1;
  }

  /**
   * 旧 `/store-rental/*` 车辆域的表仍只有 tenantId，尚未完成空间级迁移。
   * 在迁移完成前只允许默认车辆空间使用这组兼容接口，禁止非默认空间把
   * 同一套租户级车辆数据伪装成自己的空间数据。
   */
  async isLegacyVehicleDomainWorkspaceAllowed(tenantId: string, workspaceId: string): Promise<boolean> {
    const [current, defaultWorkspace] = await Promise.all([
      this.prisma.businessWorkspace.findFirst({
        where: { id: workspaceId, tenantId, categoryCode: PrismaRentalCategoryCode.VEHICLE },
        select: { id: true }
      }),
      this.prisma.businessWorkspace.findFirst({
        where: { tenantId, isDefault: true, categoryCode: PrismaRentalCategoryCode.VEHICLE },
        select: { id: true }
      })
    ]);
    return Boolean(current && defaultWorkspace && current.id === defaultWorkspace.id);
  }

  async listOrganizations(
    tenantId?: string,
    currentUser?: SystemUserRow
  ): Promise<OrganizationSummary[]> {
    const organizations = await this.prisma.organizationUnit.findMany({
      where: buildOrganizationWhere(
        tenantId,
        currentUser
      ) as Prisma.OrganizationUnitWhereInput,
      orderBy: [{ tenantId: "asc" }, { code: "asc" }]
    });

    return organizations.map((organization) => this.toOrganizationSummary(organization));
  }

  async getOrganizationTenantId(id: string) {
    return (await this.prisma.organizationUnit.findUnique({ where: { id }, select: { tenantId: true } }))?.tenantId;
  }

  async getRoleTenantId(id: string) {
    return (await this.prisma.role.findUnique({ where: { id }, select: { tenantId: true } }))?.tenantId;
  }

  async getUserTenantId(id: string) {
    return (await this.prisma.user.findUnique({ where: { id }, select: { tenantId: true } }))?.tenantId;
  }

  async saveOrganization(input: SaveOrganizationRequest): Promise<OrganizationSummary> {
    const code = input.code.trim();
    const name = input.name.trim();
    const parentId = input.parentId?.trim() || undefined;
    const status = input.status ?? "enabled";

    if (!code || !name) {
      throw new BadRequestException("组织编码和组织名称不能为空");
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId }
    });
    if (!tenant) {
      throw new BadRequestException("租户不存在");
    }
    const duplicated = await this.prisma.organizationUnit.findFirst({
      where: {
        id: { not: input.id },
        tenantId: input.tenantId,
        code
      }
    });
    if (duplicated) {
      throw new BadRequestException("该租户下组织编码已存在");
    }
    if (parentId) {
      if (parentId === input.id) {
        throw new BadRequestException("上级组织不能选择自身");
      }
      const parent = await this.prisma.organizationUnit.findFirst({
        where: { id: parentId, tenantId: input.tenantId }
      });
      if (!parent) {
        throw new BadRequestException("上级组织不属于当前租户");
      }
    }

    const existing = input.id
      ? await this.prisma.organizationUnit.findFirst({
          where: { id: input.id, tenantId: input.tenantId }
        })
      : undefined;
    if (input.id && !existing) {
      throw new NotFoundException("组织不存在");
    }
    const id = input.id ?? `org_${randomUUID()}`;
    const row = await this.prisma.organizationUnit.upsert({
      where: { id },
      update: {
        parentId,
        type: this.toPrismaOrganizationType(input.type),
        code,
        name,
        status
      },
      create: {
        id,
        tenantId: input.tenantId,
        parentId,
        type: this.toPrismaOrganizationType(input.type),
        code,
        name,
        status
      }
    });

    await this.recordAuditLog({
      tenantId: row.tenantId,
      action: existing ? "organization.update" : "organization.create",
      operator: input.operator ?? "平台管理员",
      targetType: "organization",
      targetId: row.id,
      detail: `${existing ? "更新" : "创建"}组织 ${row.name}`
    });

    return this.toOrganizationSummary(row);
  }

  async setOrganizationStatus(
    id: string,
    status: OrganizationSummary["status"],
    operator = "平台管理员"
  ): Promise<OrganizationSummary> {
    const existing = await this.prisma.organizationUnit.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException("组织不存在");
    }

    const row = await this.prisma.organizationUnit.update({
      where: { id },
      data: { status }
    });
    await this.recordAuditLog({
      tenantId: row.tenantId,
      action: "organization.status",
      operator,
      targetType: "organization",
      targetId: row.id,
      detail: `${status === "enabled" ? "启用" : "停用"}组织 ${row.name}`
    });

    return this.toOrganizationSummary(row);
  }

  async listPermissionTree(): Promise<PermissionModule[]> {
    const permissions = await this.prisma.permission.findMany({
      orderBy: { code: "asc" }
    });
    const modules = new Map<string, PermissionModule>();

    for (const permission of permissions) {
      const module = this.permissionModuleOf(permission.code, permission.module);
      const display = this.permissionDisplayOf(permission);
      if (!modules.has(module.code)) {
        modules.set(module.code, {
          code: module.code,
          name: module.name,
          children: []
        });
      }
      modules.get(module.code)?.children.push({
        code: permission.code,
        name: display.name,
        description: display.description
      });
    }

    return [...modules.values()];
  }

  async listRoles(tenantId: string): Promise<SystemRoleRow[]> {
    const roles = await this.prisma.role.findMany({
      where: { tenantId },
      include: {
        permissions: {
          include: {
            permission: true
          }
        }
      },
      orderBy: [{ fixedAllPermissions: "desc" }, { code: "asc" }]
    });

    return roles.map((role) => this.toRoleRow(role));
  }

  async saveRole(input: SaveSystemRoleRequest, tenantId: string): Promise<SystemRoleRow> {
    const existing = input.id
      ? await this.findRoleWithPermissions(input.id)
      : undefined;
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();

    if (!code || !name) {
      throw new BadRequestException("角色编码和角色名称不能为空");
    }

    const duplicated = await this.prisma.role.findFirst({
      where: {
        id: { not: existing?.id },
        tenantId,
        code
      }
    });
    if (duplicated) {
      throw new BadRequestException("角色编码已存在");
    }

    if (existing && existing.tenantId !== tenantId) {
      throw new NotFoundException("角色不存在");
    }
    const fixedAllPermissions =
      existing?.fixedAllPermissions ?? code === "TENANT_ADMIN";
    const requestedPermissions = [...new Set(input.permissions ?? [])];
    const requestedButtonPermissions = [
      ...new Set([
        ...(input.buttonPermissions ?? []),
        ...requestedPermissions.filter((permission) =>
          this.isButtonPermission(permission)
        )
      ])
    ];
    const permissionCodes = fixedAllPermissions
      ? (await this.prisma.permission.findMany()).map((item) => item.code)
      : [
          ...new Set([
            ...requestedPermissions.filter(
              (permission) => !this.isButtonPermission(permission)
            ),
            ...requestedButtonPermissions
          ])
        ];

    const role = await this.prisma.role.upsert({
      where: { id: existing?.id ?? input.id ?? `role_${randomUUID()}` },
      update: {
        code,
        name,
        description: input.description?.trim(),
        scope: this.toPrismaRoleScope(input.scope),
        fixedAllPermissions,
        enabledBusinessScopes: [...new Set(input.enabledBusinessScopes ?? [])],
        buttonPermissions: fixedAllPermissions ? ["*"] : requestedButtonPermissions,
        dataScope: fixedAllPermissions
          ? PrismaSystemDataScope.ALL
          : this.toPrismaDataScope(
              input.dataScope ?? this.toSharedDataScope(existing?.dataScope)
            ),
        isActive: input.isActive ?? true
      },
      create: {
        id: input.id ?? `role_${randomUUID()}`,
        tenantId,
        code,
        name,
        description: input.description?.trim(),
        scope: this.toPrismaRoleScope(input.scope),
        fixedAllPermissions,
        enabledBusinessScopes: [...new Set(input.enabledBusinessScopes ?? [])],
        buttonPermissions: fixedAllPermissions ? ["*"] : requestedButtonPermissions,
        dataScope: fixedAllPermissions
          ? PrismaSystemDataScope.ALL
          : this.toPrismaDataScope(input.dataScope),
        isActive: input.isActive ?? true
      }
    });

    await this.replaceRolePermissions(role.id, permissionCodes);
    const saved = await this.findRoleWithPermissions(role.id);
    if (!saved) {
      throw new NotFoundException(`Role ${role.id} was not found`);
    }
    return this.toRoleRow(saved);
  }

  async saveRolePermissions(id: string, permissions: string[], tenantId: string) {
    const role = await this.findRoleWithPermissions(id);
    if (!role || role.tenantId !== tenantId) {
      throw new NotFoundException(`Role ${id} was not found`);
    }
    if (role.fixedAllPermissions) {
      return this.toRoleRow(role);
    }

    const nextPermissions = [...new Set(permissions)];
    await this.replaceRolePermissions(id, nextPermissions);
    await this.prisma.role.update({
      where: { id },
      data: {
        buttonPermissions: nextPermissions.filter((permission) =>
          this.isButtonPermission(permission)
        )
      }
    });
    const saved = await this.findRoleWithPermissions(id);
    if (!saved) {
      throw new NotFoundException(`Role ${id} was not found`);
    }
    return this.toRoleRow(saved);
  }

  async deleteRole(id: string, tenantId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { userAssignments: true, users: true, workspaceMembers: true }
    });
    if (!role || role.tenantId !== tenantId) {
      throw new NotFoundException(`Role ${id} was not found`);
    }
    if (role.fixedAllPermissions) {
      throw new BadRequestException("预设角色不能删除");
    }
    if (role.userAssignments.length > 0 || role.users.length > 0 || role.workspaceMembers.length > 0) {
      throw new BadRequestException("该角色已分配给账号，不能删除");
    }

    await this.prisma.rolePermission.deleteMany({ where: { roleId: id } });
    await this.prisma.role.delete({ where: { id } });
    return { id, deleted: true };
  }

  async listUsers(
    tenantId?: string,
    currentUser?: SystemUserRow
  ): Promise<SystemUserRow[]> {
    const users = await this.prisma.user.findMany({
      where: buildSystemUserWhere(tenantId, currentUser) as Prisma.UserWhereInput,
      include: this.userInclude(),
      orderBy: [{ tenantId: "asc" }, { account: "asc" }]
    });

    return users.map((user) => this.toUserRow(user));
  }

  async saveUser(input: SaveSystemUserRequest, tenantId: string): Promise<SystemUserRow> {
    const saved = await this.prisma.$transaction((tx) => this.saveUserInTransaction(tx, input, tenantId));
    const user = await this.findUserWithRoles(saved.userId);
    return { ...this.toUserRow(user), temporaryPassword: saved.temporaryPassword };
  }

  async saveUserWithWorkspaceAccess(
    input: SaveSystemUserAccessRequest,
    tenantId: string
  ): Promise<SystemUserRow> {
    const { workspaceAccesses, ...userInput } = input;
    const saved = await this.prisma.$transaction(async (tx) => {
      const user = await this.saveUserInTransaction(tx, userInput, tenantId);
      await this.saveWorkspaceAccessesInTransaction(tx, tenantId, user.userId, workspaceAccesses);
      return user;
    });
    const user = await this.findUserWithRoles(saved.userId);
    return { ...this.toUserRow(user), temporaryPassword: saved.temporaryPassword };
  }

  private async saveUserInTransaction(
    tx: Prisma.TransactionClient,
    input: SaveSystemUserRequest,
    tenantId: string
  ): Promise<{ userId: string; temporaryPassword?: string }> {
    const account = input.account.trim();
    const displayName = input.displayName.trim();

    if (!account || !displayName) {
      throw new BadRequestException("账号和姓名不能为空");
    }
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new BadRequestException("租户不存在");
    }
    const duplicated = await tx.user.findFirst({
      where: {
        id: input.id ? { not: input.id } : undefined,
        tenantId,
        account
      }
    });
    if (duplicated) {
      throw new BadRequestException("该租户下账号已存在");
    }

    const platformRole = await tx.role.findFirst({
      where: { tenantId, code: "TENANT_ADMIN" }
    });
    const roleIds = input.isPlatformAdmin
      ? platformRole
        ? [platformRole.id]
        : []
      : [...new Set(input.roleIds)].filter((roleId) => roleId !== platformRole?.id);

    if (!input.isPlatformAdmin && roleIds.length === 0) {
      throw new BadRequestException("普通用户至少选择一个角色");
    }

    const validRoles = await tx.role.findMany({
      where: { id: { in: roleIds }, tenantId, isActive: true },
      select: { id: true }
    });
    if (validRoles.length !== roleIds.length) {
      throw new BadRequestException("角色不存在、已停用或不属于当前租户");
    }
    if (input.organizationId) {
      const organization = await tx.organizationUnit.findFirst({
        where: { id: input.organizationId, tenantId }
      });
      if (!organization) throw new BadRequestException("组织不属于当前租户");
    }
    const existingUser = input.id
      ? await tx.user.findFirst({ where: { id: input.id, tenantId } })
      : undefined;
    if (input.id && !existingUser) throw new NotFoundException("账号不存在");
    const temporaryPassword = existingUser ? undefined : generateTemporaryPassword();
    const userId = input.id ?? `user_${randomUUID()}`;
    const user = await tx.user.upsert({
      where: { id: userId },
      update: {
        tenantId,
        account,
        displayName,
        phone: input.phone,
        organizationId: input.organizationId,
        roleId: roleIds[0],
        isPlatformAdmin: Boolean(input.isPlatformAdmin),
        isSaasAdmin: false,
        isActive: input.isActive
      },
      create: {
        id: userId,
        tenantId,
        account,
        displayName,
        phone: input.phone,
        organizationId: input.organizationId,
        roleId: roleIds[0],
        // upsert 的 create 分支对象会先在 JavaScript 中求值；编辑已有账号时
        // temporaryPassword 为空，不能无条件 hash undefined。
        passwordHash: existingUser?.passwordHash ?? hashPassword(temporaryPassword!),
        mustChangePassword: true,
        isSaasAdmin: false,
        isPlatformAdmin: Boolean(input.isPlatformAdmin),
        isActive: input.isActive
      }
    });

    await tx.userRole.deleteMany({ where: { userId: user.id } });
    if (roleIds.length > 0) {
      await tx.userRole.createMany({
        data: roleIds.map((roleId) => ({ userId: user.id, roleId })),
        skipDuplicates: true
      });
    }

    return { userId: user.id, temporaryPassword };
  }

  private async saveWorkspaceAccessesInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    accesses: SaveWorkspaceAccessRequest[]
  ) {
    const rows = Array.isArray(accesses) ? accesses : [];
    const workspaceIds = rows.map((row) => row.workspaceId);
    if (new Set(workspaceIds).size !== workspaceIds.length) {
      throw new BadRequestException("同一经营空间不能重复授权");
    }
    if (rows.length === 0) return;

    const [user, workspaces] = await Promise.all([
      tx.user.findFirst({ where: { id: userId, tenantId }, select: { id: true } }),
      tx.businessWorkspace.findMany({
        where: { tenantId, id: { in: workspaceIds } },
        select: { id: true, status: true }
      })
    ]);
    if (!user) throw new BadRequestException("账号不存在或不属于当前租户");
    if (workspaces.length !== workspaceIds.length) {
      throw new BadRequestException("经营空间不存在或不属于当前租户");
    }
    if (workspaces.some((workspace) => workspace.status !== PrismaWorkspaceStatus.ACTIVE)) {
      throw new BadRequestException("冻结或停用的经营空间不能变更成员");
    }

    const roleIds = [...new Set(rows.map((row) => row.roleId).filter((roleId): roleId is string => Boolean(roleId)))];
    if (roleIds.length > 0) {
      const roles = await tx.role.findMany({
        where: { id: { in: roleIds }, tenantId, isActive: true },
        select: { id: true }
      });
      if (roles.length !== roleIds.length) {
        throw new BadRequestException("空间角色不存在、已停用或不属于当前租户");
      }
    }

    for (const row of rows) {
      const data = {
        roleId: row.roleId ?? null,
        dataScope: row.dataScope ? this.toPrismaDataScope(row.dataScope) : null,
        isActive: row.isActive
      };
      await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: row.workspaceId, userId } },
        create: { tenantId, workspaceId: row.workspaceId, userId, ...data },
        update: data
      });
    }
  }

  async setUserStatus(id: string, isActive: boolean, tenantId: string) {
    const current = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!current) throw new NotFoundException("账号不存在");
    await this.prisma.user.update({ where: { id }, data: { isActive } });
    if (!isActive) await this.revokeUserSessions(id);
    return this.toUserRow(await this.findUserWithRoles(id));
  }

  async resetUserPassword(id: string, tenantId: string) {
    const existing = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException("账号不存在");
    const temporaryPassword = generateTemporaryPassword();
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: hashPassword(temporaryPassword),
        mustChangePassword: true,
        passwordChangedAt: new Date(),
        tokenVersion: { increment: 1 }
      }
    });
    await this.revokeUserSessions(id);
    return {
      userId: user.id,
      account: user.account,
      temporaryPassword,
      message: "密码已重置为一次性临时密码，用户下次登录必须修改。"
    };
  }

  async getSystemRules(tenantId = requireRequestTenantId()) {
    const row = await this.prisma.systemParameterSet.findFirst({
      where: {
        tenantId,
        module: "system-rules",
        status: "EFFECTIVE"
      },
      orderBy: { versionNo: "desc" }
    });
    return row?.content as unknown as SystemRulesConfig | undefined;
  }

  async saveSystemRules(
    config: SystemRulesConfig,
    operator = "system",
    tenantId = requireRequestTenantId()
  ) {
    const row = await this.prisma.systemParameterSet.findFirst({
      where: { tenantId, module: "system-rules", status: "EFFECTIVE" },
      orderBy: { versionNo: "desc" }
    });
    const versionNo = row?.versionNo ?? 1;

    return this.prisma.systemParameterSet.upsert({
      where: {
        tenantId_module_versionNo: {
          tenantId,
          module: "system-rules",
          versionNo
        }
      },
      update: { content: config as object, operator },
      create: {
        tenantId,
        module: "system-rules",
        versionNo,
        status: "EFFECTIVE",
        content: config as object,
        operator
      }
    });
  }

  async listAuditLogs(
    query: PlatformAuditLogQuery = {}
  ): Promise<PlatformAuditResult> {
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);
    // 审计是经营事实的一部分：普通经营会话只能回看当前空间的动作。
    // 平台管理会话没有 workspaceId，保留租户级平台审计的查询能力；绝不从
    // query 参数读取空间，避免客户端借此跨空间枚举审计记录。
    const workspaceId = getRequestWorkspaceId();
    const where: Prisma.OperationLogWhereInput = {
      tenantId: query.tenantId || requireRequestTenantId(),
      workspaceId,
      action: query.action ? { contains: query.action } : undefined
    };
    const [rows, total] = await Promise.all([
      this.prisma.operationLog.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: "desc" },
        take: limit
      }),
      this.prisma.operationLog.count({ where })
    ]);
    const mapped = rows
      .map((row) => this.toAuditLogRow(row))
      .filter((row) => !query.operator || row.operator.includes(query.operator))
      .filter((row) => !query.targetType || row.targetType === query.targetType);

    return {
      rows: mapped,
      total
    };
  }

  async recordAuditLog(input: Omit<PlatformAuditLogRow, "id" | "createdAt">) {
    await this.prisma.operationLog.create({
      data: {
        tenantId: input.tenantId,
        action: input.action,
        detail: {
          operator: input.operator,
          targetType: input.targetType,
          targetId: input.targetId,
          detail: input.detail
        }
      }
    });
  }

  async listFilterPresets(
    query: PlatformFilterPresetQuery = {}
  ): Promise<PlatformFilterPreset[]> {
    const tenantId = query.tenantId || (await this.resolveConfigTenantId());
    const where: Prisma.FilterPresetWhereInput = {
      tenantId,
      scopeKey: query.scopeKey
    };
    const rows = await this.prisma.filterPreset.findMany({
      where,
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
    });
    return rows.map((row) => this.toFilterPreset(row));
  }

  async saveFilterPreset(
    input: SavePlatformFilterPresetRequest & {
      tenantId: string;
      operator: string;
    }
  ): Promise<PlatformFilterPreset> {
    const tenantId = input.tenantId || (await this.resolveConfigTenantId());
    const operator = input.operator || "营运端";
    const row = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.filterPreset.updateMany({
          where: { tenantId, scopeKey: input.scopeKey },
          data: { isDefault: false }
        });
      }
      const existing = input.id
        ? await tx.filterPreset.findFirst({ where: { id: input.id, tenantId } })
        : await tx.filterPreset.findUnique({
            where: {
              tenantId_scopeKey_name: {
                tenantId,
                scopeKey: input.scopeKey,
                name: input.name
              }
            }
          });
      if (input.id && !existing) {
        throw new NotFoundException("筛选预设不存在");
      }
      const data = {
        tenantId,
        scopeKey: input.scopeKey,
        name: input.name,
        description: input.description,
        filters: input.filters as Prisma.InputJsonValue,
        isDefault: Boolean(input.isDefault),
        isSystem: false,
        operator
      };
      return existing
        ? tx.filterPreset.update({ where: { id: existing.id }, data })
        : tx.filterPreset.create({ data });
    });
    await this.recordAuditLog({
      tenantId,
      action: "filter-preset.save",
      operator,
      targetType: "filter-preset",
      targetId: row.id,
      detail: `保存筛选预设：${row.name}`
    });
    return this.toFilterPreset(row);
  }

  async setDefaultFilterPreset(
    id: string,
    operator = "营运端",
    tenantId = requireRequestTenantId()
  ): Promise<PlatformFilterPreset> {
    const row = await this.prisma.filterPreset.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new NotFoundException("筛选预设不存在");
    }
    const next = await this.prisma.$transaction(async (tx) => {
      await tx.filterPreset.updateMany({
        where: { tenantId: row.tenantId, scopeKey: row.scopeKey },
        data: { isDefault: false }
      });
      return tx.filterPreset.update({
        where: { id },
        data: { isDefault: true, operator }
      });
    });
    await this.recordAuditLog({
      tenantId: row.tenantId,
      action: "filter-preset.default",
      operator,
      targetType: "filter-preset",
      targetId: row.id,
      detail: `设为默认筛选预设：${row.name}`
    });
    return this.toFilterPreset(next);
  }

  async deleteFilterPreset(
    id: string,
    operator = "营运端",
    tenantId = requireRequestTenantId()
  ) {
    const row = await this.prisma.filterPreset.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new NotFoundException("筛选预设不存在");
    }
    await this.prisma.filterPreset.delete({ where: { id } });
    await this.recordAuditLog({
      tenantId: row.tenantId,
      action: "filter-preset.delete",
      operator,
      targetType: "filter-preset",
      targetId: row.id,
      detail: `删除筛选预设：${row.name}`
    });
    return { id, deleted: true };
  }

  async getPlatformDictionaries(
    defaults: PlatformDictionaryGroup[]
  ): Promise<PlatformDictionaryGroup[]> {
    const content = await this.getPlatformConfig<{ groups: PlatformDictionaryGroup[] }>(
      "platform-dictionaries"
    );
    return content?.groups ?? defaults;
  }

  async savePlatformDictionaryGroup(
    input: SavePlatformDictionaryGroupRequest
  ): Promise<PlatformDictionaryGroup> {
    const tenantId = await this.resolveConfigTenantId();
    const current =
      (await this.getPlatformConfig<{ groups: PlatformDictionaryGroup[] }>(
        "platform-dictionaries",
        tenantId
      ))?.groups ?? [];
    const group: PlatformDictionaryGroup = {
      code: input.code.trim(),
      name: input.name.trim(),
      module: input.module.trim(),
      description: input.description?.trim(),
      items: input.items
        .map((item) => ({
          code: item.code.trim(),
          label: item.label.trim(),
          value: item.value.trim(),
          sortNo: Number(item.sortNo),
          enabled: Boolean(item.enabled),
          remark: item.remark?.trim()
        }))
        .sort((left, right) => left.sortNo - right.sortNo),
      updatedAt: new Date().toISOString(),
      updatedBy: input.operator || "营运端"
    };
    const next = current.filter((item) => item.code !== group.code);
    next.unshift(group);
    await this.savePlatformConfig(tenantId, "platform-dictionaries", {
      groups: next
    });
    await this.recordAuditLog({
      tenantId,
      action: "dictionary.update",
      operator: group.updatedBy,
      targetType: "dictionary",
      targetId: group.code,
      detail: `更新数据字典：${group.name}`
    });
    return group;
  }

  async getPlatformNumberRules(
    defaults: PlatformNumberRule[]
  ): Promise<PlatformNumberRule[]> {
    const content = await this.getPlatformConfig<{ rules: PlatformNumberRule[] }>(
      "platform-number-rules"
    );
    return (content?.rules ?? defaults).map((rule) => ({
      ...rule,
      sample: this.formatNumber(rule, rule.currentSequence + 1)
    }));
  }

  async savePlatformNumberRule(
    input: SavePlatformNumberRuleRequest
  ): Promise<PlatformNumberRule> {
    const tenantId = await this.resolveConfigTenantId();
    const current =
      (await this.getPlatformConfig<{ rules: PlatformNumberRule[] }>(
        "platform-number-rules",
        tenantId
      ))?.rules ?? [];
    const existing = current.find((rule) => rule.code === input.code);
    const rule: PlatformNumberRule = {
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      module: input.module.trim(),
      prefix: input.prefix.trim().toUpperCase(),
      datePattern: input.datePattern,
      sequenceLength: input.sequenceLength,
      currentSequence: input.currentSequence ?? existing?.currentSequence ?? 0,
      resetCycle: input.resetCycle,
      enabled: input.enabled,
      sample: "",
      updatedAt: new Date().toISOString(),
      updatedBy: input.operator || "营运端"
    };
    rule.sample = this.formatNumber(rule, rule.currentSequence + 1);
    const next = current.filter((item) => item.code !== rule.code);
    next.unshift(rule);
    await this.savePlatformConfig(tenantId, "platform-number-rules", {
      rules: next
    });
    await this.recordAuditLog({
      tenantId,
      action: "number-rule.update",
      operator: rule.updatedBy,
      targetType: "number-rule",
      targetId: rule.code,
      detail: `更新编号规则：${rule.name}`
    });
    return rule;
  }

  async generatePlatformNumber(
    input: GeneratePlatformNumberRequest
  ) {
    const tenantId = await this.resolveConfigTenantId();
    const content = await this.getPlatformConfig<{ rules: PlatformNumberRule[] }>(
      "platform-number-rules",
      tenantId
    );
    const rules = content?.rules ?? [];
    const rule = rules.find((item) => item.code === input.code);
    if (!rule) {
      throw new NotFoundException("编号规则不存在");
    }
    if (!rule.enabled) {
      throw new BadRequestException("编号规则已停用");
    }
    rule.currentSequence += 1;
    rule.updatedAt = new Date().toISOString();
    rule.updatedBy = input.operator || "营运端";
    rule.sample = this.formatNumber(rule, rule.currentSequence + 1);
    await this.savePlatformConfig(tenantId, "platform-number-rules", {
      rules
    });
    const generatedNo = this.formatNumber(rule, rule.currentSequence);
    await this.recordAuditLog({
      tenantId,
      action: "number.generate",
      operator: rule.updatedBy,
      targetType: "number-rule",
      targetId: rule.code,
      detail: `生成编号：${generatedNo}`
    });

    return {
      code: rule.code,
      generatedNo,
      nextSequence: rule.currentSequence + 1
    };
  }

  async bootstrapTenant(
    input: TenantBootstrapRequest,
    preview: TenantBootstrapPreview,
    seed: {
      systemRules: SystemRulesConfig;
      dictionaries: PlatformDictionaryGroup[];
      numberRules: PlatformNumberRule[];
    },
    /**
     * 在初始化事务内、提交之前执行。用于把 Rental Core 品类配置并入同一事务，
     * 满足需求 4.1「初始化失败必须整体回滚」；抛错会连带回滚租户、组织、角色和管理员。
     */
    onBeforeCommit?: (tx: Prisma.TransactionClient, tenantId: string) => Promise<void>
  ): Promise<TenantBootstrapResult> {
    const tenantCode = input.tenantCode.trim().toLowerCase();
    const tenantName = input.tenantName.trim();
    const adminAccount = input.adminAccount.trim();
    const adminDisplayName = input.adminDisplayName.trim();
    if (!tenantCode || !tenantName || !adminAccount || !adminDisplayName || !input.categoryCode) {
      throw new BadRequestException("租户编码、名称、经营品类和管理员信息不能为空");
    }
    const temporaryPassword = generateTemporaryPassword();
    const storePermissionCodes = new Set([
      "store-rental:order:view",
      "store-rental:order:operate",
      "store-rental:order:settle",
      // 与 STORE_OPERATOR 预设同一条迁移：原本凭 order:settle 就能裁定的四类费用审核，
      // 拆权后要显式补上 fee-review，否则门店营运账号开出来就无法处理待审费用。
      "store-rental:order:fee-review",
      "store-rental:station:view",
      "store-rental:vehicle:view",
      "rental-core:catalog:view",
      "rental-core:asset:view",
      "store-rental:member:view",
      "store-rental:corporate:view",
      "store-rental:order:create",
      "store-rental:order:pickup",
      "store-rental:order:return",
      "store-rental:order:fee-manage"
    ]);
    const created = await this.prisma.$transaction(async (tx) => {
      if (await tx.tenant.findUnique({ where: { code: tenantCode } })) {
        throw new BadRequestException("租户编码已存在");
      }
      const categoryCode = this.toPrismaCategoryCode(input.categoryCode);
      const category = await tx.rentalCategoryDefinition.findUnique({ where: { code: categoryCode } });
      if (!category) throw new BadRequestException("经营品类不存在");
      const tenant = await tx.tenant.create({
        data: { code: tenantCode, name: tenantName, status: PrismaTenantStatus.ACTIVE }
      });
      await tx.tenantRentalProfile.create({
        data: {
          tenantId: tenant.id,
          categoryCode,
          capabilities: category.defaultCapabilities as Prisma.InputJsonValue,
          terminology: category.terminology as Prisma.InputJsonValue,
          configVersion: category.version
        }
      });
      const operatorOrg = await tx.organizationUnit.create({
        data: {
          tenantId: tenant.id,
          type: PrismaOrganizationType.OPERATOR,
          code: `OP-${tenantCode.toUpperCase()}`,
          name: `${tenant.name}营运中心`
        }
      });
      const storeOrg = await tx.organizationUnit.create({
        data: {
          tenantId: tenant.id,
          parentId: operatorOrg.id,
          type: PrismaOrganizationType.STORE,
          code: input.storeCode?.trim() || `STORE-${tenantCode.toUpperCase()}`,
          name: input.storeName?.trim() || `${tenant.name}门店`
        }
      });
      const permissions = await tx.permission.findMany();
      const tenantAdminRole = await tx.role.create({
        data: {
          tenantId: tenant.id,
          code: "TENANT_ADMIN",
          name: "租户管理员",
          description: "拥有当前 SaaS 租户内全部权限，但不能访问其他租户。",
          scope: PrismaRoleScope.OPERATOR,
          fixedAllPermissions: true,
          enabledBusinessScopes: ["RENTAL_CORE"],
          buttonPermissions: ["*"],
          dataScope: PrismaSystemDataScope.ALL,
          isActive: true
        }
      });
      const storeRole = await tx.role.create({
        data: {
          tenantId: tenant.id,
          code: "STORE_OPERATOR",
          name: "门店运营",
          description: "处理租赁订单、取还检查和基础库存查询。",
          scope: PrismaRoleScope.STORE,
          fixedAllPermissions: false,
          enabledBusinessScopes: ["RENTAL_CORE"],
          buttonPermissions: [
            "store-rental:order:create",
            "store-rental:order:pickup",
            "store-rental:order:return",
            "store-rental:order:fee-manage"
          ],
          dataScope: PrismaSystemDataScope.STORE,
          isActive: true
        }
      });
      await tx.rolePermission.createMany({
        data: permissions
          .filter((permission) => !permission.code.startsWith("system:tenant:"))
          .map((permission) => ({ roleId: tenantAdminRole.id, permissionId: permission.id })),
        skipDuplicates: true
      });
      await tx.rolePermission.createMany({
        data: permissions
          .filter((permission) => storePermissionCodes.has(permission.code))
          .map((permission) => ({ roleId: storeRole.id, permissionId: permission.id })),
        skipDuplicates: true
      });
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          organizationId: operatorOrg.id,
          account: adminAccount,
          displayName: adminDisplayName,
          phone: input.adminPhone,
          roleId: tenantAdminRole.id,
          passwordHash: hashPassword(temporaryPassword),
          isSaasAdmin: false,
          isPlatformAdmin: true,
          mustChangePassword: true,
          isActive: true
        }
      });
      await tx.userRole.create({ data: { userId: user.id, roleId: tenantAdminRole.id } });
      // SPACE-01（需求 4.1）：默认经营空间、其唯一品类以及管理员的成员关系，
      // 由 onBeforeCommit 里的 initializeTenant → upsertProfile 在**同一事务**内建立，
      // 因此这里不再重复创建。
      //
      // 刻意不在此处单独写一份：品类档案有两条写入路径（租户初始化与懒加载自愈），
      // 不变量必须钉在档案的写入点上，否则两条路径会给出不一致的结果。
      // 该调用在本方法末尾、提交之前发生，任一步失败仍整体回滚。
      const configs = [
        ["system-rules", seed.systemRules],
        ["platform-dictionaries", { groups: seed.dictionaries }],
        ["platform-number-rules", { rules: seed.numberRules }]
      ] as const;
      for (const [module, content] of configs) {
        await tx.systemParameterSet.create({
          data: {
            tenantId: tenant.id,
            module,
            versionNo: 1,
            status: ConfigStatus.EFFECTIVE,
            content: content as unknown as Prisma.InputJsonValue,
            operator: input.operator || "SaaS 平台管理员",
            effectiveAt: new Date()
          }
        });
      }
      const templateExecution = await this.bootstrapTenantTemplates({
        tenantId: tenant.id,
        tenantCode,
        tenantName: tenant.name,
        operatorOrgId: operatorOrg.id,
        storeOrgId: storeOrg.id,
        adminUserId: user.id,
        storeCode: storeOrg.code,
        storeName: storeOrg.name
      });
      await tx.operationLog.create({
        data: {
          tenantId: tenant.id,
          userId: undefined,
          action: "tenant.bootstrap",
          detail: {
            categoryCode: input.categoryCode,
            operator: input.operator || "SaaS 平台管理员",
            templates: templateExecution.items.map((item) => item.code)
          }
        }
      });
      await onBeforeCommit?.(tx, tenant.id);
      return { tenant, user, templateExecution, categoryName: category.name };
    });

    return {
      tenant: {
        tenantId: created.tenant.id,
        tenantCode: created.tenant.code,
        tenantName: created.tenant.name,
        tenantStatus: this.toTenantStatus(created.tenant.status),
        enabledBusinessLines: ["rental_core"],
        categoryCode: input.categoryCode,
        categoryName: created.categoryName
      },
      adminUser: this.toUserRow(await this.findUserWithRoles(created.user.id)),
      preview,
      templateExecution: created.templateExecution,
      temporaryPassword,
      message: "租户初始化已完成；临时密码仅本次返回，管理员首次登录必须修改。"
    };
  }

  private async bootstrapTenantTemplates(input: {
    tenantId: string;
    tenantCode: string;
    tenantName: string;
    operatorOrgId: string;
    storeOrgId: string;
    adminUserId: string;
    storeCode: string;
    storeName: string;
  }): Promise<NonNullable<TenantBootstrapResult["templateExecution"]>> {
    void input;

    return {
      executionId: `tenant_bootstrap_${randomUUID()}`,
      items: [
        {
          code: "store-station",
          name: "默认门市与站点",
          count: 1,
          reusableForGenericRental: false,
          remark: "当前绑定门市租车；通用租赁应改为服务点/仓库模板。"
        },
        {
          code: "asset-vehicle",
          name: "车辆资产与车型组",
          count: 2,
          reusableForGenericRental: false,
          remark: "汽车租赁专用；通用租赁需替换为资产品类、规格和库存实例。"
        },
        {
          code: "customer",
          name: "个人会员与企业客户",
          count: 2,
          reusableForGenericRental: true,
          remark: "客户底座可复用，等级和证照字段后续按品类调整。"
        },
        {
          code: "demo-order",
          name: "演示门市租赁订单",
          count: 1,
          reusableForGenericRental: false,
          remark: "用于本地验证订单闭环；通用租赁需替换资产快照字段。"
        }
      ],
      message: "已执行默认角色、参数、字典、编号和门市租赁基础模板。"
    };
  }

  private toFilterPreset(row: {
    id: string;
    tenantId: string;
    scopeKey: string;
    name: string;
    description: string | null;
    filters: Prisma.JsonValue;
    isDefault: boolean;
    isSystem: boolean;
    operator: string | null;
    updatedAt: Date;
  }): PlatformFilterPreset {
    const filters =
      row.filters && typeof row.filters === "object" && !Array.isArray(row.filters)
        ? (row.filters as Record<string, unknown>)
        : {};
    return {
      id: row.id,
      tenantId: row.tenantId,
      scopeKey: row.scopeKey as PlatformFilterPreset["scopeKey"],
      name: row.name,
      description: row.description ?? undefined,
      filters,
      isDefault: row.isDefault,
      isSystem: row.isSystem,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.operator || "营运端"
    };
  }

  private toAuditLogRow(row: {
    id: string;
    tenantId: string;
    workspaceId: string | null;
    action: string;
    detail: Prisma.JsonValue;
    createdAt: Date;
    user?: { displayName: string; account: string } | null;
  }): PlatformAuditLogRow {
    const detail =
      row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)
        ? (row.detail as Record<string, unknown>)
        : {};
    const operator = String(
      detail.operator ?? row.user?.displayName ?? row.user?.account ?? "系统"
    );

    return {
      id: row.id,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId ?? undefined,
      action: row.action,
      operator,
      targetType: String(detail.targetType ?? "system"),
      targetId: detail.targetId ? String(detail.targetId) : undefined,
      detail: String(detail.detail ?? JSON.stringify(row.detail)),
      createdAt: row.createdAt.toISOString()
    };
  }

  private async getPlatformConfig<T>(module: string, tenantId?: string) {
    const row = await this.prisma.systemParameterSet.findFirst({
      where: {
        tenantId,
        module,
        status: ConfigStatus.EFFECTIVE
      },
      orderBy: { versionNo: "desc" }
    });
    return row?.content as T | undefined;
  }

  private async savePlatformConfig(
    tenantId: string,
    module: string,
    content: unknown
  ) {
    return this.prisma.systemParameterSet.upsert({
      where: {
        tenantId_module_versionNo: {
          tenantId,
          module,
          versionNo: 1
        }
      },
      update: {
        content: content as Prisma.InputJsonValue,
        operator: "platform-governance",
        status: ConfigStatus.EFFECTIVE
      },
      create: {
        tenantId,
        module,
        versionNo: 1,
        status: ConfigStatus.EFFECTIVE,
        content: content as Prisma.InputJsonValue,
        operator: "platform-governance"
      }
    });
  }

  private async resolveConfigTenantId() {
    const requestTenantId = requireRequestTenantId();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: requestTenantId }
    });
    if (!tenant) {
      throw new NotFoundException("当前登录租户不存在");
    }
    return tenant.id;
  }

  private formatNumber(rule: PlatformNumberRule, sequence: number) {
    const parts = [rule.prefix];
    const datePart = this.formatDatePart(rule.datePattern);
    if (datePart) {
      parts.push(datePart);
    }
    parts.push(String(sequence).padStart(rule.sequenceLength, "0"));
    return parts.join("-");
  }

  private formatDatePart(pattern: PlatformNumberRule["datePattern"]) {
    if (pattern === "none") {
      return "";
    }
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const yy = yyyy.slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    if (pattern === "yyyyMMdd") {
      return `${yyyy}${mm}${dd}`;
    }
    if (pattern === "yyyyMM") {
      return `${yyyy}${mm}`;
    }
    return `${yy}${mm}${dd}`;
  }

  private async findRoleWithPermissions(id: string) {
    return this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: {
          include: {
            permission: true
          }
        }
      }
    });
  }

  private async findUserWithRoles(id: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id },
      include: this.userInclude()
    });
  }

  private userInclude() {
    return {
      organization: true,
      role: {
        include: {
          permissions: {
            include: { permission: true }
          }
        }
      },
      roleAssignments: {
        include: {
          role: {
            include: {
              permissions: {
                include: { permission: true }
              }
            }
          }
        }
      }
    } as const;
  }

  private async replaceRolePermissions(roleId: string, permissionCodes: string[]) {
    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: permissionCodes.filter((code) => code !== "*") } }
    });

    await this.prisma.rolePermission.deleteMany({ where: { roleId } });
    if (permissions.length > 0) {
      await this.prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId,
          permissionId: permission.id
        })),
        skipDuplicates: true
      });
    }
  }

  private toRoleRow(role: NonNullable<RoleWithPermissions>): SystemRoleRow {
    const permissionCodes = role.permissions.map((item) => item.permission.code);
    const buttonPermissionCodes = role.permissions
      .filter((item) => item.permission.kind === PermissionKind.BUTTON)
      .map((item) => item.permission.code);
    const savedButtonPermissions =
      (role.buttonPermissions as string[] | null) ?? [];

    return {
      id: role.id,
      tenantId: role.tenantId,
      code: role.code,
      name: role.name,
      description: role.description ?? undefined,
      scope: this.toSharedRoleScope(role.scope),
      fixedAllPermissions: role.fixedAllPermissions,
      enabledBusinessScopes: role.enabledBusinessScopes as string[],
      isActive: role.isActive,
      permissions: role.fixedAllPermissions
        ? ["*"]
        : permissionCodes.filter((code) => !this.isButtonPermission(code)),
      buttonPermissions: role.fixedAllPermissions
        ? ["*"]
        : [...new Set([...buttonPermissionCodes, ...savedButtonPermissions])],
      dataScope: this.toSharedDataScope(role.dataScope)
    };
  }

  private toUserRow(user: Awaited<ReturnType<PlatformRepository["findUserWithRoles"]>>): SystemUserRow {
    const roles = [
      ...user.roleAssignments.map((item) => item.role),
      ...(user.role ? [user.role] : [])
    ].filter((role, index, array) => array.findIndex((item) => item.id === role.id) === index);
    const activeRoles = roles.filter((role) => role.isActive);
    const isPlatformAdmin =
      user.isPlatformAdmin || roles.some((role) => role.fixedAllPermissions);
    const permissions = isPlatformAdmin
      ? ["*"]
      : [
          ...new Set(
            activeRoles.flatMap((role) => [
              ...role.permissions.map((item) => item.permission.code),
              ...(((role.buttonPermissions as string[] | null) ?? []) as string[])
            ])
          )
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
      roleNames: roles.map((role) =>
        role.isActive ? role.name : `${role.name}（停用）`
      ),
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
      dataScope: isPlatformAdmin ? "all" : this.resolveUserDataScope(activeRoles)
    };
  }

  private toTenantStatus(status: PrismaTenantStatus) {
    if (status === PrismaTenantStatus.FROZEN) {
      return TenantStatus.Frozen;
    }
    if (status === PrismaTenantStatus.DISABLED) {
      return TenantStatus.Disabled;
    }
    return TenantStatus.Active;
  }

  // Prisma 枚举带 @map：客户端读写都使用枚举名（如 CAMERA），领域契约统一为小写（camera）。
  // 登录上下文、路由守卫和前端菜单都按小写比较，必须在仓储边界归一化。
  private toDomainCategoryCode(value: string | null | undefined): TenantSummary["categoryCode"] | undefined {
    return value ? (value.toLowerCase() as TenantSummary["categoryCode"]) : undefined;
  }

  private toPrismaCategoryCode(value: string): PrismaRentalCategoryCode {
    const map: Record<string, PrismaRentalCategoryCode> = {
      vehicle: PrismaRentalCategoryCode.VEHICLE,
      camera: PrismaRentalCategoryCode.CAMERA,
      camping: PrismaRentalCategoryCode.CAMPING,
      construction: PrismaRentalCategoryCode.CONSTRUCTION
    };
    const mapped = map[value];
    if (!mapped) throw new BadRequestException("经营品类不存在");
    return mapped;
  }

  private toTenantSummary(tenant: {
    id: string;
    code: string;
    name: string;
    status: PrismaTenantStatus;
    statusReason: string | null;
    createdAt: Date;
    updatedAt: Date;
    rentalProfile: null | {
      categoryCode: string;
      capabilities: unknown;
      category: { name: string };
    };
    businessWorkspaces: Array<{ categoryCode: string }>;
    _count: { users: number; organizations: number; rentalOrders: number };
  }): TenantSummary {
    return {
      tenantId: tenant.id,
      tenantCode: tenant.code,
      tenantName: tenant.name,
      tenantStatus: this.toTenantStatus(tenant.status),
      enabledBusinessLines: ["rental_core"],
      categoryCode: this.toDomainCategoryCode(tenant.rentalProfile?.categoryCode),
      categoryName: tenant.rentalProfile?.category.name,
      capabilities: tenant.rentalProfile?.capabilities as TenantSummary["capabilities"],
      workspaceCount: tenant.businessWorkspaces.length,
      workspaceCategoryCodes: [...new Set(tenant.businessWorkspaces.map((workspace) => this.toDomainCategoryCode(workspace.categoryCode)).filter(Boolean))] as TenantSummary["workspaceCategoryCodes"],
      userCount: tenant._count.users,
      organizationCount: tenant._count.organizations,
      orderCount: tenant._count.rentalOrders,
      statusReason: tenant.statusReason ?? undefined,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString()
    };
  }

  private toSharedRoleScope(scope: PrismaRoleScope | PrismaOrganizationType): RoleScope {
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

  private toOrganizationSummary(organization: {
    id: string;
    tenantId: string;
    parentId: string | null;
    type: PrismaOrganizationType;
    code: string;
    name: string;
    status: string;
  }): OrganizationSummary {
    return {
      id: organization.id,
      tenantId: organization.tenantId,
      parentId: organization.parentId ?? undefined,
      type: this.toSharedRoleScope(organization.type),
      code: organization.code,
      name: organization.name,
      status: organization.status === "disabled" ? "disabled" : "enabled"
    };
  }

  private toPrismaRoleScope(scope: RoleScope): PrismaRoleScope {
    if (scope === RoleScope.CarShop) {
      return PrismaRoleScope.CAR_SHOP;
    }
    if (scope === RoleScope.Store) {
      return PrismaRoleScope.STORE;
    }
    if (scope === RoleScope.Station) {
      return PrismaRoleScope.STATION;
    }
    return PrismaRoleScope.OPERATOR;
  }

  private toPrismaOrganizationType(scope: RoleScope): PrismaOrganizationType {
    if (scope === RoleScope.CarShop) {
      return PrismaOrganizationType.CAR_SHOP;
    }
    if (scope === RoleScope.Store) {
      return PrismaOrganizationType.STORE;
    }
    if (scope === RoleScope.Station) {
      return PrismaOrganizationType.STATION;
    }
    return PrismaOrganizationType.OPERATOR;
  }

  private toSharedDataScope(scope?: PrismaSystemDataScope | SystemDataScope): SystemDataScope {
    if (scope === PrismaSystemDataScope.ALL || scope === "all") {
      return "all";
    }
    if (scope === PrismaSystemDataScope.ORGANIZATION || scope === "organization") {
      return "organization";
    }
    if (scope === PrismaSystemDataScope.OWN || scope === "own") {
      return "own";
    }
    return "store";
  }

  private toPrismaDataScope(scope?: SystemDataScope): PrismaSystemDataScope {
    if (scope === "all") {
      return PrismaSystemDataScope.ALL;
    }
    if (scope === "organization") {
      return PrismaSystemDataScope.ORGANIZATION;
    }
    if (scope === "own") {
      return PrismaSystemDataScope.OWN;
    }
    return PrismaSystemDataScope.STORE;
  }

  private resolveUserDataScope(roles: Array<{ dataScope: PrismaSystemDataScope }>) {
    const order: SystemDataScope[] = ["own", "store", "organization", "all"];
    const scope = roles
      .map((role) => this.toSharedDataScope(role.dataScope))
      .sort((left, right) => order.indexOf(right) - order.indexOf(left))[0];
    return scope ?? "own";
  }

  private isButtonPermission(permission: string) {
    return (
      permission.includes(":button:") ||
      [
        "store-rental:order:create",
        "store-rental:order:pickup",
        "store-rental:order:return",
        "store-rental:order:extend",
        "store-rental:order:cancel",
        "store-rental:order:close",
        "store-rental:order:fee-manage",
        "store-rental:vehicle:status-action",
        "store-rental:member:risk-action",
        "store-rental:corporate:monthly-settle",
        "store-rental:finance:adjust",
        "store-rental:finance:invoice",
        "system:button:export"
      ].includes(permission)
    );
  }

  private permissionDisplayOf(permission: { code: string; name: string; description: string | null }) {
    const overrides: Record<string, { name: string; description?: string }> = {
      "store-rental:order:view": { name: "订单查看", description: "查看租赁订单列表和详情" },
      "store-rental:order:operate": { name: "订单操作", description: "新建租赁订单、领取检查和归还检查" },
      "store-rental:order:create": { name: "按钮-新建订单", description: "显示并执行新建租赁订单入口" },
      "store-rental:order:pickup": { name: "按钮-领取交付", description: "执行领取交付和确认开始履约" },
      "store-rental:order:return": { name: "按钮-归还验收", description: "执行归还验收和提交结算" },
      "store-rental:order:extend": { name: "按钮-延长租期", description: "执行延长租期和逾期补办续租" },
      "store-rental:station:view": { name: "履约地点查看" },
      "store-rental:station:manage": { name: "履约地点管理" },
      "store-rental:vehicle-group:manage": { name: "品类型号与分组管理" },
      "store-rental:vehicle:view": { name: "品类资产查看" },
      "store-rental:vehicle:manage": { name: "品类资产管理" },
      "store-rental:vehicle:status-action": { name: "按钮-品类资产状态动作", description: "启停、维保、异常和状态处置" }
    };
    const override = overrides[permission.code];
    return {
      name: override?.name ?? permission.name,
      description: override?.description ?? permission.description ?? undefined
    };
  }

  private permissionModuleOf(code: string, moduleName: string) {
    if (code.startsWith("system:")) {
      return { code: "system", name: "系统设置" };
    }
    if (code.startsWith("store-rental:")) {
      return { code: "store-rental", name: "租赁业务" };
    }
    return { code: moduleName, name: moduleName };
  }

}
