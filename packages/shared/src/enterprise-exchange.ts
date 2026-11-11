/** One post-pickup exchange spending request, not physical exchange authority.
 * Fulfillment, inspection, credit and original Core execution stay separate. */
import type { EnterpriseChangeRequest } from "./enterprise-workflows";
import type { RentalOrderExchangePriceBasis } from "./core";
import type { EnterpriseExpenseRequestOriginalResult, EnterpriseExtensionRequestClosureReceipt } from "./enterprise-expense";
import type { RentalExchangeInspectionConsent } from "./rental-exchange-inspection-preparation";

/** The client matches the original consent to its retained order/preparation/key. */
export function enterpriseExchangeInspectionConsentSnapshot(value: unknown,
  expected: { orderId: string; customerId: string; preparationId: string; operationKey?: string }): RentalExchangeInspectionConsent | undefined {
  const row = value as RentalExchangeInspectionConsent | null;
  const reference = (candidate: unknown): candidate is string => typeof candidate === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(candidate);
  const hash = (candidate: unknown): candidate is string => typeof candidate === "string" && /^[a-f0-9]{64}$/u.test(candidate);
  if (!row || typeof row !== "object" || Array.isArray(row) || !reference(row.id) || !reference(row.workspaceId)
    || row.orderId !== expected.orderId || row.customerId !== expected.customerId || row.preparationId !== expected.preparationId
    || !reference(row.orderId) || !reference(row.customerId) || !reference(row.preparationId)
    || typeof row.operationKey !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(row.operationKey)
    || expected.operationKey !== undefined && row.operationKey !== expected.operationKey
    || !hash(row.requestHash) || !hash(row.preparationHash) || !hash(row.materialHash)
    || typeof row.expectedOrderUpdatedAt !== "string" || !Number.isFinite(Date.parse(row.expectedOrderUpdatedAt))
    || typeof row.confirmedAt !== "string" || !Number.isFinite(Date.parse(row.confirmedAt))
    || row.revision !== 1 || row.state !== "confirmed" || row.scope !== "specific_exchange_inspection_and_handover" || row.retryable !== false) return undefined;
  return {
    id: row.id, orderId: row.orderId, workspaceId: row.workspaceId, customerId: row.customerId,
    preparationId: row.preparationId, preparationHash: row.preparationHash, materialHash: row.materialHash,
    expectedOrderUpdatedAt: row.expectedOrderUpdatedAt, operationKey: row.operationKey, requestHash: row.requestHash,
    confirmedAt: row.confirmedAt, revision: 1, state: "confirmed", scope: row.scope, retryable: false
  };
}
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
  state: "pending" | "approved" | "rejected" | "withdrawn" | "expired" | "consumed";
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
  execution: "original_merchant_execution_not_connected" | "original_merchant_execution_required" | "original_merchant_receipt_required";
}
