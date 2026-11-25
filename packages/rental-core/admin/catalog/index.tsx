/** Rental商品与资产贡献复用原表单、卡片和库存作业，宿主供给当前会话。 */
import type { CoreAdminContribution } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { CatalogPage } from "./CatalogPage";
import { AssetWorkspacePage } from "./AssetWorkspacePage";
import type { RentalCatalogPageContext } from "./page-context";
import { RENTAL_CATALOG_CORE_ID, RENTAL_CATALOG_PAGES } from "./pages";
export * from "./client";
export * from "./page-context";
export * from "./pages";
export * from "./listCapabilities";
export { CatalogPage } from "./CatalogPage";
export { AssetWorkspacePage } from "./AssetWorkspacePage";
export { ItemGroupPhoto } from "./ItemGroupPhoto";
export { StockOperationsPanel } from "./StockOperationsPanel";
export { CatalogCardMedia } from "./CatalogCardMedia";
export { catalogCards } from "./catalogCards";
export { assetCards, stockCards } from "./assetCards";
export { catalogAttributeText } from "./catalogAttributeText";
export function createRentalCatalogAdminContribution(
  implementationVersion: string,
  usePageContext: () => RentalCatalogPageContext,
): CoreAdminContribution<CoreRouteComponent> {
  const Catalog: CoreRouteComponent = () => <CatalogPage {...usePageContext()} />;
  const Assets: CoreRouteComponent = () => <AssetWorkspacePage {...usePageContext()} />;
  return {
    coreId: RENTAL_CATALOG_CORE_ID,
    implementationVersion,
    pages: [
      { ...RENTAL_CATALOG_PAGES.catalog, component: Catalog },
      { ...RENTAL_CATALOG_PAGES.assets, component: Assets },
    ],
  };
}
