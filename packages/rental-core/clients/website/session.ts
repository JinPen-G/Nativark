/** Rental 官网登录态业务请求由宿主原 JSON 运输执行。
 * 当前客户身份、刷新和迟到响应由宿主维护，金额、授权与原结果沿服务端裁定。 */
import type { ClientOrderView } from "../../src/client-contracts";
import type {
  EnterpriseOwnRentalPolicy,
  EnterpriseBookingApprovalView,
  EnterpriseApprovalOriginalResult,
  EnterpriseOrderOriginalResult,
} from "../../src/enterprise-policy";
import type {
  IssueEnterpriseOrderDelegation,
  RevokeEnterpriseOrderDelegation,
  EnterpriseOrderDelegationOriginal,
} from "../../src/enterprise-order-delegation";
import type {
  EnterpriseExchangeChoices,
  EnterpriseExchangeChoicesQuery,
  EnterpriseExchangeRequestOriginalResult,
  RequestEnterpriseExchangeApproval,
  CloseEnterpriseExchangeRequest,
  ConfirmEnterpriseExchangeExpense,
  EnterpriseExchangeConfirmationResult,
  EnterpriseExchangeApprovalView,
} from "../../src/enterprise-exchange";
import type {
  CloseEnterpriseExtensionRequest,
  EnterpriseExtensionRequestOriginalResult,
  EnterpriseExtensionEligibility,
  EnterpriseExtensionApprovalView,
  EnterpriseExtensionOriginalResult,
} from "../../src/enterprise-expense";

