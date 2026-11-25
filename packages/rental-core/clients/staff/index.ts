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
export { createRentalStaffEntryActionApi, STAFF_ORDER_ENTRY_CODES, type RentalStaffEntryActionPorts, type RentalStaffEntryActionSession, type StaffOrderEntryCode, type StaffEntryActionApi } from "./ai-entry-actions";
export { createRentalStaffInspectionTaskApi, type RentalStaffInspectionTaskPorts, type StaffInspectionTaskApi } from "./ai-inspection-tasks";
export { createRentalStaffSceneCatalogApi, type RentalStaffSceneCatalogPorts } from "./ai-scene-catalog";
export { createRentalStaffInspectionTransport, type RentalStaffInspectionTransportPorts } from "./inspection-transport";
export { inspectionRows, inspectionResults, type InspectionFieldRow } from "./inspection-form";
export { createRentalStaffLabels, type RentalStaffLabelsPorts, type Tone, type OrderTabKey } from "./labels";
export { createRentalStaffPresenters, type RentalStaffPresentersPorts, type OrderCard } from "./presenters";
export { createRentalStaffScan, type RentalStaffScanPorts, type ScanKind, type ScanResult, type ScanHistoryEntry } from "./scan";
export { createRentalStaffContext, type RentalStaffContextPorts, type Terminology, type WorkspaceContext } from "./context";
export { createRentalStaffSubscriptionAccess, STAFF_ACTIONS, STAFF_FEATURE_BINDINGS, type RentalStaffSubscriptionAccessPorts, type StaffAction, type AccessDecision, type FeatureBinding } from "./subscription-access";
