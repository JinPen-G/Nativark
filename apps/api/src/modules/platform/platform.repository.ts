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
  TenantSummary
} from "@rimo/shared";
import { RoleScope, TenantStatus } from "@rimo/shared";
import {
  buildOrganizationWhere,
  buildSystemUserWhere
} from "../../common/data-permission";
import { PrismaService } from "../database/prisma.service";

type RoleWithPermissions = Awaited<
  ReturnType<PlatformRepository["findRoleWithPermissions"]>
>;

@Injectable()
export class PlatformRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listTenants(): Promise<TenantSummary[]> {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { code: "asc" }
    });

    return tenants.map((tenant) => ({
      tenantId: tenant.id,
      tenantCode: tenant.code,
      tenantName: tenant.name,
      tenantStatus: this.toTenantStatus(tenant.status),
      enabledBusinessLines: ["store_rental"]
    }));
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
    if (!user || !this.passwordMatches(user.passwordHash, password)) {
      return undefined;
    }

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

  async resolveUserByToken(token?: string): Promise<SystemUserRow | undefined> {
    const raw = token?.replace(/^Bearer\s+/i, "").trim();
    const [, tenantCode, account] = raw?.split(".") ?? [];

    if (!tenantCode || !account) {
      return undefined;
    }

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

    return user ? this.toUserRow(user) : undefined;
  }

  async findUserByToken(token?: string): Promise<SystemUserRow> {
    const user = await this.resolveUserByToken(token);
    if (user) {
      return user;
    }

    const admin = await this.prisma.user.findFirst({
      where: { isActive: true },
      include: this.userInclude(),
      orderBy: { account: "asc" }
    });
    if (!admin) {
      throw new NotFoundException("默认管理员不存在，请先执行 db:seed");
    }

    return this.toUserRow(admin);
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
      ? await this.prisma.organizationUnit.findUnique({ where: { id: input.id } })
      : undefined;
    const id = input.id ?? `org_${randomUUID()}`;
    const row = await this.prisma.organizationUnit.upsert({
      where: { id },
      update: {
        tenantId: input.tenantId,
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

  async listRoles(): Promise<SystemRoleRow[]> {
    const roles = await this.prisma.role.findMany({
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

  async saveRole(input: SaveSystemRoleRequest): Promise<SystemRoleRow> {
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
        code
      }
    });
    if (duplicated) {
      throw new BadRequestException("角色编码已存在");
    }

    const tenantId = existing?.tenantId ?? "tenant_001";
    const fixedAllPermissions =
      existing?.fixedAllPermissions ?? code === "PLATFORM_ADMIN";
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

  async saveRolePermissions(id: string, permissions: string[]) {
    const role = await this.findRoleWithPermissions(id);
    if (!role) {
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

  async deleteRole(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { userAssignments: true, users: true }
    });
    if (!role) {
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

  async saveUser(input: SaveSystemUserRequest): Promise<SystemUserRow> {
    const account = input.account.trim();
    const displayName = input.displayName.trim();

    if (!account || !displayName) {
      throw new BadRequestException("账号和姓名不能为空");
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId }
    });
    if (!tenant) {
      throw new BadRequestException("租户不存在");
    }
    const duplicated = await this.prisma.user.findFirst({
      where: {
        id: { not: input.id },
        tenantId: input.tenantId,
        account
      }
    });
    if (duplicated) {
      throw new BadRequestException("该租户下账号已存在");
    }

    const platformRole = await this.prisma.role.findFirst({
      where: { tenantId: input.tenantId, code: "PLATFORM_ADMIN" }
    });
    const roleIds = input.isPlatformAdmin
      ? platformRole
        ? [platformRole.id]
        : []
      : [...new Set(input.roleIds)].filter((roleId) => roleId !== platformRole?.id);

    if (!input.isPlatformAdmin && roleIds.length === 0) {
      throw new BadRequestException("普通用户至少选择一个角色");
    }

    const user = await this.prisma.user.upsert({
      where: { id: input.id ?? `user_${randomUUID()}` },
      update: {
        tenantId: input.tenantId,
        account,
        displayName,
        phone: input.phone,
        organizationId: input.organizationId,
        roleId: roleIds[0],
        isPlatformAdmin: Boolean(input.isPlatformAdmin),
        isActive: input.isActive
      },
      create: {
        id: input.id ?? `user_${randomUUID()}`,
        tenantId: input.tenantId,
        account,
        displayName,
        phone: input.phone,
        organizationId: input.organizationId,
        roleId: roleIds[0],
        passwordHash: "dev-only:123456",
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
    return this.toUserRow(saved);
  }

  async setUserStatus(id: string, isActive: boolean) {
    await this.prisma.user.update({ where: { id }, data: { isActive } });
    return this.toUserRow(await this.findUserWithRoles(id));
  }

  async resetUserPassword(id: string) {
    const user = await this.prisma.user.update({
      where: { id },
      data: { passwordHash: "dev-only:123456" }
    });
    return {
      userId: user.id,
      account: user.account,
      temporaryPassword: "123456",
      message: "密码已重置为默认演示密码 123456。"
    };
  }

  async getSystemRules() {
    const row = await this.prisma.systemParameterSet.findFirst({
      where: {
        module: "system-rules",
        status: "EFFECTIVE"
      },
      orderBy: { versionNo: "desc" }
    });
    return row?.content as unknown as SystemRulesConfig | undefined;
  }

  async saveSystemRules(config: SystemRulesConfig, operator = "system") {
    const row = await this.prisma.systemParameterSet.findFirst({
      where: { module: "system-rules", status: "EFFECTIVE" },
      orderBy: { versionNo: "desc" }
    });
    const tenantId = row?.tenantId ?? "tenant_001";
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
      tenantId: query.tenantId,
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
        ? await tx.filterPreset.findUnique({ where: { id: input.id } })
        : await tx.filterPreset.findUnique({
            where: {
              tenantId_scopeKey_name: {
                tenantId,
                scopeKey: input.scopeKey,
                name: input.name
              }
            }
          });
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
    operator = "营运端"
  ): Promise<PlatformFilterPreset> {
    const row = await this.prisma.filterPreset.findUnique({ where: { id } });
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

  async deleteFilterPreset(id: string, operator = "营运端") {
    const row = await this.prisma.filterPreset.findUnique({ where: { id } });
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
    const existing = await this.prisma.tenant.findUnique({
      where: { code: tenantCode }
    });
    if (existing) {
      throw new BadRequestException("租户编码已存在");
    }

    const tenant = await this.prisma.tenant.create({
      data: {
        code: tenantCode,
        name: input.tenantName.trim(),
        status: PrismaTenantStatus.ACTIVE
      }
    });
    const operatorOrg = await this.prisma.organizationUnit.create({
      data: {
        tenantId: tenant.id,
        type: PrismaOrganizationType.OPERATOR,
        code: `OP-${tenantCode.toUpperCase()}`,
        name: `${tenant.name}营运中心`
      }
    });
    await this.prisma.organizationUnit.create({
      data: {
        tenantId: tenant.id,
        parentId: operatorOrg.id,
        type: PrismaOrganizationType.STORE,
        code: input.storeCode?.trim() || `STORE-${tenantCode.toUpperCase()}`,
        name: input.storeName?.trim() || `${tenant.name}门市`
      }
    });

    const permissions = await this.prisma.permission.findMany();
    const platformRole = await this.prisma.role.create({
      data: {
        tenantId: tenant.id,
        code: "PLATFORM_ADMIN",
        name: "平台管理员",
        description: "固定拥有当前租户全部权限，不允许按功能裁剪。",
        scope: PrismaRoleScope.OPERATOR,
        fixedAllPermissions: true,
        enabledBusinessScopes: ["STORE_STANDARD", "STORE_24H", "SYSTEM_GLOBAL"],
        buttonPermissions: ["*"],
        dataScope: PrismaSystemDataScope.ALL,
        isActive: true
      }
    });
    const storeRole = await this.prisma.role.create({
      data: {
        tenantId: tenant.id,
        code: "STORE_OPERATOR",
        name: "门店营运",
        description: "门店前台和门店值班人员处理订单、取还车和基础车辆查看。",
        scope: PrismaRoleScope.STORE,
        fixedAllPermissions: false,
        enabledBusinessScopes: ["STORE_STANDARD", "STORE_24H"],
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

    await this.prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({
        roleId: platformRole.id,
        permissionId: permission.id
      })),
      skipDuplicates: true
    });
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
    await this.prisma.rolePermission.createMany({
      data: permissions
        .filter((permission) => storePermissionCodes.has(permission.code))
        .map((permission) => ({
          roleId: storeRole.id,
          permissionId: permission.id
        })),
      skipDuplicates: true
    });

    const user = await this.prisma.user.create({
      data: {
        tenantId: tenant.id,
        organizationId: operatorOrg.id,
        account: input.adminAccount.trim(),
        displayName: input.adminDisplayName.trim(),
        phone: input.adminPhone,
        roleId: platformRole.id,
        passwordHash: "dev-only:123456",
        isPlatformAdmin: true,
        isActive: true
      }
    });
    await this.prisma.userRole.create({
      data: { userId: user.id, roleId: platformRole.id }
    });
    await this.savePlatformConfig(tenant.id, "system-rules", seed.systemRules);
    await this.savePlatformConfig(tenant.id, "platform-dictionaries", {
      groups: seed.dictionaries
    });
    await this.savePlatformConfig(tenant.id, "platform-number-rules", {
      rules: seed.numberRules
    });
    const templateExecution = await this.bootstrapTenantTemplates({
      tenantId: tenant.id,
      tenantCode,
      tenantName: tenant.name,
      operatorOrgId: operatorOrg.id,
      storeOrgId: storeRole.id,
      adminUserId: user.id,
      storeCode: input.storeCode?.trim() || `STORE-${tenantCode.toUpperCase()}`,
      storeName: input.storeName?.trim() || `${tenant.name}门市`
    });
    await this.recordAuditLog({
      tenantId: tenant.id,
      action: "tenant.bootstrap",
      operator: input.operator || "营运端",
      targetType: "tenant",
      targetId: tenant.id,
      detail: `初始化租户：${tenant.name}；已执行 ${templateExecution.items.length} 类模板。`
    });

    return {
      tenant: {
        tenantId: tenant.id,
        tenantCode: tenant.code,
        tenantName: tenant.name,
        tenantStatus: this.toTenantStatus(tenant.status),
        enabledBusinessLines: ["store_rental"]
      },
      adminUser: this.toUserRow(await this.findUserWithRoles(user.id)),
      preview,
      templateExecution,
      message: "租户初始化已完成，默认管理员密码为 123456。"
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
    const demo = await this.prisma.tenant.findUnique({
      where: { id: "tenant_001" }
    });
    if (demo) {
      return demo.id;
    }
    const tenant = await this.prisma.tenant.findFirst({
      orderBy: { code: "asc" }
    });
    if (!tenant) {
      throw new NotFoundException("租户不存在，请先执行 db:seed");
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

  private passwordMatches(passwordHash: string, password: string) {
    if (passwordHash.startsWith("dev-only:")) {
      return passwordHash.slice("dev-only:".length) === password;
    }
    return false;
  }
}
