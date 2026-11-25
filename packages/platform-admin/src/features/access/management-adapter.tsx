/** Core 只向原管理页面提供可选呈现和默认值。
 * 适配不授予业务访问权，公共账号及角色始终由原服务端接口复验。 */
import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { SaveSystemRoleRequest } from "@rental-os/platform-contracts";
import { PageHeading, type PageHeadingProps } from "../../components/PageHeading";
import { useAdminSession } from "../../runtime";
import { resolveAdminBrandName } from "../../app/branding";

export type ManagementHeadingProps = Omit<PageHeadingProps, "brandName">;
export type ManagementHeading = ComponentType<ManagementHeadingProps>;
export type ManagementRoleDefaults = Pick<SaveSystemRoleRequest, "scope" | "enabledBusinessScopes" | "dataScope">;

export interface PublicManagementRouteProps { routeEdit?: boolean; routeAction?: boolean; routeStatus?: boolean; }

export interface PublicManagementCoreAdapter {
  UsersPage?: ComponentType<PublicManagementRouteProps>;
  TenantsPage?: ComponentType<PublicManagementRouteProps>;
  tenantRoleDefaults?: ManagementRoleDefaults;
  platformRoleDefaults?: ManagementRoleDefaults;
}

const ManagementCoreContext = createContext<PublicManagementCoreAdapter | undefined>(undefined);

export function PublicManagementCoreProvider({ adapter, children }: {
  adapter?: PublicManagementCoreAdapter;
  children: ReactNode;
}) {
  return <ManagementCoreContext.Provider value={adapter}>{children}</ManagementCoreContext.Provider>;
}

export function usePublicManagementCoreAdapter() {
  return useContext(ManagementCoreContext);
}

export function ManagementPageHeading(props: ManagementHeadingProps) {
  const { tenant, user } = useAdminSession();
  return <PageHeading {...props} brandName={resolveAdminBrandName(tenant, user)} />;
}
