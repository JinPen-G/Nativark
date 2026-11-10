/** Explicit enterprise scope and payment policy; never pricing, credit or inventory facts. */
import type { RentalCategoryCode } from "./core";
import type { EnterpriseChangeRequest } from "./enterprise-workflows";
export interface EnterpriseScopePolicy {
  workspaceIds: string[];
  categoryCodes: RentalCategoryCode[];
  personalPaymentAllowed: boolean;
  enterprisePaymentAllowed: boolean;
  approvalMode: "per_order" | "without_per_order" | "unconfigured";
  /** Merchant-approved plain-text notice; company/member policies cannot replace it. */
  noticeVersion: string;
  noticeText: string;
  maxRequestAmount?: string;
  currency?: string;
  approvalLifetimeMinutes?: number;
}
export interface SaveEnterpriseScopePolicyRequest extends EnterpriseChangeRequest { policy: EnterpriseScopePolicy }
export interface EnterpriseScopePolicyView {
  revision: number;
  merchantRevision: number;
  companyRevision: number;
  employeeRevision: number;
  merchant?: EnterpriseScopePolicy;
  company?: EnterpriseScopePolicy;
  employee?: EnterpriseScopePolicy;
  effectiveWorkspaceIds: string[];
  effectiveCategoryCodes: RentalCategoryCode[];
  workspaces: Array<{ id: string; name: string; categoryCode: RentalCategoryCode }>;
}
export interface EnterpriseOwnRentalPolicy {
  corporateCustomerId: string;
  corporateName: string;
  membershipId: string;
  workspaceId: string;
  available: boolean;
  personalPaymentAllowed: boolean;
  enterprisePaymentAllowed: boolean;
  approvalMode: EnterpriseScopePolicy["approvalMode"];
  noticeVersion?: string;
  noticeText?: string;
  unavailableReason?: string;
}
export interface EnterpriseDisclosure { noticeVersion: string; acknowledged: boolean }
export interface EnterpriseBookingBasis {
  merchantRevision: number; companyRevision: number; employeeRevision: number;
  membershipUpdatedAt: string; noticeVersion: string; acknowledgedAt: string;
  /** Contractual default only; does not claim a deposit payment or freeze. */
  guaranteePayer: "enterprise"; approvalMode: EnterpriseScopePolicy["approvalMode"];
}
export interface RequestEnterpriseBookingApproval extends EnterpriseChangeRequest { quoteId: string; purpose: string }
export interface DecideEnterpriseBookingApproval extends EnterpriseChangeRequest { decision: "approve" | "reject" | "withdraw" }
export interface SubmitEnterpriseApprovedBooking extends EnterpriseChangeRequest { approvalId: string; confirm: true }
/** Closes the original execution under the Core commit fence; never retries it
 * or cancels an order which already committed. */
export interface CloseEnterpriseApprovalExecution extends EnterpriseChangeRequest { confirm: true }
export interface EnterpriseOrderOriginalResult {
  state: "not_observed" | "unknown" | "observed";
  orderId: string | null;
  retryable: false;
}
export interface EnterpriseApprovalOriginalResult {
  approval: EnterpriseBookingApprovalView;
  original: EnterpriseOrderOriginalResult | { state: "not_submitted"; retryable: false } | { state: "closed"; retryable: false };
  retryable: false;
}
/** A whitelist of the stored quote only; missing historical facts stay null.
 * Guarantee responsibility is not proof of payment or preauthorization. */
export interface EnterpriseBookingReview {
  quoteNo: string | null;
  categoryCode: RentalCategoryCode;
  expiresAt: string;
  startAt: string | null;
  endAt: string | null;
  fulfillmentMode: string | null;
  applicantName: string | null;
  corporateName: string | null;
  lines: Array<{ itemGroupId?: string; pricingGroupId?: string; itemGroupName: string | null; pricingGroupName: string | null; quantity: number }>;
  chargeLines: Array<{ code: string; name: string; type: string; amount: number | null }>;
  rentalAmount: number | null;
  discountAmount: number | null;
  couponAmount: number | null;
  serviceAmount: number | null;
  fulfillmentAmount: number | null;
  taxAmount: number | null;
  payableAmount: number | null;
  depositAmount: number | null;
  preAuthAmount: number | null;
  currency: string | null;
  guaranteePayer: "enterprise" | null;
  guaranteeSource: "not_recorded";
  paymentResponsibility: "enterprise";
  settlementMode: "per_order" | "credit" | null;
}
export interface EnterpriseBookingApprovalView {
  id: string; corporateCustomerId: string; applicantCustomerId: string; workspaceId: string;
  quoteId: string; state: "pending" | "approved" | "rejected" | "withdrawn" | "executing" | "consumed" | "expired" | "closed";
  revision: number; expiresAt: string; purpose: string; orderId?: string;
  amount: string; currency: string; quote: EnterpriseBookingReview;
}
