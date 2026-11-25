/** 公共租户、账号、角色、组织与安全配置仓储。原身份与权限投影保持单源。
 * 调用方先锁当前主体；所有写入与审计在同一公共事务，Core使用权另由Core宿主维护。 */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { CreatePlatformTenantRequest, OrganizationSummary, PlatformTenantSummary, SaveOrganizationRequest,
  SaveSystemRoleRequest, SaveSystemUserRequest, SystemRoleRow, SystemSecurityBaselineConfig, SystemUserRow,
  UpdateTenantRequest, UpdateTenantStatusRequest } from "@rental-os/platform-contracts";
import { generateTemporaryPassword, hashPassword } from "../../common/password";
import { buildOrganizationWhere, buildSystemUserWhere, isOrganizationScopedUser, resolveTenantIdForQuery } from "../../common/platform-data-permission";
import { enabledOrganizationSubtreeIds } from "../../common/organization-location-scope";
import { PlatformIdentityRepository } from "./platform-identity.repository";
import type { LegacyPlatformManagementCompatibility, PlatformManagementDatabase, PlatformManagementTransaction } from "./platform-management.store";
import type { StoredPlatformRoleScope, StoredPlatformDataScope } from "./platform-auth-data-store";
import { PLATFORM_SECURITY_TENANT_ID } from "./platform-security-baseline";

export class PlatformManagementRepository extends PlatformIdentityRepository {
  constructor(database: PlatformManagementDatabase) { super(database); }

