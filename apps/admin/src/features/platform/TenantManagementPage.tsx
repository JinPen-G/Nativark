/** 旧组合保持原租户列表、侧窗及原 bootstrap 事务，正式 Rental 宿主复用同一实现。 */
import { RentalTenantManagementPage } from "@rental-os/rental-core/admin";
import { PageHeader } from "@/components/PageHeader";
export function TenantManagementPage() { return <RentalTenantManagementPage Heading={PageHeader} coreAccess={false} />; }
