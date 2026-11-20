/** 原支付页面入口。绑定同一 Core 编排实例，微信、存储及原端口由宿主供给。 */
import { createRentalMiniProgramPaymentFlow } from "@rental-os/rental-core/clients/miniprogram";
import { fetchFunding } from "../api/orders";
import { closePaymentIntent, createMiniProgramPaymentIntent, fetchPaymentIntent, refreshPaymentIntent } from "../api/payments";
import { remainingMs } from "./clock";
import { ApiError, isApiError } from "./http";
import { actionKey, releaseActionKey } from "./keys";
import { STORAGE_KEYS, readStorage, writeStorage } from "./storage";

const payment = createRentalMiniProgramPaymentFlow({
  orders: { fetchFunding }, payments: { closePaymentIntent, createMiniProgramPaymentIntent, fetchPaymentIntent, refreshPaymentIntent },
  remainingMs, ApiError, isApiError, actionKey, releaseActionKey,
  paymentIntentsKey: STORAGE_KEYS.paymentIntents, readStorage, writeStorage,
  requestPayment: options => wx.requestPayment(options),
});
export const { jsapiEnabled, offlineMethods, validJsapi, rememberedIntent, forgetIntent, obtainIntent, launchPayment, rentalDue, verifyPayment, verifyWithRetries, VERIFY_SCHEDULE_MS } = payment;
export type { PaymentOutcome, PaymentVerification } from "@rental-os/rental-core/clients/miniprogram";
