/** 宿主绑定真实会话及原组织权限，异步读取和写入核对同一经营空间。 */
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import { createRentalLocationApi, type RentalLocationApi } from "./client";

export interface RentalLocationPageContext {
  api: RentalLocationApi;
  scopeKey: string;
  currentScopeKey: () => string | undefined;
  canViewOrganizations: () => boolean;
  canManageOrganizationMapping: () => boolean;
}

export function createRentalLocationPageContext({
  runtime,
  scopeKey,
  currentScopeKey,
  canViewOrganizations,
  canManageOrganizationMapping,
}: {
  runtime: AdminRuntime;
  scopeKey: string;
  currentScopeKey: RentalLocationPageContext["currentScopeKey"];
  canViewOrganizations: RentalLocationPageContext["canViewOrganizations"];
  canManageOrganizationMapping: RentalLocationPageContext["canManageOrganizationMapping"];
}): RentalLocationPageContext {
  const isCurrentScope = () => Boolean(scopeKey) && currentScopeKey() === scopeKey;
  const assertCurrent = () => {
    if (!isCurrentScope()) throw new DOMException("地点页面的会话或经营空间已变化", "AbortError");
  };
  const request: AdminRuntime["request"] = async <Result,>(
    path: string,
    options?: AdminRequestOptions,
  ): Promise<Result> => {
    assertCurrent();
    const result = await runtime.request<Result>(path, options);
    assertCurrent();
    return result;
  };
  const api = createRentalLocationApi(request);
  const assertOrganizationAccess = () => {
    assertCurrent();
    if (!canViewOrganizations()) throw new Error("当前组织目录不可用");
  };
  return {
    api: {
      ...api,
      organizations: async (options) => {
        assertOrganizationAccess();
        const organizations = await api.organizations(options);
        assertOrganizationAccess();
        return organizations;
      },
    },
    scopeKey,
    currentScopeKey,
    canViewOrganizations: () => isCurrentScope() && canViewOrganizations(),
    canManageOrganizationMapping: () => isCurrentScope() && canManageOrganizationMapping(),
  };
}
