/** Enterprise workflow contracts: applications are not memberships or rental authority. */
export type EnterpriseRequestKind = "corporate_application" | "join_request" | "administrator_transfer" | "finance_request";
export type EnterpriseRequestState = "draft" | "pending" | "supplement_required" | "approved" | "rejected" | "withdrawn";
export interface EnterpriseChangeRequest { operationKey: string; expectedRevision: number; reason: string }
export interface EnterpriseApplicationInput {
  legalName: string; region: string; legalIdentifier: string; contactName: string; contactPhone: string;
  email?: string; authorityStatement: string; evidenceFileIds: string[]; agreementVersion: string;
  agreementAcknowledged?: boolean;
  existingCorporateCustomerId?: string;
}
export interface SaveEnterpriseApplicationRequest extends EnterpriseChangeRequest {
  requestId?: string; submit: boolean; application: EnterpriseApplicationInput;
}
export interface EnterpriseWorkflowView {
  id: string; kind: EnterpriseRequestKind; state: EnterpriseRequestState; revision: number;
  corporateCustomerId?: string; applicantCustomerId: string; createdAt: string; updatedAt: string;
  payload: Record<string, unknown>; decisionReason?: string;
}
export interface ReviewEnterpriseApplicationRequest extends EnterpriseChangeRequest {
  decision: "approve" | "reject" | "supplement";
  verifiedRepresentative: boolean;
}
export interface EnterpriseAuthorityUploadRequest { fileName: string; mimeType: string; sizeBytes: number; idempotencyKey: string }
export interface EnterpriseInvitePolicy {
  maxLifetimeHours: number; maxUses: number; guessesPerWindow: number; windowSeconds: number;
  agreementVersion: string;
  /** Merchant-approved plain text; missing legacy text leaves invitation preview unavailable. */
  noticeText?: string;
}
export interface SaveEnterpriseInvitePolicyRequest extends EnterpriseChangeRequest { policy: EnterpriseInvitePolicy }
export interface CreateEnterpriseInviteRequest extends EnterpriseChangeRequest { lifetimeHours: number; maxUses: number }
export interface EnterpriseInviteView {
  id: string; corporateCustomerId: string; status: "active" | "revoked"; revision: number;
  expiresAt: string; maxUses: number; used: number; createdAt: string;
}
export interface EnterpriseInviteCreated { invite: EnterpriseInviteView; code?: string; codeRetrievableAgain: false }
export interface PreviewEnterpriseInviteRequest { inviteCode: string }
export interface EnterpriseInvitePreview {
  corporateName: string;
  expiresAt: string;
  agreementVersion: string;
  noticeText: string;
  /** Server binding of the exact displayed notice; not membership authority. */
  noticeHash: string;
  semantics: "join_request_only";
}
export interface JoinEnterpriseRequest extends EnterpriseChangeRequest {
  inviteCode: string; department?: string; employeeNo?: string; agreementVersion: string; noticeHash: string; acknowledged: boolean;
}
export interface ReviewEnterpriseJoinRequest extends EnterpriseChangeRequest { decision: "approve" | "reject" }
export interface ChangeEnterpriseMemberRequest extends EnterpriseChangeRequest {
  department?: string; employeeNo?: string; status: "active" | "suspended" | "exited";
  effectiveTo?: string; expectedUpdatedAt: string;
}
export interface ChangeEnterpriseAdministratorRequest extends EnterpriseChangeRequest {
  role: "admin" | "employee";
  actions: import("./enterprise").EnterprisePortalAction[];
  expectedUpdatedAt: string;
}
export interface TransferEnterpriseAdministratorRequest extends EnterpriseChangeRequest { targetMembershipId: string }
export interface DecideEnterpriseTransferRequest extends EnterpriseChangeRequest { accept: boolean }
export interface EnterpriseOperationResult { state: "not_recorded" | "committed"; result?: Record<string, unknown> }
export interface EnterpriseTaskItem {
  id: string;
  kind: "corporate_application" | "join_request" | "administrator_transfer" | "booking_approval" | "extension_approval" | "management_request";
  state: string;
  revision: number;
  corporateCustomerId?: string;
  requiresAction: boolean;
  page: "applications" | "join" | "join-requests" | "approvals" | "extension-approvals" | "profile";
  createdAt?: string;
  expiresAt?: string;
}
export interface EnterpriseTaskCenter {
  items: EnterpriseTaskItem[];
  coverage: "own_requests_and_current_workspace_approvals";
  unavailable: Array<"order_alerts" | "financial_alerts" | "external_notifications">;
}
export interface EnterpriseListResponse<T> { items: T[]; page: number; pageSize: number; total: number }
export interface EnterpriseAuditView { operationKey: string; action: string; target: string; reason: string; actor: string; createdAt: string }

/** Management requests propose a change; approval records review only, never writes
 * a customer master, credit limit, policy, payment or ledger. */
export type EnterpriseManagementRequestType = "profile_change" | "credit_change" | "scope_change";
export interface EnterpriseProfileView {
  corporateCustomerId: string;
  corporateName: string;
  legalName: string | null;
  legalIdentifierMasked: string | null;
  membershipStatus: string;
  registeredAddress: string | null;
  profileRevision: string;
  creditRevision: number | null;
  merchantPolicyRevision: number;
  requestTypes: EnterpriseManagementRequestType[];
  unavailable: Array<"formal_bills" | "payment_proof" | "bill_dispute" | "contract_files">;
}
export interface EnterpriseManagementProposal {
  legalName?: string;
  registeredAddress?: string;
  email?: string;
  requestedCreditLimit?: string;
  currency?: string;
  workspaceIds?: string[];
  categoryCodes?: string[];
}
export interface SaveEnterpriseManagementRequest extends EnterpriseChangeRequest {
  requestId?: string;
  requestType: EnterpriseManagementRequestType;
  objectRevision: string;
  proposal: EnterpriseManagementProposal;
  evidenceFileIds: string[];
  submit: boolean;
}
export interface ReviewEnterpriseManagementRequest extends EnterpriseChangeRequest {
  decision: "approve" | "reject" | "supplement";
}
export interface EnterpriseManagementRequestView {
  id: string;
  corporateCustomerId: string;
  applicantCustomerId: string;
  requestType: EnterpriseManagementRequestType;
  objectRevision: string;
  state: EnterpriseRequestState;
  revision: number;
  proposal: EnterpriseManagementProposal;
  evidenceFileIds: string[];
  reason: string;
  decisionReason: string | null;
  effect: "review_only_no_business_change";
  createdAt: string;
  updatedAt: string;
}
