import type {
  ClientCancellationPreview,
  ClientFeeItemsResponse,
  ClientFeeResponseRequest,
  ClientFeeResponseResult,
  ClientFulfillmentView,
  ClientMyOrdersResponse,
  ClientOrderExtensionRequest,
  ClientOrderView,
  RentalFundingBalance,
  RentalOrderExtension,
  RentalOrderExtensionPreview
} from "@rental-os/shared";
import { request } from "../core/http";
import type { AiBookingHandoff } from "@rental-os/shared";
import type { AiClientHostCapabilities } from "@rental-os/shared";

export function readBookingHostCapabilities(): Promise<AiClientHostCapabilities> {
  return request("/ai-native/entry/host-capabilities/read", { method: "POST", data: {}, replayAfterRefresh: false });
}

export function readBookingHandoff(handoffRef: string): Promise<AiBookingHandoff> {
  return request("/ai-native/entry/booking-handoffs/read", { method: "POST", data: { handoffRef }, replayAfterRefresh: false });
}

export interface CreateOrderResult {
  order: ClientOrderView;
  replayed?: boolean;
}

export interface ExtensionResult {
  order: ClientOrderView;
  extension: RentalOrderExtension;
  replayed?: boolean;
}

/** 报价转订单；幂等键由调用方持久化并在结果未知时同键重放。 */
export async function createOrder(quoteId: string, idempotencyKey: string): Promise<CreateOrderResult> {
  return request<CreateOrderResult>("/orders", { method: "POST", data: { quoteId }, idempotencyKey });
}

/** 统一本人订单索引：本租户各服务的本人订单，只读，不含他人订单。 */
export async function fetchMyOrders(page: number, pageSize = 20): Promise<ClientMyOrdersResponse> {
  return request<ClientMyOrdersResponse>("/my/orders", { query: { page, pageSize }, scope: "tenant" });
}

export async function fetchOrder(orderId: string): Promise<ClientOrderView> {
  return request<ClientOrderView>(`/orders/${encodeURIComponent(orderId)}`);
}

export async function fetchFulfillment(orderId: string): Promise<ClientFulfillmentView> {
  return request<ClientFulfillmentView>(`/orders/${encodeURIComponent(orderId)}/fulfillment`);
}

export async function fetchFunding(orderId: string): Promise<RentalFundingBalance> {
  return request<RentalFundingBalance>(`/orders/${encodeURIComponent(orderId)}/funding`);
}

/** 取消预览：只试算取消费，不改变订单与资金。 */
export async function previewCancellation(orderId: string): Promise<ClientCancellationPreview> {
  return request<ClientCancellationPreview>(`/orders/${encodeURIComponent(orderId)}/cancel/preview`, { method: "POST" });
}

export async function cancelOrder(orderId: string, reason: string, idempotencyKey: string): Promise<CreateOrderResult> {
  return request<CreateOrderResult>(`/orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST", data: { reason }, idempotencyKey });
}

export async function listExtensions(orderId: string): Promise<RentalOrderExtension[]> {
  return request<RentalOrderExtension[]>(`/orders/${encodeURIComponent(orderId)}/extensions`);
}

export async function previewExtension(orderId: string, input: ClientOrderExtensionRequest): Promise<RentalOrderExtensionPreview> {
  return request<RentalOrderExtensionPreview>(`/orders/${encodeURIComponent(orderId)}/extensions/preview`, { method: "POST", data: input });
}

export async function applyExtension(orderId: string, input: ClientOrderExtensionRequest, idempotencyKey: string): Promise<ExtensionResult> {
  return request<ExtensionResult>(`/orders/${encodeURIComponent(orderId)}/extensions`, { method: "POST", data: input, idempotencyKey });
}

/** 资金校验后的生效动作，不是付款入口；补款须先经收银台完成。 */
export async function activatePaidExtension(orderId: string, extensionId: string, idempotencyKey: string): Promise<ExtensionResult> {
  return request<ExtensionResult>(`/orders/${encodeURIComponent(orderId)}/extensions/${encodeURIComponent(extensionId)}/pay`, { method: "POST", idempotencyKey });
}

/* ---------- MP-11：检查异常费用的本人确认与异议 ---------- */

export async function fetchFeeItems(orderId: string): Promise<ClientFeeItemsResponse> {
  return request<ClientFeeItemsResponse>(`/orders/${encodeURIComponent(orderId)}/fee-items`);
}

/** 追加式响应：确认或异议；同一决定按幂等键重放。 */
export async function respondToFee(orderId: string, inspectionId: string, exceptionIndex: number, input: ClientFeeResponseRequest, idempotencyKey: string): Promise<ClientFeeResponseResult> {
  return request<ClientFeeResponseResult>(`/orders/${encodeURIComponent(orderId)}/fee-items/${encodeURIComponent(inspectionId)}/${exceptionIndex}/response`, { method: "POST", data: input, idempotencyKey });
}
