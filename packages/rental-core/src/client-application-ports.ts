/** Rental客户应用的宿主参加者。数据库、客户Auth、会员、文件和付款均供给原实例。
 * 私有MySQL视图不进入公共Core合同；当前本人范围、原事务及操作收据仍由原业务复验。 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { TenantIntegrationService } from "@rental-os/platform-server/tenant-integration";
import type {
  CompleteFileUploadRequest, CreateFileUploadSessionRequest, FileAssetSummary,
  FileDownloadUrlSummary, FileUploadSessionSummary
} from "@rental-os/platform-contracts/files";
import type {
  CustomerMembershipPlanAssignment, CustomerMembershipQualificationType, CustomerMembershipReview,
  CustomerQualificationRef, CustomerQualificationRevision, RentalMembershipSnapshot, RentalRuleConfig,
  SubmitCustomerQualificationRequest
} from "./contracts";
import type {
  ClientMembershipStatusResponse, ClientMiniProgramPaymentIntentRequest,
  ClientPaymentIntentRequest, ClientPaymentIntentResponse
} from "./client-contracts";
import type { ClientRequestContext } from "./client-context";
import type { ApprovedOrderBinding } from "./approved-order-transaction.ports";
import type { RentalQualificationAction, RentalQualificationCheckWindow } from "./qualification";
import type { RentalHttpApplications, RentalHttpMembershipOptions, RentalHttpInspectionFailureEvents } from "./http-applications";
import type { RentalCategoryResolver } from "./category-runtime";
import type { RentalCoreFactRepository } from "./mysql-core-facts";
import type { ClientDeliveryAddressService } from "./mysql-client-delivery-address";

export type RentalClientApplicationStorage = Pick<PrismaClient,
  "tenant" | "businessWorkspace" | "clientChannelProfile" | "tenantAppearanceProfile" |
  "miniProgramChannel" | "websiteChannelProfile" | "customerProfile" | "customerMembershipRegistrationSettings" |
  "rentalPaymentIntent" | "customerContact" | "customerMembershipPlan" | "customerCorporateMembership" |
  "rentalOrderIdempotencyRecord" | "rentalOrder" | "rentalInspectionRecord" | "$transaction">;

export type RentalClientCore = Pick<RentalHttpApplications["core"],
  "readBusinessContext" | "getProfile" | "getWorkspaceCategory" | "getBusinessSettings" | "listItemGroups" |
  "listPricingGroups" | "listCouponTemplates" | "listLocations" | "listOperators" | "getOrder" |
  "readItemGroupImage" | "listCategories" | "listItemGroupsPage" | "listOrders" | "availability" |
  "resolvePricingGroupQuoteRequest" | "readQuoteConfiguration" | "persist" | "listInspections" | "cancelOrder" |
  "assertOrderExtensionAvailable" | "listOrderExtensions" | "lockOrderForUpdate" | "requestOrderExtension" | "payOrderExtension">;

export type RentalClientBusiness = Pick<RentalHttpApplications["business"],
  "refreshWorkspaceContext" | "listSpaceRatesAt" | "listServices" | "listDiscountPlans" | "effectiveRuleAt" |
  "listNotificationLogs" | "createQuote" | "normalizeQuoteInput" | "createQuoteForOriginalOperation" |
  "readQuoteForOriginalReference" | "loadQuote" | "readOneTimeDeliveryAddressForQuote" |
  "listCurrentCustomerCoupons" | "claimCoupon" | "persist" | "calculateCancellationCharge" |
  "releaseCouponInTransaction" | "quoteOrderExtension" | "quoteEnterpriseExtension" | "synchronizeExtensionCoupon">;

export type RentalClientOrderConfirmation = Pick<RentalHttpApplications["orderConfirmation"],
  "fingerprintOrderRequest" | "readOrderCreation" | "createApprovedOrder" | "createOrder">;
export type RentalClientIdempotentActions = Pick<RentalHttpApplications["idempotent"], "executeWithReplayFlag" | "executeInTransaction">;
export type RentalClientFunding = Pick<RentalHttpApplications["funding"], "listEvents" | "recordEvent">;
export type RentalClientServiceCapacities = Pick<RentalHttpApplications["serviceCapacities"],
  "readAvailabilityForQuote" | "releaseForOrder" | "reserveForOrder" | "confirmForOrder">;
export type RentalClientDocuments = RentalHttpApplications["documents"];
export type RentalClientCorporateSettlement = Pick<NonNullable<RentalHttpApplications["corporateSettlement"]>,
  "settleCancelledOrderCredit" | "allowsExtensionCredit">;
export type RentalClientIntegrationCatalog = Pick<TenantIntegrationService, "catalog">;
export type RentalClientCategoryResolver = Pick<RentalCategoryResolver, "forWorkspace">;
export type RentalClientHandoffFacts = Pick<RentalCoreFactRepository<Prisma.TransactionClient>, "findOrder">;
export type RentalClientDeliveryAddresses = Pick<ClientDeliveryAddressService, "snapshotForOrder">;
export type RentalClientFailureOutbox = Required<RentalHttpInspectionFailureEvents>;

export interface RentalClientApplicationAuthority {
  listPublicWorkspaces(tenantCode: string): Promise<{
    apiVersion: "v1"; tenantCode: string; tenantName: string;
    workspaces: Array<{ code: string; name: string; categoryCode: string; isDefault: boolean }>;
  }>;
  sessionStatus(context: ClientRequestContext): Promise<ClientMembershipStatusResponse>;
}

export interface RentalClientMemberships extends Pick<RentalHttpMembershipOptions, "listBookingOptions"> {
  updateOwnProfile(tenantId: string, customerId: string,
    data: Pick<Prisma.CustomerProfileUpdateManyMutationInput, "name" | "email">): Promise<boolean>;
  listPlanAssignments(tenantId: string, customerId: string): Promise<CustomerMembershipPlanAssignment[]>;
  resolveBenefits(tenantId: string, workspaceId: string, customerId: string, corporateCustomerId?: string,
    transaction?: Prisma.TransactionClient): Promise<{
      personal?: CustomerMembershipPlanAssignment; corporate?: CustomerMembershipPlanAssignment;
    }>;
  listQualificationTypes(tenantId: string, workspaceId: string): Promise<CustomerMembershipQualificationType[]>;
  listQualificationRevisions(tenantId: string, customerId: string, qualificationType?: string): Promise<CustomerQualificationRevision[]>;
  submitQualification(tenantId: string, workspaceId: string, customerId: string,
    input: SubmitCustomerQualificationRequest, channel: "admin" | "app", operator?: string): Promise<{
      qualification: CustomerQualificationRef; review: CustomerMembershipReview;
    }>;
  assertBookingQualificationForAction(tenantId: string, workspaceId: string,
    snapshot: RentalMembershipSnapshot | undefined, rule: RentalRuleConfig["qualification"],
    action: RentalQualificationAction, window: RentalQualificationCheckWindow,
    transaction?: Prisma.TransactionClient, delegatedBinding?: Readonly<ApprovedOrderBinding>): Promise<{
      ok: true; qualificationType?: string;
    }>;
}

/** 仅本链使用的资质附件拥有者；客户身份来自原Controller/Auth，不由这些字段授予。 */
export interface RentalClientQualificationFileOwner {
  businessType: "customer";
  businessId: string;
  uploadScene: "client-qualification";
}
export interface RentalClientFiles {
  createUploadSession(tenantId: string, input: CreateFileUploadSessionRequest,
    owner?: RentalClientQualificationFileOwner): Promise<FileUploadSessionSummary>;
  completeUpload(tenantId: string, sessionId: string, input: CompleteFileUploadRequest,
    owner?: RentalClientQualificationFileOwner): Promise<FileAssetSummary>;
  downloadUrl(tenantId: string, fileAssetId: string,
    owner?: RentalClientQualificationFileOwner): Promise<FileDownloadUrlSummary>;
}

export interface RentalClientWechatIdentity {
  identityForSession(context: ClientRequestContext): Promise<{ openId: string; appId: string; channelId: string } | undefined>;
  channelReady(tenantId: string): Promise<boolean>;
}
export interface RentalClientPayments {
  createPaymentIntent(tenantId: string, workspaceId: string, orderId: string,
    input: ClientPaymentIntentRequest): Promise<ClientPaymentIntentResponse>;
  createMiniProgramPaymentIntent(tenantId: string, workspaceId: string, orderId: string,
    input: ClientMiniProgramPaymentIntentRequest, identity?: { openId: string; appId: string }): Promise<ClientPaymentIntentResponse>;
  getPaymentIntent(tenantId: string, workspaceId: string, orderId: string, intentId: string): Promise<ClientPaymentIntentResponse>;
  refreshPaymentIntent(tenantId: string, workspaceId: string, orderId: string, intentId: string): Promise<ClientPaymentIntentResponse>;
  closePaymentIntent(tenantId: string, workspaceId: string, orderId: string, intentId: string): Promise<ClientPaymentIntentResponse>;
}
