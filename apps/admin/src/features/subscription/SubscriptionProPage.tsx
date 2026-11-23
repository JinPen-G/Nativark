/** 原后台兼容出口，订阅页面与交互由公共包唯一维护。 */
import { SubscriptionProPage as PublicSubscriptionProPage } from "@rental-os/platform-admin/subscription/SubscriptionProPage";

export function SubscriptionProPage() {
  return <PublicSubscriptionProPage standardDescription="基础租赁经营" />;
}
