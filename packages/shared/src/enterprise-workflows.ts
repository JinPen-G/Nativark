/** Enterprise workflow contracts: applications are not memberships or rental authority. */
import { ENTERPRISE_PORTAL_ACTIONS, type EnterprisePortalAction } from "./enterprise";
import { CUSTOMER_ACCOUNT_STATUSES, CUSTOMER_MEMBERSHIP_STATUSES, CUSTOMER_STATUS_ACTIONS, type CustomerMembershipStatus, type CustomerStatusHistoryEntry } from "./core";
/** Current registered corporate-identity mapping only. CN uses the existing
 * corporate USCC port; this is not tenant enablement, qualification or authority.
 * Add another region only with its real identity port, not a customer city field. */
export const enterpriseApplicationRegionHasIdentityMapping = (region: unknown): boolean => region === "CN";

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
/** Current, request-bound verification facts; not a receipt or authority to claim.
 * legalIdentifierMasked comes from the registered corporate identity, not a city field. */
export interface EnterpriseApplicationClaimView {
  applicationId: string;
  applicationRevision: number;
  corporateCustomerId: string;
  corporateName: string;
  legalIdentifierMasked: string;
  migrated: boolean;
  hasCurrentAdministrator: boolean;
  readOnly: true;
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
/** Original current-workspace own enterprise-order material, not a handoff request,
 * merchant acceptance or today's member/financial authority. No third-party PII. */
export interface EnterpriseRentalHandoffMaterial {
  orderId: string;
  orderNo: string;
  orderUpdatedAt: string;
  workspaceCode: string;
  corporateCustomerId: string;
  corporateMembershipId: string;
  membershipResolvedAt: string;
  membershipUpdatedAt: string | null;
  enterpriseContractAndPayer: boolean;
  subjects: { contract: "personal" | "corporate" | "unavailable"; payer: "personal" | "corporate" | "unavailable"; user: "self" | "unavailable" };
  subjectBasis: "recorded_columns" | "legacy_customer_fallback";
  scope: "current_workspace_original_own_order";
  readOnly: true;
}
/** Canonical allowlisted copy for both HTTP projection and frozen material keys.
 * JSON storage may reorder fields; current memberships never fill missing history. */
export function enterpriseRentalHandoffMaterialSnapshot(value: unknown, orderId: string, workspaceCode: string): EnterpriseRentalHandoffMaterial | undefined {
  const reference = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(value);
  const utc = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const row = value as EnterpriseRentalHandoffMaterial | null;
  if (!reference(orderId) || !reference(workspaceCode) || !row || typeof row !== "object" || Array.isArray(row) || row.readOnly !== true || row.scope !== "current_workspace_original_own_order" || row.orderId !== orderId || row.workspaceCode !== workspaceCode
    || !reference(row.corporateCustomerId) || !reference(row.corporateMembershipId) || !utc(row.orderUpdatedAt) || !utc(row.membershipResolvedAt) || row.membershipUpdatedAt !== null && !utc(row.membershipUpdatedAt)
    || typeof row.orderNo !== "string" || !row.orderNo.trim() || row.orderNo.length > 191 || /[\u0000-\u001f\u007f]/u.test(row.orderNo) || typeof row.enterpriseContractAndPayer !== "boolean"
    || !["recorded_columns", "legacy_customer_fallback"].includes(row.subjectBasis) || !row.subjects || typeof row.subjects !== "object" || Array.isArray(row.subjects)
    || !["personal", "corporate", "unavailable"].includes(row.subjects.contract) || !["personal", "corporate", "unavailable"].includes(row.subjects.payer) || !["self", "unavailable"].includes(row.subjects.user)) return undefined;
  return { orderId, orderNo: row.orderNo, orderUpdatedAt: row.orderUpdatedAt, workspaceCode, corporateCustomerId: row.corporateCustomerId, corporateMembershipId: row.corporateMembershipId,
    membershipResolvedAt: row.membershipResolvedAt, membershipUpdatedAt: row.membershipUpdatedAt, enterpriseContractAndPayer: row.enterpriseContractAndPayer,
    subjects: { contract: row.subjects.contract, payer: row.subjects.payer, user: row.subjects.user }, subjectBasis: row.subjectBasis, scope: row.scope, readOnly: true };
}
export interface CreateEnterpriseRentalHandoffRequest extends EnterpriseChangeRequest {
  materialKey: string;
  confirm: true;
}
export interface EnterpriseRentalHandoffCreated {
  id: string;
  orderId: string;
  state: "pending";
  revision: 1;
  effect: "request_only_no_business_change";
}
export interface EnterpriseRentalHandoffView {
  id: string;
  orderId: string;
  revision: number;
  state: "pending" | "reviewed" | "withdrawn";
  material: EnterpriseRentalHandoffMaterial;
  reason: string;
  merchantReview?: { operatorId: string; reason: string; reviewedAt: string };
  createdAt: string;
  updatedAt: string;
  effect: "request_only_no_business_change";
}
/** Registered owner feedback only; copy original fields, not ORM/private extensions. */
export function enterpriseRentalHandoffSnapshot(value: unknown, workspaceCode: string): EnterpriseRentalHandoffView | undefined {
  const row = value as EnterpriseRentalHandoffView | null;
  const reference = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(value);
  const utc = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  if (!row || typeof row !== "object" || Array.isArray(row) || !reference(row.id) || !reference(row.orderId) || !["pending", "reviewed", "withdrawn"].includes(row.state)
    || row.revision !== (row.state === "pending" ? 1 : 2) || typeof row.reason !== "string" || !row.reason.trim() || row.reason.length > 500 || !utc(row.createdAt) || !utc(row.updatedAt) || row.effect !== "request_only_no_business_change") return undefined;
  const material = enterpriseRentalHandoffMaterialSnapshot(row.material, row.orderId, workspaceCode), review = row.merchantReview;
  if (!material || material.subjects.user !== "self" || Boolean(review) !== (row.state === "reviewed")
    || review && (!reference(review.operatorId) || typeof review.reason !== "string" || !review.reason.trim() || review.reason.length > 500 || !utc(review.reviewedAt))) return undefined;
  return { id: row.id, orderId: row.orderId, state: row.state, revision: row.revision, material, reason: row.reason, createdAt: row.createdAt, updatedAt: row.updatedAt, effect: row.effect,
    ...(review ? { merchantReview: { operatorId: review.operatorId, reason: review.reason, reviewedAt: review.reviewedAt } } : {}) };
}
export type EnterpriseRentalHandoffList = EnterpriseRentalHandoffView[];
/** Administrative request eligibility, not a second rental state machine or proof of pickup/payment. */
export const ENTERPRISE_RENTAL_HANDOFF_REQUEST_STATES = ["reserved", "pickup_overdue", "ready_for_pickup", "renting", "return_inspection", "settling"] as const;
export interface EnterpriseRentalHandoffOrder { status: typeof ENTERPRISE_RENTAL_HANDOFF_REQUEST_STATES[number]; material: EnterpriseRentalHandoffMaterial }
export type EnterpriseRentalHandoffOrderSource = { state: "available"; coverage: "current_workspace_original_own_enterprise_employee_orders"; items: EnterpriseRentalHandoffOrder[] }
  | { state: "unavailable"; coverage: "current_workspace_original_own_enterprise_employee_orders" };
/** Missing/malformed/over-limit source is unavailable, never an empty successful index. */
export function enterpriseRentalHandoffOrderSourceSnapshot(value: unknown, workspaceCode: string): EnterpriseRentalHandoffOrderSource | undefined {
  const source = value as EnterpriseRentalHandoffOrderSource | null;
  if (!source || typeof source !== "object" || Array.isArray(source) || source.coverage !== "current_workspace_original_own_enterprise_employee_orders") return undefined;
  if (source.state === "unavailable") return { state: "unavailable", coverage: source.coverage };
  if (source.state !== "available" || !Array.isArray(source.items) || source.items.length > 200) return undefined;
  const ids = new Set<string>(), items: EnterpriseRentalHandoffOrder[] = [];
  for (const row of source.items) {
    if (!row || !ENTERPRISE_RENTAL_HANDOFF_REQUEST_STATES.includes(row.status)) return undefined;
    const material = enterpriseRentalHandoffMaterialSnapshot(row.material, row.material?.orderId, workspaceCode);
    if (!material || material.subjects.user !== "self" || ids.has(material.orderId)) return undefined;
    ids.add(material.orderId); items.push({ status: row.status, material });
  }
  return { state: "available", coverage: source.coverage, items };
}
/** Total is the authorized ORIGINAL ORDER total, deliberately not a request count. */
export interface EnterpriseRentalHandoffMerchantQueue { items: EnterpriseRentalHandoffMerchantView[]; orderPage: { page: number; pageSize: 50; total: number }; coverage: "current_workspace_authorized_original_order_page" }
export function enterpriseRentalHandoffMerchantQueueSnapshot(value: unknown): EnterpriseRentalHandoffMerchantQueue | undefined {
  const source = value as EnterpriseRentalHandoffMerchantQueue | null, page = source?.orderPage;
  if (!source || typeof source !== "object" || Array.isArray(source) || source.coverage !== "current_workspace_authorized_original_order_page" || !page
    || !Number.isSafeInteger(page.page) || page.page < 1 || page.page > 999999 || page.pageSize !== 50 || !Number.isSafeInteger(page.total) || page.total < 0
    || !Array.isArray(source.items) || source.items.length > 200 || page.total === 0 && source.items.length > 0) return undefined;
  const ids = new Set<string>(), items: EnterpriseRentalHandoffMerchantView[] = [];
  for (const row of source.items) {
    const original = enterpriseRentalHandoffSnapshot(row, row?.material?.workspaceCode);
    if (!original || original.state !== "pending" || typeof row.applicantCustomerId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(row.applicantCustomerId) || ids.has(original.id)) return undefined;
    ids.add(original.id); items.push({ ...original, applicantCustomerId: row.applicantCustomerId });
  }
  return { items, orderPage: { page: page.page, pageSize: 50, total: page.total }, coverage: source.coverage };
}
export interface WithdrawEnterpriseRentalHandoffRequest extends EnterpriseChangeRequest { materialKey: string; confirm: true }
export interface EnterpriseRentalHandoffWithdrawn { id: string; orderId: string; state: "withdrawn"; revision: 2; effect: "request_only_no_business_change" }
export interface EnterpriseRentalHandoffMerchantView extends EnterpriseRentalHandoffView { applicantCustomerId: string }
/** A merchant opinion records coordination only, never a Core execution approval. */
export interface ReviewEnterpriseRentalHandoffRequest extends EnterpriseChangeRequest { materialKey: string; confirm: true }
export interface EnterpriseRentalHandoffReviewed { id: string; orderId: string; state: "reviewed"; revision: 2; effect: "request_only_no_business_change" }
export interface EnterpriseTaskItem {
  id: string;
  kind: "corporate_application" | "join_request" | "administrator_transfer" | "booking_approval" | "extension_approval" | "exchange_approval" | "management_request" | "rental_handoff";
  state: string;
  revision: number;
  corporateCustomerId?: string;
  requiresAction: boolean;
  page: "applications" | "join" | "join-requests" | "approvals" | "extension-approvals" | "exchange-approvals" | "profile";
  createdAt?: string;
  expiresAt?: string;
}
export interface EnterpriseTaskCenter {
  items: EnterpriseTaskItem[];
  handoffOrders?: EnterpriseRentalHandoffOrderSource;
  coverage: "own_requests_and_current_workspace_approvals";
  unavailable: Array<"order_alerts" | "financial_alerts" | "external_notifications">;
}
export interface EnterpriseApprovalNotice {
  approvalId: string; kind: "booking_approval" | "extension_approval" | "exchange_approval";
  state: "pending" | "approved" | "rejected" | "withdrawn" | "executing" | "consumed" | "expired" | "closed";
  revision: number; createdAt: string; expiresAt: string; feedback?: string;
  page: "approvals" | "extension-approvals" | "exchange-approvals";
}
export interface EnterpriseApprovalNotices {
  tenantCode: string; customerId: string; workspaceCode: string; corporateCustomerId?: string; permissionRevision?: string;
  coverage: "current_workspace_own_recorded_approval_states" | "current_workspace_nonself_pending_approval_records";
  delivery: "not_reported"; readState: "not_recorded"; items: EnterpriseApprovalNotice[];
}
/** Stored approval states/periods, not execution, delivery or current admission. */
export function enterpriseApprovalNoticesSnapshot(value: unknown, scope: {tenantCode:string;customerId:string;workspaceCode:string;corporateCustomerId?:string;permissionRevision?:string}): EnterpriseApprovalNotices | undefined {
  const row=value as EnterpriseApprovalNotices|null, ref=(v:unknown):v is string=>typeof v === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(v);
  const utc=(v:unknown):v is string=>typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  const review=scope.corporateCustomerId!==undefined,coverage=review ? "current_workspace_nonself_pending_approval_records" : "current_workspace_own_recorded_approval_states";
  if (!row || typeof row!=="object" || Array.isArray(row) || row.tenantCode!==scope.tenantCode || row.customerId!==scope.customerId || row.workspaceCode!==scope.workspaceCode
    || !ref(scope.customerId) || !ref(scope.workspaceCode) || row.coverage!==coverage || row.corporateCustomerId!==scope.corporateCustomerId || row.permissionRevision!==scope.permissionRevision
    || review && (!ref(scope.corporateCustomerId) || typeof scope.permissionRevision!=="string" || !/^\d{1,15}:\d{1,15}$/u.test(scope.permissionRevision))
    || row.delivery!=="not_reported" || row.readState!=="not_recorded" || !Array.isArray(row.items) || row.items.length>200) return undefined;
  const items:EnterpriseApprovalNotice[]=[],keys=new Set<string>();
  for (const r of row.items) {
    const page=r?.kind === "booking_approval" ? "approvals" : r?.kind === "extension_approval" ? "extension-approvals" : r?.kind === "exchange_approval" ? "exchange-approvals" : undefined;
    if (!r || typeof r!=="object" || Array.isArray(r) || !ref(r.approvalId) || !page || r.page!==page || keys.has(`${r.kind}:${r.approvalId}`) || !Number.isSafeInteger(r.revision) || r.revision<1
      || !utc(r.createdAt) || !utc(r.expiresAt) || !["pending","approved","rejected","withdrawn","expired","consumed","closed","executing"].includes(r.state)
      || r.kind === "exchange_approval" && ["consumed","closed","executing"].includes(r.state) || r.kind === "extension_approval" && r.state === "executing"
      || review && (r.state!=="pending" || r.feedback!==undefined) || r.feedback!==undefined && (typeof r.feedback!=="string" || !r.feedback.trim() || r.feedback.length>500)) return undefined;
    keys.add(`${r.kind}:${r.approvalId}`);items.push({approvalId:r.approvalId,kind:r.kind,state:r.state,revision:r.revision,createdAt:r.createdAt,expiresAt:r.expiresAt,page,...(r.feedback!==undefined ? {feedback:r.feedback} : {})});
  }
  return {tenantCode:scope.tenantCode,customerId:scope.customerId,workspaceCode:scope.workspaceCode,coverage,delivery:"not_reported",readState:"not_recorded",items,
    ...(review ? {corporateCustomerId:scope.corporateCustomerId,permissionRevision:scope.permissionRevision} : {})};
}
export interface EnterpriseOwnMessage {
  requestId: string; kind: "corporate_application" | "join_request" | "management_request";
  state: "approved" | "rejected" | "supplement_required"; revision: number; updatedAt: string; feedback?: string;
  page: "applications" | "join" | "profile";
}
export const ENTERPRISE_OWN_MESSAGE_UNAVAILABLE = ["relationship_and_administrator_changes","approval_feedback","order_and_financial_alerts","external_notifications","delivery_and_read_receipts"] as const;
export interface EnterpriseOwnMessages {
  tenantCode: string; customerId: string; coverage: "own_current_persisted_request_feedback";
  delivery: "not_reported"; readState: "not_recorded"; items: EnterpriseOwnMessage[];
  unavailable: Array<typeof ENTERPRISE_OWN_MESSAGE_UNAVAILABLE[number]>;
}
/** Current persisted feedback summaries, not historical delivery events or authority. */
export function enterpriseOwnMessagesSnapshot(value: unknown, tenantCode: string, customerId: string): EnterpriseOwnMessages | undefined {
  const row=value as EnterpriseOwnMessages | null, ref=(v:unknown):v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(v);
  const utc=(v:unknown):v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  if (!row || typeof row!=="object" || Array.isArray(row) || row.tenantCode!==tenantCode || row.customerId!==customerId || !ref(customerId)
    || row.coverage!=="own_current_persisted_request_feedback" || row.delivery!=="not_reported" || row.readState!=="not_recorded" || !Array.isArray(row.items) || row.items.length>200
    || !Array.isArray(row.unavailable) || row.unavailable.length!==ENTERPRISE_OWN_MESSAGE_UNAVAILABLE.length || ENTERPRISE_OWN_MESSAGE_UNAVAILABLE.some(v=>!row.unavailable.includes(v))) return undefined;
  const items:EnterpriseOwnMessage[]=[],ids=new Set<string>();
  for (const r of row.items) {
    if (!r || typeof r!=="object" || Array.isArray(r) || !ref(r.requestId) || ids.has(r.requestId) || !["corporate_application","join_request","management_request"].includes(r.kind)
      || !["approved","rejected","supplement_required"].includes(r.state) || r.kind === "join_request" && r.state === "supplement_required" || !Number.isSafeInteger(r.revision) || r.revision<2 || !utc(r.updatedAt)
      || r.feedback!==undefined && (typeof r.feedback!=="string" || !r.feedback.trim() || r.feedback.length>500)
      || r.page!==(r.kind === "corporate_application" ? "applications" : r.kind === "join_request" ? "join" : "profile")) return undefined;
    ids.add(r.requestId);items.push({requestId:r.requestId,kind:r.kind,state:r.state,revision:r.revision,updatedAt:r.updatedAt,page:r.page,...(r.feedback!==undefined ? {feedback:r.feedback} : {})});
  }
  return {tenantCode,customerId,coverage:"own_current_persisted_request_feedback",delivery:"not_reported",readState:"not_recorded",items,unavailable:[...ENTERPRISE_OWN_MESSAGE_UNAVAILABLE]};
}
export interface EnterpriseOwnApplicationReviewMessages {
  tenantCode:string;customerId:string;coverage:"own_original_application_review_receipts";
  delivery:"not_reported";readState:"not_recorded";
  items:Array<{requestId:string;operationKey:string;state:"approved"|"rejected"|"supplement_required";revision:number;feedback:string;createdAt:string;corporateCustomerId?:string}>;
}
/** Original reviewer receipts addressed by the retained applicant, not current feedback or delivery history. */
export function enterpriseOwnApplicationReviewMessagesSnapshot(value:unknown,tenantCode:string,customerId:string):EnterpriseOwnApplicationReviewMessages|undefined {
  const row=value as EnterpriseOwnApplicationReviewMessages|null,ref=(v:unknown,max=191):v is string=>typeof v==="string" && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`,"u").test(v);
  const utc=(v:unknown):v is string=>typeof v==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  if(!row || typeof row!=="object" || Array.isArray(row) || row.tenantCode!==tenantCode || row.customerId!==customerId || !ref(customerId) || row.coverage!=="own_original_application_review_receipts" || row.delivery!=="not_reported" || row.readState!=="not_recorded" || !Array.isArray(row.items) || row.items.length>200)return undefined;
  const items:EnterpriseOwnApplicationReviewMessages["items"]=[],keys=new Set<string>();
  for(const r of row.items){if(!r || typeof r!=="object" || Array.isArray(r) || !ref(r.requestId) || !ref(r.operationKey,128) || keys.has(r.operationKey) || !["approved","rejected","supplement_required"].includes(r.state) || !Number.isSafeInteger(r.revision) || r.revision<2 || typeof r.feedback!=="string" || !r.feedback.trim() || r.feedback.length>500 || !utc(r.createdAt) || (r.state==="approved" ? !ref(r.corporateCustomerId) : r.corporateCustomerId!==undefined && !ref(r.corporateCustomerId)))return undefined;
    keys.add(r.operationKey);items.push({requestId:r.requestId,operationKey:r.operationKey,state:r.state,revision:r.revision,feedback:r.feedback,createdAt:r.createdAt,...(r.corporateCustomerId!==undefined?{corporateCustomerId:r.corporateCustomerId}:{})});}
  return {tenantCode,customerId,coverage:"own_original_application_review_receipts",delivery:"not_reported",readState:"not_recorded",items};
}
export interface EnterpriseOwnJoinReviewMessages {
  tenantCode:string;customerId:string;coverage:"own_original_join_review_receipts";
  delivery:"not_reported";readState:"not_recorded";
  items:Array<{requestId:string;corporateCustomerId:string;operationKey:string;state:"approved"|"rejected";revision:number;reason:string;createdAt:string}>;
}
/** Applicant-addressed original join-review outcomes, not current membership or a decision-reason reconstruction. */
export function enterpriseOwnJoinReviewMessagesSnapshot(value:unknown,tenantCode:string,customerId:string):EnterpriseOwnJoinReviewMessages|undefined {
  const row=value as EnterpriseOwnJoinReviewMessages|null,ref=(v:unknown,max=191):v is string=>typeof v==="string" && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`,"u").test(v);
  const utc=(v:unknown):v is string=>typeof v==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  if(!row || typeof row!=="object" || Array.isArray(row) || row.tenantCode!==tenantCode || row.customerId!==customerId || !ref(customerId) || row.coverage!=="own_original_join_review_receipts" || row.delivery!=="not_reported" || row.readState!=="not_recorded" || !Array.isArray(row.items) || row.items.length>200)return undefined;
  const items:EnterpriseOwnJoinReviewMessages["items"]=[],keys=new Set<string>();
  for(const r of row.items){if(!r || typeof r!=="object" || Array.isArray(r) || !ref(r.requestId) || !ref(r.corporateCustomerId) || !ref(r.operationKey,128) || keys.has(r.operationKey) || !["approved","rejected"].includes(r.state) || !Number.isSafeInteger(r.revision) || r.revision<2 || typeof r.reason!=="string" || !r.reason.trim() || r.reason.length>500 || !utc(r.createdAt))return undefined;
    keys.add(r.operationKey);items.push({requestId:r.requestId,corporateCustomerId:r.corporateCustomerId,operationKey:r.operationKey,state:r.state,revision:r.revision,reason:r.reason,createdAt:r.createdAt});}
  return {tenantCode,customerId,coverage:"own_original_join_review_receipts",delivery:"not_reported",readState:"not_recorded",items};
}
export const ENTERPRISE_MANAGEMENT_REQUEST_TYPES = ["profile_change","credit_change","scope_change","payment_proof"] as const;
export const ENTERPRISE_PAYMENT_PROOF_SCENE = "enterprise-payment-proof";
export interface EnterpriseOwnManagementReviewMessages {
  tenantCode:string;customerId:string;coverage:"own_original_management_review_only_receipts";
  delivery:"not_reported";readState:"not_recorded";
  items:Array<{requestId:string;corporateCustomerId:string;requestType:EnterpriseManagementRequestType;operationKey:string;state:"approved"|"rejected"|"supplement_required";revision:number;reason:string;createdAt:string;effect:"review_only_no_business_change"}>;
}
/** Immutable retained request type and original review-only result, not current business facts. */
export function enterpriseOwnManagementReviewMessagesSnapshot(value:unknown,tenantCode:string,customerId:string):EnterpriseOwnManagementReviewMessages|undefined {
  const row=value as EnterpriseOwnManagementReviewMessages|null,ref=(v:unknown,max=191):v is string=>typeof v==="string" && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`,"u").test(v);
  const utc=(v:unknown):v is string=>typeof v==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  if(!row || typeof row!=="object" || Array.isArray(row) || row.tenantCode!==tenantCode || row.customerId!==customerId || !ref(customerId) || row.coverage!=="own_original_management_review_only_receipts" || row.delivery!=="not_reported" || row.readState!=="not_recorded" || !Array.isArray(row.items) || row.items.length>200)return undefined;
  const items:EnterpriseOwnManagementReviewMessages["items"]=[],keys=new Set<string>();
  for(const r of row.items){if(!r || typeof r!=="object" || Array.isArray(r) || !ref(r.requestId) || !ref(r.corporateCustomerId) || !ENTERPRISE_MANAGEMENT_REQUEST_TYPES.includes(r.requestType) || !ref(r.operationKey,128) || keys.has(r.operationKey) || !["approved","rejected","supplement_required"].includes(r.state) || !Number.isSafeInteger(r.revision) || r.revision<2 || typeof r.reason!=="string" || !r.reason.trim() || r.reason.length>500 || !utc(r.createdAt) || r.effect!=="review_only_no_business_change")return undefined;
    keys.add(r.operationKey);items.push({requestId:r.requestId,corporateCustomerId:r.corporateCustomerId,requestType:r.requestType,operationKey:r.operationKey,state:r.state,revision:r.revision,reason:r.reason,createdAt:r.createdAt,effect:r.effect});}
  return {tenantCode,customerId,coverage:"own_original_management_review_only_receipts",delivery:"not_reported",readState:"not_recorded",items};
}
export interface EnterpriseListResponse<T> { items: T[]; page: number; pageSize: number; total: number }
export interface EnterpriseMembershipAuditEntry {
  operationKey: string; membershipId: string; actorCustomerId: string;
  action: "member.change" | "member.exit" | "administrator.change"; reason: string; createdAt: string;
  result: { membershipId: string; updatedAt: string; status?: "active" | "suspended" | "exited"; role?: "admin" | "employee"; actions?: EnterprisePortalAction[]; revision?: number };
}
export interface EnterpriseInviteTransferAuditEntry {
  operationKey: string; objectId: string; objectType: "invite" | "administrator_transfer"; actorCustomerId: string;
  action: "invite.create" | "invite.revoke" | "administrator.transfer" | "administrator.accept" | "administrator.decision.sealed" | "administrator.decision.close";
  reason: string; createdAt: string;
  result: { id: string; revision: number; status?: "active" | "revoked"; state?: "pending" | "approved" | "rejected";
    expiresAt?: string; maxUses?: number; used?: 0; createdAt?: string; codeRetrievableAgain?: false; outcome?: "closed" | "observed" };
}
/** Curated original invite/transfer facts, never raw codes, K/C authority or current state. */
export function enterpriseInviteTransferAuditEntrySnapshot(value: unknown): EnterpriseInviteTransferAuditEntry | undefined {
  const row = value as EnterpriseInviteTransferAuditEntry | null;
  const ref = (v: unknown,max=191): v is string => typeof v === "string" && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`,"u").test(v);
  const utc = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  if (!row || typeof row !== "object" || Array.isArray(row) || !ref(row.operationKey,128) || !ref(row.objectId) || !ref(row.actorCustomerId)
    || typeof row.reason !== "string" || !row.reason.trim() || row.reason.length>500 || !utc(row.createdAt) || !row.result || typeof row.result !== "object" || Array.isArray(row.result)
    || row.result.id!==row.objectId || !Number.isSafeInteger(row.result.revision) || row.result.revision<1 || "code" in row.result || "tokenHash" in row.result) return undefined;
  const r=row.result; let result: EnterpriseInviteTransferAuditEntry["result"];
  if (row.objectType === "invite") {
    if (row.action === "invite.create") {
      if(r.status!=="active" || r.revision!==1 || r.used!==0 || r.codeRetrievableAgain!==false || !utc(r.createdAt) || !utc(r.expiresAt) || Date.parse(r.expiresAt)<=Date.parse(r.createdAt) || !Number.isSafeInteger(r.maxUses) || r.maxUses!<1) return undefined;
      result={id:row.objectId,status:"active",revision:1,used:0,maxUses:r.maxUses,createdAt:r.createdAt,expiresAt:r.expiresAt,codeRetrievableAgain:false};
    } else if(row.action === "invite.revoke" && r.status === "revoked" && r.revision>=2) result={id:row.objectId,status:"revoked",revision:r.revision};
    else return undefined;
  } else if(row.objectType === "administrator_transfer") {
    if(row.action === "administrator.transfer" && r.state === "pending" && r.revision === 1) result={id:row.objectId,state:"pending",revision:1};
    else if(row.action === "administrator.accept" && ["approved","rejected"].includes(r.state ?? "") && r.revision>=2) result={id:row.objectId,state:r.state,revision:r.revision};
    else if(["administrator.decision.close","administrator.decision.sealed"].includes(row.action) && ["closed","observed"].includes(r.outcome ?? "") && ["approved","rejected"].includes(r.state ?? "") && r.revision>=2
      && (r.outcome!=="closed" || r.state === "rejected") && (row.action!=="administrator.decision.sealed" || r.outcome === "closed")) result={id:row.objectId,state:r.state,revision:r.revision,outcome:r.outcome};
    else return undefined;
  } else return undefined;
  return {operationKey:row.operationKey,objectId:row.objectId,objectType:row.objectType,actorCustomerId:row.actorCustomerId,action:row.action,reason:row.reason,createdAt:row.createdAt,result};
}
export interface EnterpriseBusinessAuditEntry {
  operationKey: string; objectId: string; objectType: "booking_approval" | "management_request";
  actor: { kind: "customer" | "operator"; id: string };
  action: "approval.request" | "approval.decision" | "approval.submit" | "approval.close" | "management-request.save" | "management-request.withdraw" | "management-request.review";
  reason: string; createdAt: string;
  result: { id: string; state: string; revision?: number; effect?: "review_only_no_business_change";
    execution?: "not_submitted"; inventory?: "not_reserved"; expiresAt?: string; retryable?: false };
}
/** Minimal original review/approval receipt; no money, quote/order, material or recovery keys. */
export function enterpriseBusinessAuditEntrySnapshot(value: unknown): EnterpriseBusinessAuditEntry | undefined {
  const row = value as EnterpriseBusinessAuditEntry | null;
  const ref = (v: unknown,max=191): v is string => typeof v === "string" && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`,"u").test(v);
  const utc = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  if (!row || typeof row !== "object" || Array.isArray(row) || !ref(row.operationKey,128) || !ref(row.objectId) || !row.actor || !ref(row.actor.id)
    || !["customer","operator"].includes(row.actor.kind) || typeof row.reason !== "string" || !row.reason.trim() || row.reason.length>500 || !utc(row.createdAt)
    || !row.result || typeof row.result !== "object" || Array.isArray(row.result) || row.result.id!==row.objectId) return undefined;
  const r=row.result, revision=(minimum:number) => Number.isSafeInteger(r.revision) && r.revision!>=minimum;
  let result: EnterpriseBusinessAuditEntry["result"];
  if (row.objectType === "booking_approval" && row.actor.kind === "customer") {
    if (row.action === "approval.request" && r.state === "pending" && r.revision === 1 && utc(r.expiresAt) && r.execution === "not_submitted" && r.inventory === "not_reserved")
      result={id:row.objectId,state:"pending",revision:1,expiresAt:r.expiresAt,execution:"not_submitted",inventory:"not_reserved"};
    else if (row.action === "approval.decision" && ["approved","rejected","withdrawn"].includes(r.state) && revision(2) && r.execution === "not_submitted")
      result={id:row.objectId,state:r.state,revision:r.revision,execution:"not_submitted"};
    else if (row.action === "approval.submit" && ["executing","closed"].includes(r.state) && r.retryable === false && r.revision === undefined)
      result={id:row.objectId,state:r.state,retryable:false};
    else if (row.action === "approval.close" && r.retryable === false && (r.state === "closed" && revision(2) || r.state === "consumed" && r.revision === undefined))
      result={id:row.objectId,state:r.state,...(r.state === "closed" ? {revision:r.revision} : {}),retryable:false};
    else return undefined;
  } else if (row.objectType === "management_request") {
    if (row.action === "management-request.save" && row.actor.kind === "customer" && ["draft","pending"].includes(r.state) && revision(1) && r.effect === "review_only_no_business_change")
      result={id:row.objectId,state:r.state,revision:r.revision,effect:"review_only_no_business_change"};
    else if (row.action === "management-request.withdraw" && row.actor.kind === "customer" && r.state === "withdrawn" && revision(2))
      result={id:row.objectId,state:"withdrawn",revision:r.revision};
    else if (row.action === "management-request.review" && row.actor.kind === "operator" && ["approved","rejected","supplement_required"].includes(r.state) && revision(2) && r.effect === "review_only_no_business_change")
      result={id:row.objectId,state:r.state,revision:r.revision,effect:"review_only_no_business_change"};
    else return undefined;
  } else return undefined;
  return {operationKey:row.operationKey,objectId:row.objectId,objectType:row.objectType,actor:{kind:row.actor.kind,id:row.actor.id},action:row.action,reason:row.reason,createdAt:row.createdAt,result};
}
export interface EnterpriseExpenseAuditEntry {
  operationKey: string; objectId: string; objectType: "extension_approval" | "exchange_approval"; actorCustomerId: string;
  action: "extension.request" | "extension.decision" | "extension.submit" | "extension.close" | "extension.sealed" | "extension.request.close" | "exchange.request" | "exchange.decision" | "exchange.expense.confirm" | "exchange.request.close";
  reason: string; createdAt: string;
  result: { id: string; state?: "pending" | "approved" | "rejected" | "withdrawn" | "consumed" | "closed" | "observed";
    revision?: number; expiresAt?: string; retryable?: false; confirmedAt?: string; scope?: "expense_only_not_inspection_or_execution" };
}
/** Associated original expense receipts only; no order, preview, money or K/C bindings. */
export function enterpriseExpenseAuditEntrySnapshot(value: unknown): EnterpriseExpenseAuditEntry | undefined {
  const row=value as EnterpriseExpenseAuditEntry | null;
  const ref=(v:unknown,max=191):v is string => typeof v === "string" && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`,"u").test(v);
  const utc=(v:unknown):v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  if (!row || typeof row!=="object" || Array.isArray(row) || !ref(row.operationKey,128) || !ref(row.objectId) || !ref(row.actorCustomerId) || !utc(row.createdAt)
    || typeof row.reason!=="string" || !row.reason.trim() || row.reason.length>500 || !row.result || typeof row.result!=="object" || Array.isArray(row.result) || row.result.id!==row.objectId) return undefined;
  const prefix=row.objectType === "extension_approval" ? "extension" : row.objectType === "exchange_approval" ? "exchange" : undefined;
  if (!prefix) return undefined;
  const r=row.result; let result:EnterpriseExpenseAuditEntry["result"];
  if (row.action===`${prefix}.request` && r.state === "pending" && r.revision === 1 && utc(r.expiresAt)) result={id:row.objectId,state:"pending",revision:1,expiresAt:r.expiresAt};
  else if (row.action===`${prefix}.decision` && ["approved","rejected","withdrawn"].includes(r.state ?? "") && Number.isSafeInteger(r.revision) && r.revision!>=2) result={id:row.objectId,state:r.state,revision:r.revision};
  else if (row.action===`${prefix}.request.close` && r.state === "observed" && r.retryable === false && r.revision === undefined) result={id:row.objectId,state:"observed",retryable:false};
  else if (prefix === "extension" && (row.action === "extension.submit" && r.state === "consumed" || row.action === "extension.close" && ["consumed","closed"].includes(r.state ?? "") || row.action === "extension.sealed" && r.state === "closed") && r.retryable === false && r.revision === undefined) result={id:row.objectId,state:r.state,retryable:false};
  else if (prefix === "exchange" && row.action === "exchange.expense.confirm" && r.state === undefined && Number.isSafeInteger(r.revision) && r.revision!>=3 && utc(r.confirmedAt) && r.scope === "expense_only_not_inspection_or_execution") result={id:row.objectId,revision:r.revision,confirmedAt:r.confirmedAt,scope:"expense_only_not_inspection_or_execution"};
  else return undefined;
  return {operationKey:row.operationKey,objectId:row.objectId,objectType:row.objectType,actorCustomerId:row.actorCustomerId,action:row.action,reason:row.reason,createdAt:row.createdAt,result};
}
export interface EnterpriseJoinAuditEntry {
  operationKey:string;objectId:string;actorCustomerId:string;action:"join.submit"|"join.withdraw"|"join.review";reason:string;createdAt:string;
  result:{id:string;state:"pending"|"approved"|"rejected"|"withdrawn";revision:number};
}
/** Only original associated join-request outcomes, never invitation material or today's relation. */
export function enterpriseJoinAuditEntrySnapshot(value:unknown):EnterpriseJoinAuditEntry|undefined {
  const r=value as EnterpriseJoinAuditEntry|null,ref=(v:unknown,max=191):v is string=>typeof v==="string" && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`,"u").test(v);
  const utc=(v:unknown):v is string=>typeof v==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  if(!r || typeof r!=="object" || Array.isArray(r) || !ref(r.operationKey,128) || !ref(r.objectId) || !ref(r.actorCustomerId) || typeof r.reason!=="string" || !r.reason.trim() || r.reason.length>500 || !utc(r.createdAt)
    || !r.result || typeof r.result!=="object" || Array.isArray(r.result) || r.result.id!==r.objectId || !Number.isSafeInteger(r.result.revision))return undefined;
  if(r.action==="join.submit" ? r.result.state!=="pending" || r.result.revision<1 : r.action==="join.withdraw" ? r.result.state!=="withdrawn" || r.result.revision<2 : r.action==="join.review" ? !["approved","rejected"].includes(r.result.state) || r.result.revision<2 : true)return undefined;
  return {operationKey:r.operationKey,objectId:r.objectId,actorCustomerId:r.actorCustomerId,action:r.action,reason:r.reason,createdAt:r.createdAt,result:{id:r.objectId,state:r.result.state,revision:r.result.revision}};
}
export interface EnterprisePolicyAuditEntry {
  operationKey:string;actorCustomerId:string;action:"policy.company";scopeKey:string;reason:string;createdAt:string;
  result:{scopeKey:string;revision:number;membershipUpdatedAt?:string};
}
/** Original policy-command metadata only; no policy body, limits or current grant. */
export function enterprisePolicyAuditEntrySnapshot(value:unknown):EnterprisePolicyAuditEntry|undefined {
  const r=value as EnterprisePolicyAuditEntry|null,ref=(v:unknown,max=191):v is string=>typeof v==="string" && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`,"u").test(v);
  const utc=(v:unknown):v is string=>typeof v==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  if(!r || typeof r!=="object" || Array.isArray(r) || !ref(r.operationKey,128) || !ref(r.actorCustomerId) || r.action!=="policy.company" || typeof r.scopeKey!=="string" || !(r.scopeKey==="company" || r.scopeKey.startsWith("member:")&&ref(r.scopeKey.slice(7)))
    || typeof r.reason!=="string" || !r.reason.trim() || r.reason.length>500 || !utc(r.createdAt) || !r.result || typeof r.result!=="object" || Array.isArray(r.result) || r.result.scopeKey!==r.scopeKey || !Number.isSafeInteger(r.result.revision) || r.result.revision<1
    || (r.scopeKey==="company" ? r.result.membershipUpdatedAt!==undefined : !utc(r.result.membershipUpdatedAt)))return undefined;
  return {operationKey:r.operationKey,actorCustomerId:r.actorCustomerId,action:"policy.company",scopeKey:r.scopeKey,reason:r.reason,createdAt:r.createdAt,result:{scopeKey:r.scopeKey,revision:r.result.revision,...(r.scopeKey!=="company"?{membershipUpdatedAt:r.result.membershipUpdatedAt}:{})}};
}
export interface EnterpriseApplicationApprovalAuditEntry {
  operationKey:string;objectId:string;actor:{kind:"operator";id:string};action:"application.review";reason:string;createdAt:string;
  result:{id:string;state:"approved";revision:number;corporateCustomerId:string};
}
/** Original approved application/company binding only, not private material or current authority. */
export function enterpriseApplicationApprovalAuditEntrySnapshot(value:unknown,corporateCustomerId:string):EnterpriseApplicationApprovalAuditEntry|undefined {
  const r=value as EnterpriseApplicationApprovalAuditEntry|null,ref=(v:unknown,max=191):v is string=>typeof v==="string" && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`,"u").test(v);
  const utc=(v:unknown):v is string=>typeof v==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  if(!r || typeof r!=="object" || Array.isArray(r) || !ref(corporateCustomerId) || !ref(r.operationKey,128) || !ref(r.objectId) || !r.actor || r.actor.kind!=="operator" || !ref(r.actor.id) || r.action!=="application.review" || typeof r.reason!=="string" || !r.reason.trim() || r.reason.length>500 || !utc(r.createdAt)
    || !r.result || typeof r.result!=="object" || Array.isArray(r.result) || r.result.id!==r.objectId || r.result.state!=="approved" || !Number.isSafeInteger(r.result.revision) || r.result.revision<2 || r.result.corporateCustomerId!==corporateCustomerId)return undefined;
  return {operationKey:r.operationKey,objectId:r.objectId,actor:{kind:"operator",id:r.actor.id},action:"application.review",reason:r.reason,createdAt:r.createdAt,result:{id:r.objectId,state:"approved",revision:r.result.revision,corporateCustomerId}};
}
export interface EnterpriseMerchantPolicyAuditEntry {
  operationKey:string;actor:{kind:"operator";id:string};action:"policy.merchant";scopeKey:"merchant";reason:string;createdAt:string;
  result:{scopeKey:"merchant";revision:number};
}
/** Published merchant-policy save metadata only, not internal logs or current rental authority. */
export function enterpriseMerchantPolicyAuditEntrySnapshot(value:unknown):EnterpriseMerchantPolicyAuditEntry|undefined {
  const r=value as EnterpriseMerchantPolicyAuditEntry|null,ref=(v:unknown,max=191):v is string=>typeof v==="string" && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`,"u").test(v);
  const utc=(v:unknown):v is string=>typeof v==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  if(!r || typeof r!=="object" || Array.isArray(r) || !ref(r.operationKey,128) || !r.actor || typeof r.actor!=="object" || Array.isArray(r.actor) || r.actor.kind!=="operator" || !ref(r.actor.id) || r.action!=="policy.merchant" || r.scopeKey!=="merchant" || typeof r.reason!=="string" || !r.reason.trim() || r.reason.length>500 || !utc(r.createdAt)
    || !r.result || typeof r.result!=="object" || Array.isArray(r.result) || r.result.scopeKey!=="merchant" || !Number.isSafeInteger(r.result.revision) || r.result.revision<1)return undefined;
  return {operationKey:r.operationKey,actor:{kind:"operator",id:r.actor.id},action:"policy.merchant",scopeKey:"merchant",reason:r.reason,createdAt:r.createdAt,result:{scopeKey:"merchant",revision:r.result.revision}};
}
export interface EnterpriseMerchantPortalAuditEntry {
  operationKey:string;actor:{kind:"operator";id:string};action:"portal.configuration";reason:string;createdAt:string;
  result:{corporateCustomerId:string;enabled:boolean;revision:number};
}
/** Original bare-actor/company-target portal receipt metadata only. The reserved
 * tenant target is ambiguous; grants and today's activation are never reconstructed. */
