import type { ClientPaymentCapabilitiesResponse, ClientPaymentIntentResponse, ClientWechatJsapiParameters, RentalFundingBalance } from "@rental-os/shared";
import { fetchFunding } from "../api/orders";
import { closePaymentIntent, createMiniProgramPaymentIntent, fetchPaymentIntent, refreshPaymentIntent } from "../api/payments";
import { remainingMs } from "./clock";
import { ApiError } from "./http";
import { actionKey, releaseActionKey } from "./keys";
import { STORAGE_KEYS, readStorage, writeStorage } from "./storage";

/**
 * 微信小程序支付（需求 §8）。
 *
 * 三条底线：
 * 1. 只把服务端一次性返回的 JSAPI 五参数交给 wx.requestPayment；Native 的 code_url/checkoutUrl 绝不能用。
 * 2. wx.requestPayment 成功回调只代表客户端流程结束；“已付款”必须以服务端支付单 + 资金事件为准。
 * 3. 用户取消支付弹窗不取消租赁订单；结果未知时短周期有限重试，超过上限交给“稍后查看/联系商户”。
 */
export type PaymentOutcome = "finished" | "cancelled" | "failed";

export interface PaymentVerification {
  confirmed: boolean;
  status: ClientPaymentIntentResponse["status"] | "unknown";
  funding?: RentalFundingBalance;
  intent?: ClientPaymentIntentResponse;
}

interface StoredIntents {
  [orderId: string]: { intentId: string; createdAt: number };
}

export function jsapiEnabled(capabilities: ClientPaymentCapabilitiesResponse | undefined): boolean {
  if (!capabilities) return false;
  return capabilities.mode === "provider" && capabilities.realPaymentEnabled && capabilities.methods.includes("wechat_pay") && capabilities.instruments.includes("rental");
}

export function offlineMethods(capabilities: ClientPaymentCapabilitiesResponse | undefined): Array<"offline_cash" | "offline_transfer"> {
  return (capabilities?.methods ?? []).filter((method): method is "offline_cash" | "offline_transfer" => method === "offline_cash" || method === "offline_transfer");
}

/** 校验 JSAPI 参数完整、未过期、不是 Native 参数冒充。 */
export function validJsapi(intent: ClientPaymentIntentResponse | undefined): ClientWechatJsapiParameters | undefined {
  if (!intent || intent.status !== "pending" || intent.provider !== "wechat_pay" || intent.method !== "wechat_pay") return undefined;
  const params = intent.jsapi;
  if (!params) return undefined;
  const { timeStamp, nonceStr, package: pkg, signType, paySign } = params;
  if (![timeStamp, nonceStr, pkg, paySign].every((value) => typeof value === "string" && value.trim())) return undefined;
  if (signType !== "RSA") return undefined;
  if (!/^prepay_id=[A-Za-z0-9_\-]+$/.test(pkg)) return undefined;
  const remaining = remainingMs(intent.expiresAt);
  if (remaining === undefined || remaining <= 0) return undefined;
  return params;
}

function rememberIntent(orderId: string, intentId: string): void {
  const stored = readStorage<StoredIntents>(STORAGE_KEYS.paymentIntents) ?? {};
  stored[orderId] = { intentId, createdAt: Date.now() };
  writeStorage(STORAGE_KEYS.paymentIntents, stored);
}

export function rememberedIntent(orderId: string): string | undefined {
  return readStorage<StoredIntents>(STORAGE_KEYS.paymentIntents)?.[orderId]?.intentId;
}

export function forgetIntent(orderId: string): void {
  const stored = readStorage<StoredIntents>(STORAGE_KEYS.paymentIntents) ?? {};
  if (stored[orderId]) {
    delete stored[orderId];
    writeStorage(STORAGE_KEYS.paymentIntents, stored);
  }
}

/**
 * 取得可用的支付单：复用未支付且参数仍可用的旧单；旧单待支付但参数不可用（一次性参数未回显或已过期）
 * 时先关闭它再新建——服务端同一订单只允许一笔待完成支付，不关闭就新建会被拒绝。
 */
