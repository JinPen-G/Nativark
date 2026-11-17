/** 公共管理应用服务：当前原主体→公共事务→仓储→同事务审计。
 * 每次写入和返回前复验当前权限，临时密码只在对应创建/重置响应返回，不记审计。 */
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { CreatePlatformTenantRequest, CreatePlatformTenantResult, OrganizationSummary, SaveOrganizationRequest,
  SavePlatformSelfProfileRequest, SaveSystemRoleRequest, SaveSystemUserRequest, SystemSecurityBaselineConfig,
  SystemUserRow, UpdateTenantRequest, UpdateTenantStatusRequest } from "@rental-os/platform-contracts";
import { generateTemporaryPassword, hashPassword } from "../../common/password";
import { getRequestIdentity } from "../../common/request-identity";
import { hasEffectivePermission } from "../../permission-match";
import { PLATFORM_AUTH_DATA_STORE } from "./platform-auth-data-store";
import { PlatformManagementRepository } from "./platform-management.repository";
import type { PlatformManagementDatabase, PlatformManagementTransaction } from "./platform-management.store";
import { PlatformPrincipalAuthority } from "./platform-principal.authority";
import { managesPlatformTenants, managesTenant } from "./platform-permissions";
import { normalizeSecurityBaseline, PLATFORM_SECURITY_TENANT_ID, readPlatformSecurityBaseline, validateSecurityBaseline } from "./platform-security-baseline";

@Injectable()
export class PlatformManagementService {
  private readonly repository: PlatformManagementRepository;
  private readonly principals: PlatformPrincipalAuthority;
  constructor(@Inject(PLATFORM_AUTH_DATA_STORE) private readonly database: PlatformManagementDatabase) {
    this.repository = new PlatformManagementRepository(database);
    this.principals = new PlatformPrincipalAuthority(this.repository);
  }

  private run<T>(permission: string, saas: boolean, target: string | undefined,
    work: (tx: PlatformManagementTransaction, user: SystemUserRow) => Promise<T>, enabling = false,
    authorize?: (user: SystemUserRow) => boolean) {
    const actor = this.principals.current(), tenantId = target ?? actor.tenantId;
    if (!saas && tenantId !== actor.tenantId) throw new ForbiddenException("公共管理不能跨租户");
    const allowed = authorize ?? ((user: SystemUserRow) => saas ? user.isSaasAdmin === true
      && (user.permissions.includes(permission) || user.permissions.includes("*")) : managesTenant(user, permission));
    return this.database.$transaction(async tx => {
      const lease = await this.principals.lock(tx, actor, tenantId, undefined, enabling);
      if (!allowed(lease.user)) throw new ForbiddenException("缺少当前公共管理权限与租户范围");
      const result = await work(tx, lease.user);
      if (!allowed(await lease.revalidate())) throw new ForbiddenException("公共管理提交前当前权限已变化");
      return result;
    }, { isolationLevel: "Serializable" }).catch(error => {
      // 数据库唯一键是并发提交的最终约束；明确冲突后由用户重读，不自动重复管理操作。
      if (error && typeof error === "object" && "code" in error && (error.code === "P2002" || error.code === "P2034"))
        throw new ConflictException("公共管理资料已存在或在提交期间变化，请重读后核对");
      throw error;
    });
  }

  private audit(tx: PlatformManagementTransaction, user: SystemUserRow, tenantId: string, action: string,
    targetId: string, metadata: Record<string, string | boolean | number | undefined> = {},
    context: { operator?: string; targetType?: string; detail?: string } = {}) {
    return tx.operationLog.create({ data: { tenantId, userId: user.id, action,
      detail: { operator: user.id, targetType: "platform", targetId, metadata, ...context } } });
  }

  listOrganizations(tenantId?: string) {
    return this.run("system:user:manage", false, undefined, (tx, user) => this.repository.listOrganizations(tx, tenantId, user),
      false, user => !user.isSaasAdmin && (user.isPlatformAdmin || hasEffectivePermission(user.permissions, "system:user:manage")));
  }

  private canManageOrganizations(user: SystemUserRow) {
    return !user.isSaasAdmin && (user.isPlatformAdmin || hasEffectivePermission(user.permissions, "system:user:manage"))
      && (user.isPlatformAdmin || user.permissions.includes("*") || user.dataScope === "all")
      && getRequestIdentity()?.locationScope?.mode !== "selected";
  }

