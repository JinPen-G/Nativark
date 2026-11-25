/** 原路由保留列表范围边界，正文通过 Rental 页面贡献消费。 */
import { useListQueryIdentity } from "@/components/ui/LiveRefresh";
import { LegacyRentalCatalogPage } from "./legacy-catalog-page";
export function CatalogPage() {
  const scope = useListQueryIdentity();
  return <CatalogWorkspace key={scope} scope={scope} />;
}
function CatalogWorkspace({ scope }: { scope: string }) {
  return <LegacyRentalCatalogPage pageId="catalog" scope={scope} />;
}
