/** 原后台兼容出口，订阅页面与交互由公共包唯一维护。 */
import { TenantSubscriptionPage as PublicTenantSubscriptionPage } from "@rental-os/platform-admin/subscription/TenantSubscriptionPage";

export function TenantSubscriptionPage() {
  return <PublicTenantSubscriptionPage description="所有经营空间共用同一订阅。" />;
}
