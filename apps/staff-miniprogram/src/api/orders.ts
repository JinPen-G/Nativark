import type { CancelRentalOrderRequest, CreateRentalInspectionRequest, CreateRentalOrderInternalNoteRequest, CreateRentalOrderRequest, ManageRentalAllocationRequest, PartialReturnRentalOrderRequest, RentalAllocationCandidates, RentalFundingBalance, RentalInspectionRecord, RentalInspectionTemplate, RentalOperationLockRequest, RentalOrder, RentalOrderExtension, RentalOrderExtensionPreview, RentalOrderExtensionRequest, RentalOrderListQuery, RentalOrderPage, RentalQuoteRequest, RentalQuoteSnapshotV1 } from "@rental-os/shared";
import { request } from "../core/http";
import { withStaffAction } from "../core/subscription-access";

/**
 * 订单与履约：列表/详情、配货、检查、交付/归还、以及处理层动作（确认/取消/爽约）。
 * 所有写动作都带幂等键或修订号；交接类动作附带操作锁令牌。
 */
const ORDERS = "/rental/v1/orders";
const orderPath = (orderId: string, suffix = "") => `${ORDERS}/${encodeURIComponent(orderId)}${suffix}`;

/** 不带分页参数时服务端返回纯数组；这里统一成数组，分页查询用 queryOrders。 */
export async function listOrders(query: RentalOrderListQuery = {}): Promise<RentalOrder[]> {
  const result = await request<RentalOrder[] | RentalOrderPage>(ORDERS, { query: { status: query.status, keyword: query.keyword, from: query.from, to: query.to, pendingFeeOnly: query.pendingFeeOnly } });
  return Array.isArray(result) ? result : result.items;
}

export function getOrder(orderId: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId));
}

export interface RentalOrderInternalNote {
  id: string;
  content: string;
  operatorName: string;
  operatorId?: string;
  createdAt: string;
}

export function listInternalOrderNotes(orderId: string): Promise<RentalOrderInternalNote[]> {
  return request<RentalOrderInternalNote[]>(orderPath(orderId, "/internal-notes"));
}

export function createInternalOrderNote(orderId: string, input: CreateRentalOrderInternalNoteRequest, idempotencyKey: string): Promise<RentalOrderInternalNote> {
  return request<RentalOrderInternalNote>(orderPath(orderId, "/internal-notes"), { method: "POST", data: input, idempotencyKey });
}

export interface StaffOfflinePaymentRegistration {
  id: string;
  orderId: string;
  instrument: "rental" | "deposit";
  amount: number;
  paymentMethod: "offline_cash" | "offline_transfer";
  reason: string;
  evidenceFileAssetId?: string;
  status: "pending" | "confirmed";
  registeredBy?: string;
  registeredAt: string;
  confirmedBy?: string;
  confirmedAt?: string;
}

export interface CreateStaffOfflinePaymentInput {
  orderId: string;
  instrument: "rental" | "deposit";
  amount: number;
  paymentMethod: "offline_cash" | "offline_transfer";
  reason: string;
  idempotencyKey: string;
  evidenceFileAssetId?: string;
}

export function getOrderFunding(orderId: string): Promise<RentalFundingBalance> {
  return request<RentalFundingBalance>(orderPath(orderId, "/funding-events"));
}

export function listOfflinePaymentRegistrations(orderId: string): Promise<StaffOfflinePaymentRegistration[]> {
  return request<StaffOfflinePaymentRegistration[]>("/offline-payments", { query: { orderId } });
}

export function registerOfflinePayment(input: CreateStaffOfflinePaymentInput): Promise<StaffOfflinePaymentRegistration> {
  return request<StaffOfflinePaymentRegistration>("/offline-payments", { method: "POST", data: input });
}

export function confirmOfflinePayment(registrationId: string): Promise<unknown> {
  return request(`/offline-payments/${encodeURIComponent(registrationId)}/confirm`, { method: "POST" });
}

export function quoteOrder(input: RentalQuoteRequest): Promise<RentalQuoteSnapshotV1> {
  return withStaffAction("order.quote", () => request<RentalQuoteSnapshotV1>("/rental/v1/quotes", { method: "POST", data: input }));
}

export function createOrder(input: CreateRentalOrderRequest, idempotencyKey: string): Promise<RentalOrder> {
  return withStaffAction("order.create", () => request<RentalOrder>(ORDERS, { method: "POST", data: input, idempotencyKey }));
}

/* ---------- 处理层：确认 / 取消 / 超时 / 爽约 ---------- */

export function confirmOrder(orderId: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/confirm"), { method: "POST" });
}

export function cancelOrder(orderId: string, input: CancelRentalOrderRequest, idempotencyKey: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/cancel"), { method: "POST", data: input, idempotencyKey });
}

export function expirePendingOrder(orderId: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/expire-pending"), { method: "POST" });
}

export function markPickupOverdue(orderId: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/mark-pickup-overdue"), { method: "POST" });
}

export function sendNoShowNotice(orderId: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/no-show-notice"), { method: "POST" });
}

export function confirmNoShow(orderId: string, reason: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/confirm-no-show"), { method: "POST", data: { reason } });
}

export function resumePickup(orderId: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/resume-pickup"), { method: "POST" });
}

