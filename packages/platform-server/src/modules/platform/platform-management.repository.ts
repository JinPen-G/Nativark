/** 公共租户、账号与角色仓储。无行业表或业务初始化，原身份与权限投影保持单源。
 * 调用方先锁当前主体；所有写入与审计在同一公共事务，Core使用权另由Core宿主维护。 */
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { CreatePlatformTenantRequest, PlatformTenantSummary, SaveSystemRoleRequest, SaveSystemUserRequest,
  SystemRoleRow, UpdateTenantRequest, UpdateTenantStatusRequest } from "@rental-os/platform-contracts";
import { generateTemporaryPassword, hashPassword } from "../../common/password";
import { PlatformIdentityRepository } from "./platform-identity.repository";
import type { PlatformManagementDatabase, PlatformManagementTransaction } from "./platform-management.store";
import type { StoredPlatformRoleScope, StoredPlatformDataScope } from "./platform-auth-data-store";

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
  }

  async user(tx: PlatformManagementTransaction, id: string, tenantId: string) {
    const row = await tx.user.findFirst({ where: { id, tenantId }, include: this.userInclude() });
    if (!row || row.isSaasAdmin) throw new NotFoundException("租户账号不存在");
    return this.toUserRow(row);
  }

  async users(tx: PlatformManagementTransaction, tenantId: string) {
    const rows = await tx.user.findMany({ where: { tenantId, isSaasAdmin: false }, include: this.userInclude(), orderBy: { account: "asc" } });
    return rows.map(row => this.toUserRow(row));
  }

  async roles(tx: PlatformManagementTransaction, tenantId: string, ids?: string[]): Promise<SystemRoleRow[]> {
    return (await tx.role.findMany({ where: { tenantId, ...(ids ? { id: { in: ids } } : {}) }, include: { permissions: { include: { permission: true } } },
      orderBy: [{ fixedAllPermissions: "desc" }, { code: "asc" }] })).map(row => ({ id: row.id, tenantId, code: row.code, name: row.name,
      description: row.description ?? undefined, scope: this.toSharedRoleScope(row.scope), fixedAllPermissions: row.fixedAllPermissions,
      enabledBusinessScopes: row.enabledBusinessScopes as string[], buttonPermissions: (row.buttonPermissions as string[] | null) ?? [],
      dataScope: this.toSharedDataScope(row.dataScope), isActive: row.isActive,
      permissions: row.fixedAllPermissions ? ["*"] : row.permissions.map(item => item.permission.code) }));
  }

  async saveRole(tx: PlatformManagementTransaction, tenantId: string, input: SaveSystemRoleRequest) {
    if (input.tenantId !== undefined && input.tenantId !== tenantId) throw new ForbiddenException("角色不能指定其他租户");
    const existing = input.id ? (await this.roles(tx, tenantId, [input.id]))[0] : undefined;
    if (input.id && !existing) throw new NotFoundException("角色不存在");
    const code = input.code.trim(), name = input.name.trim();
    if (!code || !name) throw new BadRequestException("角色编码和名称不能为空");
    if (existing?.fixedAllPermissions || code === "TENANT_ADMIN") throw new BadRequestException("固定全权角色不通过普通角色编辑修改");
    const codes = [...new Set([...input.permissions, ...(input.buttonPermissions ?? [])])];
    if (codes.includes("*")) throw new BadRequestException("普通角色不允许保存通配权限");
    const permissions = await tx.permission.findMany({ where: { code: { in: codes } } });
    if (permissions.length !== codes.length || (input.buttonPermissions ?? []).some(code => !permissions.some(p => p.code === code && p.kind === "BUTTON")))
      throw new BadRequestException("权限未登记或按钮类型不符");
    const id = existing?.id ?? randomUUID();
    const data = { code, name, description: input.description?.trim(), scope: input.scope.toUpperCase() as StoredPlatformRoleScope,
      fixedAllPermissions: false, enabledBusinessScopes: [...new Set(input.enabledBusinessScopes)],
      buttonPermissions: permissions.filter(p => p.kind === "BUTTON").map(p => p.code),
      dataScope: (input.dataScope ?? existing?.dataScope ?? "store").toUpperCase() as StoredPlatformDataScope, isActive: input.isActive };
    if (existing) await tx.role.update({ where: { id }, data });
    else await tx.role.create({ data: { id, tenantId, ...data } });
    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map(p => ({ roleId: id, permissionId: p.id })) });
    return (await this.roles(tx, tenantId, [id]))[0];
  }

  async saveUser(tx: PlatformManagementTransaction, tenantId: string, input: SaveSystemUserRequest, actorIsAdmin: boolean) {
    if (input.isSaasAdmin || input.tenantId !== undefined && input.tenantId !== tenantId) throw new ForbiddenException("租户账号不能成为SaaS主体或跨租户");
    const existing = input.id ? await this.user(tx, input.id, tenantId) : undefined;
    const account = input.account.trim(), displayName = input.displayName.trim();
    if (!account || !displayName) throw new BadRequestException("账号和姓名不能为空");
    const candidates = await tx.role.findMany({ where: { tenantId, isActive: true, ...(input.isPlatformAdmin ? { code: "TENANT_ADMIN" }
      : { id: { in: [...new Set(input.roleIds)] } }) }, include: { permissions: { include: { permission: true } } } });
    if (!input.isPlatformAdmin && candidates.length !== new Set(input.roleIds).size) throw new BadRequestException("角色不存在、已停用或不属于当前租户");
    // 原租户管理员角色只经isPlatformAdmin分配，不能混入普通角色形成隐含全权。
    const roles = input.isPlatformAdmin ? candidates : candidates.filter(role => role.code !== "TENANT_ADMIN");
    if (!roles.length) throw new BadRequestException("普通账号至少选择一个有效角色");
    if (!actorIsAdmin && (input.isPlatformAdmin || existing?.isPlatformAdmin || roles.some(role => role.fixedAllPermissions)))
      throw new ForbiddenException("只有当前租户管理员可以管理管理员账号");
    if (input.organizationId && !await tx.organizationUnit.findFirst({ where: { id: input.organizationId, tenantId } }))
      throw new BadRequestException("组织不属于当前租户");
    const temporaryPassword = existing ? undefined : generateTemporaryPassword();
    const id = existing?.id ?? await this.insertUser(tx, { tenantId, account, displayName, phone: input.phone,
      organizationId: input.organizationId, roleId: roles[0].id, isPlatformAdmin: Boolean(input.isPlatformAdmin), password: temporaryPassword! });
    if (existing) await tx.user.update({ where: { id }, data: { account, displayName, phone: input.phone ?? null,
      organizationId: input.organizationId ?? null, roleId: roles[0].id, isPlatformAdmin: Boolean(input.isPlatformAdmin), isActive: input.isActive } });
    else if (!input.isActive) await tx.user.update({ where: { id }, data: { isActive: false } });
    await tx.userRole.deleteMany({ where: { userId: id } });
    await tx.userRole.createMany({ data: roles.map(role => ({ userId: id, roleId: role.id })) });
    if (!input.isActive) await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    return { ...await this.user(tx, id, tenantId), temporaryPassword };
  }

  async deleteRole(tx: PlatformManagementTransaction, id: string, tenantId: string) {
    const role = await tx.role.findUnique({ where: { id }, include: { _count: { select: { users: true, userAssignments: true } } } });
    if (!role || role.tenantId !== tenantId) throw new NotFoundException("角色不存在");
    if (role.fixedAllPermissions || role._count.users || role._count.userAssignments) throw new BadRequestException("固定或已分配角色不能删除");
    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    await tx.role.delete({ where: { id } });
    return { id, deleted: true as const };
  }
}
