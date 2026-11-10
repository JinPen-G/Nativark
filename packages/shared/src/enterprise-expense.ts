/** Additional enterprise spending is bound to an original Core preview, not an old
 * booking approval. Approval/creation/payment remain separate business stages. */
import type { ClientOrderExtensionRequest } from "./client";
import type { RentalOrderExtensionPreview } from "./core";
import type { EnterpriseChangeRequest } from "./enterprise-workflows";
export interface EnterpriseExtensionEligibility {
  orderId: string;
  expectedOrderUpdatedAt: string;
  approvalRequired: boolean;
  corporateCustomerId?: string;
}
export interface RequestEnterpriseExtensionApproval extends EnterpriseChangeRequest {
  orderId: string;
  expectedOrderUpdatedAt: string;
  extension: ClientOrderExtensionRequest;
}
export interface EnterpriseExtensionApprovalView {
  id: string;
  corporateCustomerId: string;
  applicantCustomerId: string;
  workspaceId: string;
  orderId: string;
  expectedOrderUpdatedAt: string;
  state: "pending" | "approved" | "rejected" | "withdrawn" | "expired" | "consumed" | "closed";
  revision: number;
  expiresAt: string;
  reason: string;
  preview: Pick<RentalOrderExtensionPreview, "originalEndAt" | "newEndAt" | "rentalAmount" | "serviceAmount" | "depositDelta" | "preAuthDelta" | "payableAmount" | "currency" | "settlementMode" | "paymentRequired"> & {
    chargeLines: Array<Pick<RentalOrderExtensionPreview["chargeLines"][number], "code" | "name" | "type" | "amount">>;
  };
  extensionId?: string;
  closedOperationKey?: string;
}
export interface DecideEnterpriseExtensionApproval extends EnterpriseChangeRequest {
  decision: "approve" | "reject" | "withdraw";
}
export interface SubmitEnterpriseExtensionApproval extends EnterpriseChangeRequest {
  approvalId: string;
  confirm: true;
}
export interface CloseEnterpriseExtensionExecution extends EnterpriseChangeRequest {
  originalOperationKey: string;
  confirm: true;
}
export interface CloseEnterpriseExtensionRequest extends EnterpriseChangeRequest {
  expectedRevision: 0;
  confirm: true;
}
export type EnterpriseExpenseRequestOriginalResult<Approval extends { id: string; orderId: string; workspaceId: string; applicantCustomerId: string }> =
  | { state: "not_recorded"; retryable: false }
  | { state: "observed"; approval: Approval; retryable: false }
  | { state: "closed"; orderId: string; workspaceId: string; workspaceCode: string; applicantCustomerId: string; closedOperationKey: string; retryable: false };
export type EnterpriseExtensionRequestOriginalResult = EnterpriseExpenseRequestOriginalResult<EnterpriseExtensionApprovalView>;
/** Original-key and closure-key receipts are separate; neither authorizes a new rental. */
export type EnterpriseExtensionRequestClosureReceipt = {
  orderId: string; workspaceId: string; workspaceCode: string; applicantCustomerId: string;
  originalOperationKey: string; closureOperationKey: string; retryable: false;
} & ({ state: "closed" } | { state: "observed"; approvalId: string });
export type EnterpriseExtensionRecoveryResult = EnterpriseExtensionOriginalResult | Extract<EnterpriseExtensionRequestOriginalResult, { state: "closed" }>;
export function enterpriseExpenseRequestMatches(result: EnterpriseExpenseRequestOriginalResult<{ id: string; orderId: string; workspaceId: string; applicantCustomerId: string }>, orderId: string, key: string, customerId: string, workspaceCode: string): boolean {
  if (result.retryable !== false) return false;
  if (result.state === "closed") return result.orderId === orderId && result.closedOperationKey === key && result.applicantCustomerId === customerId
    && Boolean(result.workspaceId) && result.workspaceCode === workspaceCode;
  return result.state === "observed" && Boolean(result.approval.id) && result.approval.orderId === orderId && result.approval.applicantCustomerId === customerId && Boolean(result.approval.workspaceId);
}
export function enterpriseExpenseRequestClosureMatches(result: EnterpriseExpenseRequestOriginalResult<{ id: string; orderId: string; workspaceId: string; applicantCustomerId: string }>, receipt: Record<string, unknown> | undefined, key: string, closureKey: string): boolean {
  if (!receipt || receipt.retryable !== false || receipt.originalOperationKey !== key || receipt.closureOperationKey !== closureKey) return false;
  const subject = result.state === "observed" ? result.approval : result.state === "closed" ? result : undefined;
  return Boolean(subject && receipt.orderId === subject.orderId && receipt.workspaceId === subject.workspaceId && receipt.applicantCustomerId === subject.applicantCustomerId
    && (result.state === "closed" ? receipt.state === "closed" && receipt.workspaceCode === result.workspaceCode : result.state === "observed" && receipt.state === "observed" && receipt.approvalId === result.approval.id));
}
export const enterpriseExtensionRequestMatches = enterpriseExpenseRequestMatches;
export const enterpriseExtensionRequestClosureMatches = enterpriseExpenseRequestClosureMatches;
export interface EnterpriseExtensionOriginalResult {
  approval: EnterpriseExtensionApprovalView;
  original: { state: "not_submitted" | "closed"; retryable: false } | { state: "observed"; extensionId: string; extensionState: string; retryable: false };
  retryable: false;
}
