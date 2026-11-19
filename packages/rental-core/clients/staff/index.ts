/** 员工业务客户端入口。宿主端口与调用链见同目录 README.md。 */
export {
  createRentalStaffOrdersApi,
  type RentalOrderInternalNote,
  type StaffOfflinePaymentRegistration,
  type CreateStaffOfflinePaymentInput,
} from "./orders";
export { createRentalStaffAssetsApi } from "./assets";
export { createRentalStaffWorkOrdersApi } from "./workOrders";
export { createRentalStaffCustomersApi, matchCustomer } from "./customers";
export { createRentalStaffWorkbenchApi } from "./workbench";
export type {
  RentalStaffRequestOptions,
  RentalStaffRequest,
  RentalStaffClientPorts,
  RentalStaffAction,
  RentalStaffOrdersPorts,
  RentalStaffAssetsPorts,
} from "./ports";
