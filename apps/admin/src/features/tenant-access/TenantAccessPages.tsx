/** 旧组合沿原 PageHeader、会话与服务端 Guard 消费同一原列表/侧窗。 */
import { RoleScope } from "@rental-os/platform-contracts";
import { OriginalRentalOperationsAccountPage } from "@rental-os/rental-core/admin";
import { PublicRolePermissionPage } from "@rental-os/platform-admin/access";
import { PageHeader } from "@/components/PageHeader";
export function TenantOperationsAccountPage() { return <OriginalRentalOperationsAccountPage Heading={PageHeader} />; }
export function TenantRolePermissionPage() {
  return <PublicRolePermissionPage Heading={PageHeader} defaults={{ scope: RoleScope.Store, enabledBusinessScopes: ["rental"], dataScope: "store" }} />;
}
