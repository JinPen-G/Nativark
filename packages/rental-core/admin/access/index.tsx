/** 所选 Rental 的管理页只补回原业务内容和默认值，不创建另一套权限。 */
import { RoleScope } from "@rental-os/platform-contracts";
import type { PublicManagementCoreAdapter } from "@rental-os/platform-admin/access";
import { RentalOperationsAccountPage } from "./OperationsAccountPage";
import { RentalTenantManagementPage } from "./TenantManagementPage";
export { RentalOperationsAccountPage, OriginalRentalOperationsAccountPage } from "./OperationsAccountPage";
export { RentalTenantManagementPage } from "./TenantManagementPage";
export { OperatorInvitations as RentalOperatorInvitations } from "./OperatorInvitations";
export const rentalPublicManagement: PublicManagementCoreAdapter = {
  UsersPage: RentalOperationsAccountPage,
  TenantsPage: RentalTenantManagementPage,
  tenantRoleDefaults: { scope: RoleScope.Store, enabledBusinessScopes: ["rental"], dataScope: "store" },
};
