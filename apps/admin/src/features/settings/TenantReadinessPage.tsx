/** 原开业页面和正文复用 Rental 单源实现，配置跳转沿原宿主当前路由授权。 */
import type { TenantReadinessStatus } from "@rental-os/rental-core";
import { TenantReadinessPage as RentalTenantReadinessPage, TenantReadinessBody as RentalTenantReadinessBody }
  from "@rental-os/rental-core/admin/setup";
import { LegacyRentalSetupPageHost } from "./legacy-setup-context";

export function TenantReadinessPage() {
  return <LegacyRentalSetupPageHost><RentalTenantReadinessPage /></LegacyRentalSetupPageHost>;
}

export function TenantReadinessBody(props: { data: TenantReadinessStatus; onRefresh: () => void }) {
  return <LegacyRentalSetupPageHost><RentalTenantReadinessBody {...props} /></LegacyRentalSetupPageHost>;
}
