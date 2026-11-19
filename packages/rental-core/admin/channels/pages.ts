/** 渠道配置共用页面、菜单与标题声明，兼容宿主继续核原集成管理权限。 */
import { rentalPageLegacyPermissions, rentalPagePermissions } from "@rental-os/rental-core/permissions";
import type { CorePageDescriptor } from "@rental-os/core-contracts";
import type { RentalOrderSession } from "../orders/page-context";

export const RENTAL_CHANNELS_CORE_ID = "rental";
export const RENTAL_CHANNELS_LEGACY_PERMISSION = rentalPageLegacyPermissions("client-channel")[0];

export const RENTAL_CHANNELS_PAGES = {
  clientChannel: {
    id: "client-channel",
    path: "/client-channel",
    title: { default: "客户端渠道", translations: { "en-US": "Client channels" } },
    purpose: "configuration",
    permissions: rentalPagePermissions("client-channel"),
    menu: {
      group: { default: "服务与渠道", translations: { "en-US": "Services & channels" } },
      order: 50,
    },
  },
} satisfies Record<string, CorePageDescriptor>;

export function rentalChannelsLegacyPageAllowed(session: RentalOrderSession): boolean {
  return Boolean(session.sessionVerified && session.authenticated && !session.user?.isSaasAdmin
    && session.hasPermission(RENTAL_CHANNELS_LEGACY_PERMISSION));
}
