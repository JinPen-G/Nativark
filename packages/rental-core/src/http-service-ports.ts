/** Rental HTTP只接收所选宿主的原服务实例。身份、Guard和事务沿原链执行，注册不授予业务权限。 */
import type { WorkspaceCapabilityService } from "./workspace-capabilities";
import type { StaffOfflinePaymentService } from "./mysql-staff-payments";

export type RentalWorkspaceCapabilitiesHttpApplication = Pick<WorkspaceCapabilityService,
  "overview" | "save" | "upgrade" | "listAudits" | "reconcileRequiredCapabilities">;
export type RentalStaffPaymentsHttpApplication = Pick<StaffOfflinePaymentService, "list" | "register" | "confirm">;

export const RENTAL_WORKSPACE_CAPABILITIES_APPLICATION = Symbol("rental.http.workspace-capabilities");
export const RENTAL_STAFF_PAYMENTS_APPLICATION = Symbol("rental.http.staff-payments");
