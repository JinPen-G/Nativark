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
export { createRentalStaffDirectoryApi } from "./directory";
export { createRentalStaffReviewsApi } from "./reviews";
export type {
  RentalStaffRequestOptions,
  RentalStaffRequest,
  RentalStaffClientPorts,
  RentalStaffAction,
  RentalStaffOrdersPorts,
  RentalStaffAssetsPorts,
} from "./ports";
export { createRentalStaffAuthApi, type RentalStaffAuthPorts } from "./auth";
export { createRentalStaffUploadsApi } from "./uploads";
export type { RentalStaffUploadsPorts, StaffUploadStage, StaffUploadReference, StaffUploadHooks, LocalStaffImage } from "./uploads";
