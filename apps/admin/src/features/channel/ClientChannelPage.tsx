/** 原渠道路由复用 Rental 配置页面，品牌、会话与传输由兼容宿主绑定。 */
import { ClientChannelPage as RentalClientChannelPage } from "@rental-os/rental-core/admin/channels";
import { LegacyRentalChannelsPageHost } from "./legacy-channels-context";

export function ClientChannelPage() {
  return <LegacyRentalChannelsPageHost><RentalClientChannelPage /></LegacyRentalChannelsPageHost>;
}
