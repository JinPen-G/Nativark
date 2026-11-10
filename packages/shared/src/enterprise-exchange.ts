/** One post-pickup exchange spending request, not physical exchange authority.
 * Fulfillment, inspection, credit and original Core execution stay separate. */
import type { EnterpriseChangeRequest } from "./enterprise-workflows";
import type { RentalOrderExchangePriceBasis } from "./core";
import type { EnterpriseExpenseRequestOriginalResult, EnterpriseExtensionRequestClosureReceipt } from "./enterprise-expense";
export interface CloseEnterpriseExchangeRequest extends EnterpriseChangeRequest { expectedRevision: 0; confirm: true }
export type EnterpriseExchangeRequestOriginalResult = EnterpriseExpenseRequestOriginalResult<EnterpriseExchangeApprovalView>;
export type EnterpriseExchangeRequestClosureReceipt = EnterpriseExtensionRequestClosureReceipt;
export interface EnterpriseExchangeIntent {
  orderLineId: string;
  allocationId: string;
  replacementItemGroupId: string;
  replacementAssetId?: string;
  replacementPricingGroupId?: string;
  priceBasis: RentalOrderExchangePriceBasis;
}
export interface EnterpriseExchangeChoicesQuery {
  allocationId?: string;
  replacementItemGroupId?: string;
}
/** Current candidates only; availability is not a reservation or expense approval. */
export interface EnterpriseExchangeChoices {
  orderId: string;
  orderNo: string;
  expectedOrderUpdatedAt: string;
  workspaceId: string;
  applicantCustomerId: string;
  lines: Array<{ orderLineId: string; allocationId: string; itemGroupId: string; itemGroupName: string; quantity: number; assetNo?: string }>;
  replacements: Array<{ itemGroupId: string; name: string; inventoryMode: "serialized" | "quantity"; pricingGroups: Array<{ id: string; name: string }> }>;
  assets: Array<{ assetId: string; assetNo: string }>;
  selectedAllocationId?: string;
  selectedReplacementItemGroupId?: string;
  reservation: "not_reserved";
}
export interface RequestEnterpriseExchangeApproval extends EnterpriseChangeRequest {
  orderId: string;
  expectedOrderUpdatedAt: string;
  exchange: EnterpriseExchangeIntent;
}
export interface ConfirmEnterpriseExchangeExpense extends EnterpriseChangeRequest {
  confirm: true;
}
export interface EnterpriseExchangeConfirmationResult {
  approval: EnterpriseExchangeApprovalView;
  original: { state: "not_confirmed"; retryable: false } | { state: "observed"; operationKey: string; retryable: false };
}
export interface DecideEnterpriseExchangeApproval extends EnterpriseChangeRequest {
  decision: "approve" | "reject" | "withdraw";
}
export interface EnterpriseExchangeApprovalView {
  id: string;
  orderId: string;
  workspaceId: string;
  corporateCustomerId: string;
  applicantCustomerId: string;
  expectedOrderUpdatedAt: string;
  revision: number;
  state: "pending" | "approved" | "rejected" | "withdrawn" | "expired";
  reason: string;
  expiresAt: string;
  exchange: EnterpriseExchangeIntent;
  preview: {
    originalItemGroupName: string;
    replacementItemGroupName: string;
    originalAmount: number;
    replacementAmount: number;
    additionalAmount: number;
    refundAmount: number;
    depositDelta: number;
    preAuthDelta: number;
    currency: string;
    originalPriceVersion?: string;
    replacementPriceVersion?: string;
  };
  /** Employee consent to this expense only; merchant inspection needs separate consent. */
  employeeConfirmation?: { operationKey: string; confirmedAt: string; scope: "expense_only_not_inspection_or_execution" };
  execution: "original_merchant_execution_not_connected";
}
