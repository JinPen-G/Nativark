/**
 * 员工订单、资金与履约请求。宿主供给同一员工运输和原报价、建单、续租准入，
 * 业务方法沿原请求投递幂等键与交接令牌，交接操作关闭认证重放。
 */
import type {
  CancelRentalOrderRequest,
  CreateRentalInspectionRequest,
  CreateRentalOrderInternalNoteRequest,
  CreateRentalOrderRequest,
  ManageRentalAllocationRequest,
  PartialReturnRentalOrderRequest,
  RentalAllocationCandidates,
  RentalFundingBalance,
  RentalInspectionRecord,
  RentalInspectionTemplate,
  RentalOperationLockRequest,
  RentalOrder,
  RentalOrderExtension,
  RentalOrderExtensionPreview,
  RentalOrderExtensionRequest,
  RentalOrderListQuery,
  RentalOrderPage,
  RentalQuoteRequest,
  RentalQuoteSnapshotV1,
} from "../../src/contracts";
import type { RentalStaffOrdersPorts } from "./ports";

export interface RentalOrderInternalNote {
  id: string;
  content: string;
  operatorName: string;
  operatorId?: string;
  createdAt: string;
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

const ORDERS = "/rental/v1/orders";
const orderPath = (orderId: string, suffix = "") => `${ORDERS}/${encodeURIComponent(orderId)}${suffix}`;

export function createRentalStaffOrdersApi({ request, withStaffAction }: RentalStaffOrdersPorts) {
  /** 兼容原服务端的数组与分页响应，对本列表消费者统一返回数组。 */
  async function listOrders(query: RentalOrderListQuery = {}): Promise<RentalOrder[]> {
    const result = await request<RentalOrder[] | RentalOrderPage>(ORDERS, { query: { status: query.status, keyword: query.keyword, from: query.from, to: query.to, pendingFeeOnly: query.pendingFeeOnly } });
    return Array.isArray(result) ? result : result.items;
  }

  function getOrder(orderId: string): Promise<RentalOrder> {
    return request<RentalOrder>(orderPath(orderId));
  }

  function listInternalOrderNotes(orderId: string): Promise<RentalOrderInternalNote[]> {
    return request<RentalOrderInternalNote[]>(orderPath(orderId, "/internal-notes"));
  }

  function createInternalOrderNote(orderId: string, input: CreateRentalOrderInternalNoteRequest, idempotencyKey: string): Promise<RentalOrderInternalNote> {
    return request<RentalOrderInternalNote>(orderPath(orderId, "/internal-notes"), { method: "POST", data: input, idempotencyKey });
  }

  function getOrderFunding(orderId: string): Promise<RentalFundingBalance> {
    return request<RentalFundingBalance>(orderPath(orderId, "/funding-events"));
  }

  function listOfflinePaymentRegistrations(orderId: string): Promise<StaffOfflinePaymentRegistration[]> {
    return request<StaffOfflinePaymentRegistration[]>("/offline-payments", { query: { orderId } });
  }

  function registerOfflinePayment(input: CreateStaffOfflinePaymentInput): Promise<StaffOfflinePaymentRegistration> {
    return request<StaffOfflinePaymentRegistration>("/offline-payments", { method: "POST", data: input });
  }

  function confirmOfflinePayment(registrationId: string): Promise<unknown> {
    return request(`/offline-payments/${encodeURIComponent(registrationId)}/confirm`, { method: "POST" });
  }

  function quoteOrder(input: RentalQuoteRequest): Promise<RentalQuoteSnapshotV1> {
    return withStaffAction("order.quote", () => request<RentalQuoteSnapshotV1>("/rental/v1/quotes", { method: "POST", data: input }));
  }

  function createOrder(input: CreateRentalOrderRequest, idempotencyKey: string): Promise<RentalOrder> {
    return withStaffAction("order.create", () => request<RentalOrder>(ORDERS, { method: "POST", data: input, idempotencyKey }));
  }

  /* ---------- 处理层：确认 / 取消 / 超时 / 爽约 ---------- */

  function confirmOrder(orderId: string): Promise<RentalOrder> {
    return request<RentalOrder>(orderPath(orderId, "/confirm"), { method: "POST" });
  }

  function cancelOrder(orderId: string, input: CancelRentalOrderRequest, idempotencyKey: string): Promise<RentalOrder> {
    return request<RentalOrder>(orderPath(orderId, "/cancel"), { method: "POST", data: input, idempotencyKey });
  }

  function expirePendingOrder(orderId: string): Promise<RentalOrder> {
    return request<RentalOrder>(orderPath(orderId, "/expire-pending"), { method: "POST" });
  }

  function markPickupOverdue(orderId: string): Promise<RentalOrder> {
    return request<RentalOrder>(orderPath(orderId, "/mark-pickup-overdue"), { method: "POST" });
  }

  function sendNoShowNotice(orderId: string): Promise<RentalOrder> {
    return request<RentalOrder>(orderPath(orderId, "/no-show-notice"), { method: "POST" });
  }

  function confirmNoShow(orderId: string, reason: string): Promise<RentalOrder> {
    return request<RentalOrder>(orderPath(orderId, "/confirm-no-show"), { method: "POST", data: { reason } });
  }

  function resumePickup(orderId: string): Promise<RentalOrder> {
    return request<RentalOrder>(orderPath(orderId, "/resume-pickup"), { method: "POST" });
  }

  /* ---------- 配货 / 分配 / 操作锁 ---------- */

  function allocationCandidates(orderId: string): Promise<RentalAllocationCandidates> {
    return request<RentalAllocationCandidates>(orderPath(orderId, "/allocation-candidates"));
  }

  function autoAllocate(orderId: string): Promise<RentalOrder> {
    return request<RentalOrder>(orderPath(orderId, "/allocate"), { method: "POST" });
  }

  function manageAllocations(orderId: string, input: ManageRentalAllocationRequest): Promise<RentalOrder> {
    return request<RentalOrder>(orderPath(orderId, "/assignments"), { method: "POST", data: input });
  }

  function operationLock(orderId: string, input: RentalOperationLockRequest, idempotencyKey?: string): Promise<{ token?: string; expiresAt?: string; ownerName?: string; released?: boolean; releasedOwnerName?: string } & Record<string, unknown>> {
    return request(orderPath(orderId, "/operation-lock"), { method: "POST", data: input, idempotencyKey });
  }

  /* ---------- 检查 / 交付 / 归还 ---------- */

  function listInspectionTemplates(stage?: "pickup" | "return", orderId?: string): Promise<RentalInspectionTemplate[]> {
    return request<RentalInspectionTemplate[]>("/rental/v1/inspection-templates", { query: { stage, orderId } });
  }

  function listInspections(orderId: string): Promise<RentalInspectionRecord[]> {
    return request<RentalInspectionRecord[]>(orderPath(orderId, "/inspections"));
  }

  /** 提交检查：领取检查完成即交付（服务端原子推进）；归还检查带 returnItems 为分批归还。 */
  function createInspection(orderId: string, input: CreateRentalInspectionRequest, options: { idempotencyKey: string; operationToken?: string }): Promise<{ inspection: RentalInspectionRecord; order: RentalOrder }> {
    return request(orderPath(orderId, "/inspections"), { method: "POST", data: input, idempotencyKey: options.idempotencyKey, operationToken: options.operationToken, replayAfterRefresh: false });
  }

  /** 无检查模板时的直接交接（服务端仍复核资金/资质/营业时段）。 */
  function handover(orderId: string, stage: "pickup" | "return", options: { idempotencyKey: string; operationToken?: string; handoverSignatureFileAssetId?: string }): Promise<RentalOrder> {
    return request<RentalOrder>(orderPath(orderId, `/handover/${stage}`), { method: "POST", data: { handoverSignatureFileAssetId: options.handoverSignatureFileAssetId }, idempotencyKey: options.idempotencyKey, operationToken: options.operationToken, replayAfterRefresh: false });
  }

  function partialReturn(orderId: string, input: PartialReturnRentalOrderRequest, options: { idempotencyKey: string; operationToken?: string }): Promise<RentalOrder> {
    return request<RentalOrder>(orderPath(orderId, "/partial-return"), { method: "POST", data: input, idempotencyKey: options.idempotencyKey, operationToken: options.operationToken, replayAfterRefresh: false });
  }

  function listExtensions(orderId: string): Promise<RentalOrderExtension[]> {
    return request<RentalOrderExtension[]>(orderPath(orderId, "/extensions"));
  }

  /* ---------- 续租代办（正差额仍由客户在客户端支付；负差额/逾时走退款审核） ---------- */

  function previewExtension(orderId: string, input: RentalOrderExtensionRequest): Promise<RentalOrderExtensionPreview> {
    return request<RentalOrderExtensionPreview>(orderPath(orderId, "/extensions/preview"), { method: "POST", data: input });
  }

  function requestExtension(orderId: string, input: RentalOrderExtensionRequest, idempotencyKey: string): Promise<RentalOrderExtension> {
    return withStaffAction("order.extend", () => request<RentalOrderExtension>(orderPath(orderId, "/extensions"), { method: "POST", data: input, idempotencyKey }));
  }

  /** 续租负差额/逾时核价审核（order:fee-review）。通过后生成退款待办，退款执行仍在 Web。 */
  function reviewExtensionRefund(orderId: string, extensionId: string, input: { decision: "approved" | "rejected"; reason: string }): Promise<RentalOrderExtension> {
    return request<RentalOrderExtension>(orderPath(orderId, `/extensions/${encodeURIComponent(extensionId)}/refund-review`), { method: "POST", data: input });
  }

  /* ---------- 检查异常费用复核 / 再复核 / 客户申诉处理（order:fee-review） ---------- */

  function reviewInspectionException(orderId: string, inspectionId: string, exceptionIndex: number, input: { decision: "approved" | "rejected"; approvedChargeAmount?: number; reason: string }): Promise<{ inspection: RentalInspectionRecord; order: RentalOrder }> {
    return request(orderPath(orderId, `/inspections/${encodeURIComponent(inspectionId)}/exceptions/${exceptionIndex}/review`), { method: "POST", data: input });
  }

  function reReviewInspectionException(orderId: string, inspectionId: string, exceptionIndex: number, input: { approvedChargeAmount?: number; reason: string }): Promise<{ inspection: RentalInspectionRecord; order: RentalOrder }> {
    return request(orderPath(orderId, `/inspections/${encodeURIComponent(inspectionId)}/exceptions/${exceptionIndex}/re-review`), { method: "POST", data: input });
  }

  /** 处理客户对费用的申诉（维持/调整/撤销）。 */
  function respondInspectionException(orderId: string, inspectionId: string, exceptionIndex: number, input: { decision: "confirmed" | "disputed"; reason?: string }): Promise<{ inspection: RentalInspectionRecord; order: RentalOrder }> {
    return request(orderPath(orderId, `/inspections/${encodeURIComponent(inspectionId)}/exceptions/${exceptionIndex}/customer-response`), { method: "POST", data: input });
  }

  return {
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
  };
}
