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
export type EnterpriseExtensionRequestOriginalResult =
  | { state: "not_recorded"; retryable: false }
  | { state: "observed"; approval: EnterpriseExtensionApprovalView; retryable: false };
export interface EnterpriseExtensionOriginalResult {
  approval: EnterpriseExtensionApprovalView;
  original: { state: "not_submitted" | "closed"; retryable: false } | { state: "observed"; extensionId: string; extensionState: string; retryable: false };
  retryable: false;
}
