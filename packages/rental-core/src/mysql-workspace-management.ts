/** 原 Rental 空间管理与账号/角色/空间复合写入的唯一仓储。
 * 空间档案、已发布品类、必选能力参加者与成员写入保留原事务；身份投影复用公共认证仓储。
 * 事务内方法只供已建立原事务和当前主体的宿主组合，不授予 Core、成员或跨租户访问权。
 */
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient, WorkspaceStatus as PrismaWorkspaceStatus, SystemDataScope as PrismaSystemDataScope } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { SystemUserRow, SystemDataScope, SaveSystemUserRequest, SaveWorkspaceAccessRequest } from "@rental-os/platform-contracts";
import { PlatformAuthenticationRepository } from "@rental-os/platform-server/authentication";
import type { PlatformAuthDataStore } from "@rental-os/platform-server/auth-store";
import { generateTemporaryPassword, hashPassword } from "@rental-os/platform-server/password";
import { requireRequestTenantId } from "@rental-os/platform-server/request-identity";
import { rentalCategoryStorageCode } from "./category-identity";
import { assertCategoryAdoptionAllowed } from "./mysql-category-policy";
import { lockRentalBusinessTenant } from "./mysql-business-fence";
import type { BusinessWorkspace, BusinessWorkspaceStatus, CreateBusinessWorkspaceRequest, SaveWorkspaceMemberRequest,
  UpdateBusinessWorkspaceRequest, WorkspaceMember, SaveSystemUserAccessRequest, RentalCategoryCode } from "./contracts";
import type { TenantSummary } from "./auth-contracts";

export type RentalWorkspaceManagementDatabase = Omit<PlatformAuthDataStore, "$transaction"> & Pick<PrismaClient,
  "businessWorkspace" | "rentalCategoryDefinition" | "rentalCategoryVersion" | "rentalCategoryAdoptionAudit" | "workspaceMember" | "rentalFulfillmentLocation" | "user" | "role" | "tenant" | "organizationUnit" | "userRole" | "$transaction">;

export class RentalWorkspaceManagementRepository extends PlatformAuthenticationRepository {
  constructor(private readonly database: RentalWorkspaceManagementDatabase) { super(database); }

  /** 只核已存在的公共租户；不读取或补造 Rental 经营配置。 */
  getTenant(tenantId: string) { return this.getTenantIdentity(tenantId); }



  /* ---------- SPACE-01：经营空间主档与成员关系 ---------- */

  /**
   * 空间范围只取自服务端会话，绝不接受客户端提交的 tenantId。
   * 需求 2.3：租户业务请求中的当前经营空间必须来自服务端验证过的会话上下文。
   */
  workspaceTenantId(currentUser?: SystemUserRow): string {
    return currentUser?.tenantId ?? requireRequestTenantId();
  }


  async listBusinessWorkspaces(currentUser?: SystemUserRow): Promise<BusinessWorkspace[]> {
    return this.listBusinessWorkspacesForTenant(this.workspaceTenantId(currentUser));
  }


