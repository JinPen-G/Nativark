/** 客户端、微信和官网配置作为同一 Rental 页面贡献，保存方法与品牌端口由当前宿主供给。 */
import type { CoreAdminContribution } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { ClientChannelPage } from "./ClientChannelPage";
import { RentalChannelsPageProvider, type RentalChannelsPageContext } from "./page-context";
import { RENTAL_CHANNELS_CORE_ID, RENTAL_CHANNELS_PAGES } from "./pages";

export const rentalChannelsPageComponents: Readonly<Record<string, CoreRouteComponent>> = {
  [RENTAL_CHANNELS_PAGES.clientChannel.id]: ClientChannelPage,
};

export function createRentalChannelsAdminContribution(
  implementationVersion: string,
  usePageContext: () => RentalChannelsPageContext,
): CoreAdminContribution<CoreRouteComponent> {
  const Page: CoreRouteComponent = () => (
    <RentalChannelsPageProvider context={usePageContext()}>
      <ClientChannelPage />
    </RentalChannelsPageProvider>
  );
  return {
    coreId: RENTAL_CHANNELS_CORE_ID,
    implementationVersion,
    pages: [{ ...RENTAL_CHANNELS_PAGES.clientChannel, component: Page }],
  };
}

export { ClientChannelPage };
export { ClientBrandPreview } from "./ClientBrandPreview";
export * from "./client";
export * from "./website-client";
export * from "./page-context";
export * from "./pages";
export { rentalChannelsMessages } from "./messages";