/** 原宿主 authedJson 负责响应解包、错误实例及安全 GET 刷新；业务写入沿原策略执行一次。 */
export type RentalWebsiteSessionRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export function createRentalWebsiteSessionClient(authedJson: RentalWebsiteSessionRequest) {
  return {
    /** 登录态目录：含履约地点、履约模式与型号（用于下单时取 locationId / fulfillmentMode）。 */
    catalog() {
      return authedJson<Record<string, any>>('/catalog');
    },
    availability(payload: unknown) {
      return authedJson<Record<string, unknown>>('/availability', { method: 'POST', body: JSON.stringify(payload) });
    },
    enterpriseRentalPolicies() {
      return authedJson<EnterpriseOwnRentalPolicy[]>('/enterprise/my-rental-policies');
    },
    enterpriseApprovals() {
      return authedJson<EnterpriseBookingApprovalView[]>('/enterprise/my-approvals');
    },
    enterpriseCommand<T>(path: string, payload: unknown) {
      return authedJson<T>(`/enterprise/${path}`, { method: 'POST', body: JSON.stringify(payload) });
    },
    issueEnterpriseOrderDelegation(input: IssueEnterpriseOrderDelegation) {
      return authedJson<EnterpriseOrderDelegationOriginal>('/enterprise/order-delegations/issue', { method: 'POST', body: JSON.stringify(input) });
    },
    enterpriseOrderDelegation(key: string) {
      return authedJson<EnterpriseOrderDelegationOriginal>(`/enterprise/order-delegations/${encodeURIComponent(key)}`, { cache: 'no-store' });
    },
    revokeEnterpriseOrderDelegation(input: RevokeEnterpriseOrderDelegation) {
      return authedJson<EnterpriseOrderDelegationOriginal>(`/enterprise/order-delegations/${encodeURIComponent(input.delegationKey)}/revoke`, { method: 'POST', body: JSON.stringify(input) });
    },
    enterpriseOperation(key: string) {
      return authedJson<{
        state: string;
        result?: Record<string, unknown>;
      }>(`/enterprise/operations/${encodeURIComponent(key)}`);
    },
    enterpriseExchangeChoices(orderId: string, query: EnterpriseExchangeChoicesQuery = {}) {
      const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined) as [string, string][]);
      return authedJson<EnterpriseExchangeChoices>(`/enterprise/orders/${encodeURIComponent(orderId)}/exchange-choices?${search}`);
    },
    requestEnterpriseExchangeApproval(input: RequestEnterpriseExchangeApproval) {
      return authedJson(`/enterprise/exchange-approvals`, { method: 'POST', body: JSON.stringify(input) });
    },
    enterpriseExchangeRequestOriginal(orderId: string, key: string) {
      return authedJson<EnterpriseExchangeRequestOriginalResult>(`/enterprise/orders/${encodeURIComponent(orderId)}/exchange-request-operations/${encodeURIComponent(key)}`);
    },
    closeEnterpriseExchangeRequest(orderId: string, key: string, input: CloseEnterpriseExchangeRequest) {
      return authedJson<EnterpriseExchangeRequestOriginalResult>(`/enterprise/orders/${encodeURIComponent(orderId)}/exchange-request-operations/${encodeURIComponent(key)}/close`, { method: 'POST', body: JSON.stringify(input) });
    },
    originalExchangeOrder(orderId: string) {
      return authedJson<ClientOrderView>(`/orders/${encodeURIComponent(orderId)}`);
    },
    confirmEnterpriseExchangeExpense(id: string, input: ConfirmEnterpriseExchangeExpense) {
      return authedJson(`/enterprise/exchange-approvals/${encodeURIComponent(id)}/expense-confirmation`, { method: 'POST', body: JSON.stringify(input) });
    },
    enterpriseExchangeConfirmation(id: string) {
      return authedJson<EnterpriseExchangeConfirmationResult>(`/enterprise/exchange-approvals/${encodeURIComponent(id)}/expense-confirmation`);
    },
    enterpriseOrderExchangeApprovals(orderId: string) {
      return authedJson<EnterpriseExchangeApprovalView[]>(`/enterprise/orders/${encodeURIComponent(orderId)}/exchange-approvals`);
    },
    enterpriseExtensionEligibility(orderId: string) {
      return authedJson<EnterpriseExtensionEligibility>(`/enterprise/orders/${encodeURIComponent(orderId)}/extension-eligibility`);
    },
    enterpriseExtensionRequestOriginal(orderId: string, key: string) {
      return authedJson<EnterpriseExtensionRequestOriginalResult>(`/enterprise/orders/${encodeURIComponent(orderId)}/extension-request-operations/${encodeURIComponent(key)}`);
    },
    closeEnterpriseExtensionRequest(orderId: string, key: string, input: CloseEnterpriseExtensionRequest) {
      return authedJson<EnterpriseExtensionRequestOriginalResult>(`/enterprise/orders/${encodeURIComponent(orderId)}/extension-request-operations/${encodeURIComponent(key)}/close`, { method: 'POST', body: JSON.stringify(input) });
    },
    enterpriseExtensionApprovals() {
      return authedJson<EnterpriseExtensionApprovalView[]>('/enterprise/my-extension-approvals');
    },
    enterpriseExtensionResult(id: string) {
      return authedJson<EnterpriseExtensionOriginalResult>(`/enterprise/extension-approvals/${encodeURIComponent(id)}/result`);
    },
    enterpriseApprovalResult(id: string) {
      return authedJson<EnterpriseApprovalOriginalResult>(`/enterprise/approvals/${encodeURIComponent(id)}/result`);
    },
    enterpriseOrderOriginal(quoteId: string, key: string) {
      return authedJson<EnterpriseOrderOriginalResult>(`/enterprise/quotes/${encodeURIComponent(quoteId)}/order-operations/${encodeURIComponent(key)}`);
    },
    createQuote(payload: unknown) {
      return authedJson<Record<string, unknown>>('/quotes', { method: 'POST', body: JSON.stringify(payload) });
    },
    getQuote(id: string) {
      return authedJson<Record<string, unknown>>(`/quotes/${encodeURIComponent(id)}`);
    },
    createOrder(payload: unknown, idempotencyKey: string) {
      return authedJson<Record<string, unknown>>('/orders', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(payload) });
    },
    myOrders(params: {
      page?: number;
      pageSize?: number;
    } = {}) {
      const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
      return authedJson<{
        items: any[];
        page: number;
        pageSize: number;
        total: number;
      }>(`/my/orders${q ? `?${q}` : ''}`);
    },
    order(id: string) {
      return authedJson<Record<string, any>>(`/orders/${encodeURIComponent(id)}`);
    },
    paymentCapabilities() {
      return authedJson<{
        methods?: string[];
        [k: string]: unknown;
      }>('/payment/capabilities');
    },
    addresses() {
      return authedJson<Record<string, unknown>>('/profile/addresses');
    },
    saveAddress(payload: unknown) {
      return authedJson<Record<string, unknown>>('/profile/addresses', { method: 'PUT', body: JSON.stringify(payload) });
    },
    deleteAddress(id: string) {
      return authedJson<unknown>(`/profile/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    coupons() {
      return authedJson<Record<string, unknown>>('/coupons');
    },
    notifications(params: {
      page?: number;
      pageSize?: number;
    } = {}) {
      const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
      return authedJson<Record<string, unknown>>(`/notifications${q ? `?${q}` : ''}`);
    },
    createPaymentIntent(orderId: string, payload: Record<string, unknown>, idempotencyKey: string) {
      // 原 DTO 从 body 读取必填操作键，兼容请求头保留同一个原键。
      return authedJson<Record<string, any>>(`/orders/${encodeURIComponent(orderId)}/payment-intents`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ ...payload, idempotencyKey }) });
    }
  };
}