export async function obtainIntent(orderId: string): Promise<ClientPaymentIntentResponse> {
  const remembered = rememberedIntent(orderId);
  if (remembered) {
    let existing: ClientPaymentIntentResponse | undefined;
    try {
      existing = await fetchPaymentIntent(orderId, remembered);
    } catch {
      existing = undefined;
    }
    if (existing?.status === "paid") return existing;
    if (existing?.status === "pending") {
      if (validJsapi(existing)) return existing;
      try {
        await closePaymentIntent(orderId, existing.intentId);
      } catch {
        // 关闭失败（可能刚被支付）：交给调用方按最新状态处理，不盲目新建。
        throw new ApiError("CONFLICT", "上一笔支付单仍在处理中，请先刷新结果或稍后再试", { status: 409 });
      }
    }
    forgetIntent(orderId);
    releaseActionKey("payment.create", orderId);
  }
  const key = actionKey("payment.create", orderId, remembered ? `after:${remembered}` : "");
  const intent = await createMiniProgramPaymentIntent(orderId, key);
  rememberIntent(orderId, intent.intentId);
  return intent;
}

/** 调起微信收银台。只用服务端返回的参数；不在本机长期保存签名。 */
export function launchPayment(intent: ClientPaymentIntentResponse): Promise<PaymentOutcome> {
  const params = validJsapi(intent);
  if (!params) return Promise.resolve("failed");
  return new Promise<PaymentOutcome>((resolve) => {
    wx.requestPayment({
      timeStamp: params.timeStamp,
      nonceStr: params.nonceStr,
      package: params.package,
      signType: params.signType,
      paySign: params.paySign,
      success: () => resolve("finished"),
      fail: (error) => {
        const message = String((error && (error as { errMsg?: string }).errMsg) ?? "");
        resolve(/cancel/i.test(message) ? "cancelled" : "failed");
      }
    });
  });
}

/** 当前待付的租赁款：未付余额加上尚未生效的续租补款（服务端支付单按同一口径收款）。 */
export function rentalDue(funding: RentalFundingBalance | undefined): number {
  if (!funding) return 0;
  return Math.max(0, funding.rental.balance + (funding.rental.pendingExtensionAmount ?? 0));
}

/**
 * 核对支付结果：先让服务端向提供方查单（refresh），再读资金事实。
 * 只有支付单 paid **且** 资金账目确认收款才算已确认。
 */
export async function verifyPayment(orderId: string, intentId: string): Promise<PaymentVerification> {
  let intent: ClientPaymentIntentResponse | undefined;
  try {
    intent = await refreshPaymentIntent(orderId, intentId);
  } catch {
    try {
      intent = await fetchPaymentIntent(orderId, intentId);
    } catch {
      return { confirmed: false, status: "unknown" };
    }
  }
  let funding: RentalFundingBalance | undefined;
  try {
    funding = await fetchFunding(orderId);
  } catch {
    return { confirmed: false, status: intent.status, intent };
  }
  const collectedEnough = intent.status === "paid" && funding.rental.collected >= intent.amount;
  return { confirmed: collectedEnough, status: intent.status, funding, intent };
}

/** 有上限的结果轮询：2s、5s、10s、10s；仍未知则交给用户。 */
export const VERIFY_SCHEDULE_MS = [2000, 5000, 10000, 10000] as const;

export async function verifyWithRetries(orderId: string, intentId: string, onAttempt?: (attempt: number, result: PaymentVerification) => void): Promise<PaymentVerification> {
  let last: PaymentVerification = { confirmed: false, status: "unknown" };
  for (let attempt = 0; attempt < VERIFY_SCHEDULE_MS.length; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, VERIFY_SCHEDULE_MS[attempt]));
    last = await verifyPayment(orderId, intentId);
    onAttempt?.(attempt + 1, last);
    if (last.confirmed || last.status === "failed" || last.status === "closed" || last.status === "funding_failed") break;
  }
  return last;
}