  async listBusinessWorkspacesForTenant(tenantId: string): Promise<BusinessWorkspace[]> {
    const rows = await this.database.businessWorkspace.findMany({
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
    return this.createBusinessWorkspaceForTenant(this.workspaceTenantId(currentUser), input, onBeforeCommit, currentUser?.id);
  }


  async createBusinessWorkspaceForTenant(
    tenantId: string,
    input: CreateBusinessWorkspaceRequest,
    onBeforeCommit?: (tx: Prisma.TransactionClient, workspaceId: string, tenantId: string) => Promise<void>,
    actorId?: string
  ): Promise<BusinessWorkspace> {
    const code = input.code?.trim().toLowerCase();
    const name = input.name?.trim();
    if (!code || !name || !input.categoryCode) throw new BadRequestException("空间编码、名称和经营品类不能为空");
    if (code === "default") throw new BadRequestException("default 为升级兼容层保留编码，请使用其他编码");
    const categoryCode = this.toPrismaCategoryCode(input.categoryCode);
    const created = await this.database.$transaction(async (tx) => {
      await lockRentalBusinessTenant(tx, tenantId);
      await tx.$queryRaw(Prisma.sql`SELECT code FROM rental_category_definitions WHERE code = ${categoryCode.toLowerCase()} FOR UPDATE`);
      const category = await tx.rentalCategoryDefinition.findUnique({ where: { code: categoryCode } });
      if (!category) {
        throw new BadRequestException("经营品类不存在");
      }
      const versionId = input.categoryVersionId ?? category.recommendedVersionId;
      if (typeof versionId !== "string" || !versionId.trim() || versionId.length > 191) {
        throw new BadRequestException("必须选择有效的品类发布版本");
      }
      const categoryVersion = await tx.rentalCategoryVersion.findUnique({ where: { id: versionId } });
      if (!categoryVersion || categoryVersion.categoryCode !== categoryCode ||
          !["published", "legacy_baseline"].includes(categoryVersion.status)) {
        throw new BadRequestException("经营品类没有可采用的发布版本");
      }
      await assertCategoryAdoptionAllowed(tx, tenantId, categoryCode, categoryVersion.id, "create");
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
          categoryVersionId: categoryVersion.id,
          status: PrismaWorkspaceStatus.ACTIVE,
          isDefault: false,
          defaultMarker: workspaceId,
          // 新建空间默认 development：首期品类能力未全部实现前不能伪装为正式经营。
          // 调用方可显式请求 production；服务层会在同一事务里校验全部品类必选能力。
          runMode: input.runMode ?? "development"
        }
      });
      await tx.rentalCategoryAdoptionAudit.create({
        data: {
          tenantId, workspaceId, toVersionId: categoryVersion.id,
          fromRevision: 0, toRevision: 0, action: "create",
          actorId: actorId ?? "system", reason: input.categoryVersionId ? "新建经营空间明确采用品类版本" : "新建经营空间绑定推荐品类版本"
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
    const updated = await this.database.$transaction(async (tx) => {
      await lockRentalBusinessTenant(tx, tenantId);
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
    const workspace = await this.database.businessWorkspace.findFirst({ where: { id: workspaceId, tenantId } });
    if (!workspace) throw new NotFoundException("经营空间不存在");
    const rows = await this.database.workspaceMember.findMany({
      where: { tenantId, workspaceId },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => this.toWorkspaceMember(row));
  }


  async listWorkspaceFulfillmentLocations(workspaceId: string, currentUser?: SystemUserRow) {
    const tenantId = this.workspaceTenantId(currentUser);
    const workspace = await this.database.businessWorkspace.findFirst({ where: { id: workspaceId, tenantId }, select: { id: true } });
    if (!workspace) throw new NotFoundException("经营空间不存在");
    return this.database.rentalFulfillmentLocation.findMany({
      where: { tenantId, workspaceId },
      select: { id: true, name: true, code: true, status: true },
      orderBy: [{ name: "asc" }, { id: "asc" }]
    });
  }


  async saveWorkspaceMember(
    workspaceId: string,
    input: SaveWorkspaceMemberRequest,
    currentUser?: SystemUserRow
  ): Promise<WorkspaceMember> {
    const tenantId = this.workspaceTenantId(currentUser);
    if (!input.userId) throw new BadRequestException("账号不能为空");
    const saved = await this.database.$transaction(async (tx) => {
      await lockRentalBusinessTenant(tx, tenantId);
      await this.assertAccountActionInTransaction(tx, tenantId, input.userId, currentUser?.id);
      await this.assertFixedAllWorkspaceAccessesAllowed(tx, tenantId, [{ ...input, workspaceId, isActive: input.isActive ?? true }], currentUser?.id);
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
      const locationScope = input.locationScope === undefined
        ? undefined
        : await this.validateLocationScope(tx, tenantId, workspaceId, input.locationScope);
      const data = {
        roleId: input.roleId ?? null,
        dataScope: input.dataScope ? this.toPrismaDataScope(input.dataScope) : null,
        ...(locationScope !== undefined ? { locationScope } : {}),
        isActive: input.isActive ?? true
      };
      return tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId, userId: input.userId } },
        create: { tenantId, workspaceId, userId: input.userId, ...data },
        update: data
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.toWorkspaceMember(saved);
  }


  toWorkspace(row: {
    id: string;
    tenantId: string;
    code: string;
    name: string;
    categoryCode: RentalCategoryCode;
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


  toWorkspaceMember(row: {
    tenantId: string;
    workspaceId: string;
    userId: string;
    roleId: string | null;
    dataScope: PrismaSystemDataScope | null;
    locationScope?: Prisma.JsonValue | null;
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
      locationScope: row.locationScope && typeof row.locationScope === "object" && !Array.isArray(row.locationScope)
        ? row.locationScope as { mode: "all" | "selected"; locationIds: string[] }
        : undefined,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }


  toPrismaWorkspaceStatus(status: BusinessWorkspaceStatus): PrismaWorkspaceStatus {
    const map = {
      active: PrismaWorkspaceStatus.ACTIVE,
      frozen: PrismaWorkspaceStatus.FROZEN,
      disabled: PrismaWorkspaceStatus.DISABLED
    } as const;
    return map[status];
  }


  /** 含停用账号；服务层需防止普通账号通过编辑停用管理员来撤销其固定权限。 */
  async isTenantAdminUser(id: string, tenantId: string): Promise<boolean> {
    const user = await this.database.user.findFirst({ where: { id, tenantId }, include: this.userInclude() });
    if (!user || user.isSaasAdmin) return false;
    return this.toUserRow(user).isPlatformAdmin || Boolean(await this.database.workspaceMember.findFirst({ where: {
      tenantId, userId: id, isActive: true, role: { is: { fixedAllPermissions: true, isActive: true } }
    }, select: { userId: true } }));
  }


  async hasFixedAllPermissionRole(roleIds: readonly string[], tenantId: string): Promise<boolean> {
    if (!roleIds.length) return false;
    const role = await this.database.role.findFirst({
      where: { id: { in: [...roleIds] }, tenantId, fixedAllPermissions: true, isActive: true },
      select: { id: true }
    });
    return Boolean(role);
  }


  async saveUserWithWorkspaceAccess(
    input: SaveSystemUserAccessRequest,
    tenantId: string,
    actorUserId?: string
  ): Promise<SystemUserRow> {
    const { workspaceAccesses, ...userInput } = input;
    const saved = await this.database.$transaction(async (tx) => {
      await lockRentalBusinessTenant(tx, tenantId);
      await this.assertFixedAllWorkspaceAccessesAllowed(tx, tenantId, workspaceAccesses, actorUserId);
      const user = await this.saveUserInTransaction(tx, userInput, tenantId, actorUserId);
      await this.saveWorkspaceAccessesInTransaction(tx, tenantId, user.userId, workspaceAccesses);
      return user;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const user = await this.findUserWithRoles(saved.userId);
    return { ...this.toUserRow(user), temporaryPassword: saved.temporaryPassword };
  }


  async saveUserInTransaction(
    tx: Prisma.TransactionClient,
    input: SaveSystemUserRequest,
    tenantId: string,
    actorUserId?: string
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
      select: { id: true, fixedAllPermissions: true }
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
      ? await tx.user.findFirst({ where: { id: input.id, tenantId }, include: this.userInclude() })
      : undefined;
    if (input.id && !existingUser) throw new NotFoundException("账号不存在");
    const actor = actorUserId
      ? await tx.user.findFirst({ where: { id: actorUserId, tenantId, isActive: true }, include: this.userInclude() })
      : undefined;
    const actorIsTenantAdmin = Boolean(actor && !actor.isSaasAdmin && this.toUserRow(actor).isPlatformAdmin);
    const targetWorkspaceAdmin = existingUser && await tx.workspaceMember.findFirst({ where: {
      tenantId, userId: existingUser.id, isActive: true, role: { is: { fixedAllPermissions: true, isActive: true } }
    }, select: { userId: true } });
    const targetIsTenantAdmin = Boolean(existingUser && !existingUser.isSaasAdmin
      && (this.toUserRow(existingUser).isPlatformAdmin || targetWorkspaceAdmin));
    const assignsFixedAllPermissions = validRoles.some((role) => role.fixedAllPermissions);
    if (!actorIsTenantAdmin && (input.isPlatformAdmin === true || targetIsTenantAdmin || assignsFixedAllPermissions)) {
      throw new ForbiddenException("只有当前租户管理员可以新增、修改或撤销租户管理员权限");
    }
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


  /** 空间授权也不能把固定全权角色当成普通空间角色批量授给员工。 */
  async assertFixedAllWorkspaceAccessesAllowed(
    tx: Prisma.TransactionClient,
    tenantId: string,
    accesses: SaveWorkspaceAccessRequest[],
    actorUserId?: string
  ) {
    const roleIds = [...new Set(accesses.map((row) => row.roleId).filter((id): id is string => Boolean(id)))];
    if (!roleIds.length) return;
    const fixedRole = await tx.role.findFirst({
      where: { tenantId, id: { in: roleIds }, fixedAllPermissions: true, isActive: true },
      select: { id: true }
    });
    if (!fixedRole) return;
    const actor = actorUserId
      ? await tx.user.findFirst({ where: { id: actorUserId, tenantId, isActive: true }, include: this.userInclude() })
      : undefined;
    const actorIsTenantAdmin = Boolean(actor && !actor.isSaasAdmin && this.toUserRow(actor).isPlatformAdmin);
    if (!actorIsTenantAdmin) {
      throw new ForbiddenException("只有当前租户管理员可以通过空间授权分配固定全权角色");
    }
  }


  async saveWorkspaceAccessesInTransaction(
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
      const locationScope = row.locationScope === undefined
        ? undefined
        : await this.validateLocationScope(tx, tenantId, row.workspaceId, row.locationScope);
      const data = {
        roleId: row.roleId ?? null,
        dataScope: row.dataScope ? this.toPrismaDataScope(row.dataScope) : null,
        ...(locationScope !== undefined ? { locationScope } : {}),
        isActive: row.isActive
      };
      await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: row.workspaceId, userId } },
        create: { tenantId, workspaceId: row.workspaceId, userId, ...data },
        update: data
      });
    }
  }


  async assertTenantPermissionInTransaction(
    tx: Prisma.TransactionClient, tenantId: string, actorUserId: string | undefined, permission: string
  ) {
    return super.assertTenantManagementPermission(tenantId, actorUserId, permission, tx);
  }


  async assertAccountActionInTransaction(
    tx: Prisma.TransactionClient, tenantId: string, id: string, actorUserId?: string
  ) {
    const actor = await this.assertTenantPermissionInTransaction(tx, tenantId, actorUserId, "system:user:manage");
    const target = await tx.user.findFirst({ where: { id, tenantId }, include: this.userInclude() });
    if (!target || target.isSaasAdmin) throw new NotFoundException("账号不存在");
    const privilegedWorkspace = await tx.workspaceMember.findFirst({ where: {
      tenantId, userId: id, isActive: true, role: { is: { fixedAllPermissions: true, isActive: true } }
    }, select: { userId: true } });
    if (!actor.isPlatformAdmin && (this.toUserRow(target).isPlatformAdmin || privilegedWorkspace)) {
      throw new ForbiddenException("只有当前租户管理员可以管理管理员账号及其空间授权");
    }
    return target;
  }


  async validateLocationScope(
    tx: Prisma.TransactionClient,
    tenantId: string,
    workspaceId: string,
    scope: NonNullable<SaveWorkspaceAccessRequest["locationScope"]>
  ): Promise<Prisma.InputJsonValue> {
    if (!scope || !["all", "selected"].includes(scope.mode) || !Array.isArray(scope.locationIds) || scope.locationIds.some((id) => typeof id !== "string" || !id.trim())) {
      throw new BadRequestException("履约地点范围格式无效");
    }
    if (scope.mode === "all") {
      if (scope.locationIds.length) throw new BadRequestException("全部履约地点范围不能附带地点编号");
      return { mode: "all", locationIds: [] };
    }
    const ids = [...new Set(scope.locationIds.map((id) => id.trim()))];
    if (!ids.length) throw new BadRequestException("至少选择一个履约地点，或改为全部地点");
    const locations = await tx.rentalFulfillmentLocation.findMany({
      where: { tenantId, workspaceId, id: { in: ids } },
      select: { id: true }
    });
    if (locations.length !== ids.length) throw new BadRequestException("履约地点不存在或不属于当前经营空间");
    return { mode: "selected", locationIds: ids };
  }


  // 读取兼容旧枚举对象；持久化编码及领域契约统一使用稳定的小写标识。
  toDomainCategoryCode(value: string | null | undefined): TenantSummary["categoryCode"] | undefined {
    return value ? (value.toLowerCase() as TenantSummary["categoryCode"]) : undefined;
  }


  toPrismaCategoryCode(value: string): RentalCategoryCode {
    return rentalCategoryStorageCode(value);
  }


  toPrismaDataScope(scope?: SystemDataScope): PrismaSystemDataScope {
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
}
