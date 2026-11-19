/** 原客户运输供给当前会话与范围，业务请求由 Rental 小程序工厂维护。 */
import { createRentalMiniProgramOrdersApi } from "@rental-os/rental-core/clients/miniprogram";
import { request } from "../core/http";
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
  readBookingHostCapabilities,
  readBookingHandoff,
  readBookingAcceptance,
  acceptBookingSubmission,
  submitAcceptedBooking,
  readBookingSubmission,
} = createRentalMiniProgramOrdersApi({ request });
