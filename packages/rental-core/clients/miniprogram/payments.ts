/** 客户支付单请求，微信收银台与付款结果核对沿原宿主和服务端。 */
import type {
  ClientPaymentCapabilitiesResponse,
  ClientPaymentIntentResponse,
} from "../../src/client-contracts";
import type { RentalMiniProgramClientPorts } from "./ports";

export function createRentalMiniProgramPaymentsApi(ports: RentalMiniProgramClientPorts) {
  const { request } = ports;

  async function fetchPaymentCapabilities(): Promise<ClientPaymentCapabilitiesResponse> {
    return request<ClientPaymentCapabilitiesResponse>("/payment/capabilities");
  }

  /**
   * 小程序支付单：服务端用可信微信身份创建 JSAPI 预支付并返回签名参数。
   * 小程序不提交 openid、金额或支付方式；用途首期固定为租金/费用。
   */
  async function createMiniProgramPaymentIntent(orderId: string, idempotencyKey: string): Promise<ClientPaymentIntentResponse> {
    return request<ClientPaymentIntentResponse>(`/orders/${encodeURIComponent(orderId)}/mini-program-payment-intents`, {
      method: "POST",
      data: { instrument: "rental", idempotencyKey }
    });
  }

  async function fetchPaymentIntent(orderId: string, intentId: string): Promise<ClientPaymentIntentResponse> {
    return request<ClientPaymentIntentResponse>(`/orders/${encodeURIComponent(orderId)}/payment-intents/${encodeURIComponent(intentId)}`);
  }

  /** 回调延迟时向提供方查单；只有服务端查到成功且金额一致才入账。 */
  async function refreshPaymentIntent(orderId: string, intentId: string): Promise<ClientPaymentIntentResponse> {
    return request<ClientPaymentIntentResponse>(`/orders/${encodeURIComponent(orderId)}/payment-intents/${encodeURIComponent(intentId)}/refresh`, { method: "POST" });
  }

  async function closePaymentIntent(orderId: string, intentId: string): Promise<ClientPaymentIntentResponse> {
    return request<ClientPaymentIntentResponse>(`/orders/${encodeURIComponent(orderId)}/payment-intents/${encodeURIComponent(intentId)}/close`, { method: "POST" });
  }

  return {
    fetchPaymentCapabilities,
    createMiniProgramPaymentIntent,
    fetchPaymentIntent,
    refreshPaymentIntent,
    closePaymentIntent,
  };
}
