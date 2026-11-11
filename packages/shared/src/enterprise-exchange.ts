/** One post-pickup exchange spending request, not physical exchange authority.
 * Fulfillment, inspection, credit and original Core execution stay separate. */
import type { EnterpriseChangeRequest } from "./enterprise-workflows";
import type { RentalOrderExchangePriceBasis } from "./core";
import type { EnterpriseExpenseRequestOriginalResult, EnterpriseExtensionRequestClosureReceipt } from "./enterprise-expense";
import type { ExecuteApprovedRentalExchangeRequest, RentalExchangeInspectionConsent, RentalExchangeInspectionCustomerMaterial } from "./rental-exchange-inspection-preparation";

export interface EnterpriseMerchantExchangePreparation {
  preparationId: string;
  createdAt: string;
  state: "waiting_consent" | "consent_unavailable" | "ready";
  inspection: RentalExchangeInspectionCustomerMaterial;
  consentConfirmedAt?: string;
  binding?: Omit<ExecuteApprovedRentalExchangeRequest, "operationKey" | "reason" | "confirm">;
}
export interface EnterpriseMerchantExchangeChoices {
  orderId: string;
  orderNo: string;
  workspaceId: string;
  corporateCustomerId: string;
  applicantCustomerId: string;
  expectedOrderUpdatedAt: string;
  approvals: Array<{
    approval: EnterpriseExchangeApprovalView;
    state: "pending" | "expired" | "consumed" | "rejected" | "withdrawn" | "waiting_expense" | "waiting_inspection" | "ready";
    preparations: EnterpriseMerchantExchangePreparation[];
  }>;
  coverage: { state: "captured" | "limited"; limit: 20; approvals: number; preparations: number; consents: number };
}

