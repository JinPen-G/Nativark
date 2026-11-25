/** 本人订单、履约、资金、续租、费用与 AI 预约请求，沿原宿主身份、操作键和读取寿命。 */
import type {
  AiBookingHandoff,
  AiBookingAcceptanceReadRequest,
  AiBookingAcceptanceReadResponse,
  AiBookingSubmissionAcceptance,
  AiBookingSubmissionDecision,
  AiBookingSubmissionReceipt,
  AiClientHostCapabilities,
} from "@rental-os/shared";
import type {
  ClientCancellationPreview,
  ClientFeeItemsResponse,
  ClientFeeResponseRequest,
  ClientFeeResponseResult,
  ClientFulfillmentView,
  ClientMyOrdersResponse,
  ClientOrderExtensionRequest,
  ClientOrderView,
} from "../../src/client-contracts";
import type {
  RentalFundingBalance,
  RentalOrderExtension,
  RentalOrderExtensionPreview,
} from "../../src/contracts";
import type { RentalMiniProgramClientPorts } from "./ports";

export interface CreateOrderResult {
  order: ClientOrderView;
  replayed?: boolean;
}

export interface ExtensionResult {
  order: ClientOrderView;
  extension: RentalOrderExtension;
  replayed?: boolean;
}

export function createRentalMiniProgramOrdersApi(ports: RentalMiniProgramClientPorts) {
  const { request } = ports;

  /** 报价转订单；幂等键由调用方持久化并在结果未知时同键重放。 */
  async function createOrder(quoteId: string, idempotencyKey: string): Promise<CreateOrderResult> {
    return request<CreateOrderResult>("/orders", { method: "POST", data: { quoteId }, idempotencyKey });
  }

  /** 统一本人订单索引：本租户各服务的本人订单，只读，不含他人订单。 */
  async function fetchMyOrders(page: number, pageSize = 20): Promise<ClientMyOrdersResponse> {
    return request<ClientMyOrdersResponse>("/my/orders", { query: { page, pageSize }, scope: "tenant" });
  }

  async function fetchOrder(orderId: string): Promise<ClientOrderView> {
    return request<ClientOrderView>(`/orders/${encodeURIComponent(orderId)}`);
  }

  async function fetchFulfillment(orderId: string): Promise<ClientFulfillmentView> {
    return request<ClientFulfillmentView>(`/orders/${encodeURIComponent(orderId)}/fulfillment`);
  }

  async function fetchFunding(orderId: string): Promise<RentalFundingBalance> {
    return request<RentalFundingBalance>(`/orders/${encodeURIComponent(orderId)}/funding`);
  }

  /** 取消预览：只试算取消费，不改变订单与资金。 */
  async function previewCancellation(orderId: string): Promise<ClientCancellationPreview> {
    return request<ClientCancellationPreview>(`/orders/${encodeURIComponent(orderId)}/cancel/preview`, { method: "POST" });
  }

  async function cancelOrder(orderId: string, reason: string, idempotencyKey: string): Promise<CreateOrderResult> {
    return request<CreateOrderResult>(`/orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST", data: { reason }, idempotencyKey });
  }

  async function listExtensions(orderId: string): Promise<RentalOrderExtension[]> {
    return request<RentalOrderExtension[]>(`/orders/${encodeURIComponent(orderId)}/extensions`);
  }

  async function previewExtension(orderId: string, input: ClientOrderExtensionRequest): Promise<RentalOrderExtensionPreview> {
    return request<RentalOrderExtensionPreview>(`/orders/${encodeURIComponent(orderId)}/extensions/preview`, { method: "POST", data: input });
  }

  async function applyExtension(orderId: string, input: ClientOrderExtensionRequest, idempotencyKey: string): Promise<ExtensionResult> {
    return request<ExtensionResult>(`/orders/${encodeURIComponent(orderId)}/extensions`, { method: "POST", data: input, idempotencyKey });
  }

  /** 资金校验后的生效动作，不是付款入口；补款须先经收银台完成。 */
  async function activatePaidExtension(orderId: string, extensionId: string, idempotencyKey: string): Promise<ExtensionResult> {
    return request<ExtensionResult>(`/orders/${encodeURIComponent(orderId)}/extensions/${encodeURIComponent(extensionId)}/pay`, { method: "POST", idempotencyKey });
  }

  /* ---------- MP-11：检查异常费用的本人确认与异议 ---------- */

  async function fetchFeeItems(orderId: string): Promise<ClientFeeItemsResponse> {
    return request<ClientFeeItemsResponse>(`/orders/${encodeURIComponent(orderId)}/fee-items`);
  }

  /** 追加式响应：确认或异议；同一决定按幂等键重放。 */
  async function respondToFee(orderId: string, inspectionId: string, exceptionIndex: number, input: ClientFeeResponseRequest, idempotencyKey: string): Promise<ClientFeeResponseResult> {
    return request<ClientFeeResponseResult>(`/orders/${encodeURIComponent(orderId)}/fee-items/${encodeURIComponent(inspectionId)}/${exceptionIndex}/response`, { method: "POST", data: input, idempotencyKey });
  }

  function readBookingHostCapabilities(): Promise<AiClientHostCapabilities> {
    return request("/ai-native/wechat-entry/host-capabilities/read", { method: "POST", data: {}, replayAfterRefresh: false });
  }

  /** Both explicit page consumers and capability-bound factories use this same read. */
  function readBookingHandoff(input: string | { handoffRef: string }): Promise<AiBookingHandoff> {
    const handoffRef = typeof input === "string" ? input : input.handoffRef;
    return request("/ai-native/wechat-entry/booking-handoffs/read", { method: "POST", data: { handoffRef }, replayAfterRefresh: false });
  }

  /** Explicit AI page host ports. Exporting these never enables or binds a host.
   * Routes are the authenticated alias published by AI_CLIENT_ENTRY_HTTP_DRAFT. */
  function readBookingAcceptance(input: AiBookingAcceptanceReadRequest): Promise<AiBookingAcceptanceReadResponse> {
    return request("/ai-native/wechat-entry/booking-submissions/acceptance/read", { method: "POST", data: input, replayAfterRefresh: false });
  }

  function acceptBookingSubmission(input: { handoffRef: string }): Promise<AiBookingSubmissionAcceptance> {
    return request<AiBookingSubmissionAcceptance>("/ai-native/wechat-entry/booking-submissions/accept", { method: "POST", data: input, replayAfterRefresh: false });
  }

  function submitAcceptedBooking(input: AiBookingSubmissionDecision): Promise<AiBookingSubmissionReceipt> {
    // A 401 may be a late current-identity recheck. Never let refresh resend a write.
    return request<AiBookingSubmissionReceipt>("/ai-native/wechat-entry/booking-submissions/submit",
      { method: "POST", data: input, replayAfterRefresh: false });
  }

  function readBookingSubmission(input: { acceptanceRef: string }): Promise<AiBookingSubmissionReceipt> {
    return request<AiBookingSubmissionReceipt>("/ai-native/wechat-entry/booking-submissions/read", { method: "POST", data: input });
  }

  return {
    createOrder,
    fetchMyOrders,
    fetchOrder,
    fetchFulfillment,
    fetchFunding,
    previewCancellation,
    cancelOrder,
    listExtensions,
    previewExtension,
    applyExtension,
    activatePaidExtension,
    fetchFeeItems,
    respondToFee,
    readBookingHostCapabilities,
    readBookingHandoff,
    readBookingAcceptance,
    acceptBookingSubmission,
    submitAcceptedBooking,
    readBookingSubmission,
  };
}
