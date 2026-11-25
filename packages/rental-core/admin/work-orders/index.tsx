/**
 * Rental 工单的正式页面贡献。宿主为同一业务实现绑定当前 API、范围与权限，公共壳负责渲染。
 * 页面清单只用于注册和定位，实际准入由当前 CorePageHost 与原服务端共同核验。
 */
import type { CoreAdminContribution } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "@rental-os/platform-admin/core";
import { MaintenanceWorkOrdersPage } from "./MaintenanceWorkOrdersPage";
import { RENTAL_WORK_ORDER_CORE_ID, RENTAL_WORK_ORDER_PAGES } from "./pages";
import type { RentalWorkOrderPageContext } from "./page-context";

export { MaintenanceWorkOrdersPage } from "./MaintenanceWorkOrdersPage";
export { WorkOrderBoard } from "./WorkOrderBoard";
export { createRentalWorkOrderApi, type RentalWorkOrderApi } from "./client";
export { RENTAL_WORK_ORDER_CORE_ID, RENTAL_WORK_ORDER_PAGES, RENTAL_WORK_ORDER_LEGACY_PERMISSIONS, rentalWorkOrderLocation } from "./pages";
export type { RentalWorkOrderPageContext } from "./page-context";

/** API 与范围读取仍来自宿主当前会话，组件回调是受控源码引用。 */
export function createRentalWorkOrdersAdminContribution(
  implementationVersion: string,
  usePageContext: () => RentalWorkOrderPageContext
): CoreAdminContribution<CoreRouteComponent> {
  const Page: CoreRouteComponent = () => <MaintenanceWorkOrdersPage {...usePageContext()} />;
  return {
    coreId: RENTAL_WORK_ORDER_CORE_ID,
    implementationVersion,
    pages: Object.values(RENTAL_WORK_ORDER_PAGES).map(definition => ({ ...definition, component: Page }))
  };
}