export function enterpriseMerchantPortalAuditEntrySnapshot(value:unknown,corporateCustomerId:string):EnterpriseMerchantPortalAuditEntry|undefined {
  const r=value as EnterpriseMerchantPortalAuditEntry|null,ref=(v:unknown,max=191):v is string=>typeof v==="string" && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`,"u").test(v);
  const utc=(v:unknown):v is string=>typeof v==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  if(!r || typeof r!=="object" || Array.isArray(r) || !ref(corporateCustomerId) || corporateCustomerId==="tenant" || !ref(r.operationKey,128) || !r.actor || typeof r.actor!=="object" || Array.isArray(r.actor) || r.actor.kind!=="operator" || !ref(r.actor.id) || r.action!=="portal.configuration" || typeof r.reason!=="string" || !r.reason.trim() || r.reason.length>500 || !utc(r.createdAt)
    || !r.result || typeof r.result!=="object" || Array.isArray(r.result) || r.result.corporateCustomerId!==corporateCustomerId || typeof r.result.enabled!=="boolean" || !Number.isSafeInteger(r.result.revision) || r.result.revision<1)return undefined;
  return {operationKey:r.operationKey,actor:{kind:"operator",id:r.actor.id},action:"portal.configuration",reason:r.reason,createdAt:r.createdAt,result:{corporateCustomerId,enabled:r.result.enabled,revision:r.result.revision}};
}
export const ENTERPRISE_READER_AUDIT_ACTIONS = [
  "orders.list", "orders.detail", "orders.export", "finance.account.read",
  "finance.account.export", "finance.order.read", "finance.order.export"
] as const;
export type EnterpriseReaderAuditAction = typeof ENTERPRISE_READER_AUDIT_ACTIONS[number];
export interface EnterpriseReaderAuditEntry {
  receiptId: string;
  actorCustomerId: string;
  membershipId: string;
  permissionRevision: string;
  action: EnterpriseReaderAuditAction;
  objectId: string;
  group: "enterprise_paid" | "personal_benefit" | null;
  projectionHash: string;
  itemCount: number;
  state: "authorized_projection_prepared";
  createdAt: string;
}
export interface EnterpriseReaderAuditPage {
  coverage: "original_current_workspace_reader_projections";
  workspaceCode: string;
  items: EnterpriseReaderAuditEntry[];
  nextCursor: string | null;
  unavailable: ["uncaptured_reader_history"];
}

/** Metadata identifies the authorized projection prepared before response delivery. */
export function enterpriseReaderAuditEntrySnapshot(value: unknown): EnterpriseReaderAuditEntry | undefined {
  const row = value as EnterpriseReaderAuditEntry | null;
  const reference = (candidate: unknown): candidate is string => typeof candidate === "string" && /^[a-zA-Z0-9._:-]{1,191}$/u.test(candidate);
  if (!row || typeof row !== "object" || Array.isArray(row)
    || !reference(row.receiptId) || !reference(row.actorCustomerId) || !reference(row.membershipId) || !reference(row.objectId)
    || typeof row.permissionRevision !== "string" || !/^\d{1,15}:\d{1,15}$/u.test(row.permissionRevision)
    || !ENTERPRISE_READER_AUDIT_ACTIONS.includes(row.action)
    || (row.action.startsWith("orders.") ? !["enterprise_paid", "personal_benefit"].includes(row.group ?? "") : row.group !== null)
    || typeof row.projectionHash !== "string" || !/^[a-f0-9]{64}$/u.test(row.projectionHash)
    || !Number.isSafeInteger(row.itemCount) || row.itemCount < 0 || row.itemCount > 500
    || !["orders.list", "orders.export"].includes(row.action) && row.itemCount !== 1
    || row.state !== "authorized_projection_prepared" || typeof row.createdAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(row.createdAt)
    || !Number.isFinite(Date.parse(row.createdAt)) || new Date(row.createdAt).toISOString() !== row.createdAt) return undefined;
  return {
    receiptId: row.receiptId, actorCustomerId: row.actorCustomerId, membershipId: row.membershipId,
    permissionRevision: row.permissionRevision, action: row.action, objectId: row.objectId, group: row.group,
    projectionHash: row.projectionHash, itemCount: row.itemCount, state: row.state, createdAt: row.createdAt
  };
}

export function enterpriseReaderAuditPageSnapshot(value: unknown, workspaceCode?: string): EnterpriseReaderAuditPage | undefined {
  const page = value as EnterpriseReaderAuditPage | null;
  if (!page || typeof page !== "object" || Array.isArray(page)
    || page.coverage !== "original_current_workspace_reader_projections" || typeof page.workspaceCode !== "string"
    || !/^[a-zA-Z0-9._:-]{1,191}$/u.test(page.workspaceCode) || page.workspaceCode !== workspaceCode
    || !Array.isArray(page.items) || page.items.length > 50
    || page.nextCursor !== null && (typeof page.nextCursor !== "string" || !/^[a-zA-Z0-9_-]{1,512}$/u.test(page.nextCursor) || page.items.length !== 50)
    || !Array.isArray(page.unavailable) || page.unavailable.length !== 1 || page.unavailable[0] !== "uncaptured_reader_history") return undefined;
  const items: EnterpriseReaderAuditEntry[] = [], receipts = new Set<string>();
  for (const candidate of page.items) {
    const item = enterpriseReaderAuditEntrySnapshot(candidate);
    if (!item || receipts.has(item.receiptId)) return undefined;
    receipts.add(item.receiptId);
    items.push(item);
  }
  return { coverage: page.coverage, workspaceCode: page.workspaceCode, items, nextCursor: page.nextCursor, unavailable: ["uncaptured_reader_history"] };
}

export interface EnterpriseMembershipAudit {
  readerAudit?: EnterpriseReaderAuditPage;
  merchantPortalCoverage?:"original_bare_actor_corporate_portal_configuration_metadata";
  merchantPortalItems?:EnterpriseMerchantPortalAuditEntry[];
  merchantPolicyCoverage?:"original_merchant_policy_save_metadata";
  merchantPolicyItems?:EnterpriseMerchantPolicyAuditEntry[];
  applicationApprovalCoverage?:"original_application_approval_company_binding_receipts";
  applicationApprovalItems?:EnterpriseApplicationApprovalAuditEntry[];
  policyCoverage?:"original_customer_company_and_member_policy_commands";
  policyItems?:EnterprisePolicyAuditEntry[];
  joiningCoverage?:"original_corporate_associated_join_request_commands";
  joiningItems?:EnterpriseJoinAuditEntry[];
  expenseCoverage?: "original_current_workspace_associated_expense_approval_commands";
  expenseItems?: EnterpriseExpenseAuditEntry[];
  businessCoverage?: "original_management_and_current_workspace_booking_commands";
  bookingWorkspace?: { state: "available"; code: string } | { state: "unavailable" };
  businessItems?: EnterpriseBusinessAuditEntry[];
  workflowCoverage?: "original_invite_and_administrator_transfer_commands";
  workflowItems?: EnterpriseInviteTransferAuditEntry[];
  tenantCode: string; corporateCustomerId: string; permissionRevision: string;
  coverage: "original_member_and_administrator_commands";
  unavailable: Array<"invites_and_transfers" | "approvals" | "profile_requests" | "remaining_approval_audit" | "order_and_financial_audit">;
  items: EnterpriseMembershipAuditEntry[];
}
/** Original results only; current relation state/grants and private input are never projected. */
export function enterpriseMembershipAuditEntrySnapshot(value: unknown): EnterpriseMembershipAuditEntry | undefined {
  const row = value as EnterpriseMembershipAuditEntry | null;
  const ref = (v: unknown, max = 191): v is string => typeof v === "string" && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`, "u").test(v);
  const utc = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  if (!row || typeof row !== "object" || Array.isArray(row) || !ref(row.operationKey,128) || !ref(row.membershipId) || !ref(row.actorCustomerId)
    || !["member.change","member.exit","administrator.change"].includes(row.action) || !utc(row.createdAt) || typeof row.reason !== "string" || !row.reason.trim() || row.reason.length > 500
    || !row.result || typeof row.result !== "object" || Array.isArray(row.result) || row.result.membershipId !== row.membershipId || !utc(row.result.updatedAt)) return undefined;
  const result = row.result;
  let original: EnterpriseMembershipAuditEntry["result"];
  if (row.action === "administrator.change") {
    if (!["admin","employee"].includes(result.role ?? "") || !Array.isArray(result.actions) || result.actions.length > ENTERPRISE_PORTAL_ACTIONS.length || new Set(result.actions).size !== result.actions.length
      || result.actions.some(action => !ENTERPRISE_PORTAL_ACTIONS.includes(action)) || result.role === "employee" && result.actions.length > 0 || result.actions.length > 0 && !result.actions.includes("portal:enter")
      || !Number.isSafeInteger(result.revision) || result.revision! < 1 || result.status !== undefined) return undefined;
    original = { membershipId: row.membershipId, role: result.role, actions: [...result.actions], updatedAt: result.updatedAt, revision: result.revision };
  } else {
    if (!["active","suspended","exited"].includes(result.status ?? "") || row.action === "member.exit" && result.status !== "exited" || result.role !== undefined || result.actions !== undefined || result.revision !== undefined) return undefined;
    original = { membershipId: row.membershipId, status: result.status, updatedAt: result.updatedAt };
  }
  return { operationKey: row.operationKey, membershipId: row.membershipId, actorCustomerId: row.actorCustomerId, action: row.action, reason: row.reason, createdAt: row.createdAt, result: original };
}
export interface EnterpriseOwnRelationshipMessages {
  tenantCode: string; customerId: string; coverage: "own_original_member_administrator_command_receipts";
  delivery: "not_reported"; readState: "not_recorded";
  items: Array<{ corporateCustomerId: string; receipt: EnterpriseMembershipAuditEntry }>;
}
/** Recipient-bound original results, not current grants or a command recovery interface. */
export function enterpriseOwnRelationshipMessagesSnapshot(value: unknown, tenantCode: string, customerId: string): EnterpriseOwnRelationshipMessages | undefined {
  const row=value as EnterpriseOwnRelationshipMessages|null,ref=(v:unknown):v is string=>typeof v === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(v);
  if (!row || typeof row!=="object" || Array.isArray(row) || row.tenantCode!==tenantCode || row.customerId!==customerId || !ref(customerId)
    || row.coverage!=="own_original_member_administrator_command_receipts" || row.delivery!=="not_reported" || row.readState!=="not_recorded" || !Array.isArray(row.items) || row.items.length>200) return undefined;
  const items:EnterpriseOwnRelationshipMessages["items"]=[],keys=new Set<string>();
  for(const r of row.items){if(!r || typeof r!=="object" || Array.isArray(r) || !ref(r.corporateCustomerId))return undefined;const receipt=enterpriseMembershipAuditEntrySnapshot(r.receipt);
    if(!receipt || keys.has(receipt.operationKey) || receipt.action === "member.exit" && receipt.actorCustomerId!==customerId)return undefined;keys.add(receipt.operationKey);items.push({corporateCustomerId:r.corporateCustomerId,receipt});}
  return {tenantCode,customerId,coverage:"own_original_member_administrator_command_receipts",delivery:"not_reported",readState:"not_recorded",items};
}
export interface EnterpriseOwnRetainedMergeMessages {
  tenantCode: string; customerId: string; coverage: "own_original_retained_master_merge_records";
  delivery: "not_reported"; readState: "not_recorded";
  items: Array<{id:string;mergedAt:string;effect:"retained_master_record_only"}>;
}
/** Original retained-master records, not merged-person details or inherited authority. */
export function enterpriseOwnRetainedMergeMessagesSnapshot(value: unknown, tenantCode: string, customerId: string): EnterpriseOwnRetainedMergeMessages | undefined {
  const row=value as EnterpriseOwnRetainedMergeMessages|null,ref=(v:unknown):v is string=>typeof v==="string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(v);
  const utc=(v:unknown):v is string=>typeof v==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  if(!row || typeof row!=="object" || Array.isArray(row) || row.tenantCode!==tenantCode || row.customerId!==customerId || !ref(customerId)
    || row.coverage!=="own_original_retained_master_merge_records" || row.delivery!=="not_reported" || row.readState!=="not_recorded" || !Array.isArray(row.items) || row.items.length>200)return undefined;
  const items:EnterpriseOwnRetainedMergeMessages["items"]=[],ids=new Set<string>();
  for(const r of row.items){if(!r || typeof r!=="object" || Array.isArray(r) || !ref(r.id) || ids.has(r.id) || !utc(r.mergedAt) || r.effect!=="retained_master_record_only")return undefined;ids.add(r.id);items.push({id:r.id,mergedAt:r.mergedAt,effect:"retained_master_record_only"});}
  return {tenantCode,customerId,coverage:"own_original_retained_master_merge_records",delivery:"not_reported",readState:"not_recorded",items};
}
export const ENTERPRISE_EMPLOYEE_POLICY_MESSAGE_UNAVAILABLE = ["company_and_merchant_policy_recipient_history","unassociated_employee_policy_history"] as const;
export interface EnterpriseOwnEmployeePolicyMessages {
  tenantCode:string;customerId:string;coverage:"own_original_retained_employee_policy_save_receipts";
  delivery:"not_reported";readState:"not_recorded";
  unavailable:Array<typeof ENTERPRISE_EMPLOYEE_POLICY_MESSAGE_UNAVAILABLE[number]>;
  items:Array<{corporateCustomerId:string;membershipId:string;operationKey:string;revision:number;membershipUpdatedAt:string;createdAt:string;effect:"original_employee_policy_save_only"}>;
}
/** Original save metadata addressed by the retained relation, never current policy or payment authority. */
export function enterpriseOwnEmployeePolicyMessagesSnapshot(value:unknown,tenantCode:string,customerId:string):EnterpriseOwnEmployeePolicyMessages|undefined {
  const row=value as EnterpriseOwnEmployeePolicyMessages|null,ref=(v:unknown,max=191):v is string=>typeof v==="string" && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`,"u").test(v);
  const utc=(v:unknown):v is string=>typeof v==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  if(!row || typeof row!=="object" || Array.isArray(row) || row.tenantCode!==tenantCode || row.customerId!==customerId || !ref(customerId) || row.coverage!=="own_original_retained_employee_policy_save_receipts" || row.delivery!=="not_reported" || row.readState!=="not_recorded" || !Array.isArray(row.items) || row.items.length>200
    || !Array.isArray(row.unavailable) || row.unavailable.length!==ENTERPRISE_EMPLOYEE_POLICY_MESSAGE_UNAVAILABLE.length || ENTERPRISE_EMPLOYEE_POLICY_MESSAGE_UNAVAILABLE.some(v=>!row.unavailable.includes(v)))return undefined;
  const items:EnterpriseOwnEmployeePolicyMessages["items"]=[],keys=new Set<string>();
  for(const r of row.items){if(!r || typeof r!=="object" || Array.isArray(r) || !ref(r.corporateCustomerId) || !ref(r.membershipId) || !ref(r.operationKey,128) || keys.has(r.operationKey) || !Number.isSafeInteger(r.revision) || r.revision<1 || !utc(r.membershipUpdatedAt) || !utc(r.createdAt) || r.effect!=="original_employee_policy_save_only")return undefined;
    keys.add(r.operationKey);items.push({corporateCustomerId:r.corporateCustomerId,membershipId:r.membershipId,operationKey:r.operationKey,revision:r.revision,membershipUpdatedAt:r.membershipUpdatedAt,createdAt:r.createdAt,effect:r.effect});}
  return {tenantCode,customerId,coverage:"own_original_retained_employee_policy_save_receipts",delivery:"not_reported",readState:"not_recorded",unavailable:[...ENTERPRISE_EMPLOYEE_POLICY_MESSAGE_UNAVAILABLE],items};
}
export interface EnterpriseOwnCorporateStatusMessages {
  tenantCode:string;customerId:string;coverage:"own_original_captured_corporate_membership_status_events";
  delivery:"not_reported";readState:"not_recorded";unavailable:["uncaptured_corporate_status_history"];
  items:Array<{historyId:string;corporateCustomerId:string;membershipId:string;membershipUpdatedAt:string;capturedAt:string;action:Exclude<CustomerStatusHistoryEntry["action"],"merge">;fromStatus:CustomerMembershipStatus;toStatus:CustomerMembershipStatus;at:string}>;
}
/** Original captured recipients only. Missing capture is unavailable, never today's membership as history. */
export function enterpriseOwnCorporateStatusMessagesSnapshot(value:unknown,tenantCode:string,customerId:string):EnterpriseOwnCorporateStatusMessages|undefined {
  const row=value as EnterpriseOwnCorporateStatusMessages|null,ref=(v:unknown):v is string=>typeof v==="string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(v);
  const utc=(v:unknown):v is string=>typeof v==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  if(!row || typeof row!=="object" || Array.isArray(row) || row.tenantCode!==tenantCode || row.customerId!==customerId || !ref(customerId) || row.coverage!=="own_original_captured_corporate_membership_status_events" || row.delivery!=="not_reported" || row.readState!=="not_recorded" || !Array.isArray(row.unavailable) || row.unavailable.length!==1 || row.unavailable[0]!=="uncaptured_corporate_status_history" || !Array.isArray(row.items) || row.items.length>200)return undefined;
  const items:EnterpriseOwnCorporateStatusMessages["items"]=[],ids=new Set<string>();
  for(const r of row.items){if(!r || typeof r!=="object" || Array.isArray(r) || !ref(r.historyId) || ids.has(r.historyId) || !ref(r.corporateCustomerId) || !ref(r.membershipId) || !utc(r.membershipUpdatedAt) || !utc(r.capturedAt) || !utc(r.at) || !CUSTOMER_STATUS_ACTIONS.some(a=>a!=="merge"&&a===r.action) || !CUSTOMER_MEMBERSHIP_STATUSES.includes(r.fromStatus) || !CUSTOMER_MEMBERSHIP_STATUSES.includes(r.toStatus))return undefined;
    ids.add(r.historyId);items.push({historyId:r.historyId,corporateCustomerId:r.corporateCustomerId,membershipId:r.membershipId,membershipUpdatedAt:r.membershipUpdatedAt,capturedAt:r.capturedAt,action:r.action,fromStatus:r.fromStatus,toStatus:r.toStatus,at:r.at});}
  return {tenantCode,customerId,coverage:"own_original_captured_corporate_membership_status_events",delivery:"not_reported",readState:"not_recorded",unavailable:["uncaptured_corporate_status_history"],items};
}
export type EnterpriseOwnStatusMessage = Pick<CustomerStatusHistoryEntry,"id"|"action"|"fromStatus"|"toStatus"|"at"> & {scope:"account"|"membership"};
export interface EnterpriseOwnStatusMessages {
  tenantCode: string; customerId: string; coverage: "own_original_account_membership_status_history";
  delivery: "not_reported"; readState: "not_recorded"; items: EnterpriseOwnStatusMessage[];
}
/** Minimal own original status facts; no internal reason, merge or present authority. */
export function enterpriseOwnStatusMessagesSnapshot(value: unknown, tenantCode: string, customerId: string): EnterpriseOwnStatusMessages | undefined {
  const row=value as EnterpriseOwnStatusMessages|null,ref=(v:unknown):v is string=>typeof v==="string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(v);
  const utc=(v:unknown):v is string=>typeof v==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
  if(!row || typeof row!=="object" || Array.isArray(row) || row.tenantCode!==tenantCode || row.customerId!==customerId || !ref(customerId)
    || row.coverage!=="own_original_account_membership_status_history" || row.delivery!=="not_reported" || row.readState!=="not_recorded" || !Array.isArray(row.items) || row.items.length>200)return undefined;
  const items:EnterpriseOwnStatusMessage[]=[],ids=new Set<string>();
  for(const r of row.items){
    if(!r || typeof r!=="object" || Array.isArray(r) || !ref(r.id) || ids.has(r.id) || !["account","membership"].includes(r.scope) || !CUSTOMER_STATUS_ACTIONS.some(a=>a===r.action && a!=="merge") || !utc(r.at))return undefined;
    const statuses=r.scope==="account" ? CUSTOMER_ACCOUNT_STATUSES : CUSTOMER_MEMBERSHIP_STATUSES;
    if(!statuses.some(s=>s===r.toStatus) || r.fromStatus!==undefined && !statuses.some(s=>s===r.fromStatus))return undefined;
    ids.add(r.id);items.push({id:r.id,scope:r.scope,action:r.action,toStatus:r.toStatus,at:r.at,...(r.fromStatus!==undefined?{fromStatus:r.fromStatus}:{})});
  }
  return {tenantCode,customerId,coverage:"own_original_account_membership_status_history",delivery:"not_reported",readState:"not_recorded",items};
}
export interface EnterpriseOwnTransferMessages {
  tenantCode: string; customerId: string; coverage: "own_original_administrator_transfer_receipts";
  delivery: "not_reported"; readState: "not_recorded";
  items: Array<{ corporateCustomerId: string; participation: "initiator" | "recipient"; receipt: EnterpriseInviteTransferAuditEntry }>;
}
/** Addressed history only. Participation is not today's administrator authority. */
export function enterpriseOwnTransferMessagesSnapshot(value: unknown, tenantCode: string, customerId: string): EnterpriseOwnTransferMessages | undefined {
  const row=value as EnterpriseOwnTransferMessages|null,ref=(v:unknown):v is string=>typeof v === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(v);
  if(!row || typeof row!=="object" || Array.isArray(row) || row.tenantCode!==tenantCode || row.customerId!==customerId || !ref(customerId)
    || row.coverage!=="own_original_administrator_transfer_receipts" || row.delivery!=="not_reported" || row.readState!=="not_recorded" || !Array.isArray(row.items) || row.items.length>200)return undefined;
  const items:EnterpriseOwnTransferMessages["items"]=[],keys=new Set<string>();
  for(const r of row.items){
    if(!r || typeof r!=="object" || Array.isArray(r) || !ref(r.corporateCustomerId) || !["initiator","recipient"].includes(r.participation))return undefined;
    const receipt=enterpriseInviteTransferAuditEntrySnapshot(r.receipt);
    if(!receipt || receipt.objectType!=="administrator_transfer" || keys.has(receipt.operationKey))return undefined;
    const actorIsSelf=receipt.actorCustomerId===customerId,initiating=receipt.action==="administrator.transfer";
    if(actorIsSelf!==(r.participation==="initiator" ? initiating : !initiating))return undefined;
    keys.add(receipt.operationKey);items.push({corporateCustomerId:r.corporateCustomerId,participation:r.participation,receipt});
  }
  return {tenantCode,customerId,coverage:"own_original_administrator_transfer_receipts",delivery:"not_reported",readState:"not_recorded",items};
}
export function enterpriseMembershipAuditSnapshot(value: unknown, tenantCode: string, corporateCustomerId: string, workspaceCode?: string): EnterpriseMembershipAudit | undefined {
  const row = value as EnterpriseMembershipAudit | null;
  const readerAudit = row?.readerAudit === undefined ? undefined : enterpriseReaderAuditPageSnapshot(row.readerAudit, workspaceCode);
  if (row?.readerAudit !== undefined && !readerAudit) return undefined;
  const extended = row?.workflowItems !== undefined || row?.workflowCoverage !== undefined;
  const business = row?.businessItems !== undefined || row?.businessCoverage !== undefined || row?.bookingWorkspace !== undefined;
  const bookingAvailable = row?.bookingWorkspace?.state === "available";
  const expense = row?.expenseItems !== undefined || row?.expenseCoverage !== undefined;
  const joining = row?.joiningItems !== undefined || row?.joiningCoverage !== undefined;
  const policy = row?.policyItems !== undefined || row?.policyCoverage !== undefined;
  const applicationApproval = row?.applicationApprovalItems !== undefined || row?.applicationApprovalCoverage !== undefined;
  const merchantPolicy = row?.merchantPolicyItems !== undefined || row?.merchantPolicyCoverage !== undefined;
  const merchantPortal = row?.merchantPortalItems !== undefined || row?.merchantPortalCoverage !== undefined;
  // Older producers must keep their missing-source declaration; never add [] to claim coverage.
  const missing: EnterpriseMembershipAudit["unavailable"] = business
    ? [...(bookingAvailable ? [] : ["approvals" as const]),"remaining_approval_audit","order_and_financial_audit"]
    : extended ? ["approvals","profile_requests","order_and_financial_audit"] : ["invites_and_transfers","approvals","profile_requests","order_and_financial_audit"];
  if (!row || typeof row !== "object" || Array.isArray(row) || row.tenantCode !== tenantCode || row.corporateCustomerId !== corporateCustomerId || row.coverage !== "original_member_and_administrator_commands"
    || typeof row.permissionRevision !== "string" || !/^\d{1,15}:\d{1,15}$/u.test(row.permissionRevision) || !Array.isArray(row.items) || row.items.length > 200 || !Array.isArray(row.unavailable)
    || row.unavailable.length !== missing.length || missing.some(key => !row.unavailable.includes(key))
    || extended && (!Array.isArray(row.workflowItems) || row.workflowCoverage !== "original_invite_and_administrator_transfer_commands" || row.items.length+row.workflowItems.length>200)
    || business && (!extended || !Array.isArray(row.businessItems) || row.businessCoverage !== "original_management_and_current_workspace_booking_commands"
      || !row.bookingWorkspace || !["available","unavailable"].includes(row.bookingWorkspace.state)
      || bookingAvailable && (row.bookingWorkspace.state !== "available" || typeof row.bookingWorkspace.code !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(row.bookingWorkspace.code) || row.bookingWorkspace.code !== workspaceCode)
      || row.items.length+(row.workflowItems?.length ?? 0)+row.businessItems.length>200)
    || expense && (!business || !Array.isArray(row.expenseItems) || row.expenseCoverage !== "original_current_workspace_associated_expense_approval_commands"
      || !bookingAvailable && row.expenseItems.length>0 || row.items.length+(row.workflowItems?.length ?? 0)+(row.businessItems?.length ?? 0)+row.expenseItems.length>200)
    || joining && (!Array.isArray(row.joiningItems) || row.joiningCoverage!=="original_corporate_associated_join_request_commands" || row.items.length+(row.workflowItems?.length ?? 0)+(row.businessItems?.length ?? 0)+(row.expenseItems?.length ?? 0)+row.joiningItems.length>200)
    || policy && (!Array.isArray(row.policyItems) || row.policyCoverage!=="original_customer_company_and_member_policy_commands" || row.items.length+(row.workflowItems?.length ?? 0)+(row.businessItems?.length ?? 0)+(row.expenseItems?.length ?? 0)+(row.joiningItems?.length ?? 0)+row.policyItems.length>200)
    || applicationApproval && (!Array.isArray(row.applicationApprovalItems) || row.applicationApprovalCoverage!=="original_application_approval_company_binding_receipts" || row.items.length+(row.workflowItems?.length ?? 0)+(row.businessItems?.length ?? 0)+(row.expenseItems?.length ?? 0)+(row.joiningItems?.length ?? 0)+(row.policyItems?.length ?? 0)+row.applicationApprovalItems.length>200)
    || merchantPolicy && (!Array.isArray(row.merchantPolicyItems) || row.merchantPolicyCoverage!=="original_merchant_policy_save_metadata" || row.items.length+(row.workflowItems?.length ?? 0)+(row.businessItems?.length ?? 0)+(row.expenseItems?.length ?? 0)+(row.joiningItems?.length ?? 0)+(row.policyItems?.length ?? 0)+(row.applicationApprovalItems?.length ?? 0)+row.merchantPolicyItems.length>200)
    || merchantPortal && (!Array.isArray(row.merchantPortalItems) || row.merchantPortalCoverage!=="original_bare_actor_corporate_portal_configuration_metadata" || row.items.length+(row.workflowItems?.length ?? 0)+(row.businessItems?.length ?? 0)+(row.expenseItems?.length ?? 0)+(row.joiningItems?.length ?? 0)+(row.policyItems?.length ?? 0)+(row.applicationApprovalItems?.length ?? 0)+(row.merchantPolicyItems?.length ?? 0)+row.merchantPortalItems.length>200)) return undefined;
  const items: EnterpriseMembershipAuditEntry[] = [], workflowItems: EnterpriseInviteTransferAuditEntry[] = [], businessItems: EnterpriseBusinessAuditEntry[] = [], expenseItems: EnterpriseExpenseAuditEntry[] = [], joiningItems:EnterpriseJoinAuditEntry[]=[], policyItems:EnterprisePolicyAuditEntry[]=[], applicationApprovalItems:EnterpriseApplicationApprovalAuditEntry[]=[], merchantPolicyItems:EnterpriseMerchantPolicyAuditEntry[]=[], merchantPortalItems:EnterpriseMerchantPortalAuditEntry[]=[], keys = new Set<string>();
  for (const item of row.items) { const original = enterpriseMembershipAuditEntrySnapshot(item); if (!original || keys.has(original.operationKey)) return undefined; keys.add(original.operationKey); items.push(original); }
  for (const item of row.workflowItems ?? []) { const original = enterpriseInviteTransferAuditEntrySnapshot(item); if (!original || keys.has(original.operationKey)) return undefined; keys.add(original.operationKey); workflowItems.push(original); }
  for (const item of row.businessItems ?? []) { const original = enterpriseBusinessAuditEntrySnapshot(item); if (!original || keys.has(original.operationKey) || !bookingAvailable && original.objectType === "booking_approval") return undefined; keys.add(original.operationKey); businessItems.push(original); }
  for (const item of row.expenseItems ?? []) { const original=enterpriseExpenseAuditEntrySnapshot(item); if (!original || keys.has(original.operationKey)) return undefined; keys.add(original.operationKey); expenseItems.push(original); }
  for(const item of row.joiningItems ?? []){const original=enterpriseJoinAuditEntrySnapshot(item);if(!original || keys.has(original.operationKey))return undefined;keys.add(original.operationKey);joiningItems.push(original);}
  for(const item of row.policyItems ?? []){const original=enterprisePolicyAuditEntrySnapshot(item);if(!original || keys.has(original.operationKey))return undefined;keys.add(original.operationKey);policyItems.push(original);}
  for(const item of row.applicationApprovalItems ?? []){const original=enterpriseApplicationApprovalAuditEntrySnapshot(item,corporateCustomerId);if(!original || keys.has(original.operationKey))return undefined;keys.add(original.operationKey);applicationApprovalItems.push(original);}
  for(const item of row.merchantPolicyItems ?? []){const original=enterpriseMerchantPolicyAuditEntrySnapshot(item);if(!original || keys.has(original.operationKey))return undefined;keys.add(original.operationKey);merchantPolicyItems.push(original);}
  for(const item of row.merchantPortalItems ?? []){const original=enterpriseMerchantPortalAuditEntrySnapshot(item,corporateCustomerId);if(!original || keys.has(original.operationKey))return undefined;keys.add(original.operationKey);merchantPortalItems.push(original);}
  return { tenantCode, corporateCustomerId, permissionRevision: row.permissionRevision, coverage: row.coverage, unavailable: [...missing], items,
    ...(readerAudit ? { readerAudit } : {}),
    ...(merchantPortal ? {merchantPortalItems,merchantPortalCoverage:"original_bare_actor_corporate_portal_configuration_metadata" as const} : {}),
    ...(merchantPolicy ? {merchantPolicyItems,merchantPolicyCoverage:"original_merchant_policy_save_metadata" as const} : {}),
    ...(applicationApproval ? {applicationApprovalItems,applicationApprovalCoverage:"original_application_approval_company_binding_receipts" as const} : {}),
    ...(policy ? {policyItems,policyCoverage:"original_customer_company_and_member_policy_commands" as const} : {}),
    ...(joining ? {joiningItems,joiningCoverage:"original_corporate_associated_join_request_commands" as const} : {}),
    ...(expense ? {expenseItems,expenseCoverage:"original_current_workspace_associated_expense_approval_commands" as const} : {}),
    ...(extended ? {workflowItems,workflowCoverage:"original_invite_and_administrator_transfer_commands" as const} : {}),
    ...(business ? {businessItems,businessCoverage:"original_management_and_current_workspace_booking_commands" as const,
      bookingWorkspace:row.bookingWorkspace!.state === "available" ? {state:"available" as const,code:row.bookingWorkspace!.code} : {state:"unavailable" as const}} : {}) };
}
export interface EnterpriseAuditView { operationKey: string; action: string; target: string; reason: string; actor: string; createdAt: string }

/** Management requests propose a change; approval records review only, never writes
 * a customer master, credit limit, policy, payment or ledger. */
export type EnterpriseManagementRequestType = typeof ENTERPRISE_MANAGEMENT_REQUEST_TYPES[number];
export interface EnterprisePaymentProofBasis {
  corporateCustomerId: string;
  orderId: string;
  workspaceId: string;
  workspaceCode: string;
  currency: string;
  objectRevision: string;
  permissionRevision: string;
  source: "original_enterprise_paid_order";
  purpose: "rental_fee";
}
export interface EnterprisePaymentProofUploadRequest extends EnterpriseAuthorityUploadRequest { objectRevision: string }
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
  /** Reported payment evidence for this original order. The amount is a proposal. */
  orderId?: string;
  workspaceId?: string;
  reportedAmount?: string;
  paymentPurpose?: "rental_fee";
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
