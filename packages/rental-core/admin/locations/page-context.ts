/** 宿主绑定真实会话及原组织/元数据权限，异步读取和写入核对同一经营空间。 */
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import { createRentalLocationApi, type RentalLocationApi } from "./client";

export interface RentalLocationPageContext {
  api: RentalLocationApi;
  scopeKey: string;
  currentScopeKey: () => string | undefined;
  canViewProfile: () => boolean;
  canViewCategories: () => boolean;
  canViewOrganizations: () => boolean;
  canManageOrganizationMapping: () => boolean;
}

export function createRentalLocationPageContext({
  runtime,
  scopeKey,
  currentScopeKey,
  canViewProfile = () => false,
  canViewCategories = () => false,
  canViewOrganizations,
  canManageOrganizationMapping,
}: {
  runtime: AdminRuntime;
  scopeKey: string;
  currentScopeKey: RentalLocationPageContext["currentScopeKey"];
  /** 旧宿主缺少元数据读取接点时使用通用地点标题，地点读保持原权限。 */
  canViewProfile?: RentalLocationPageContext["canViewProfile"];
  canViewCategories?: RentalLocationPageContext["canViewCategories"];
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
  const assertMetadataAccess = (canRead: () => boolean) => {
    assertCurrent();
    if (!canRead()) throw new Error("当前品类资料不可用");
  };
  const assertOrganizationAccess = () => {
    assertCurrent();
    if (!canViewOrganizations()) throw new Error("当前组织目录不可用");
  };
  return {
    api: {
      ...api,
      profile: async (options) => {
        assertMetadataAccess(canViewProfile);
        const profile = await api.profile(options);
        assertMetadataAccess(canViewProfile);
        return profile;
      },
      categories: async (options) => {
        assertMetadataAccess(canViewCategories);
        const categories = await api.categories(options);
        assertMetadataAccess(canViewCategories);
        return categories;
      },
      organizations: async (options) => {
        assertOrganizationAccess();
        const organizations = await api.organizations(options);
        assertOrganizationAccess();
        return organizations;
      },
    },
    scopeKey,
    currentScopeKey,
    canViewProfile: () => isCurrentScope() && canViewProfile(),
    canViewCategories: () => isCurrentScope() && canViewCategories(),
    canViewOrganizations: () => isCurrentScope() && canViewOrganizations(),
    canManageOrganizationMapping: () => isCurrentScope() && canManageOrganizationMapping(),
  };
}