  saveOrganization(input: SaveOrganizationRequest) {
    const actor = this.principals.current();
    if (input.tenantId !== actor.tenantId) throw new ForbiddenException("不能访问或修改其他租户的数据");
    return this.run("system:user:manage", false, undefined, async (tx, user) => {
      const { organization, created } = await this.repository.saveOrganization(tx, input);
      await this.audit(tx, user, actor.tenantId, created ? "organization.create" : "organization.update", organization.id, {},
        { operator: input.operator ?? "平台管理员", targetType: "organization", detail: `${created ? "创建" : "更新"}组织 ${organization.name}` });
      return organization;
    }, false, user => this.canManageOrganizations(user));
  }

  setOrganizationStatus(id: string, status: OrganizationSummary["status"], operator = "租户管理员") {
    const actor = this.principals.current();
    return this.run("system:user:manage", false, undefined, async (tx, user) => {
      const organization = await this.repository.setOrganizationStatus(tx, id, status, actor.tenantId);
      await this.audit(tx, user, actor.tenantId, "organization.status", id, {}, { operator, targetType: "organization",
        detail: `${status === "enabled" ? "启用" : "停用"}组织 ${organization.name}` });
      return organization;
    }, false, user => this.canManageOrganizations(user));
  }

  readSecurityBaseline() {
    return this.run("system:params:manage", false, undefined, tx => readPlatformSecurityBaseline(tx), false,
      user => hasEffectivePermission(user.permissions, "system:params:manage") || !user.isSaasAdmin && user.isPlatformAdmin);
  }

  saveSecurityBaseline(input: SystemSecurityBaselineConfig) {
    return this.run("system:params:manage", true, PLATFORM_SECURITY_TENANT_ID, async (tx, user) => {
      const security = normalizeSecurityBaseline(input);
      validateSecurityBaseline(security);
      await this.repository.saveSecurityBaseline(tx, security, user.displayName);
      await this.audit(tx, user, PLATFORM_SECURITY_TENANT_ID, "security-baseline.update", "system-security", {},
        { operator: user.displayName, targetType: "security-baseline", detail: "更新登录限流、密码策略、脱敏和二次确认配置。" });
      return security;
    });
  }

  /** 原管理工具的 MVP 检查结果，业务批准和执行仍消费其正式授权与收据。 */
  checkSecondConfirmation(action: string, confirmationCode?: string) {
    return this.run("system:params:manage", false, undefined, async tx => {
      const baseline = await readPlatformSecurityBaseline(tx);
      const required = baseline.secondConfirmation.enabled && baseline.secondConfirmation.actions.includes(action);
      if (required && !confirmationCode?.trim()) throw new BadRequestException("该关键操作需要二次确认码");
      return {
        action,
        required,
        accepted: !required || confirmationCode === "000000",
        message: required && confirmationCode !== "000000"
          ? "MVP 预留二次确认校验，演示确认码为 000000。"
          : "二次确认校验通过。"
      };
    }, false, user => !user.isSaasAdmin && (user.isPlatformAdmin || hasEffectivePermission(user.permissions, "system:params:manage")));
  }

  listTenants() { return this.run("system:tenant:manage", true, undefined, tx => this.repository.tenants(tx)); }

  createTenant(input: CreatePlatformTenantRequest): Promise<CreatePlatformTenantResult> {
    return this.run("system:tenant:bootstrap", true, undefined, async (tx, user) => {
      const created = await this.repository.createTenant(tx, input);
      await this.audit(tx, user, created.tenantId, "tenant.created", created.tenantId);
      const tenant = (await this.repository.tenants(tx, created.tenantId))[0];
      const admin = await this.repository.user(tx, created.adminId, created.tenantId);
      return { tenant, admin, temporaryPassword: created.temporaryPassword, message: "公共租户已创建；管理员首次登录须改密，业务Core另行授权。" };
    });
  }

  updateTenant(id: string, input: UpdateTenantRequest, saas: boolean) {
    return this.run("system:tenant:manage", saas, id, async (tx, user) => {
      await this.repository.updateTenant(tx, id, input);
      await this.audit(tx, user, id, "tenant.update", id);
      return (await this.repository.tenants(tx, id))[0];
    });
  }

  readTenant() {
    const actor = this.principals.current();
    return this.run("system:tenant:manage", false, actor.tenantId, async tx => (await this.repository.tenants(tx, actor.tenantId))[0]);
  }

  tenantStatus(id: string, input: UpdateTenantStatusRequest) {
    return this.run("system:tenant:manage", true, id, async (tx, user) => {
      if (!managesPlatformTenants(user)) throw new ForbiddenException("租户状态需要当前SaaS管理员");
      await this.repository.tenantStatus(tx, id, input, user.displayName);
      await this.audit(tx, user, id, "tenant.status.update", id, { state: input.status });
      return (await this.repository.tenants(tx, id))[0];
    });
  }

