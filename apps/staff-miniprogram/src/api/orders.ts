/** 员工订单宿主入口，同一 Rental 工厂通过原员工运输和业务准入消费业务与原收据。 */
import { createRentalStaffOrdersApi } from "@rental-os/rental-core/clients/staff";
import { request } from "../core/http";
import { withStaffAction } from "../core/subscription-access";

export type { RentalOrderInternalNote, StaffOfflinePaymentRegistration, CreateStaffOfflinePaymentInput } from "@rental-os/rental-core/clients/staff";

export const {
  listOrders,
  getOrder,
  listInternalOrderNotes,
  createInternalOrderNote,
  getOrderFunding,
  listOfflinePaymentRegistrations,
  registerOfflinePayment,
  confirmOfflinePayment,
  quoteOrder,
  createOrder,
  confirmOrder,
  cancelOrder,
  expirePendingOrder,
  markPickupOverdue,
  sendNoShowNotice,
  confirmNoShow,
  resumePickup,
  allocationCandidates,
  autoAllocate,
  manageAllocations,
  operationLock,
  listInspectionTemplates,
  listInspections,
  createInspection,
  handover,
  partialReturn,
  listExtensions,
  previewExtension,
  requestExtension,
  reviewExtensionRefund,
  reviewInspectionException,
  reReviewInspectionException,
  respondInspectionException,
  readFulfillmentReceipt,
} = createRentalStaffOrdersApi({ request, withStaffAction });
