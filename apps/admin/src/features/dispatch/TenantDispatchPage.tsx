/** 原寄件路由沿公共页面读取，宿主供给当前品牌和页头图标。 */
import { TenantDispatchPage as PublicTenantDispatchPage } from "@rental-os/platform-admin/messaging";
import { PageHeader } from "@/components/PageHeader";

export function TenantDispatchPage() {
  return <PublicTenantDispatchPage renderHeader={props => <PageHeader {...props} />} />;
}
