/** 公共租户摘要的 Rental 数量投影、原角色目录登记与原组合历史权限解释。
 * 公共主体、会话和写入由同一管理事务裁定，本适配只投影既有事实和补充拒绝条件。 */
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { corePermissionCode } from "@rental-os/core-contracts";
import type { CorePermissionRegistrationParticipant } from "@rental-os/platform-core-host";
import type { LegacyPlatformManagementCompatibility, PlatformTenantSummaryProjection } from "@rental-os/platform-server/management-store";
import type { TenantSummary } from "./auth-contracts";
import { RENTAL_CORE_ID } from "./core-identity";
import { createRentalLegacyPermissionModules, RENTAL_PERMISSION_DECLARATIONS, rentalOriginalPermissionCode } from "./permissions";

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

// 原 Prisma 种子将这些精确业务码另列会员模块，兼容登记保留已存在的模块及权限 ID。
const historicalPermissionModules: Readonly<Record<string, string>> = {
  "rental-os:member:account-manage": "会员管理",
  "rental-os:member:review": "会员管理",
  "rental-os:member:qualification-review": "会员管理",
  "rental-os:member:plan:manage": "会员管理",
  "rental-os:member:plan:publish": "会员管理",
  "rental-os:corporate:employee-manage": "企业会员"
};

/** 受控宿主以已核定 Rental 清单供给公共登记事务，原角色仍保存精确业务码。
 * 页面 OR 准入只参与当前目录投影，其独立声明没有原业务码，因而不进入角色权限登记。 */
export function createRentalPermissionRegistrationParticipant(): CorePermissionRegistrationParticipant {
  const originals = new Map(createRentalLegacyPermissionModules().flatMap(module =>
    module.children.map(permission => [permission.code, { ...permission, module: module.name }] as const)));
  const declared = new Set(RENTAL_PERMISSION_DECLARATIONS.map(permission => corePermissionCode(RENTAL_CORE_ID, permission)));
  return {
    coreId: RENTAL_CORE_ID,
    declarations(manifest) {
      if (manifest.id !== RENTAL_CORE_ID) throw new Error("Rental 原角色目录仅供所选 Rental 包使用");
      return manifest.permissions.flatMap(permission => {
        const reference = corePermissionCode(manifest.id, permission);
        if (!declared.has(reference)) throw new Error("Rental 清单权限与当前包的原声明不一致");
        const code = rentalOriginalPermissionCode(reference);
        if (!code) return [];
        const original = originals.get(code)!;
        const previousModule = historicalPermissionModules[code];
        return [{ permission: { resource: permission.resource, action: permission.action }, code,
          name: original.name, module: original.module, description: original.description,
          kind: legacyButtons.has(code) ? "BUTTON" as const : "ACTION" as const,
          previousModules: previousModule ? [previousModule] : undefined }];
      });
    }
  };
}

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
