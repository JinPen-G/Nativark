/** 企业HTTP的私有服务接点，保留客户/营运两套鉴权及原附件、事务和收据。
 * 宿主供给同一实际实例；数据库模型留在此MySQL适配，领域根出口不加载它。 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { CompleteFileUploadRequest, CreateFileUploadSessionRequest, FileAssetSummary, FileUploadSessionSummary } from "@rental-os/platform-contracts/files";
import type { TenantIntegrationService } from "@rental-os/platform-server/tenant-integration";
import type { EnterpriseCoreFundingSource, EnterpriseCoreCreditAccountSource } from "./mysql-enterprise-finance";
import type { RentalEnterpriseReadStorage } from "./enterprise-read-storage";
import type { EnterpriseOrderReaderService } from "./mysql-enterprise-orders";
import type { EnterpriseApplicationService } from "./mysql-enterprise-application";
import type { EnterpriseMembersService } from "./mysql-enterprise-members";
import type { EnterpriseCommandService } from "./mysql-enterprise-command";
import type { EnterprisePolicyService } from "./mysql-enterprise-policy";
import type { EnterpriseManagementRequestService } from "./mysql-enterprise-management-request";
import type { EnterpriseMerchantDelegationService } from "./mysql-enterprise-merchant-delegation";
import type { EnterpriseMerchantOrderSubmissionService } from "./mysql-enterprise-merchant-order-submission";
import type { EnterpriseApprovalService } from "./mysql-enterprise-approval";
import type { EnterpriseExtensionApprovalService } from "./mysql-enterprise-extension-approval";
import type { EnterpriseExchangeApprovalService } from "./mysql-enterprise-exchange-approval";
import type { EnterpriseTaskCenterService } from "./mysql-enterprise-task-center";
import type { EnterpriseRentalHandoffService } from "./mysql-enterprise-rental-handoff";
import type { EnterpriseMembershipAuditService } from "./mysql-enterprise-membership-audit";
import type { RentalApprovedExchangeService } from "./mysql-approved-exchange-execution";
import type { RentalExchangeInspectionConsentService } from "./mysql-exchange-inspection-consent";

/** 由专用Controller核验的原对象绑定，不接受客户端自行提交为授权依据。 */
export interface RentalEnterpriseEvidenceOwner {
  businessType?: string;
  businessId?: string;
  uploadScene?: string;
  workspaceId?: string;
  actorUserId?: string;
  enterprisePaymentProof?: { corporateCustomerId: string; orderId: string; objectRevision: string; purpose: "rental_fee" };
}

export interface RentalEnterpriseHttpFiles {
  createUploadSession(tenantId: string, input: CreateFileUploadSessionRequest, owner?: RentalEnterpriseEvidenceOwner): Promise<FileUploadSessionSummary>;
  completeUpload(tenantId: string, sessionId: string, input: CompleteFileUploadRequest, owner?: RentalEnterpriseEvidenceOwner): Promise<FileAssetSummary>;
  readAuthorityBytes(tenantId: string, fileAssetId: string, applicantCustomerId: string): Promise<{ mimeType: string; content: Buffer }>;
  readPaymentProofBytes(tenantId: string, fileAssetId: string, applicantCustomerId: string, orderId: string, workspaceId: string, contentHash: string): Promise<{ mimeType: string; content: Buffer }>;
}

