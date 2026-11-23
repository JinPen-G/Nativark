/** 公共角色权限呈现正式出口。数据和保存由宿主提供，组件不授予任何Core或业务权限。 */
export { PermissionMatrix, PermissionEditor } from "./features/access/PermissionMatrix";
export * from "./features/access/permission-matrix-model";

export { PublicOperationsAccountPage, type PublicUserBusinessAccess } from "./features/access/PublicOperationsAccountPage";
export { PublicRolePermissionPage } from "./features/access/PublicRolePermissionPage";
export { PublicManagementCoreProvider, type PublicManagementCoreAdapter, type PublicManagementRouteProps } from "./features/access/management-adapter";
export { PublicTenantManagementPage, type PublicTenantBusiness, type PublicTenantCreated } from "./features/access/PublicTenantManagementPage";
export type { ManagementHeading, ManagementHeadingProps } from "./features/access/management-adapter";