  async tenants(tx: PlatformManagementTransaction, tenantId?: string): Promise<PlatformTenantSummary[]> {
    const rows = await tx.tenant.findMany({ where: tenantId ? { id: tenantId } : { code: { not: "platform" } },
      orderBy: { code: "asc" }, include: { _count: { select: { users: true, organizations: true } } } });
    return rows.map(row => ({ ...this.toTenantIdentity(row), userCount: row._count.users, organizationCount: row._count.organizations,
      statusReason: row.statusReason ?? undefined, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
  }

  async createTenant(tx: PlatformManagementTransaction, input: CreatePlatformTenantRequest) {
    const code = input.tenantCode.trim().toLowerCase(), name = input.tenantName.trim();
    if (!code || !name || code === "platform") throw new BadRequestException("租户编码和名称不能为空，platform为SaaS保留编码");
    if (await tx.tenant.findUnique({ where: { code } })) throw new BadRequestException("租户编码已存在");
    const tenantId = randomUUID(), organizationId = randomUUID(), shortName = input.operatorShortName?.trim() || null;
    if (shortName && shortName.length > 64) throw new BadRequestException("后台简称最多64个字符");
    await tx.tenant.create({ data: { id: tenantId, code, name, operatorShortName: shortName, status: "ACTIVE" } });
    await tx.organizationUnit.create({ data: { id: organizationId, tenantId, type: "OPERATOR", code: "ROOT", name } });
    const roleId = await this.createAdminRole(tx, tenantId), temporaryPassword = generateTemporaryPassword();
    const adminId = await this.insertUser(tx, { tenantId, account: input.adminAccount.trim(), displayName: input.adminDisplayName.trim(),
      phone: input.adminPhone, organizationId, roleId, isPlatformAdmin: true, password: temporaryPassword });
    return { tenantId, adminId, temporaryPassword };
  }

  async createAdminRole(tx: PlatformManagementTransaction, tenantId: string) {
    const role = await tx.role.create({ data: { id: randomUUID(), tenantId, code: "TENANT_ADMIN", name: "租户管理员",
      description: "当前租户公共管理权；Core使用仍须单独授权和成员分配", scope: "OPERATOR", fixedAllPermissions: true,
      enabledBusinessScopes: [], buttonPermissions: ["*"], dataScope: "ALL", isActive: true } });
    return role.id;
  }

  async insertUser(tx: PlatformManagementTransaction, input: { tenantId: string; account: string; displayName: string;
    phone?: string; organizationId?: string; roleId?: string; isSaasAdmin?: boolean; isPlatformAdmin: boolean; password: string; id?: string }) {
    if (!input.account || !input.displayName) throw new BadRequestException("账号和姓名不能为空");
    const id = input.id ?? randomUUID();
    await tx.user.create({ data: { id, tenantId: input.tenantId, account: input.account, displayName: input.displayName,
      phone: input.phone, organizationId: input.organizationId, roleId: input.roleId, passwordHash: hashPassword(input.password),
      isSaasAdmin: input.isSaasAdmin ?? false, isPlatformAdmin: input.isPlatformAdmin, mustChangePassword: true, isActive: true } });
    if (input.roleId) await tx.userRole.createMany({ data: [{ userId: id, roleId: input.roleId }] });
    return id;
  }

  async updateTenant(tx: PlatformManagementTransaction, id: string, input: UpdateTenantRequest) {
    const current = await tx.tenant.findUnique({ where: { id } });
    if (!current || current.code === "platform") throw new NotFoundException("租户不存在或为SaaS保留主体");
    const name = input.tenantName.trim(), shortName = input.operatorShortName?.trim() || null;
    if (!name || shortName && shortName.length > 64) throw new BadRequestException("租户名称不能为空，后台简称最多64个字符");
    await tx.tenant.update({ where: { id }, data: { name,
      ...(input.operatorShortName !== undefined ? { operatorShortName: shortName } : {}) } });
    return {
      before: { name: current.name, operatorShortName: current.operatorShortName },
      after: { name, operatorShortName: input.operatorShortName === undefined ? current.operatorShortName : shortName }
    };
  }

  async tenantStatus(tx: PlatformManagementTransaction, id: string, input: UpdateTenantStatusRequest, operator: string) {
    const current = await tx.tenant.findUnique({ where: { id } });
    if (!current || current.code === "platform") throw new ForbiddenException("SaaS主体不能通过租户接口停用");
    if (!input.reason.trim()) throw new BadRequestException("状态变更须填写原因");
    const status = { active: "ACTIVE", frozen: "FROZEN", disabled: "DISABLED" } as const;
    await tx.tenant.update({ where: { id }, data: { status: status[input.status], statusReason: input.reason.trim(),
      statusChangedAt: new Date(), statusChangedBy: operator } });
    if (input.status !== "active") await tx.$executeRaw`UPDATE auth_sessions s JOIN \`User\` u ON u.id=s.userId
      SET s.revokedAt=${new Date()} WHERE u.tenantId=${id} AND s.revokedAt IS NULL`;
    return { before: current.status, after: input.status, reason: input.reason.trim() };
  }

  async listOrganizations(tx: Pick<PlatformManagementTransaction, "organizationUnit">, tenantId?: string,
    currentUser?: SystemUserRow): Promise<OrganizationSummary[]> {
    if (isOrganizationScopedUser(currentUser)) {
      const scopedTenantId = resolveTenantIdForQuery(tenantId, currentUser);
      if (!scopedTenantId || !currentUser.organizationId) return [];
      const organizations = await tx.organizationUnit.findMany({
        where: { tenantId: scopedTenantId }, orderBy: [{ tenantId: "asc" }, { code: "asc" }]
      });
      const allowedOrganizationIds = new Set(enabledOrganizationSubtreeIds(organizations, currentUser.organizationId));
      return organizations.filter(organization => allowedOrganizationIds.has(organization.id))
        .map(organization => this.toOrganizationSummary(organization));
    }
    const organizations = await tx.organizationUnit.findMany({
      where: buildOrganizationWhere(tenantId, currentUser), orderBy: [{ tenantId: "asc" }, { code: "asc" }]
    });
    return organizations.map(organization => this.toOrganizationSummary(organization));
  }

  async saveOrganization(tx: PlatformManagementTransaction, input: SaveOrganizationRequest) {
    const code = input.code.trim(), name = input.name.trim(), parentId = input.parentId?.trim() || undefined;
    const status = input.status ?? "enabled";
    if (!code || !name) throw new BadRequestException("组织编码和组织名称不能为空");
    if (!await tx.tenant.findUnique({ where: { id: input.tenantId } })) throw new BadRequestException("租户不存在");
    if (await tx.organizationUnit.findFirst({ where: { id: { not: input.id }, tenantId: input.tenantId, code } }))
      throw new BadRequestException("该租户下组织编码已存在");
    if (parentId) {
      if (parentId === input.id) throw new BadRequestException("上级组织不能选择自身");
      if (!await tx.organizationUnit.findFirst({ where: { id: parentId, tenantId: input.tenantId } }))
        throw new BadRequestException("上级组织不属于当前租户");
    }
    const existing = input.id ? await tx.organizationUnit.findFirst({ where: { id: input.id, tenantId: input.tenantId } }) : undefined;
    if (input.id && !existing) throw new NotFoundException("组织不存在");
    const id = input.id ?? `org_${randomUUID()}`;
    const data = { parentId, type: input.type.toUpperCase() as StoredPlatformRoleScope, code, name, status };
    const row = existing ? await tx.organizationUnit.update({ where: { id }, data })
      : await tx.organizationUnit.create({ data: { id, tenantId: input.tenantId, ...data } });
    return { organization: this.toOrganizationSummary(row), created: !existing };
  }

  async setOrganizationStatus(tx: PlatformManagementTransaction, id: string, status: OrganizationSummary["status"], tenantId: string) {
    const existing = await tx.organizationUnit.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("组织不存在");
    if (existing.tenantId !== tenantId) throw new ForbiddenException("不能访问或修改其他租户的数据");
    const row = await tx.organizationUnit.update({ where: { id }, data: { status } });
    return this.toOrganizationSummary(row);
  }

  private toOrganizationSummary(row: { id: string; tenantId: string; parentId: string | null;
    type: StoredPlatformRoleScope; code: string; name: string; status: string }): OrganizationSummary {
    return { id: row.id, tenantId: row.tenantId, parentId: row.parentId ?? undefined,
      type: this.toSharedRoleScope(row.type), code: row.code, name: row.name, status: row.status as OrganizationSummary["status"] };
  }

  async saveSecurityBaseline(tx: PlatformManagementTransaction, security: SystemSecurityBaselineConfig, operator: string) {
    const where = { tenantId: PLATFORM_SECURITY_TENANT_ID, module: "system-rules", status: "EFFECTIVE" as const };
    const current = await tx.systemParameterSet.findFirst({ where, orderBy: { versionNo: "desc" } });
    const previous = current?.content ?? {};
    if (typeof previous !== "object" || Array.isArray(previous)) throw new BadRequestException("现有安全配置格式无法核对");
    const content = { ...previous, security: { ...security }, updatedAt: new Date().toISOString(), updatedBy: operator };
    // 原生效版本及其他字段留在同一对象。父租户锁串行化公共保存，版本/状态在写入点再次匹配。
    if (current) {
      const updated = await tx.systemParameterSet.updateMany({ where: { id: current.id, versionNo: current.versionNo, ...where },
        data: { content, operator } });
      if (updated.count !== 1) throw new ConflictException("安全基线在提交期间变化，请重读后核对");
    } else {
      await tx.systemParameterSet.create({ data: { ...where, versionNo: 1, content, operator } });
    }
  }

  async user(tx: PlatformManagementTransaction, id: string, tenantId: string) {
    const row = await tx.user.findFirst({ where: { id, tenantId }, include: this.userInclude() });
    if (!row || row.isSaasAdmin) throw new NotFoundException("租户账号不存在");
    return this.toUserRow(row);
  }

  async tenantAdmin(tx: PlatformManagementTransaction, tenantId: string) {
    const row = await tx.user.findFirst({
      where: { tenantId, isPlatformAdmin: true, isSaasAdmin: false },
      include: this.userInclude(), orderBy: { createdAt: "asc" }
    });
    if (!row) throw new NotFoundException("租户管理员账号不存在");
    await tx.$queryRaw`SELECT id FROM \`User\` WHERE id = ${row.id} AND tenantId = ${tenantId} FOR UPDATE`;
    return this.toUserRow(row);
  }

  async users(tx: PlatformManagementTransaction, tenantId: string, currentUser?: SystemUserRow) {
    const scopedTenantId = resolveTenantIdForQuery(tenantId, currentUser) ?? tenantId;
    const where: Parameters<PlatformManagementTransaction["user"]["findMany"]>[0]["where"] = {
      ...buildSystemUserWhere(tenantId, currentUser), tenantId: scopedTenantId, isSaasAdmin: false
    };
    if (isOrganizationScopedUser(currentUser)) {
      if (!currentUser.organizationId) return [];
      const organizations = await tx.organizationUnit.findMany({
        where: { tenantId: scopedTenantId }, orderBy: [{ tenantId: "asc" }, { code: "asc" }]
      });
      const allowedOrganizationIds = enabledOrganizationSubtreeIds(organizations, currentUser.organizationId);
      if (!allowedOrganizationIds.length) return [];
      where.organizationId = { in: allowedOrganizationIds };
    }
    const rows = await tx.user.findMany({ where, include: this.userInclude(), orderBy: { account: "asc" } });
    return rows.map(row => this.toUserRow(row));
  }

  private permissionCodes(codes: readonly string[], compatibility?: LegacyPlatformManagementCompatibility) {
    return compatibility ? compatibility.normalizePermissionCodes(codes) : [...new Set(codes)];
  }

  private async registeredPermissions(tx: PlatformManagementTransaction, codes: string[], buttons: string[]) {
    if (codes.some(code => !code || code === "*")) throw new BadRequestException("普通角色不能配置通配权限");
    const permissions = await tx.permission.findMany({ where: { code: { in: codes } } });
    const registered = new Map(permissions.map(permission => [permission.code, permission]));
    if (codes.some(code => !registered.has(code)) || buttons.some(code => registered.get(code)?.kind !== "BUTTON")) {
      throw new BadRequestException("角色只能配置已登记的对应类型权限");
    }
    return permissions;
  }

  private async lockRole(tx: PlatformManagementTransaction, id: string, tenantId: string, allowMissing = false) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM \`Role\` WHERE id = ${id} AND tenantId = ${tenantId} FOR UPDATE`;
    if (rows.length === 1) return;
    // 原 PUT 兼容创建尚不存在的指定 ID，已有其他租户角色仍须明确拒绝。
    const existing = allowMissing && await tx.role.findUnique({
      where: { id }, include: { _count: { select: { users: true, userAssignments: true } } }
    });
    if (!allowMissing || existing) throw new NotFoundException("角色不存在");
  }

  private async replaceRolePermissions(tx: PlatformManagementTransaction, id: string,
    permissions: Array<{ id: string }>) {
    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    if (permissions.length) await tx.rolePermission.createMany({
      data: permissions.map(permission => ({ roleId: id, permissionId: permission.id }))
    });
  }

  async roles(tx: PlatformManagementTransaction, tenantId: string, ids?: string[],
    compatibility?: LegacyPlatformManagementCompatibility): Promise<SystemRoleRow[]> {
    const rows = await tx.role.findMany({
      where: { tenantId, ...(ids ? { id: { in: ids } } : {}) },
      include: { permissions: { include: { permission: true } } },
      orderBy: [{ fixedAllPermissions: "desc" }, { code: "asc" }]
    });
    return rows.map(row => {
      // Core 的按钮码不必含 :button:；使用已登记类型，避免同一按钮同时进入操作权限和按钮权限。
      const codes = this.permissionCodes(row.permissions.filter(item => item.permission.kind !== "BUTTON")
        .map(item => item.permission.code), compatibility);
      const registeredButtons = this.permissionCodes(row.permissions.filter(item => item.permission.kind === "BUTTON")
        .map(item => item.permission.code), compatibility);
      const savedButtons = this.permissionCodes((row.buttonPermissions as string[] | null) ?? [], compatibility);
      return {
        id: row.id, tenantId, code: row.code, name: row.name,
        description: row.description ?? undefined, scope: this.toSharedRoleScope(row.scope),
        fixedAllPermissions: row.fixedAllPermissions, enabledBusinessScopes: row.enabledBusinessScopes as string[],
        dataScope: this.toSharedDataScope(row.dataScope), isActive: row.isActive,
        permissions: row.fixedAllPermissions ? ["*"] : codes,
        buttonPermissions: row.fixedAllPermissions ? ["*"] : [...new Set([...registeredButtons, ...savedButtons])]
      };
    });
  }

  async saveRole(tx: PlatformManagementTransaction, tenantId: string, input: SaveSystemRoleRequest,
    compatibility?: LegacyPlatformManagementCompatibility, beforeSelfRevocation?: () => Promise<void>) {
    if (input.tenantId !== undefined && input.tenantId !== tenantId) throw new ForbiddenException("角色不能指定其他租户");
    if (input.id) await this.lockRole(tx, input.id, tenantId, Boolean(compatibility));
    const existing = input.id ? (await this.roles(tx, tenantId, [input.id], compatibility))[0] : undefined;
    if (input.id && !existing && !compatibility) throw new NotFoundException("角色不存在");
    const code = input.code.trim().toUpperCase(), name = input.name.trim();
    if (!code || !name) throw new BadRequestException("角色编码和名称不能为空");
    if (existing?.fixedAllPermissions || code === "TENANT_ADMIN") throw new BadRequestException("固定全权角色不通过普通角色编辑修改");
    const duplicates = await tx.role.findMany({ where: { tenantId, code }, include: { permissions: { include: { permission: true } } } });
    if (duplicates.some(role => role.id !== existing?.id)) throw new BadRequestException("角色编码已存在");
    const requestedPermissions = this.permissionCodes(input.permissions ?? [], compatibility);
    const requestedButtons = this.permissionCodes(input.buttonPermissions ?? [], compatibility);
    const codes = [...new Set([...requestedPermissions, ...requestedButtons])];
    const permissions = await this.registeredPermissions(tx, codes, requestedButtons);
    const buttons = permissions.filter(permission => permission.kind === "BUTTON").map(permission => permission.code);
    const id = existing?.id ?? input.id ?? randomUUID();
    const data = {
      code, name, description: input.description?.trim(), scope: input.scope.toUpperCase() as StoredPlatformRoleScope,
      fixedAllPermissions: false, enabledBusinessScopes: [...new Set(input.enabledBusinessScopes ?? [])],
      buttonPermissions: buttons, dataScope: (input.dataScope ?? existing?.dataScope ?? "store").toUpperCase() as StoredPlatformDataScope,
      isActive: input.isActive ?? true
    };
    if (existing?.isActive && (!data.isActive || existing.dataScope === "all" && data.dataScope !== "ALL"
      || [...existing.permissions, ...(existing.buttonPermissions ?? [])].some(permission => !codes.includes(permission)))) {
      await beforeSelfRevocation?.();
    }
    if (existing) await tx.role.update({ where: { id }, data });
    else await tx.role.create({ data: { id, tenantId, ...data } });
    await this.replaceRolePermissions(tx, id, permissions);
    return (await this.roles(tx, tenantId, [id], compatibility))[0];
  }

  async saveRolePermissions(tx: PlatformManagementTransaction, id: string, codes: string[], tenantId: string,
    compatibility?: LegacyPlatformManagementCompatibility, beforeSelfRevocation?: () => Promise<void>) {
    await this.lockRole(tx, id, tenantId);
    const existing = (await this.roles(tx, tenantId, [id], compatibility))[0];
    if (!existing) throw new NotFoundException("角色不存在");
    if (existing.fixedAllPermissions) return existing;
    const nextPermissions = this.permissionCodes(codes, compatibility);
    const permissions = await this.registeredPermissions(tx, nextPermissions, []);
    const buttons = permissions.filter(permission => permission.kind === "BUTTON").map(permission => permission.code);
    if (existing.isActive && [...existing.permissions, ...(existing.buttonPermissions ?? [])].some(permission => !nextPermissions.includes(permission))) {
      await beforeSelfRevocation?.();
    }
    await this.replaceRolePermissions(tx, id, permissions);
    await tx.role.update({ where: { id }, data: { buttonPermissions: buttons } });
    return (await this.roles(tx, tenantId, [id], compatibility))[0];
  }

  async saveUser(tx: PlatformManagementTransaction, tenantId: string, input: SaveSystemUserRequest, actorIsAdmin: boolean,
    compatibility?: LegacyPlatformManagementCompatibility, beforeSelfRevocation?: () => Promise<void>) {
    if (input.isSaasAdmin || input.tenantId !== undefined && input.tenantId !== tenantId) throw new ForbiddenException("租户账号不能成为SaaS主体或跨租户");
    const storedExisting = input.id ? await tx.user.findFirst({ where: { id: input.id, tenantId }, include: this.userInclude() }) : undefined;
    if (input.id && (!storedExisting || storedExisting.isSaasAdmin)) throw new NotFoundException("租户账号不存在");
    const existing = storedExisting ? this.toUserRow(storedExisting) : undefined;
    const account = input.account.trim(), displayName = input.displayName.trim();
    if (!account || !displayName) throw new BadRequestException("账号和姓名不能为空");
    const duplicate = await tx.user.findFirst({ where: { tenantId, account,
      ...(input.id ? { id: { not: input.id } } : {}) }, include: this.userInclude() });
    if (duplicate) throw new BadRequestException("该租户下账号已存在");
    const adminRole = (await tx.role.findMany({ where: { tenantId, code: "TENANT_ADMIN" },
      include: { permissions: { include: { permission: true } } } }))[0];
    // 原固定管理员角色只经 isPlatformAdmin 分配，普通账号提交该 ID 时沿原规则剔除。
    const roleIds = input.isPlatformAdmin ? (adminRole ? [adminRole.id] : [])
      : [...new Set(input.roleIds ?? [])].filter(roleId => roleId !== adminRole?.id);
    const roles = await tx.role.findMany({ where: { tenantId, isActive: true, id: { in: roleIds } },
      include: { permissions: { include: { permission: true } } } });
    if (roles.length !== roleIds.length) throw new BadRequestException("角色不存在、已停用或不属于当前租户");
    if (!roles.length && (!input.isPlatformAdmin || !compatibility)) throw new BadRequestException("普通账号至少选择一个有效角色");
    if (!actorIsAdmin && (input.isPlatformAdmin || existing?.isPlatformAdmin || roles.some(role => role.fixedAllPermissions)))
      throw new ForbiddenException("只有当前租户管理员可以管理管理员账号");
    if (input.organizationId && !await tx.organizationUnit.findFirst({ where: { id: input.organizationId, tenantId } }))
      throw new BadRequestException("组织不属于当前租户");
    const activeExistingRoles = [...(storedExisting?.role ? [storedExisting.role] : []),
      ...(storedExisting?.roleAssignments.map(assignment => assignment.role) ?? [])].filter(role => role.isActive);
    if (storedExisting && (storedExisting.isActive && input.isActive === false || storedExisting.isPlatformAdmin && !input.isPlatformAdmin
      || activeExistingRoles.some(role => !roleIds.includes(role.id)))) {
      await beforeSelfRevocation?.();
    }
    const temporaryPassword = existing ? undefined : generateTemporaryPassword();
    const id = existing?.id ?? await this.insertUser(tx, { tenantId, account, displayName, phone: input.phone,
      organizationId: input.organizationId, roleId: roleIds[0], isPlatformAdmin: Boolean(input.isPlatformAdmin), password: temporaryPassword! });
    if (existing) await tx.user.update({ where: { id }, data: { account, displayName,
      // 省略字段沿原编辑语义保留存量，明确空值才参与更新。
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
      roleId: roleIds[0], isPlatformAdmin: Boolean(input.isPlatformAdmin), isActive: input.isActive } });
    else if (input.isActive === false) await tx.user.update({ where: { id }, data: { isActive: false } });
    await tx.userRole.deleteMany({ where: { userId: id } });
    if (roleIds.length) await tx.userRole.createMany({ data: roleIds.map(roleId => ({ userId: id, roleId })) });
    if (input.isActive === false) await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    return { ...await this.user(tx, id, tenantId), temporaryPassword };
  }

  async deleteRole(tx: PlatformManagementTransaction, id: string, tenantId: string,
    compatibility?: LegacyPlatformManagementCompatibility) {
    await this.lockRole(tx, id, tenantId);
    const role = await tx.role.findUnique({ where: { id }, include: { _count: { select: { users: true, userAssignments: true } } } });
    if (!role || role.tenantId !== tenantId) throw new NotFoundException("角色不存在");
    if (role.fixedAllPermissions || role._count.users || role._count.userAssignments) throw new BadRequestException("固定或已分配角色不能删除");
    await compatibility?.assertRoleNotReferenced(tx, id, tenantId);
    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    await tx.role.delete({ where: { id } });
    return { id, deleted: true as const };
  }
}