export interface RentalEnterpriseHttpApplications {
  orders: Pick<EnterpriseOrderReaderService, "list" | "detail" | "exportRows">;
  database: RentalEnterpriseReadStorage & Pick<PrismaClient, "fileUploadSession">;
  funding: EnterpriseCoreFundingSource;
  credit: EnterpriseCoreCreditAccountSource;
  applications: Pick<EnterpriseApplicationService, "detail" | "merchantClaimMaterial" | "merchantDetail" | "merchantEvidenceOwner" | "merchantList" | "mine" | "readReview" | "readSave" | "readWithdrawal" | "review" | "save" | "withdraw">;
  members: Pick<EnterpriseMembersService, "acceptTransfer" | "administrator" | "changeAdministrator" | "changeMember" | "closeTransferDecision" | "createInvite" | "decideJoin" | "invites" | "join" | "joinRequests" | "merchantPolicy" | "ownRelations" | "previewInvite" | "readAdministratorChange" | "readInviteCreation" | "readInviteRevocation" | "readJoinReview" | "readJoinSubmission" | "readJoinWithdrawal" | "readMemberChange" | "readMemberExit" | "readTransferDecision" | "readTransferInitiation" | "revokeInvite" | "savePolicy" | "transfer" | "withdrawJoin">;
  commands: Pick<EnterpriseCommandService, "conflict" | "customer" | "operator">;
  policies: Pick<EnterprisePolicyService, "companySave" | "companyView" | "merchantSave" | "merchantView" | "ownRentalPolicies" | "readCompanySave" | "readMerchantSave">;
  management: Pick<EnterpriseManagementRequestService, "customerEvidenceOwner" | "detail" | "evidenceOwner" | "merchantList" | "mine" | "paymentProofBasis" | "profile" | "readReview" | "readSave" | "readWithdrawal" | "review" | "save" | "withdraw">;
  exchanges: Pick<EnterpriseExchangeApprovalService, "approvedExchangeParticipant" | "choices" | "closeRequest" | "confirmExpense" | "confirmationOriginal" | "decide" | "list" | "merchantExchangeAccess" | "merchantExchangeReference" | "merchantExecutionChoices" | "orderApprovals" | "original" | "request" | "requestOriginal">;
  approvedExchanges: Pick<RentalApprovedExchangeService<Prisma.TransactionClient>, "execute" | "original">;
  delegations: Pick<EnterpriseMerchantDelegationService, "issue" | "readCustomer" | "readMerchant" | "revoke">;
  delegatedOrders: Pick<EnterpriseMerchantOrderSubmissionService, "execute" | "readOriginal">;
  approvals: Pick<EnterpriseApprovalService, "closeExecution" | "decide" | "list" | "orderOriginal" | "request" | "result" | "submit">;
  extensions: Pick<EnterpriseExtensionApprovalService, "closeExecution" | "closeRequest" | "decide" | "eligibility" | "list" | "request" | "requestOriginal" | "result" | "submit">;
  tasks: Pick<EnterpriseTaskCenterService, "applicationReviewMessages" | "approvalNotices" | "corporateStatusMessages" | "employeePolicyMessages" | "joinReviewMessages" | "managementReviewMessages" | "messages" | "ownAudit" | "relationshipMessages" | "retainedMergeMessages" | "statusMessages" | "tasks" | "transferMessages">;
  handoffs: Pick<EnterpriseRentalHandoffService, "merchantDetail" | "merchantQueue" | "readReview" | "review" | "create" | "detail" | "mine" | "orderSource" | "readCreate" | "readWithdrawal" | "withdraw">;
  membershipAudit: Pick<EnterpriseMembershipAuditService, "read">;
  exchangeInspections: Pick<RentalExchangeInspectionConsentService, "material" | "photo" | "confirm" | "original">;
  files: RentalEnterpriseHttpFiles;
  integrations: Pick<TenantIntegrationService, "runtimeConfig">;
}

export const RENTAL_ENTERPRISE_HTTP = {
  orders: Symbol("rental.http.enterprise.orders"),
  database: Symbol("rental.http.enterprise.database"),
  funding: Symbol("rental.http.enterprise.funding"),
  credit: Symbol("rental.http.enterprise.credit"),
  applications: Symbol("rental.http.enterprise.applications"),
  members: Symbol("rental.http.enterprise.members"),
  commands: Symbol("rental.http.enterprise.commands"),
  policies: Symbol("rental.http.enterprise.policies"),
  management: Symbol("rental.http.enterprise.management"),
  exchanges: Symbol("rental.http.enterprise.exchanges"),
  approvedExchanges: Symbol("rental.http.enterprise.approved-exchanges"),
  delegations: Symbol("rental.http.enterprise.delegations"),
  delegatedOrders: Symbol("rental.http.enterprise.delegated-orders"),
  approvals: Symbol("rental.http.enterprise.approvals"),
  extensions: Symbol("rental.http.enterprise.extensions"),
  tasks: Symbol("rental.http.enterprise.tasks"),
  handoffs: Symbol("rental.http.enterprise.handoffs"),
  membershipAudit: Symbol("rental.http.enterprise.membership-audit"),
  exchangeInspections: Symbol("rental.http.enterprise.exchange-inspections"),
  files: Symbol("rental.http.enterprise.files"),
  integrations: Symbol("rental.http.enterprise.integrations")
} as const satisfies { [K in keyof RentalEnterpriseHttpApplications]: symbol };
