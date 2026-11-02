/** Enterprise eligibility and original approval reads. Writes never refresh/replay automatically. */
import type { EnterpriseOwnRentalPolicy, EnterpriseBookingApprovalView, EnterpriseOperationResult, EnterpriseApprovalOriginalResult, EnterpriseOrderOriginalResult, RequestEnterpriseBookingApproval, SubmitEnterpriseApprovedBooking } from "@rental-os/shared";
import type { EnterpriseExtensionEligibility, EnterpriseExtensionApprovalView, EnterpriseExtensionOriginalResult, RequestEnterpriseExtensionApproval, SubmitEnterpriseExtensionApproval, CloseEnterpriseExtensionExecution } from "@rental-os/shared";
import { request } from "../core/http";
export const fetchEnterpriseExtensionEligibility = (orderId: string) => request<EnterpriseExtensionEligibility>(`/enterprise/orders/${encodeURIComponent(orderId)}/extension-eligibility`);
export const fetchEnterpriseExtensionApprovals = () => request<EnterpriseExtensionApprovalView[]>("/enterprise/my-extension-approvals");
export const requestEnterpriseExtensionApproval = (input: RequestEnterpriseExtensionApproval) => request<{ id: string; revision: number; state: string }>("/enterprise/extension-approvals", { method: "POST", data: input, replayAfterRefresh: false });
export const submitEnterpriseExtensionApproval = (input: SubmitEnterpriseExtensionApproval) => request<EnterpriseExtensionOriginalResult>("/enterprise/extension-approvals/submit", { method: "POST", data: input, replayAfterRefresh: false });
export const closeEnterpriseExtensionExecution = (id: string, input: CloseEnterpriseExtensionExecution) => request<EnterpriseExtensionOriginalResult>(`/enterprise/extension-approvals/${encodeURIComponent(id)}/close-execution`, { method: "POST", data: input, replayAfterRefresh: false });
export const readEnterpriseExtensionResult = (id: string) => request<EnterpriseExtensionOriginalResult>(`/enterprise/extension-approvals/${encodeURIComponent(id)}/result`);
export const fetchEnterpriseRentalPolicies = () => request<EnterpriseOwnRentalPolicy[]>("/enterprise/my-rental-policies");
export const fetchEnterpriseApprovals = () => request<EnterpriseBookingApprovalView[]>("/enterprise/my-approvals");
export const requestEnterpriseApproval = (input: RequestEnterpriseBookingApproval) => request<{ id: string; revision: number; state: string }>("/enterprise/approvals", { method: "POST", data: input, replayAfterRefresh: false });
export const submitEnterpriseApproval = (input: SubmitEnterpriseApprovedBooking) => request<{ orderId?: string; state?: string }>("/enterprise/approvals/submit", { method: "POST", data: input, replayAfterRefresh: false });
export const readEnterpriseOperation = (key: string) => request<EnterpriseOperationResult>(`/enterprise/operations/${encodeURIComponent(key)}`);
export const readEnterpriseApprovalResult = (id: string) => request<EnterpriseApprovalOriginalResult>(`/enterprise/approvals/${encodeURIComponent(id)}/result`);
export const createEnterpriseOrder = (quoteId: string, key: string) => request("/orders", { method: "POST", data: { quoteId }, idempotencyKey: key, replayAfterRefresh: false });
export const readEnterpriseOrderOriginal = (quoteId: string, key: string) => request<EnterpriseOrderOriginalResult>(`/enterprise/quotes/${encodeURIComponent(quoteId)}/order-operations/${encodeURIComponent(key)}`);
