/** 本人企业政策、批准与原操作请求，写入保持原键及关闭刷新重放。 */
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
  EnterpriseOwnRentalPolicy,
  EnterpriseBookingApprovalView,
  EnterpriseApprovalOriginalResult,
  EnterpriseOrderOriginalResult,
  RequestEnterpriseBookingApproval,
  SubmitEnterpriseApprovedBooking,
} from "../../src/enterprise-policy";
import type {
  EnterpriseOperationResult,
} from "../../src/enterprise-workflows";
import type {
  EnterpriseExtensionRequestOriginalResult,
  EnterpriseExtensionEligibility,
  EnterpriseExtensionApprovalView,
  EnterpriseExtensionOriginalResult,
  RequestEnterpriseExtensionApproval,
  SubmitEnterpriseExtensionApproval,
  CloseEnterpriseExtensionExecution,
  CloseEnterpriseExtensionRequest,
} from "../../src/enterprise-expense";
import type {
  IssueEnterpriseOrderDelegation,
  RevokeEnterpriseOrderDelegation,
  EnterpriseOrderDelegationOriginal,
} from "../../src/enterprise-order-delegation";
import type { RentalMiniProgramClientPorts } from "./ports";

export function createRentalMiniProgramEnterpriseApi(ports: RentalMiniProgramClientPorts) {
  const { request } = ports;

  const fetchEnterpriseExchangeChoices = (orderId: string, query: EnterpriseExchangeChoicesQuery = {}) => {
    const search = Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value!)}`).join("&");
    return request<EnterpriseExchangeChoices>(`/enterprise/orders/${encodeURIComponent(orderId)}/exchange-choices${search ? `?${search}` : ""}`);
  };

  function requestEnterpriseExchangeApproval(input: RequestEnterpriseExchangeApproval) {
    return request("/enterprise/exchange-approvals", { method: "POST", data: input, replayAfterRefresh: false });
  }

  function readEnterpriseExchangeRequestOriginal(orderId: string, key: string) {
    return request<EnterpriseExchangeRequestOriginalResult>(`/enterprise/orders/${encodeURIComponent(orderId)}/exchange-request-operations/${encodeURIComponent(key)}`);
  }

  function closeEnterpriseExchangeRequest(orderId: string, key: string, input: CloseEnterpriseExchangeRequest) {
    return request<EnterpriseExchangeRequestOriginalResult>(`/enterprise/orders/${encodeURIComponent(orderId)}/exchange-request-operations/${encodeURIComponent(key)}/close`, { method: "POST", data: input, replayAfterRefresh: false });
  }

  function confirmEnterpriseExchangeExpense(id: string, input: ConfirmEnterpriseExchangeExpense) {
    return request(`/enterprise/exchange-approvals/${encodeURIComponent(id)}/expense-confirmation`, { method: "POST", data: input, replayAfterRefresh: false });
  }

  function readEnterpriseExchangeConfirmation(id: string) {
    return request<EnterpriseExchangeConfirmationResult>(`/enterprise/exchange-approvals/${encodeURIComponent(id)}/expense-confirmation`);
  }

  function fetchEnterpriseOrderExchangeApprovals(orderId: string) {
    return request<EnterpriseExchangeApprovalView[]>(`/enterprise/orders/${encodeURIComponent(orderId)}/exchange-approvals`);
  }

  function fetchEnterpriseExtensionEligibility(orderId: string) {
    return request<EnterpriseExtensionEligibility>(`/enterprise/orders/${encodeURIComponent(orderId)}/extension-eligibility`);
  }

  function readEnterpriseExtensionRequestOriginal(orderId: string, key: string) {
    return request<EnterpriseExtensionRequestOriginalResult>(`/enterprise/orders/${encodeURIComponent(orderId)}/extension-request-operations/${encodeURIComponent(key)}`);
  }

  function closeEnterpriseExtensionRequest(orderId: string, key: string, input: CloseEnterpriseExtensionRequest) {
    return request<EnterpriseExtensionRequestOriginalResult>(`/enterprise/orders/${encodeURIComponent(orderId)}/extension-request-operations/${encodeURIComponent(key)}/close`, { method: "POST", data: input, replayAfterRefresh: false });
  }

  function fetchEnterpriseExtensionApprovals() {
    return request<EnterpriseExtensionApprovalView[]>("/enterprise/my-extension-approvals");
  }

  function requestEnterpriseExtensionApproval(input: RequestEnterpriseExtensionApproval) {
    return request<{ id: string; revision: number; state: string }>("/enterprise/extension-approvals", { method: "POST", data: input, replayAfterRefresh: false });
  }

  function submitEnterpriseExtensionApproval(input: SubmitEnterpriseExtensionApproval) {
    return request<EnterpriseExtensionOriginalResult>("/enterprise/extension-approvals/submit", { method: "POST", data: input, replayAfterRefresh: false });
  }

  function closeEnterpriseExtensionExecution(id: string, input: CloseEnterpriseExtensionExecution) {
    return request<EnterpriseExtensionOriginalResult>(`/enterprise/extension-approvals/${encodeURIComponent(id)}/close-execution`, { method: "POST", data: input, replayAfterRefresh: false });
  }

  function readEnterpriseExtensionResult(id: string) {
    return request<EnterpriseExtensionOriginalResult>(`/enterprise/extension-approvals/${encodeURIComponent(id)}/result`);
  }

  function fetchEnterpriseRentalPolicies() {
    return request<EnterpriseOwnRentalPolicy[]>("/enterprise/my-rental-policies");
  }

  function fetchEnterpriseApprovals() {
    return request<EnterpriseBookingApprovalView[]>("/enterprise/my-approvals");
  }

  function requestEnterpriseApproval(input: RequestEnterpriseBookingApproval) {
    return request<{ id: string; revision: number; state: string }>("/enterprise/approvals", { method: "POST", data: input, replayAfterRefresh: false });
  }

  function submitEnterpriseApproval(input: SubmitEnterpriseApprovedBooking) {
    return request<{ orderId?: string; state?: string }>("/enterprise/approvals/submit", { method: "POST", data: input, replayAfterRefresh: false });
  }

  function readEnterpriseOperation(key: string) {
    return request<EnterpriseOperationResult>(`/enterprise/operations/${encodeURIComponent(key)}`);
  }

  function readEnterpriseApprovalResult(id: string) {
    return request<EnterpriseApprovalOriginalResult>(`/enterprise/approvals/${encodeURIComponent(id)}/result`);
  }

  function createEnterpriseOrder(quoteId: string, key: string) {
    return request("/orders", { method: "POST", data: { quoteId }, idempotencyKey: key, replayAfterRefresh: false });
  }

  function readEnterpriseOrderOriginal(quoteId: string, key: string) {
    return request<EnterpriseOrderOriginalResult>(`/enterprise/quotes/${encodeURIComponent(quoteId)}/order-operations/${encodeURIComponent(key)}`);
  }

  function issueEnterpriseOrderDelegation(input: IssueEnterpriseOrderDelegation) {
    return request<EnterpriseOrderDelegationOriginal>("/enterprise/order-delegations/issue", { method: "POST", data: input, replayAfterRefresh: false });
  }

  function readEnterpriseOrderDelegation(key: string) {
    return request<EnterpriseOrderDelegationOriginal>(`/enterprise/order-delegations/${encodeURIComponent(key)}`);
  }

  function revokeEnterpriseOrderDelegation(input: RevokeEnterpriseOrderDelegation) {
    return request<EnterpriseOrderDelegationOriginal>(`/enterprise/order-delegations/${encodeURIComponent(input.delegationKey)}/revoke`, { method: "POST", data: input, replayAfterRefresh: false });
  }

  return {
    fetchEnterpriseExchangeChoices,
    requestEnterpriseExchangeApproval,
    readEnterpriseExchangeRequestOriginal,
    closeEnterpriseExchangeRequest,
    confirmEnterpriseExchangeExpense,
    readEnterpriseExchangeConfirmation,
    fetchEnterpriseOrderExchangeApprovals,
    fetchEnterpriseExtensionEligibility,
    readEnterpriseExtensionRequestOriginal,
    closeEnterpriseExtensionRequest,
    fetchEnterpriseExtensionApprovals,
    requestEnterpriseExtensionApproval,
    submitEnterpriseExtensionApproval,
    closeEnterpriseExtensionExecution,
    readEnterpriseExtensionResult,
    fetchEnterpriseRentalPolicies,
    fetchEnterpriseApprovals,
    requestEnterpriseApproval,
    submitEnterpriseApproval,
    readEnterpriseOperation,
    readEnterpriseApprovalResult,
    createEnterpriseOrder,
    readEnterpriseOrderOriginal,
    issueEnterpriseOrderDelegation,
    readEnterpriseOrderDelegation,
    revokeEnterpriseOrderDelegation,
  };
}
