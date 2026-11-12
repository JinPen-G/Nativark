/** One original customer submission delegated to the current merchant operator.
 * The source is server-only. Public views expose references and original receipts. */
import type { CreateRentalOrderRequest } from "./core";
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
