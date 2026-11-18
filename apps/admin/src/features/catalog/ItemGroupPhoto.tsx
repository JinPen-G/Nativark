/** 订单等原消费者复用 Rental 同源照片，宿主绑定原认证读取和会话范围。 */
import type { ComponentProps } from "react";
import { ItemGroupPhoto as RentalItemGroupPhoto } from "@rental-os/rental-core/admin/catalog/images";
import { RentalCatalogPageProvider } from "@rental-os/rental-core/admin/catalog/context";
import { useLegacyRentalCatalogContext } from "./legacy-catalog-context";
export function ItemGroupPhoto(props: ComponentProps<typeof RentalItemGroupPhoto>) {
  const context = useLegacyRentalCatalogContext();
  return (
    <RentalCatalogPageProvider context={context}>
      <RentalItemGroupPhoto {...props} />
    </RentalCatalogPageProvider>
  );
}