/** Bind the displayed merchant materials to the original order and using customer. */
export function enterpriseMerchantExchangeChoicesSnapshot(value: unknown, expected: {
  orderId: string; workspaceId: string; corporateCustomerId: string; applicantCustomerId: string; expectedOrderUpdatedAt: string;
}): EnterpriseMerchantExchangeChoices | undefined {
  const row = value as EnterpriseMerchantExchangeChoices | null;
  const reference = (candidate: unknown): candidate is string => typeof candidate === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(candidate);
  const key = (candidate: unknown): candidate is string => typeof candidate === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(candidate);
  const hash = (candidate: unknown): candidate is string => typeof candidate === "string" && /^[a-f0-9]{64}$/u.test(candidate);
  const date = (candidate: unknown): candidate is string => typeof candidate === "string" && Number.isFinite(Date.parse(candidate));
  if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(expected).some(field => row[field as keyof typeof expected] !== expected[field as keyof typeof expected])
    || ![row.orderId, row.workspaceId, row.corporateCustomerId, row.applicantCustomerId].every(reference) || typeof row.orderNo !== "string"
    || !date(row.expectedOrderUpdatedAt) || !Array.isArray(row.approvals) || row.approvals.length > 20
    || !row.coverage || row.coverage.limit !== 20 || !["captured", "limited"].includes(row.coverage.state)
    || ![row.coverage.approvals, row.coverage.preparations, row.coverage.consents].every(count => Number.isSafeInteger(count) && count >= 0 && count <= 20)
    || row.coverage.approvals !== row.approvals.length || new Set(row.approvals.map(entry => entry?.approval?.id)).size !== row.approvals.length) return undefined;
  for (const entry of row.approvals) {
    const approval = entry?.approval, preview = approval?.preview;
    if (!approval || !reference(approval.id) || approval.orderId !== row.orderId || approval.workspaceId !== row.workspaceId
      || approval.corporateCustomerId !== row.corporateCustomerId || approval.applicantCustomerId !== row.applicantCustomerId
      || !date(approval.expectedOrderUpdatedAt) || !date(approval.expiresAt) || !Number.isSafeInteger(approval.revision) || approval.revision < 1
      || !["pending", "approved", "expired", "consumed", "rejected", "withdrawn"].includes(approval.state)
      || typeof approval.reason !== "string" || !approval.exchange || !preview
      || typeof preview.originalItemGroupName !== "string" || typeof preview.replacementItemGroupName !== "string" || typeof preview.currency !== "string" || !preview.currency.trim()
      || ![preview.originalAmount, preview.replacementAmount, preview.additionalAmount, preview.refundAmount, preview.depositDelta, preview.preAuthDelta].every(Number.isFinite)
      || !Array.isArray(entry.preparations) || entry.preparations.length > 20
      || new Set(entry.preparations.map(material => material?.preparationId)).size !== entry.preparations.length) return undefined;
    const confirmation = approval.employeeConfirmation;
    if (confirmation && (!key(confirmation.operationKey) || !date(confirmation.confirmedAt) || confirmation.scope !== "expense_only_not_inspection_or_execution")) return undefined;
    let state: string = approval.state;
    if (approval.state === "approved") {
      state = confirmation ? "waiting_inspection" : "waiting_expense";
      if (confirmation && entry.preparations.some(material => material?.state === "ready")) state = "ready";
    }
    if (entry.state !== state || approval.state !== "approved" && entry.preparations.length) return undefined;
    for (const material of entry.preparations) {
      const inspection = material?.inspection, binding = material?.binding;
      if (!material || !reference(material.preparationId) || !date(material.createdAt) || !["waiting_consent", "consent_unavailable", "ready"].includes(material.state)
        || !inspection || inspection.orderId !== row.orderId || inspection.workspaceId !== row.workspaceId || inspection.customerId !== row.applicantCustomerId
        || inspection.preparationId !== material.preparationId || inspection.expectedOrderUpdatedAt !== row.expectedOrderUpdatedAt
        || !hash(inspection.preparationHash) || !hash(inspection.materialHash) || !inspection.exchange
        || !Array.isArray(inspection.templates) || !inspection.templates.length || inspection.templates.length > 40
        || !Array.isArray(inspection.inspections) || inspection.inspections.length !== inspection.templates.length
        || !Array.isArray(inspection.exceptions) || inspection.exceptions.length > 20 || !Array.isArray(inspection.photos) || inspection.photos.length > 50
        || !["return_to_warehouse", "off_shelf"].includes(inspection.exchange.originalDisposition)
        || (["orderLineId", "allocationId", "replacementItemGroupId", "replacementAssetId", "priceBasis"] as const).some(field => inspection.exchange[field] !== approval.exchange[field])) return undefined;
      if (inspection.templates.some(template => !template || !["original_return", "replacement_pickup"].includes(template.side)
        || !reference(template.templateId) || typeof template.templateVersion !== "string" || typeof template.name !== "string" || !Array.isArray(template.fields)
        || template.fields.some(field => !field || typeof field.code !== "string" || typeof field.label !== "string" || typeof field.required !== "boolean"
          || !["boolean", "number", "text", "select", "photo"].includes(field.type)))
        || inspection.inspections.some(result => !result || !inspection.templates.some(template => template.side === result.side && template.templateId === result.templateId
          && template.templateVersion === result.templateVersion) || !result.results || typeof result.results !== "object" || Array.isArray(result.results)
          || Object.values(result.results).some(answer => !["string", "number", "boolean"].includes(typeof answer) || typeof answer === "number" && !Number.isFinite(answer)))
        || inspection.exceptions.some(exception => !exception || typeof exception.description !== "string" || typeof exception.code !== "string" || !reference(exception.allocationId))) return undefined;
      if (material.state === "ready") {
        if (!confirmation || approval.revision < 3 || approval.expectedOrderUpdatedAt !== row.expectedOrderUpdatedAt || !binding
          || Object.keys(binding).some(field => !["approvalId", "expectedApprovalRevision", "expectedOrderUpdatedAt", "preparationId", "preparationHash", "consentId", "consentOperationKey"].includes(field))
          || binding.approvalId !== approval.id || binding.expectedApprovalRevision !== approval.revision || binding.expectedOrderUpdatedAt !== row.expectedOrderUpdatedAt
          || binding.preparationId !== material.preparationId || binding.preparationHash !== inspection.preparationHash
          || !reference(binding.consentId) || !key(binding.consentOperationKey) || !date(material.consentConfirmedAt)) return undefined;
      } else if (binding || material.consentConfirmedAt) return undefined;
    }
  }
  return structuredClone(row);
}

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
