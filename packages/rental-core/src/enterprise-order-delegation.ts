/** One original customer submission delegated to the current merchant operator.
 * The source is server-only. Public views expose references and original receipts. */
import type { CreateRentalOrderRequest } from "./contracts";
import type { EnterpriseBookingBasis } from "./enterprise-policy";
import type { EnterpriseChangeRequest } from "./enterprise-workflows";

export const ENTERPRISE_ORDER_DELEGATION_SOURCE_VERSION = "enterprise-order-delegation-1" as const;

export type EnterpriseOrderDelegationRequestReference =
  | { approvalId: string }
  | { quoteId: string };

export interface IssueEnterpriseOrderDelegation extends EnterpriseChangeRequest {
  requestReference: EnterpriseOrderDelegationRequestReference;
  confirm: true;
}

export interface EnterpriseOrderDelegationReference {
  delegationKey: string;
  expectedRevision: number;
  approvalId?: string;
}

export interface ExecuteEnterpriseMerchantOrderDelegation extends EnterpriseOrderDelegationReference {
  confirm: true;
}

export type EnterpriseMerchantOrderDelegationResult = {
  delegationKey: string;
  retryable: false;
} & ({ state: "observed"; orderId: string } | { state: "unknown"; orderId: null });

export interface RevokeEnterpriseOrderDelegation extends EnterpriseChangeRequest {
  delegationKey: string;
  confirm: true;
}

export interface EnterpriseOrderDelegationSource {
  version: typeof ENTERPRISE_ORDER_DELEGATION_SOURCE_VERSION;
  purpose: "merchant_operator";
  delegationKey: string;
  tenantId: string;
  workspaceId: string;
  personalCustomerId: string;
  corporateCustomerId: string;
  corporateMembershipId: string;
  requestReference: EnterpriseOrderDelegationRequestReference;
  quoteId: string;
  request: CreateRentalOrderRequest;
  requestHash: string;
  requestContentHash: string;
  quoteHash: string;
  basis: EnterpriseBookingBasis;
  basisHash: string;
  approval?: { id: string; revision: number; requestHash: string; quoteHash: string };
  confirmation: { operationKey: string; customerId: string; confirmedAt: string; noticeVersion: string; acknowledgedAt: string };
  expiresAt: string;
  integrityHash: string;
}

export interface EnterpriseOrderDelegationReceipt {
  state: "consumed";
  delegationKey: string;
  sourceHash: string;
  tenantId: string;
  workspaceId: string;
  personalCustomerId: string;
  corporateCustomerId: string;
  quoteId: string;
  requestHash: string;
  coreIdempotencyKey: string;
  actorUserId: string;
  orderId: string;
  consumedAt: string;
  retryable: false;
}

export interface EnterpriseOrderDelegationView {
  delegationKey: string;
  personalCustomerId?: string;
  corporateCustomerId?: string;
  quoteId?: string;
  workspaceId?: string;
  requestReference: EnterpriseOrderDelegationRequestReference;
  state: "issued" | "expired" | "revoked" | "consumed";
  revision: number;
  expiresAt: string;
  confirmedAt: string;
  purpose: "merchant_operator";
  original: EnterpriseOrderDelegationReceipt | { state: "not_submitted"; retryable: false } | { state: "revoked"; retryable: false };
  retryable: false;
}

export type EnterpriseOrderDelegationOriginal = EnterpriseOrderDelegationView | {
  state: "not_recorded";
  delegationKey: string;
  retryable: false;
};


/** Bind a public customer read to its original quote and delegation locator.
 * An absent receipt keeps the operation pending. Only the server's consumed
 * or revoked original can release the customer's submission controls. */
export function enterpriseOrderDelegationMatches(value: unknown, expected: {
  delegationKey: string;
  requestReference: EnterpriseOrderDelegationRequestReference;
  tenantId: string;
  personalCustomerId: string;
  corporateCustomerId: string;
  quoteId: string;
}): value is EnterpriseOrderDelegationView {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as EnterpriseOrderDelegationView;
  const identifier = (input: unknown): input is string => typeof input === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(input);
  if (row.delegationKey !== expected.delegationKey || row.purpose !== "merchant_operator" || row.retryable !== false
    || row.personalCustomerId !== expected.personalCustomerId || row.corporateCustomerId !== expected.corporateCustomerId
    || row.quoteId !== expected.quoteId || !identifier(row.workspaceId)
    || JSON.stringify(row.requestReference) !== JSON.stringify(expected.requestReference)
    || !Number.isSafeInteger(row.revision) || row.revision < 1
    || typeof row.confirmedAt !== "string" || typeof row.expiresAt !== "string"
    || !Number.isFinite(Date.parse(row.confirmedAt)) || !Number.isFinite(Date.parse(row.expiresAt))
    || !row.original || row.original.retryable !== false) return false;
  if (row.state === "issued" || row.state === "expired") return row.revision === 1 && row.original.state === "not_submitted";
  if (row.state === "revoked") return row.revision >= 2 && row.original.state === "revoked";
  if (row.state !== "consumed" || row.revision < 2 || row.original.state !== "consumed") return false;
  const receipt = row.original;
  return receipt.delegationKey === expected.delegationKey && receipt.coreIdempotencyKey === expected.delegationKey
    && receipt.tenantId === expected.tenantId && receipt.workspaceId === row.workspaceId
    && receipt.personalCustomerId === expected.personalCustomerId && receipt.corporateCustomerId === expected.corporateCustomerId
    && receipt.quoteId === expected.quoteId && /^[a-f0-9]{64}$/u.test(receipt.sourceHash)
    && /^[a-f0-9]{64}$/u.test(receipt.requestHash) && identifier(receipt.actorUserId)
    && identifier(receipt.orderId) && typeof receipt.consumedAt === "string" && Number.isFinite(Date.parse(receipt.consumedAt));
}