/* ---------- 配货 / 分配 / 操作锁 ---------- */

export function allocationCandidates(orderId: string): Promise<RentalAllocationCandidates> {
  return request<RentalAllocationCandidates>(orderPath(orderId, "/allocation-candidates"));
}

export function autoAllocate(orderId: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/allocate"), { method: "POST" });
}

export function manageAllocations(orderId: string, input: ManageRentalAllocationRequest): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/assignments"), { method: "POST", data: input });
}

export function operationLock(orderId: string, input: RentalOperationLockRequest, idempotencyKey?: string): Promise<{ token?: string; expiresAt?: string; ownerName?: string; released?: boolean; releasedOwnerName?: string } & Record<string, unknown>> {
  return request(orderPath(orderId, "/operation-lock"), { method: "POST", data: input, idempotencyKey });
}

/* ---------- 检查 / 交付 / 归还 ---------- */

export function listInspectionTemplates(stage?: "pickup" | "return"): Promise<RentalInspectionTemplate[]> {
  return request<RentalInspectionTemplate[]>("/rental/v1/inspection-templates", { query: { stage } });
}

export function listInspections(orderId: string): Promise<RentalInspectionRecord[]> {
  return request<RentalInspectionRecord[]>(orderPath(orderId, "/inspections"));
}

/** 提交检查：领取检查完成即交付（服务端原子推进）；归还检查带 returnItems 为分批归还。 */
export function createInspection(orderId: string, input: CreateRentalInspectionRequest, options: { idempotencyKey: string; operationToken?: string }): Promise<{ inspection: RentalInspectionRecord; order: RentalOrder }> {
  return request(orderPath(orderId, "/inspections"), { method: "POST", data: input, idempotencyKey: options.idempotencyKey, operationToken: options.operationToken });
}

/** 无检查模板时的直接交接（服务端仍复核资金/资质/营业时段）。 */
export function handover(orderId: string, stage: "pickup" | "return", options: { idempotencyKey: string; operationToken?: string; handoverSignatureFileAssetId?: string }): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, `/handover/${stage}`), { method: "POST", data: { handoverSignatureFileAssetId: options.handoverSignatureFileAssetId }, idempotencyKey: options.idempotencyKey, operationToken: options.operationToken });
}

export function partialReturn(orderId: string, input: PartialReturnRentalOrderRequest, options: { idempotencyKey: string; operationToken?: string }): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/partial-return"), { method: "POST", data: input, idempotencyKey: options.idempotencyKey, operationToken: options.operationToken });
}

export function listExtensions(orderId: string): Promise<RentalOrderExtension[]> {
  return request<RentalOrderExtension[]>(orderPath(orderId, "/extensions"));
}

/* ---------- 续租代办（正差额仍由客户在客户端支付；负差额/逾时走退款审核） ---------- */

export function previewExtension(orderId: string, input: RentalOrderExtensionRequest): Promise<RentalOrderExtensionPreview> {
  return request<RentalOrderExtensionPreview>(orderPath(orderId, "/extensions/preview"), { method: "POST", data: input });
}

export function requestExtension(orderId: string, input: RentalOrderExtensionRequest, idempotencyKey: string): Promise<RentalOrderExtension> {
  return withStaffAction("order.extend", () => request<RentalOrderExtension>(orderPath(orderId, "/extensions"), { method: "POST", data: input, idempotencyKey }));
}

/** 续租负差额/逾时核价审核（order:fee-review）。通过后生成退款待办，退款执行仍在 Web。 */
export function reviewExtensionRefund(orderId: string, extensionId: string, input: { decision: "approved" | "rejected"; reason: string }): Promise<RentalOrderExtension> {
  return request<RentalOrderExtension>(orderPath(orderId, `/extensions/${encodeURIComponent(extensionId)}/refund-review`), { method: "POST", data: input });
}

/* ---------- 检查异常费用复核 / 再复核 / 客户申诉处理（order:fee-review） ---------- */

export function reviewInspectionException(orderId: string, inspectionId: string, exceptionIndex: number, input: { decision: "approved" | "rejected"; approvedChargeAmount?: number; reason: string }): Promise<{ inspection: RentalInspectionRecord; order: RentalOrder }> {
  return request(orderPath(orderId, `/inspections/${encodeURIComponent(inspectionId)}/exceptions/${exceptionIndex}/review`), { method: "POST", data: input });
}

export function reReviewInspectionException(orderId: string, inspectionId: string, exceptionIndex: number, input: { approvedChargeAmount?: number; reason: string }): Promise<{ inspection: RentalInspectionRecord; order: RentalOrder }> {
  return request(orderPath(orderId, `/inspections/${encodeURIComponent(inspectionId)}/exceptions/${exceptionIndex}/re-review`), { method: "POST", data: input });
}

/** 处理客户对费用的申诉（维持/调整/撤销）。 */
export function respondInspectionException(orderId: string, inspectionId: string, exceptionIndex: number, input: { decision: "confirmed" | "disputed"; reason?: string }): Promise<{ inspection: RentalInspectionRecord; order: RentalOrder }> {
  return request(orderPath(orderId, `/inspections/${encodeURIComponent(inspectionId)}/exceptions/${exceptionIndex}/customer-response`), { method: "POST", data: input });
}
