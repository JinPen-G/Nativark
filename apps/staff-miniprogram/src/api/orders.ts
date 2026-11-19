/** 员工订单宿主入口，普通业务消费同一 Rental 工厂，AI 原收据按原宿主端口读取。 */
import type { StaffFulfillmentReceiptQuery, StaffFulfillmentReceiptObservation } from "@rental-os/shared";
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
} = createRentalStaffOrdersApi({ request, withStaffAction });

/** Original Core receipt lookup. It cannot repeat a write or infer that a
 * missing receipt rolled back. No runtime shared dependency enters WeChat. */
export async function readFulfillmentReceipt(orderId: string, query: StaffFulfillmentReceiptQuery): Promise<StaffFulfillmentReceiptObservation> {
  const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
  const keys = (value: object) => Object.keys(value).sort().join(",");
  if (!identifier(orderId) || !query || typeof query !== "object" || Array.isArray(query)
    || typeof query.operationKey !== "string" || query.operationKey.length > 191 || !query.operationKey.trim()
    || !["pickup", "return"].includes(query.stage)
    || (query.kind === "inspection" ? keys(query) !== "kind,operationKey,stage,templateId" || !identifier(query.templateId)
      : keys(query) !== "kind,operationKey,stage" || (query.kind !== "handover" && query.kind !== "partial_return")
        || query.kind === "partial_return" && query.stage !== "return")) throw Error("AI_INVALID_INPUT");
  const original = { orderId, ...query, operationKey: query.operationKey.trim() };
  const result = await request<StaffFulfillmentReceiptObservation>("/ai-native/inspection-assist/fulfillment-receipt-read",
    { method: "POST", data: { orderId, ...query }, replayAfterRefresh: false });
  if (!result || result.version !== "staff-fulfillment-receipt-1" || result.execution !== "read_only_no_submission"
    || result.automaticRetry !== false || keys(result) !== "automaticRetry,execution,original,receipt,state,version"
    || !result.original || keys(result.original) !== keys(original)
    || Object.entries(original).some(([name, value]) => result.original[name as keyof typeof result.original] !== value)
    || (result.state !== "committed" && result.state !== "unknown")
    || (result.state === "unknown" ? result.receipt !== null : !result.receipt || result.receipt.orderId !== orderId
      || keys(result.receipt) !== (query.kind === "inspection" ? "inspectionId,orderId" : "orderId")
      || query.kind === "inspection" && !identifier(result.receipt.inspectionId)))
    throw Error("AI_RESOURCE_UNAVAILABLE");
  return result;
}
