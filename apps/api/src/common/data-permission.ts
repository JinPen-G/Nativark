import type { SystemDataScope, SystemUserRow } from "@rental-os/shared";

export interface DataPermissionSummary {
  tenantId?: string;
  scope: SystemDataScope;
  organizationId?: string;
  description: string;
}

export function describeDataPermission(
  user?: SystemUserRow
): DataPermissionSummary {
  if (!user) {
    return {
      scope: "own",
      description: "未登录用户不授予数据范围"
    };
  }

  if (user.isSaasAdmin) {
    return {
      scope: "all",
      description: "SaaS 平台管理员可在显式目标租户范围内管理数据"
    };
  }

  if (user.isPlatformAdmin || user.permissions.includes("*")) {
    return {
      tenantId: user.tenantId,
      scope: "all",
      organizationId: user.organizationId,
      description: "租户管理员拥有当前租户全部数据"
    };
  }

  const descriptions: Record<SystemDataScope, string> = {
    all: "当前租户全部数据",
    organization: "当前组织及其业务范围数据",
    store: "当前经营空间/履约点数据",
    own: "本人创建或分配的数据"
  };

  return {
    tenantId: user.tenantId,
    scope: user.dataScope,
    organizationId: user.organizationId,
    description: descriptions[user.dataScope]
  };
}

export function resolveTenantIdForQuery(
  requestedTenantId: string | undefined,
  user?: SystemUserRow
) {
  if (!user) {
    return requestedTenantId;
  }
  if (user.isSaasAdmin) return requestedTenantId ?? user.tenantId;
  return user.tenantId;
}

export function buildSystemUserWhere(
  requestedTenantId: string | undefined,
  user?: SystemUserRow
) {
  const tenantId = resolveTenantIdForQuery(requestedTenantId, user);
  const where: Record<string, unknown> = tenantId ? { tenantId } : {};

  if (!user || user.isSaasAdmin || user.isPlatformAdmin || user.permissions.includes("*")) {
    return where;
  }

  if (user.dataScope === "own") {
    return {
      ...where,
      id: user.id
    };
  }
  if (user.dataScope === "store") {
    return user.organizationId
      ? {
          ...where,
          organizationId: user.organizationId
        }
      : {
          ...where,
          id: user.id
        };
  }

  return where;
}

export function buildOrganizationWhere(
  requestedTenantId: string | undefined,
  user?: SystemUserRow
) {
  const tenantId = resolveTenantIdForQuery(requestedTenantId, user);
  const where: Record<string, unknown> = tenantId ? { tenantId } : {};

  if (!user || user.isSaasAdmin || user.isPlatformAdmin || user.permissions.includes("*")) {
    return where;
  }

  if (user.dataScope === "own" || user.dataScope === "store") {
    return user.organizationId
      ? {
          ...where,
          id: user.organizationId
        }
      : where;
  }

  return where;
}