  listUsers() {
    const actor = this.principals.current();
    return this.run("system:user:manage", false, undefined, tx => this.repository.users(tx, actor.tenantId));
  }

  saveUser(input: SaveSystemUserRequest) {
    const actor = this.principals.current();
    if (input.id === actor.subjectId && !input.isActive) throw new BadRequestException("不能通过账号管理停用当前登录账号");
    return this.run("system:user:manage", false, undefined, async (tx, user) => {
      const result = await this.repository.saveUser(tx, actor.tenantId, input, user.isPlatformAdmin);
      await this.audit(tx, user, actor.tenantId, "system.user.saved", result.id, { active: input.isActive });
      return result;
    });
  }

  userStatus(id: string, active: boolean) {
    const actor = this.principals.current();
    if (id === actor.subjectId) throw new BadRequestException("不能通过账号管理停用当前登录账号");
    return this.run("system:user:manage", false, undefined, async (tx, user) => {
      const target = await this.repository.user(tx, id, actor.tenantId);
      if (target.isPlatformAdmin && !user.isPlatformAdmin) throw new ForbiddenException("只有租户管理员可以管理管理员账号");
      await tx.user.update({ where: { id }, data: { isActive: active } });
      if (!active) await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit(tx, user, actor.tenantId, "system.user.status", id, { active });
      return this.repository.user(tx, id, actor.tenantId);
    });
  }

  resetUserPassword(id: string) {
    const actor = this.principals.current();
    if (id === actor.subjectId) throw new BadRequestException("本人修改密码请使用安全设置");
    return this.run("system:user:manage", false, undefined, async (tx, user) => {
      const target = await this.repository.user(tx, id, actor.tenantId);
      if (target.isPlatformAdmin && !user.isPlatformAdmin) throw new ForbiddenException("只有租户管理员可以重置管理员密码");
      const temporaryPassword = generateTemporaryPassword();
      await tx.user.update({ where: { id }, data: { passwordHash: hashPassword(temporaryPassword), mustChangePassword: true,
        passwordChangedAt: new Date(), tokenVersion: { increment: 1 } } });
      await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit(tx, user, actor.tenantId, "system.user.reset-password", id);
      return { userId: id, account: target.account, temporaryPassword, message: "临时密码只在本响应返回，下次登录必须修改。" };
    });
  }

  listRoles() {
    const actor = this.principals.current();
    return this.run("system:role:manage", false, undefined, tx => this.repository.roles(tx, actor.tenantId));
  }

  saveRole(input: SaveSystemRoleRequest) {
    const actor = this.principals.current();
    return this.run("system:role:manage", false, undefined, async (tx, user) => {
      const result = await this.repository.saveRole(tx, actor.tenantId, input);
      await this.audit(tx, user, actor.tenantId, "system.role.saved", result.id);
      return result;
    });
  }

  deleteRole(id: string) {
    const actor = this.principals.current();
    return this.run("system:role:manage", false, undefined, async (tx, user) => {
      const result = await this.repository.deleteRole(tx, id, actor.tenantId);
      await this.audit(tx, user, actor.tenantId, "system.role.deleted", id);
      return result;
    });
  }

  permissionTree() {
    return this.run("system:role:manage", false, undefined, async tx => {
      const permissions = await tx.permission.findMany({ orderBy: { code: "asc" } });
      const modules = new Map<string, { code: string; name: string; children: Array<{ code: string; name: string; description?: string }> }>();
      for (const permission of permissions) {
        const group = modules.get(permission.module) ?? { code: permission.module, name: permission.module, children: [] };
        group.children.push({ code: permission.code, name: permission.name, description: permission.description ?? undefined });
        modules.set(permission.module, group);
      }
      return [...modules.values()];
    });
  }

  saveSelfProfile(input: SavePlatformSelfProfileRequest) {
    const actor = this.principals.current();
    return this.database.$transaction(async tx => {
      const lease = await this.principals.lock(tx, actor, actor.tenantId);
      const displayName = input.displayName.trim();
      if (!displayName) throw new BadRequestException("姓名不能为空");
      await tx.user.update({ where: { id: actor.subjectId }, data: { displayName,
        ...(input.phone !== undefined ? { phone: input.phone.trim() || null } : {}) } });
      await this.audit(tx, lease.user, actor.tenantId, "system.user.profile", actor.subjectId);
      return lease.revalidate();
    }, { isolationLevel: "Serializable" });
  }

  readSelfProfile() {
    const actor = this.principals.current();
    return this.database.$transaction(async tx => {
      const lease = await this.principals.lock(tx, actor, actor.tenantId);
      return lease.revalidate();
    }, { isolationLevel: "ReadCommitted" });
  }
}
