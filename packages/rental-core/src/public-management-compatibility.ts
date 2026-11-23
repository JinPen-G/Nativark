/** 公共租户摘要的 Rental 数量投影与原组合历史权限解释。
 * 公共主体、会话和写入由同一管理事务裁定，本适配只投影既有事实和补充拒绝条件。 */
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { LegacyPlatformManagementCompatibility, PlatformTenantSummaryProjection } from "@rental-os/platform-server/management-store";
import type { TenantSummary } from "./auth-contracts";

const permissionReplacements: Readonly<Record<string, readonly string[]>> = {
  "rental-os:vehicle-group:manage": ["rental-core:catalog:view", "rental-core:catalog:manage"],
  "rental-os:vehicle:view": ["rental-core:catalog:view", "rental-core:asset:view", "rental-os:order:view"],
  "rental-os:vehicle:manage": ["rental-core:asset:manage", "rental-os:order:operate"],
  "rental-os:vehicle:status-action": ["rental-core:asset:manage"]
};

const legacyButtons = new Set([
  "rental-os:order:create",
  "rental-os:order:pickup",
  "rental-os:order:return",
  "rental-os:order:extend",
  "rental-os:order:cancel",
  "rental-os:order:close",
  "rental-os:order:fee-manage",
  "rental-os:member:risk-action",
  "rental-os:corporate:monthly-settle",
  "rental-os:finance:adjust",
  "rental-os:finance:invoice",
  "system:button:export"
]);

/** 独立宿主只追加原两项数量，其他 Core 的开通状态由平台目录维护。 */
export const rentalTenantSummaryProjection: PlatformTenantSummaryProjection = {
  async projectTenants(transaction, tenants) {
    const source = transaction as unknown as Pick<Prisma.TransactionClient, "tenant">;
    const rows = await source.tenant.findMany({
      where: { id: { in: tenants.map(tenant => tenant.tenantId) } },
      select: { id: true, _count: { select: { businessWorkspaces: true, rentalOrders: true } } }
    });
    const byId = new Map(rows.map(row => [row.id, row]));
    return tenants.map(tenant => {
      const row = byId.get(tenant.tenantId);
      if (!row) throw new NotFoundException("租户不存在");
      return { ...tenant, workspaceCount: row._count.businessWorkspaces, orderCount: row._count.rentalOrders };
    });
  }
};

export const rentalPublicManagementCompatibility: LegacyPlatformManagementCompatibility = {
  // 原普通管理账号须具有完整租户范围及精确代码，全权管理员沿当前身份标志识别。
  allowsTenantAccess(user, permission) {
    return user.isPlatformAdmin || user.dataScope === "all" && user.permissions.includes(permission);
  },

  async projectTenants(transaction, tenants): Promise<TenantSummary[]> {
    const source = transaction as unknown as Pick<Prisma.TransactionClient, "tenant">;
    const rows = await source.tenant.findMany({
      where: { id: { in: tenants.map(tenant => tenant.tenantId) } },
      include: {
        rentalProfile: { include: { category: true } },
        businessWorkspaces: { select: { categoryCode: true } },
        _count: { select: { rentalOrders: true } }
      }
    });
    const byId = new Map(rows.map(row => [row.id, row]));
    return tenants.map(tenant => {
      const row = byId.get(tenant.tenantId);
      if (!row) throw new NotFoundException("租户不存在");
      // 原摘要读取会把旧 Prisma 大写品类解释为原小写编码，沿同一历史口径投影。
      const workspaceCategoryCodes = row.businessWorkspaces
        .map(workspace => workspace.categoryCode.toLowerCase() as NonNullable<TenantSummary["categoryCode"]>)
        .filter(Boolean);
      return {
        ...tenant,
        enabledBusinessLines: ["rental_core"],
        categoryCode: row.rentalProfile?.categoryCode.toLowerCase() as TenantSummary["categoryCode"],
        categoryName: row.rentalProfile?.category.name,
        capabilities: row.rentalProfile?.capabilities as TenantSummary["capabilities"],
        workspaceCount: row.businessWorkspaces.length,
        workspaceCategoryCodes: [...new Set(workspaceCategoryCodes)],
        orderCount: row._count.rentalOrders
      };
    });
  },

  normalizePermissionCodes(codes) {
    return [...new Set(codes.flatMap(code => permissionReplacements[code] ?? [code]))];
  },

  isButtonPermission(code) {
    return code.includes(":button:") || legacyButtons.has(code);
  },

  permissionModule(permission) {
    if (Object.hasOwn(permissionReplacements, permission.code)) return undefined;
    if (permission.code.startsWith("system:")) return { code: "system", name: "系统设置" };
    if (permission.code.startsWith("rental-os:")) return { code: "rental-os", name: "租赁业务" };
    return { code: permission.module, name: permission.module };
  },

  async assertRoleNotReferenced(transaction, roleId) {
    const source = transaction as unknown as Pick<Prisma.TransactionClient, "workspaceMember">;
    const references = await source.workspaceMember.count({ where: { roleId } });
    if (references) throw new BadRequestException("该角色已分配给账号，不能删除");
  },

  async assertUserNotPrivileged(transaction, userId, tenantId, actor) {
    if (actor.isPlatformAdmin) return;
    const source = transaction as unknown as Pick<Prisma.TransactionClient, "workspaceMember">;
    const privilegedWorkspace = await source.workspaceMember.findFirst({
      where: { tenantId, userId, isActive: true, role: { is: { fixedAllPermissions: true, isActive: true } } },
      select: { userId: true }
    });
    if (privilegedWorkspace) throw new ForbiddenException("只有当前租户管理员可以管理管理员账号及其空间授权");
  }
};
