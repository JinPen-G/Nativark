/** 原客服路由沿公共邮件页面读取，宿主供给当前品牌和页头图标。 */
import { CustomerSupportPage as PublicCustomerSupportPage } from "@rental-os/platform-admin/messaging";
import { PageHeader } from "@/components/PageHeader";

export function CustomerSupportPage() {
  return <PublicCustomerSupportPage renderHeader={props => <PageHeader {...props} />} />;
}
