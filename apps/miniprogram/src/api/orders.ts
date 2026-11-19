/** 原客户运输供给当前会话与范围，业务请求由 Rental 小程序工厂维护。 */
import { createRentalMiniProgramOrdersApi } from "@rental-os/rental-core/clients/miniprogram";
import { request } from "../core/http";
import type {
  AiBookingHandoff,
  AiBookingAcceptanceReadRequest,
  AiBookingAcceptanceReadResponse,
  AiBookingSubmissionAcceptance,
  AiBookingSubmissionDecision,
  AiBookingSubmissionReceipt,
  AiClientHostCapabilities,
} from "@rental-os/shared";
export type { CreateOrderResult, ExtensionResult } from "@rental-os/rental-core/clients/miniprogram";

export const {
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
} = createRentalMiniProgramOrdersApi({ request });

export function readBookingHostCapabilities(): Promise<AiClientHostCapabilities> {
  return request("/ai-native/wechat-entry/host-capabilities/read", { method: "POST", data: {}, replayAfterRefresh: false });
}

/** Both explicit page consumers and capability-bound factories use this same read. */
export function readBookingHandoff(input: string | { handoffRef: string }): Promise<AiBookingHandoff> {
  const handoffRef = typeof input === "string" ? input : input.handoffRef;
  return request("/ai-native/wechat-entry/booking-handoffs/read", { method: "POST", data: { handoffRef }, replayAfterRefresh: false });
}

/** Explicit AI page host ports. Exporting these never enables or binds a host.
 * Routes are the authenticated alias published by AI_CLIENT_ENTRY_HTTP_DRAFT. */
export function readBookingAcceptance(input: AiBookingAcceptanceReadRequest): Promise<AiBookingAcceptanceReadResponse> {
  return request("/ai-native/wechat-entry/booking-submissions/acceptance/read", { method: "POST", data: input, replayAfterRefresh: false });
}

export function acceptBookingSubmission(input: { handoffRef: string }): Promise<AiBookingSubmissionAcceptance> {
  return request<AiBookingSubmissionAcceptance>("/ai-native/wechat-entry/booking-submissions/accept", { method: "POST", data: input, replayAfterRefresh: false });
}

export function submitAcceptedBooking(input: AiBookingSubmissionDecision): Promise<AiBookingSubmissionReceipt> {
  // A 401 may be a late current-identity recheck. Never let refresh resend a write.
  return request<AiBookingSubmissionReceipt>("/ai-native/wechat-entry/booking-submissions/submit",
    { method: "POST", data: input, replayAfterRefresh: false });
}

export function readBookingSubmission(input: { acceptanceRef: string }): Promise<AiBookingSubmissionReceipt> {
  return request<AiBookingSubmissionReceipt>("/ai-native/wechat-entry/booking-submissions/read", { method: "POST", data: input });
}
