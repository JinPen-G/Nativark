import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  BillingMode,
  CorporateStatus,
  ConfigStatus,
  DispatchStatus,
  MemberReviewStatus,
  MemberStatus,
  OrderMainStatus,
  OrganizationType as PrismaOrganizationType,
  PermissionKind,
  PaymentStatus,
  Prisma,
  RentalCategoryCode as PrismaRentalCategoryCode,
  RoleScope as PrismaRoleScope,
  SettlementMode,
  StoreRentalMode,
  SystemDataScope as PrismaSystemDataScope,
  TenantStatus as PrismaTenantStatus,
  VehicleOperationStatus,
  VehicleServiceType
} from "@prisma/client";
import type {
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
  SaveSystemUserRequest,
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
import { getRequestTenantId } from "../../common/request-identity";

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
        _count: { select: { users: true, organizations: true, orders: true, rentalOrders: true } }
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
        _count: { select: { users: true, organizations: true, orders: true, rentalOrders: true } }
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
      where: { code }
    });
    if (!tenant) {
      return undefined;
    }

    return {
      tenantId: tenant.id,
      tenantCode: tenant.code,
      tenantName: tenant.name,
      tenantStatus: this.toTenantStatus(tenant.status),
      enabledBusinessLines: ["store_rental"]
    };
  }

  async findUserForLogin(tenantCode: string, account: string, password: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { code: tenantCode }
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
        enabledBusinessLines: ["store_rental"]
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

  async createAuthSession(input: { id: string; userId: string; refreshTokenHash: string; expiresAt: Date }) {
    return this.prisma.authSession.create({ data: input });
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

  async revokeAuthSession(id: string) {
    await this.prisma.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() }
    });
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
      if (!modules.has(module.code)) {
        modules.set(module.code, {
          code: module.code,
          name: module.name,
          children: []
        });
      }
      modules.get(module.code)?.children.push({
        code: permission.code,
        name: permission.name,
        description: permission.description ?? undefined
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
      include: { userAssignments: true, users: true }
    });
    if (!role || role.tenantId !== tenantId) {
      throw new NotFoundException(`Role ${id} was not found`);
    }
    if (role.fixedAllPermissions) {
      throw new BadRequestException("预设角色不能删除");
    }
    if (role.userAssignments.length > 0 || role.users.length > 0) {
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
    const account = input.account.trim();
    const displayName = input.displayName.trim();

    if (!account || !displayName) {
      throw new BadRequestException("账号和姓名不能为空");
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId }
    });
    if (!tenant) {
      throw new BadRequestException("租户不存在");
    }
    const duplicated = await this.prisma.user.findFirst({
      where: {
        id: { not: input.id },
        tenantId,
        account
      }
    });
    if (duplicated) {
      throw new BadRequestException("该租户下账号已存在");
    }

    const platformRole = await this.prisma.role.findFirst({
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

    const validRoles = await this.prisma.role.findMany({
      where: { id: { in: roleIds }, tenantId, isActive: true },
      select: { id: true }
    });
    if (validRoles.length !== roleIds.length) {
      throw new BadRequestException("角色不存在、已停用或不属于当前租户");
    }
    if (input.organizationId) {
      const organization = await this.prisma.organizationUnit.findFirst({
        where: { id: input.organizationId, tenantId }
      });
      if (!organization) throw new BadRequestException("组织不属于当前租户");
    }
    const existingUser = input.id
      ? await this.prisma.user.findFirst({ where: { id: input.id, tenantId } })
      : undefined;
    if (input.id && !existingUser) throw new NotFoundException("账号不存在");
    const temporaryPassword = existingUser ? undefined : generateTemporaryPassword();
    const user = await this.prisma.user.upsert({
      where: { id: input.id ?? `user_${randomUUID()}` },
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
        id: input.id ?? `user_${randomUUID()}`,
        tenantId,
        account,
        displayName,
        phone: input.phone,
        organizationId: input.organizationId,
        roleId: roleIds[0],
        passwordHash: hashPassword(temporaryPassword!),
        mustChangePassword: true,
        isSaasAdmin: false,
        isPlatformAdmin: Boolean(input.isPlatformAdmin),
        isActive: input.isActive
      }
    });

    await this.prisma.userRole.deleteMany({ where: { userId: user.id } });
    if (roleIds.length > 0) {
      await this.prisma.userRole.createMany({
        data: roleIds.map((roleId) => ({ userId: user.id, roleId })),
        skipDuplicates: true
      });
    }

    const saved = await this.findUserWithRoles(user.id);
    return { ...this.toUserRow(saved), temporaryPassword };
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

  async getSystemRules(tenantId = getRequestTenantId()) {
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
    tenantId = getRequestTenantId()
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
    const where: Prisma.OperationLogWhereInput = {
      tenantId: query.tenantId || getRequestTenantId(),
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
    tenantId = getRequestTenantId()
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
    tenantId = getRequestTenantId()
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
    }
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
      "store-rental:station:view",
      "store-rental:vehicle:view",
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
      const categoryCode = input.categoryCode as unknown as PrismaRentalCategoryCode;
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
      return { tenant, user, templateExecution };
    });

    return {
      tenant: {
        tenantId: created.tenant.id,
        tenantCode: created.tenant.code,
        tenantName: created.tenant.name,
        tenantStatus: this.toTenantStatus(created.tenant.status),
        enabledBusinessLines: ["rental_core"],
        categoryCode: input.categoryCode
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
    const requestTenantId = getRequestTenantId();
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
      category: { name: string };
    };
    _count: { users: number; organizations: number; orders: number; rentalOrders: number };
  }): TenantSummary {
    return {
      tenantId: tenant.id,
      tenantCode: tenant.code,
      tenantName: tenant.name,
      tenantStatus: this.toTenantStatus(tenant.status),
      enabledBusinessLines: ["rental_core"],
      categoryCode: tenant.rentalProfile?.categoryCode as TenantSummary["categoryCode"],
      categoryName: tenant.rentalProfile?.category.name,
      userCount: tenant._count.users,
      organizationCount: tenant._count.organizations,
      orderCount: tenant._count.orders + tenant._count.rentalOrders,
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

  private permissionModuleOf(code: string, moduleName: string) {
    if (code.startsWith("system:")) {
      return { code: "system", name: "系统设置" };
    }
    if (code.startsWith("store-rental:")) {
      return { code: "store-rental", name: "门市租赁" };
    }
    return { code: moduleName, name: moduleName };
  }

}
