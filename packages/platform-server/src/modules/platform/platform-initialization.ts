/** 部署人员显式创建公共SaaS主体；重复执行不改账号口令/角色，不初始化任何Core或订阅。 */
import { BadRequestException, ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PlatformManagementRepository } from "./platform-management.repository";
import type { PlatformManagementDatabase } from "./platform-management.store";
import { PLATFORM_PERMISSIONS } from "./platform-permissions";

export async function initializePublicPlatform(database: PlatformManagementDatabase, password: string) {
  if (!password || password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password))
    throw new BadRequestException("SaaS初始口令至少8位，包含字母和数字，不能使用默认口令");
  const repository = new PlatformManagementRepository(database);
  return database.$transaction(async tx => {
    const existing = await tx.tenant.findUnique({ where: { code: "platform" } });
    // 已有公共库也补录当前权限目录；后续主体核验失败时，元数据随同一事务回滚。
    for (const permission of PLATFORM_PERMISSIONS) await tx.permission.upsert({ where: { code: permission.code },
      create: { id: randomUUID(), ...permission, kind: "ACTION" }, update: { name: permission.name, module: permission.module } });
    if (existing) {
      const admin = await repository.findUserById("user_saas_admin", tx);
      if (!admin?.isSaasAdmin || admin.tenantId !== existing.id || !admin.permissions.includes("system:tenant:manage")
        || !admin.permissions.includes("system:tenant:bootstrap"))
        throw new ConflictException("已存在SaaS主体但原管理员不可用；须核对原账号，初始化不会重置或恢复它");
      return { initialized: false as const, tenantId: existing.id };
    }
    const tenantId = "tenant_platform";
    await tx.tenant.create({ data: { id: tenantId, code: "platform", name: "Nativark SaaS平台", status: "ACTIVE" } });
    await tx.organizationUnit.create({ data: { id: "org_saas_platform", tenantId, type: "OPERATOR", code: "SAAS", name: "SaaS平台管理" } });
    const roleId = "role_saas_admin", allowed = ["system:tenant:manage", "system:tenant:bootstrap", "system:params:manage"];
    await tx.role.create({ data: { id: roleId, tenantId, code: "SAAS_ADMIN", name: "SaaS平台管理员",
      description: "公共租户和底座管理，不授予租户业务访问权", scope: "OPERATOR", fixedAllPermissions: false,
      enabledBusinessScopes: [], buttonPermissions: [], dataScope: "ALL", isActive: true } });
    const permissions = await tx.permission.findMany({ where: { code: { in: allowed } } });
    await tx.rolePermission.createMany({ data: permissions.map(permission => ({ roleId, permissionId: permission.id })) });
    const userId = await repository.insertUser(tx, { id: "user_saas_admin", tenantId, account: "admin", displayName: "SaaS平台管理员",
      organizationId: "org_saas_platform", roleId, isSaasAdmin: true, isPlatformAdmin: false, password });
    await tx.operationLog.create({ data: { tenantId, userId, action: "platform.initialized",
      detail: { operator: userId, targetType: "platform", targetId: tenantId } } });
    return { initialized: true as const, tenantId, userId };
  }, { isolationLevel: "Serializable" });
}
