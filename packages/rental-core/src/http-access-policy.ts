/** Rental 完整应用组合的旧 HTTP 服务端审定表。只给已核读取/原事务接点选择请求包装，
 * 不授予角色/对象权限，也不以路由声明证明运行时写入已封口。未审定、匿名准入、
 * 未封口的审计及手动响应保留明确缺口；宿主必须核完实际挂载集合才能启用完整入口。 */
import { RequestMethod, ServiceUnavailableException, type Type } from "@nestjs/common";
import { HOST_METADATA, METHOD_METADATA, PATH_METADATA, REDIRECT_METADATA, RENDER_METADATA,
  ROUTE_ARGS_METADATA, SSE_METADATA, VERSION_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";
import { matchableRequestPath } from "@rental-os/platform-server/request-path";
import type { createRentalAuthorization } from "./http-auth";
import { MembershipController } from "./http-membership.controller";
import { StaffAuthController } from "./http-staff-auth.controller";
import { RentalAuthExtensionsController } from "./http-auth-extensions.controller";
import { StaffSubscriptionController } from "./http-staff-subscription.controller";
import { EnterpriseReadController } from "./http-enterprise-read.controller";
import { RentalCustomersController } from "./http-customers.controller";
import { CustomerAvatarController } from "./http-customer-avatar.controller";
import { RentalWorkspacesController } from "./http-workspaces.controller";
import { RentalCoreController } from "./http-core.controller";
import { RentalBusinessController } from "./http-business.controller";
import { WorkspaceCapabilityController } from "./http-workspace-capabilities.controller";
import { ClientChannelProfileController, MiniProgramChannelController, WebsiteChannelProfileController } from "./http-channels.controller";
import { CategoryAdoptionPreparationController } from "./http-category-adoption-preparation.controller";
import { CategoryGovernanceController } from "./http-category-governance.controller";
import { ClientApiController } from "./http-client.controller";
import { EnterpriseWorkflowsController } from "./http-enterprise-workflows.controller";
import { EnterpriseMerchantController } from "./http-enterprise-merchant.controller";
import { EnterpriseRentalHandoffMerchantController } from "./http-enterprise-handoff-merchant.controller";
import { PaymentOperationsController } from "./http-payment-operations.controller";
import { PaymentReconciliationController } from "./http-payment-reconciliation.controller";
import { StaffOfflinePaymentController } from "./http-staff-payments.controller";
import { FilesController } from "./http-files.controller";
import { StaffUploadsController } from "./http-staff-uploads.controller";
import { PaymentWebhookController } from "./http-payment-webhook.controller";
import { isRentalPaymentCallbackRoute } from "./application-payment-callback-access";
import { declareRentalRecovery, type RentalRecoveryDeclaration, type RentalRecoveryKind } from "./application-recovery-policy";
export { createRentalNativeResponseBuffer } from "./http-native-response";

export type RentalHttpAccessReview = (
  | { readonly kind: "buffered-read"; readonly evidence: string }
  | { readonly kind: "audited-read"; readonly evidence: string }
  | { readonly kind: "maintained-read"; readonly evidence: string }
  | { readonly kind: "transactional-write"; readonly evidence: string }
  | { readonly kind: "disabled-feature"; readonly feature: "inspection-evidence"; readonly evidence: string }
  | { readonly kind: "pending"; readonly reason: string; readonly evidence: string })
  & { readonly response?: "buffered-native"; readonly ingress?: "client-public" | "platform-identity" | "payment-callback" };

/** These are trusted composition inputs, never request body/query/header metadata.
 * evidence names the original read implementation or every commit participant.
 * A transactional-write declaration is a review record, not an ORM write detector. */
export interface RentalHttpAccessDeclaration {
  readonly controller: Type<unknown>;
  readonly handler: Function;
  readonly review: RentalHttpAccessReview;
}

export interface RentalHttpAccessRoute extends RentalHttpAccessDeclaration {
  readonly handlerName: string;
  readonly method: string;
  readonly path: string;
  readonly recovery?: RentalRecoveryDeclaration;
}

const member = MembershipController.prototype;
const reads = [member.enterpriseOperation, member.enterpriseSettings, member.enterpriseConfiguration,
  member.registrationSettings, member.personalOptions, member.personalMembers, member.qualificationHistory,
  member.reviews, member.qualificationOptions, member.qualificationTypes, member.corporateMembers,
  member.corporateEmployees, member.benefitScopeOptions, member.plans, member.planAssignments,
  member.benefits, member.bookingOptions];
const writes = [member.saveRegistrationSettings, member.registerPersonal, member.savePersonal,
  member.setTemporaryPassword, member.submitQualification, member.review, member.saveQualificationType,
  member.saveCorporate, member.saveCorporateEmployee, member.savePlan, member.publishPlan,
  member.disablePlan, member.restorePlan, member.assignPlan, member.revokePlanAssignment];

const customer = RentalCustomersController.prototype, core = RentalCoreController.prototype;
const business = RentalBusinessController.prototype, capability = WorkspaceCapabilityController.prototype;
const adoption = CategoryAdoptionPreparationController.prototype, governance = CategoryGovernanceController.prototype;
const workspace = RentalWorkspacesController.prototype;
const client = ClientApiController.prototype;
const enterprise = EnterpriseWorkflowsController.prototype, merchant = EnterpriseMerchantController.prototype;
const handoff = EnterpriseRentalHandoffMerchantController.prototype;
const files = FilesController.prototype, staffFiles = StaffUploadsController.prototype;
const staffAuth = StaffAuthController.prototype, authExtensions = RentalAuthExtensionsController.prototype;
const webhook = PaymentWebhookController.prototype;
// PCH-R04 history/closeout is a closed original-handler list. In particular confirm,
// new quotes/orders/extensions/exchanges and generic GET routes do not inherit it.
const recoveryHandlers = new Map<Function, RentalRecoveryKind>([
  ...[core.orders, core.order, core.inspections, core.extensions, core.changes,
    core.orderDocument, core.orderDocumentVersions, core.orderDocumentVersion,
    core.originalExchangeInspectionMedia, core.readExchangeInspection, core.originalExchangeInspection,
    enterprise.exchangeInspectionConsentOriginal, enterprise.orderExchangeApprovals,
    core.operationReport, core.exportOperationReport,
    PaymentReconciliationController.prototype.listStatements, PaymentReconciliationController.prototype.getStatement,
    core.listCarrierShipmentEvents, core.revealOrderDeliveryAddress, core.listInternalOrderNotes,
    core.getServiceExecutionReceipt, business.fundingEvents,
    client.listOrders, client.myOrders, client.orderDetail, client.fulfillment, client.orderDocument,
    client.orderDocumentVersions, client.feeItems, client.extensions, client.funding, client.paymentIntent,
    PaymentOperationsController.prototype.listPaymentIntents,
    PaymentOperationsController.prototype.listPaymentRefunds].map(handler => [handler, "history"] as const),
  ...[core.allocate, core.allocationCandidates, core.manageAllocations, core.operationLock,
    core.createInspection, core.correctInspectionUsage, core.handover, core.partialReturn,
    core.createInternalOrderNote, core.createCarrierShipmentEvent, core.updateServiceOccurrence,
    core.markPickupOverdue, core.sendNoShowNotice, core.confirmNoShow, core.resumePickup]
    .map(handler => [handler, "fulfillment"] as const),
  ...[core.cancel, core.expirePendingOrder, core.settle, core.reviewOrderFeeReview, core.reviewExtensionRefund,
    core.refundServiceOccurrence, core.reviewInspectionException, core.recordInspectionExceptionCustomerResponse,
    core.reReviewInspectionException, core.previewPartialLineCancellation, core.applyPartialLineCancellation,
    business.refundFunding, business.releaseFunding, business.failFunding,
    client.respondToFee, client.previewCancellation, client.cancelOrder]
    .map(handler => [handler, "settlement"] as const),
  ...[client.refreshPaymentIntent, client.closePaymentIntent,
    PaymentOperationsController.prototype.createPaymentRefund, PaymentOperationsController.prototype.refreshPaymentRefund]
    .map(handler => [handler, "payment-result"] as const)
]);
const callbackHandlers: readonly Function[] = [webhook.alipay, webhook.wechatPay, webhook.stripe,
  webhook.alipayRefund, webhook.wechatRefund];
// Identity/session maintenance must remain available when ordinary Core business is
// unavailable. Only these existing handlers may use the original Guard/service alone;
// declarations supplied by another module cannot turn a business handler into identity.
const identityHandlers = new Map<Type<unknown>, readonly Function[]>([
  [StaffAuthController, [staffAuth.login, staffAuth.refresh, staffAuth.logout, staffAuth.me,
    staffAuth.sessionContext, staffAuth.changePassword, staffAuth.switchWorkspace]],
  [RentalAuthExtensionsController, [authExtensions.resetLocalDemoPassword, authExtensions.switchWorkspace]],
  [StaffSubscriptionController, [StaffSubscriptionController.prototype.context]]
]);
const auditedEnterpriseReads: readonly Function[] = [
  EnterpriseReadController.prototype.listOrders, EnterpriseReadController.prototype.orderDetail,
  EnterpriseReadController.prototype.exportOrders, EnterpriseReadController.prototype.corporateFinance,
  EnterpriseReadController.prototype.orderFinance, EnterpriseReadController.prototype.exportCorporateFinance,
  EnterpriseReadController.prototype.exportOrderFinance
];
const auditedCustomerReads: readonly Function[] = [customer.sharedCustomers, customer.customerDetail,
  customer.customerIdentityVerifications, customer.customerProfileOverview];

function reviewed(controller: Type<unknown>, handlers: readonly Function[], kind: Exclude<RentalHttpAccessReview["kind"], "pending" | "disabled-feature">,
  evidence: string): readonly RentalHttpAccessDeclaration[] {
  return handlers.map(handler => Object.freeze({ controller, handler, review: Object.freeze({ kind, evidence }) }));
}
function unresolved(controller: Type<unknown>, handlers: readonly Function[], reason: string,
  evidence: string): readonly RentalHttpAccessDeclaration[] {
  return handlers.map(handler => Object.freeze({ controller, handler, review: pending(reason, evidence) }));
}

/** Only this bounded set has been traced through its current services. Additional
 * declarations must name actual controller functions and their reviewed boundary. */
export const RENTAL_HTTP_REVIEWED_ACCESS: readonly RentalHttpAccessDeclaration[] = Object.freeze([
  ...callbackHandlers.map(handler => Object.freeze({ controller: PaymentWebhookController, handler,
    review: Object.freeze({ kind: "transactional-write" as const, ingress: "payment-callback" as const,
      evidence: "original signature/merchant/amount verification binds the persisted payment/refund; exact current config, Tenant/Core/binding/deployment and original Order/Workspace precede result consumption; original funding/CAS/idempotency retained, no actor or new dispatch" }) })),
  ...reviewed(FilesController, [files.files], "buffered-read",
    "original FileLedgerApplication list preserves original Rental file business ACL and excludes protected dedicated scenes; no write or provider call"),
  ...reviewed(FilesController, [files.createFile], "transactional-write",
    "Rental integration repository wraps original simulation file metadata creation in RC Tenant/Core; original production and dedicated-scene refusal retained, public ledger unchanged; subsequent original log cannot roll back or re-admit committed metadata"),
  ...reviewed(FilesController, [files.createUploadSession, files.createCustomerIdentityUploadSession,
    files.completeCustomerIdentityUpload, files.createCarrierEvidenceUploadSession,
    files.completeCarrierEvidenceUpload, files.completeUpload, files.cleanupExpiredUploads], "transactional-write",
    "original Rental file upload/claim/dispatch and cleanup use Tenant/Core before new persistence/dispatch; original actor/owner/session/config/hash/expiry retained; acknowledged or unknown frozen completion uses original result-only CAS without re-admission or resend"),
  ...reviewed(FilesController, [files.customerIdentityDownloadUrl, files.carrierEvidenceDownloadUrl,
    files.downloadUrl], "audited-read",
    "original issueFileDownloadReference signs only original asset; Rental short RC transaction rechecks Tenant/Core, unchanged asset and original same-tx file ACL before required operation audit; host rechecks before returning reference"),
  ...reviewed(StaffUploadsController, [staffFiles.createSession, staffFiles.completeSession], "transactional-write",
    "RentalStaffFileStorageApplication preserves original Auth Tenant X/current staff/workspace/location before same-tx Core; frozen success/unknown original result observation never adds admission or TTL retry"),
  ...reviewed(StaffUploadsController, [staffFiles.observeSession], "buffered-read",
    "original staff observation parses closed original request, reads exact existing session/file and original evidence, rechecks current owner and staff scene permission; it never initiates or repeats completion"),
  ...reviewed(StaffUploadsController, [staffFiles.downloadUrl], "audited-read",
    "original staff file authority and RentalFileApplicationParticipant keep current Auth Tenant X/Core, exact asset/owner/scene ACL and required download audit in the same RC transaction"),
  ...reviewed(ClientApiController, [client.qualificationFileUpload, client.completeQualificationFileUpload], "transactional-write",
    "original own-customer qualification and file owner; Rental upload/claim/dispatch use current Tenant/Core before new work, original frozen result-only completion never resends or replaces operation key"),
  ...reviewed(ClientApiController, [client.qualificationFileUrl], "audited-read",
    "original own-customer qualification/file ACL; Rental download transaction rechecks Tenant/Core and current exact asset/ACL before required audit, host buffers returned reference until recheck"),
  ...reviewed(ClientApiController, [client.enterpriseEntry, client.enterpriseMembers, client.closurePreview,
    client.me, client.config, client.paymentCapabilities, client.profile, client.contacts, client.membershipStatus,
    client.notifications, client.bookingOptions, client.membershipPlans, client.membershipAssignments,
    client.membershipBenefits, client.corporateIdentities, client.qualificationTypes, client.qualifications,
    client.catalog, client.availability, client.quoteDetail, client.myOrders, client.listOrders, client.orderDetail,
    client.fulfillment, client.rentalHandoffMaterial, client.orderDocumentVersions, client.feeItems,
    client.previewCancellation, client.extensions, client.previewExtension, client.funding], "buffered-read",
    "original client applications read own customer/current workspace and original order/payment/member projections; complete MySQL context readers refresh committed cache without initialization, displayed expired assignments are projections only; funding order lock reads existing facts; no financial or membership command"),
  ...reviewed(ClientApiController, [client.coupons, client.orderDocument], "maintained-read",
    "original coupons only expire claimed rows under RC Tenant/Core; original document render archives content-addressed original snapshot under RC Tenant/Core and unique replay, requested saved snapshot remains original; return rechecks current access"),
  ...reviewed(ClientApiController, [client.updateProfile, client.updateProfileViaPut, client.saveContact,
    client.deleteContact, client.changePassword, client.bindWechat, client.submitQualification, client.claimCoupon,
    client.createOrder, client.respondToFee, client.cancelOrder, client.applyExtension, client.payExtension,
    client.simulateFunding], "transactional-write",
    "original own-customer/profile/contact/password/qualification transactions start Tenant/Core; Wechat exchange runs once and same-tx current channel revision/secret/session binds identity; coupon category lock and order confirmation/IdempotentAction/funding parent gate precede original facts and receipts; simulation retains original production refusal"),
  ...reviewed(ClientApiController, [client.catalogImage], "audited-read",
    "original published catalogue/customer scope and bounded image; provider path uses Rental file Tenant/Core/current exact asset ACL and required audit; original redirect/bytes buffered until host recheck")
    .map(item => ({ ...item, review: { ...item.review, response: "buffered-native" as const } })),
  ...reviewed(ClientApiController, [client.quote], "transactional-write",
    "original createQuote persists under RC Tenant/Core before Workspace X; original fulfillment/inventory/capability/current caller scope and original-key replay preserved; quote is preparation, never payment or order execution"),
  ...reviewed(MiniProgramChannelController, [MiniProgramChannelController.prototype.test], "transactional-write",
    "original credentials-only transport follows same-tx Tenant/Core and current stored channel capture once; no user data read or transport retry; result-only original Tenant/CAS targets the same id/revision/appId/secret/test record and does not re-admit after dispatch"),
  ...reviewed(EnterpriseWorkflowsController, [enterprise.paymentProofUpload, enterprise.paymentProofUploadComplete,
    enterprise.authorityUpload, enterprise.authorityComplete], "transactional-write",
    "original enterprise applicant/payment-proof basis, object revision and purpose retained; Rental file create/claim/dispatch gate and original frozen result-only CAS use the same stored owner and operation"),
  ...reviewed(EnterpriseWorkflowsController, [enterprise.exchangeInspectionPhoto, enterprise.paymentProofFile], "buffered-read",
    "original own-order/preparation/media hash or current enterprise evidence owner is checked before and after original bounded bytes/hash read; no reusable evidence URL; native output held until host current-access recheck")
    .map(item => ({ ...item, review: { ...item.review, response: "buffered-native" as const } })),
  ...reviewed(EnterpriseMerchantController, [merchant.managementFile, merchant.authorityFile], "buffered-read",
    "original current reviewer, material/actor identity and payment-proof content hash are checked on both sides of bounded original evidence read; native bytes remain buffered until host recheck")
    .map(item => ({ ...item, review: { ...item.review, response: "buffered-native" as const } })),
  ...reviewed(RentalCoreController, [core.itemGroupImage], "audited-read",
    "original local bounded image or stored file asset; provider download reference uses Tenant/Core, exact asset/ACL and required audit; original native redirect/bytes buffered until current read recheck")
    .map(item => ({ ...item, review: { ...item.review, response: "buffered-native" as const } })),
  ...reviewed(RentalCoreController, [core.exchangeInspectionMediaRequirements, core.originalExchangeInspectionMedia,
    core.exchangeInspectionRequirements, core.readExchangeInspection, core.originalExchangeInspection], "buffered-read",
    "original exchange media/preparation requirements and original-key observation use Tenant/Core then original Order lock/current actor and immutable original template/media hashes; no preparation or execution submitted"),
  ...reviewed(RentalCoreController, [core.createExchangeInspectionMedia, core.completeExchangeInspectionMedia,
    core.prepareExchangeInspection], "transactional-write",
    "original exchange media/preparation transaction uses Tenant/Core then original Order and operation key; file persistence/claim/dispatch participants share original scope, unknown original claims are only observed and never replaced or resent"),
  ...reviewed(StaffAuthController, [staffAuth.me, staffAuth.sessionContext], "buffered-read",
    "same original AuthSessionService/RentalAuthService and staff audience; reads own live session, account, original workspace and capability context, never grants business/Core permission")
    .map(item => ({ ...item, review: { ...item.review, ingress: "platform-identity" as const } })),
  ...reviewed(StaffAuthController, [staffAuth.login, staffAuth.refresh, staffAuth.logout,
    staffAuth.changePassword, staffAuth.switchWorkspace], "transactional-write",
    "same original authentication source/session service, rate limits, token audience, password policy, refresh rotation and workspace membership/CAS; identity lifecycle remains usable without active Core, later business requests independently require current Core")
    .map(item => ({ ...item, review: { ...item.review, ingress: "platform-identity" as const } })),
  ...reviewed(RentalAuthExtensionsController, [authExtensions.resetLocalDemoPassword,
    authExtensions.switchWorkspace], "transactional-write",
    "original operator auth only: current session audience and workspace membership/CAS; demo reset retains original explicit environment/profile flag and current SaaS checks where required, does not grant Core or business access")
    .map(item => ({ ...item, review: { ...item.review, ingress: "platform-identity" as const } })),
  ...reviewed(StaffSubscriptionController, [StaffSubscriptionController.prototype.context], "buffered-read",
    "original Guard authenticates operator/staff; original subscription service selects own tenant and strips money fields; identity/entitlement display is not a Rental business action")
    .map(item => ({ ...item, review: { ...item.review, ingress: "platform-identity" as const } })),
  ...reviewed(EnterpriseReadController, [EnterpriseReadController.prototype.historyWorkspaces], "buffered-read",
    "mysql-enterprise-finance.historicalWorkspaceBasis only selects original paid/benefit order subjects in current trusted workspace and rechecks original enterprise scope; cross-workspace remains unavailable"),
  ...reviewed(EnterpriseWorkflowsController, [enterprise.profile, enterprise.auditMembership,
    enterprise.approvalNoticesMine, enterprise.approvalNoticesReview, enterprise.retainedMergeMessagesMine,
    enterprise.employeePolicyMessagesMine, enterprise.corporateStatusMessagesMine, enterprise.statusMessagesMine,
    enterprise.transferMessagesMine, enterprise.relationshipMessagesMine, enterprise.managementReviewMessagesMine,
    enterprise.joinReviewMessagesMine, enterprise.applicationReviewMessagesMine, enterprise.messagesMine, enterprise.auditMine,
    enterprise.rentalHandoffCreateOriginal, enterprise.rentalHandoffOrderSource, enterprise.rentalHandoffsMine,
    enterprise.rentalHandoffWithdrawalOriginal, enterprise.rentalHandoffDetail, enterprise.applicationsMine,
    enterprise.applicationDetail, enterprise.applicationSaveOriginal, enterprise.applicationWithdrawalOriginal,
    enterprise.ownRelations, enterprise.joinWithdrawalOriginal, enterprise.joinSubmissionOriginal, enterprise.invites,
    enterprise.inviteCreationOriginal, enterprise.inviteRevocationOriginal, enterprise.joinReviewOriginal,
    enterprise.memberChangeOriginal, enterprise.administratorChangeOriginal, enterprise.readAdministrator,
    enterprise.memberExitOriginal, enterprise.transferInitiationOriginal, enterprise.transferDecisionOriginal,
    enterprise.policy, enterprise.memberPolicy, enterprise.policySaveOriginal, enterprise.memberPolicySaveOriginal,
    enterprise.ownRentalPolicies, enterprise.ownExchangeApprovals, enterprise.exchangeApprovals,
    enterprise.ownExtensionApprovals, enterprise.extensionApprovals, enterprise.ownApprovals, enterprise.approvalsList,
    enterprise.extensionEligibility, enterprise.extensionRequestOriginal, enterprise.exchangeRequestOriginal], "buffered-read",
    "original enterprise application/members/policy/task/message/approval/handoff projections select bounded own or granted facts and original receipts; membershipAudit reads stored audits without appending; no currentJoin expiry or command execution in these methods"),
  ...reviewed(EnterpriseWorkflowsController, [enterprise.readOrderDelegation, enterprise.managementMine,
    enterprise.managementDetail, enterprise.managementSaveOriginal, enterprise.paymentProofBasis,
    enterprise.paymentProofUploadOriginal, enterprise.managementWithdrawalOriginal], "buffered-read",
    "original delegation/management/proof readers retain exact actor/object/revision checks and no writes; rentalNativeResponse stages original no-store/Vary headers until successful pre-return access recheck")
    .map(item => ({ ...item, review: { ...item.review, response: "buffered-native" as const } })),
  ...reviewed(EnterpriseWorkflowsController, [enterprise.mine, enterprise.joins, enterprise.tasksMine,
    enterprise.corporateTasks], "maintained-read",
    "mysql-enterprise-members.joinRequests retains Tenant X then Core gate before original currentJoin expiry/usage-release updates in the same RC transaction; task center explicitly consumes this maintained reader, pre-return recheck still required"),
  ...reviewed(EnterpriseWorkflowsController, [enterprise.saveApplication, enterprise.withdraw,
    enterprise.saveManagement, enterprise.withdrawManagement, enterprise.createRentalHandoff, enterprise.withdrawRentalHandoff,
    enterprise.withdrawJoin, enterprise.previewInvite, enterprise.join, enterprise.createInvite, enterprise.revoke,
    enterprise.decideJoin, enterprise.changeMember, enterprise.administrator, enterprise.exit, enterprise.transfer,
    enterprise.accept, enterprise.closeTransferDecision, enterprise.savePolicy, enterprise.saveMemberPolicy,
    enterprise.requestExtensionApproval, enterprise.decideExtensionApproval, enterprise.closeExtensionRequest,
    enterprise.requestExchangeApproval, enterprise.confirmExchangeExpense, enterprise.decideExchangeApproval,
    enterprise.closeExchangeRequest, enterprise.requestApproval, enterprise.decideApproval], "transactional-write",
    "original EnterpriseCommandService.execute takes original Tenant X/S then selected Core before verify/serialize/receipt/apply; member/policy/master and approval participants reuse tx; preview/join attempt counters use independent RC Tenant/Core/customer tx and over-limit rejects after commit; no added post-commit Core denial"),
  ...reviewed(EnterpriseMerchantController, [merchant.applicationsList, merchant.applicationMaterial,
    merchant.applicationClaim, merchant.applicationDecisionOriginal, merchant.managementList,
    merchant.managementDecisionOriginal, merchant.operation, merchant.scopePolicy,
    merchant.scopePolicySaveOriginal, merchant.policy], "buffered-read",
    "original merchant application/material/evidence metadata, management receipts and policy readers retain original operator/finance/tenant gates; bounded SQL/projections only, no approval or external effect"),
  ...reviewed(EnterpriseMerchantController, [merchant.readOrderDelegation, merchant.orderDelegationResult,
    merchant.exchangeExecutionChoices], "buffered-read",
    "original delegation receipts and exchange choices recheck original merchant authorization and captured order/approval/preparation/consent facts without executing; original no-store/Vary headers buffered until pre-return check")
    .map(item => ({ ...item, review: { ...item.review, response: "buffered-native" as const } })),
  ...reviewed(EnterpriseMerchantController, [merchant.decision, merchant.managementDecision,
    merchant.saveScopePolicy, merchant.savePolicy], "transactional-write",
    "original merchant decisions and policy changes use EnterpriseCommandService.execute Tenant/Core before original authority and receipt/facts; reviews remain review-only except approved original first-admin binding, no new business behavior"),
  ...reviewed(EnterpriseRentalHandoffMerchantController, [handoff.queue, handoff.material, handoff.original], "buffered-read",
    "mysql-enterprise-rental-handoff merchantQueue/detail/readReview only read current authorized original order page, immutable material and own decision receipt"),
  ...reviewed(EnterpriseRentalHandoffMerchantController, [handoff.review], "transactional-write",
    "original EnterpriseCommandService Tenant/Core -> handoff row/revision and request-only review receipt commit together; never updates order responsibility, inventory or funds"),
  ...reviewed(EnterpriseWorkflowsController, [enterprise.orderOriginal, enterprise.orderExchangeApprovals,
    enterprise.exchangeChoices, enterprise.exchangeOriginal, enterprise.exchangeConfirmationOriginal,
    enterprise.extensionOriginal, enterprise.approvalResult, enterprise.operation, enterprise.authorityOriginal,
    enterprise.exchangeInspectionMaterial, enterprise.exchangeInspectionConsentOriginal], "buffered-read",
    "original own-customer/enterprise permission and immutable source/reference validation around bounded order/approval/inspection/receipt reads; no execution on missing results, original unknown remains non-retryable"),
  ...reviewed(EnterpriseWorkflowsController, [enterprise.issueOrderDelegation, enterprise.revokeOrderDelegation,
    enterprise.closeExtensionApproval, enterprise.submitExtensionApproval, enterprise.closeApproval,
    enterprise.submitApproval, enterprise.confirmExchangeInspection], "transactional-write",
    "original EnterpriseCommandService or inspection consent Tenant/Core gates every receipt transaction; approved order/extension executes only through original Core same-tx participants, closing/revoking seals original key, original unknown never auto-replays"),
  ...reviewed(EnterpriseMerchantController, [merchant.executeOrderDelegation], "transactional-write",
    "original authenticated merchant delegation source and original order submission port; confirmed source/revision/customer approval held through original order Tenant/Core transaction; native wrapper only stages original no-store headers")
    .map(item => ({ ...item, review: { ...item.review, response: "buffered-native" as const } })),
  ...reviewed(EnterpriseMerchantController, [merchant.executeExchange], "transactional-write",
    "original approved exchange executor and enterprise approval participant share original Core Tenant/order/idempotency transaction; original current merchant checks retained before and after"),
  ...reviewed(EnterpriseMerchantController, [merchant.exchangeExecutionOriginal], "buffered-read",
    "original approved-exchange original receipt lookup plus current merchant and exact approval reference, no execution or transport"),
  ...reviewed(PaymentOperationsController, [PaymentOperationsController.prototype.listPaymentIntents,
    PaymentOperationsController.prototype.listPaymentRefunds], "buffered-read",
    "original order/workspace-scoped persisted payment/refund projections; no provider query or money action"),
  ...reviewed(PaymentOperationsController, [PaymentOperationsController.prototype.createPaymentRefund,
    PaymentOperationsController.prototype.refreshPaymentRefund], "transactional-write",
    "original payment runtime Tenant/Core -> Order -> original intent/refund, provider once outside original short admission tx, result CAS and original funding participant keep unknown semantics"),
  ...reviewed(PaymentReconciliationController, [PaymentReconciliationController.prototype.listStatements,
    PaymentReconciliationController.prototype.getStatement], "buffered-read",
    "original full-workspace financial authority plus bounded stored statement/line projection; no provider query or reconciliation action"),
  ...reviewed(PaymentReconciliationController, [PaymentReconciliationController.prototype.reconcile,
    PaymentReconciliationController.prototype.importStatement, PaymentReconciliationController.prototype.reviewStatementLine], "transactional-write",
    "original payment reconciliation delegates gated original query/funding; statement import and line review RC transactions start Tenant/Core then original full-workspace financial predicate before batch/line writes; original CSV/amount/status and no automatic money adjustment remain"),
  ...reviewed(StaffOfflinePaymentController, [StaffOfflinePaymentController.prototype.list], "buffered-read",
    "original staff audience/order/workspace and current assigned location scope; bounded existing registration reads"),
  ...reviewed(StaffOfflinePaymentController, [StaffOfflinePaymentController.prototype.register,
    StaffOfflinePaymentController.prototype.confirm], "transactional-write",
    "original staff payment transaction starts Tenant/Core -> Order then staff location/registration/funding; original register and confirm permissions and idempotency retained"),
  ...reviewed(ClientApiController, [client.listWorkspaces, client.bootstrap, client.resolveSite,
    client.publicDocument, client.publicCatalog], "buffered-read",
    "application-public-access binds original tenant/channel/published workspace facts; original service readers have no business mutation, outer public scope rechecks before return; unmatched website host preserves explicit null")
    .map(item => ({ ...item, review: { ...item.review, ingress: "client-public" as const } })),
  ...reviewed(ClientApiController, [client.websiteAsset, client.publicCatalogImage], "buffered-read",
    "original public asset/catalog readers bind trusted tenant/published workspace; rentalNativeResponse stages original headers/bytes/redirect once, host flushes only after public read recheck and discards on failure/disconnect")
    .map(item => ({ ...item, review: { ...item.review, ingress: "client-public" as const, response: "buffered-native" as const } })),
  ...reviewed(ClientApiController, [client.createPurposeChallenge, client.createChallenge, client.verifyChallenge,
    client.register, client.login, client.smsLogin, client.wechatPhoneLogin, client.refresh, client.logout], "transactional-write",
    "mysql-client-auth original parent/challenge/customer/session transactions and rate-limit tenant quota enter public Core gate; transport outside transaction then result-only CAS; WeChat original channel fingerprint rechecked, refresh rotates original hash-only session atomically; logout is original credential revocation only")
    .map(item => ({ ...item, review: { ...item.review, ingress: "client-public" as const } })),
  ...reviewed(ClientApiController, [client.closureChallenge, client.closeAccount, client.switchWorkspace,
    client.saveAddress, client.deleteAddress], "transactional-write",
    "original client subject/session retained: closure challenge uses authenticated quota and pre-SMS gate; closure proof consume/final Tenant X transaction checks Core; switch locks original published target and checks same-tx binding without member assignment; customer address mutations use original Tenant/Core transaction"),
  ...reviewed(ClientApiController, [client.listAddresses, client.paymentIntent], "buffered-read",
    "original own-customer address projections and persisted payment-intent reads; payment client response signs original stored parameters locally without provider dispatch or business write"),
  ...reviewed(ClientApiController, [client.createPaymentIntent, client.createMiniProgramPaymentIntent,
    client.refreshPaymentIntent, client.closePaymentIntent], "transactional-write",
    "mysql-payment-runtime original Tenant/Core -> Order -> operation scope -> Intent locks; provider preparation in bounded original transaction, transport once outside, result-only CAS preserves original unknown/funding_failed receipt without post-dispatch re-admission"),
  ...reviewed(CustomerAvatarController, [CustomerAvatarController.prototype.save], "transactional-write",
    "mysql-customer-avatar.save checks Tenant/Core before file IO and in original final pointer transaction; original bitmap validation and production storage rejection remain; ambiguous commit retains original file key"),
  ...reviewed(CustomerAvatarController, [CustomerAvatarController.prototype.read], "buffered-read",
    "original avatar reader rechecks customer pointer after buffered file IO; original customer Guard/object scope remains and rentalNativeResponse flushes bytes only after current access recheck")
    .map(item => ({ ...item, review: { ...item.review, response: "buffered-native" as const } })),
  ...reads.map(handler => Object.freeze({ controller: MembershipController, handler,
    review: Object.freeze({ kind: "buffered-read" as const,
      evidence: "mysql-membership read projections / mysql-enterprise-portal operation, tenantSettings, configuration: no business/audit writes or manual response" }) })),
  ...writes.map(handler => Object.freeze({ controller: MembershipController, handler,
    review: Object.freeze({ kind: "transactional-write" as const,
      evidence: "mysql-membership original transaction: lockRentalBusinessTenant or original Tenant X + assertRentalBusinessTenantAccessAfterLock; qualification type uses original category fence" }) })),
  ...[member.saveEnterpriseSettings, member.saveEnterpriseConfiguration].map(handler => Object.freeze({ controller: MembershipController, handler,
    review: Object.freeze({ kind: "transactional-write" as const,
      evidence: "mysql-enterprise-portal.change: original Tenant FOR UPDATE, then assertRentalBusinessTenantAccessAfterLock before enterprise_portal_operations receipt/facts; both PUT handlers reuse this transaction" }) })),
  ...reviewed(EnterpriseReadController, auditedEnterpriseReads, "audited-read",
    "mysql-enterprise-orders list/detail/exportRows and http-enterprise-read financial readers -> EnterpriseReaderAuditService.record: independent RC Tenant S/Core fence, same-tx requireWorkspaceAction + requireSuccess operation log; original post-audit authority checks remain"),
  ...reviewed(RentalCustomersController, auditedCustomerReads, "audited-read",
    "application-customer-management -> mysql-customer-governance listCustomers/getCustomerDetail/listIdentityVerifications; getProfileOverview uses getCustomerDetail; recordSensitiveReadAccess commits original audit payload under its own RC Tenant S/Core fence"),
  ...reviewed(RentalCustomersController, [customer.customerRiskRecords, customer.customerStatusHistory,
    customer.customerSensitiveAccess, customer.customerDuplicates, customer.customerMergePreview,
    customer.customerClosability, customer.customerMembershipClosability, customer.customerTransactability,
    customer.customerInvoiceProfiles, customer.customerContracts, customer.customerCredit,
    customer.customerCreditAccount, customer.customerCreditLedger, customer.customerCreditMaturity,
    customer.customerCreditPaymentReversal], "buffered-read",
    "application-customer-management -> original governance/operations, merge preview/closability, corporate and settlement readers: scoped find/count/aggregate and original authority checks; no audit append or business mutation"),
  ...reviewed(RentalCustomersController, [customer.registerCustomer, customer.saveCustomerIdentityVerification,
    customer.saveCustomerProfileAddress, customer.removeCustomerProfileAddress, customer.ensureCustomerAccount,
    customer.changeCustomerAccountStatus, customer.changeCustomerMembershipStatus, customer.createCustomerRiskRecord,
    customer.reviewCustomerRiskRecord, customer.saveCustomerInvoiceProfile, customer.saveCustomerContract,
    customer.saveCustomerCredit], "transactional-write",
    "original membership registration and mysql-customer-governance/corporate transactions: Tenant S fence or original Tenant X + assertRentalBusinessTenantAccessAfterLock before writes; return saved projections without read-audit re-admission"),
  ...reviewed(RentalCustomersController, [customer.recordCustomerCreditMaturity, customer.recordCustomerCreditPayment,
    customer.reverseCustomerCreditPayment], "transactional-write",
    "mysql-customer-corporate-settlement recordMaturity/recordPayment/reversePayment: original order discovery/locks then lockCredit -> Tenant S/Core fence before every append or successful replay; original financial authority and receipts remain in same RC transaction"),
  ...reviewed(RentalCustomersController, [customer.mergeCustomers], "transactional-write",
    "mysql-customer-merge.mergeCustomers original Tenant X -> assertRentalBusinessTenantAccessAfterLock -> sorted customer gates; original merge account/history/enterprise revisions commit together; original post-commit sensitive audit remains result-only"),
  ...reviewed(RentalCoreController, [core.listCarrierShipmentEvents, core.bookingMembers, core.bookingOptions,
    core.bookingDeliveryAddresses, core.operationReport, core.profile, core.tenantReadiness,
    core.businessSettings, core.couponTemplates, core.locations, core.operators, core.groups, core.pricingGroups,
    core.dispositions, core.workOrders, core.workOrderAssignees, core.workOrderHistory, core.workbenchTodos,
    core.orders, core.order, core.orderDocumentVersions, core.orderDocumentVersion, core.allocationCandidates,
    core.listInternalOrderNotes, core.extensions, core.changes, core.exchangeServiceOptions, core.templates,
    core.inspections, core.getServiceExecutionReceipt], "buffered-read",
    "http-core handlers -> original configuration snapshots, factStore find/query/list, membership/address projections, reports aggregate, allocation candidates, document snapshot reads and idempotent.readReceipt; state/cache projection only, no factContext initialization or persist/append/render"),
  ...reviewed(RentalBusinessController, [business.pricingPlans, business.priceVersions, business.priceVersion,
    business.legacyPriceVersions, business.listPriceAdjustments, business.listSpacePriceAdjustments,
    business.discountPlans, business.services, business.calendar, business.calendarVersions, business.calendarVersion,
    business.officialSourceVersions, business.calendarPublishPreview, business.calendarOverrideAudits,
    business.ruleVersions, business.currentRule, business.ruleVersionAudits, business.ruleVersion,
    business.ruleVersionPublishPreview, business.fundingEvents, business.rewards, business.benefitAccounts,
    business.notificationTemplates, business.notificationLogs, business.quoteDetail], "buffered-read",
    "rentalHttpBusinessContext reads committed Core/business configuration snapshots; original pricing/calendar/rule/funding/notification/quote readers only query or project cache; calendar previews build detached values, official source readers query stored versions without fetching"),
  ...reviewed(WorkspaceCapabilityController, [capability.overview, capability.audits], "buffered-read",
    "WorkspaceCapabilityService.overview/listAudits -> repository current scope, instances and audit findMany; no initialize/save/hook execution"),
  ...reviewed(WorkspaceCapabilityController, [capability.save, capability.upgrade, capability.initializeRequired], "transactional-write",
    "application-domain supplies original lockActiveCategoryBinding -> Tenant S/Core fence: repository.saveInstance owns instance+audit transaction; reconcileRequiredCapabilities reads workspaceScope in original transaction before initializeInstances, including empty/idempotent result"),
  ...reviewed(ClientChannelProfileController, [ClientChannelProfileController.prototype.get], "buffered-read",
    "mysql-client-channel-profile.get: tenant profile/workspace/appearance reads and readiness projection only"),
  ...reviewed(WebsiteChannelProfileController, [WebsiteChannelProfileController.prototype.get], "buffered-read",
    "mysql-website-channel-profile.get: load + categoryOptions findMany + summary only"),
  ...reviewed(MiniProgramChannelController, [MiniProgramChannelController.prototype.get], "buffered-read",
    "mysql-mini-program-channel.get: stored channel load + masked summary only; no credential test"),
  ...reviewed(MiniProgramChannelController, [MiniProgramChannelController.prototype.save], "transactional-write",
    "original channel Tenant X -> Core -> current revision/AppID/identity checks and encrypted configuration save; original post-commit audit and masked response perform no new business admission"),
  ...reviewed(ClientChannelProfileController, [ClientChannelProfileController.prototype.save], "transactional-write",
    "original channel publication/profile transaction starts Tenant/Core before profile and audit writes; original workspace publication and availability validation remains"),
  ...reviewed(WebsiteChannelProfileController, [WebsiteChannelProfileController.prototype.save,
    WebsiteChannelProfileController.prototype.uploadAsset], "transactional-write",
    "original profile transaction or image upload Tenant X enters selected Core gate before original revision/configuration/blob facts; tenant scope comes from original Guard, no client-supplied subject"),
  ...reviewed(CategoryAdoptionPreparationController, [adoption.candidates, adoption.receipt, adoption.preview,
    adoption.entities, adoption.readBatch], "buffered-read",
    "mysql-category-preparation read transactions retain original authorization lease/revalidate, current/historical source queries and detached compatibility projection; mysql-category-adoption.readOriginal only verifies original receipt, preserving unknown"),
  ...reviewed(CategoryAdoptionPreparationController, [adoption.save, adoption.saveBatch, adoption.adopt], "transactional-write",
    "lockCategoryAdoptionAccess: original Auth Tenant X/user/session/role locks, then selected Core check before facts or receipt lookup; original same-tx source/preparation/policy checks and final lease validation preserved, no write retry"),
  ...reviewed(RentalCoreController, [core.assets, core.assetStatusHistory, core.stocks, core.stockLedger], "buffered-read",
    "mysql-core-runtime.factContext authoritative MySQL branch returns detached committed configuration without initialization/sample writes; actual asset/status/stock/ledger readers only query current scoped facts"),
  ...reviewed(RentalCoreController, [core.orderDocument], "maintained-read",
    "mysql-documents.render archives already rendered original facts in RC Tenant S/Core -> unique content hash read/append; duplicate race rereads same immutable version, outer maintained read rechecks before returning"),
  ...reviewed(RentalCoreController, [core.revealOrderDeliveryAddress], "audited-read",
    "original reveal permission/order-scope projection retained; required operation log commits in short RC Tenant/Core transaction using the original PlatformOperationLogService masking/error contract, outer read rechecks before releasing sensitive data"),
  ...reviewed(RentalCoreController, [core.exportOperationReport], "buffered-read",
    "original report filters and original report repository shared with page; rentalNativeResponse buffers CSV headers until current read check, CSV rendering and monetary permission retain original contract")
    .map(item => ({ ...item, review: { ...item.review, response: "buffered-native" as const } })),
  ...reviewed(RentalBusinessController, [business.customerCoupons], "maintained-read",
    "mysql-business-facts.expireClaimedCoupons owns RC Tenant S/Core -> original scoped claimed/effectiveTo predicate update; normalized fact refresh is read-only, outer read rechecks before returning"),
  ...reviewed(RentalBusinessController, [business.serviceCapacityList], "maintained-read",
    "mysql-service-capacity.releaseExpired original RC transaction now takes Tenant S/Core before reservation/counter writes; same original expiry/CAS and full rollback, outer read rechecks before returning"),
  ...reviewed(RentalCoreController, [core.categories], "buffered-read",
    "original published category references only; exact global SaaS scope checks original public principal/deployment, tenant operator uses original tenant Core scope; no fabricated member or workspace"),
  ...reviewed(CategoryGovernanceController, [governance.list, governance.catalog, governance.tenants,
    governance.previewCreation, governance.creationReceipt, governance.detail, governance.candidates,
    governance.validate, governance.preview, governance.audits], "buffered-read",
    "global definition preview/read/original receipt uses no business mutation; exact SaaS scope locks/revalidates original live public principal and deployment before/after, original preview flags and permission predicates remain"),
  ...reviewed(CategoryGovernanceController, [governance.createCategory, governance.create, governance.patch,
    governance.publish, governance.archive, governance.opening, governance.policy], "transactional-write",
    "original Serializable platformTransaction now enters sorted original principal Tenant X before Tenant S/Core deployment and category locks; original signed browser token/role reads before and after, revision and immutable receipt checks retained"),
  ...reviewed(RentalWorkspacesController, [workspace.workspaces, workspace.workspaceMembers,
    workspace.workspaceFulfillmentLocations], "buffered-read",
    "exact original tenant-management scope accepts no selected workspace; original facade/Guard tenant/full-data authority and repository read projections preserved, Core tenant grant/member assignment/binding rechecked before return"),
  ...reviewed(RentalWorkspacesController, [workspace.createWorkspace, workspace.updateWorkspace,
    workspace.saveWorkspaceMember, workspace.createUserWithWorkspaceAccess, workspace.updateUserWithWorkspaceAccess], "transactional-write",
    "original four repository transactions begin Tenant S/Core gate, preserving original category initialization, required capabilities, fixed-admin protection and account/member/role atomicity; no target scope taken from DTO"),
  ...reviewed(RentalWorkspacesController, [workspace.tenantWorkspaces], "buffered-read",
    "exact target tenant from original path, SaaS live principal -> current target Core grant/tenant binding/deployment; original tenant lookup and scoped workspace list, pre-return recheck without member assignment"),
  ...reviewed(RentalWorkspacesController, [workspace.createTenantWorkspace, workspace.updateTenantWorkspace], "transactional-write",
    "original repository Tenant helper first invokes selected management beforeParent: sorted actor/target Tenant X plus original principal locks before Tenant S; same-tx target grant/binding/deployment then original workspace/category/capability writes"),
  ...reviewed(RentalCoreController, [core.saveProfile, core.saveBusinessSettings, core.saveCouponTemplate,
    core.updateCouponTemplate, core.saveOperator, core.updateOperator, core.saveLocation, core.updateLocation,
    core.saveGroup, core.updateGroup, core.savePricingGroup, core.updatePricingGroup,
    core.updatePricingGroupSecurityRates, core.saveAsset, core.updateAsset], "transactional-write",
    "original normalized configuration/fact write uses lockActiveCategoryBinding -> Tenant/Core before workspace/category/revision checks; composite pricing group and initial rates share original RC transaction; authoritative profile snapshot commits inside upsertProfile and normalized persist is now no-op"),
  ...reviewed(RentalCoreController, [core.uploadItemGroupImage, core.removeItemGroupImage], "transactional-write",
    "original file upload gate precedes transport; image delta merges locked current album under RC Tenant/Core -> Workspace with original upsert/opening; only acknowledged commit updates cache, unknown retains original asset/session; unlink and original file delete_pending CAS commit together for the sole cleanup worker"),
  ...reviewed(RentalCoreController, [core.stockOperation, core.saveStock], "transactional-write",
    "mysql-core-facts stock operation/count original RC Tenant/Core transaction returns original balance and reservation projection before commit; runtime consumes this confirmed result without post-commit factContext/re-admission; original key/lock/inventory algorithm retained"),
  ...reviewed(RentalCoreController, [core.restoreDisposition,
    core.writeOffDisposition, core.createWorkOrder, core.assignWorkOrder, core.startWorkOrder,
    core.submitWorkOrder, core.reviewWorkOrder, core.cancelWorkOrder], "transactional-write",
    "mysql-core-facts disposition/workorder original RC transaction starts Tenant/Core, retaining linked Order -> asset -> disposition locks and receipts; assignee validation/update/projection share tx; no post-commit normalized snapshot write"),
  ...reviewed(RentalCoreController, [core.createCarrierShipmentEvent, core.manageAllocations,
    core.createInternalOrderNote, core.operationLock, core.createOrder, core.expirePendingOrders,
    core.expirePendingOrder, core.reconcilePickupOverdue, core.markPickupOverdue, core.sendNoShowNotice,
    core.confirmNoShow, core.resumePickup, core.confirm, core.allocate, core.substituteBundleComponent,
    core.partialReturn, core.cancel, core.applyPostPickupExchange, core.applyPartialLineCancellation,
    core.applyExtension, core.payExtension, core.reviewOrderFeeReview, core.reviewExtensionRefund,
    core.createInspection, core.correctInspectionUsage, core.handover, core.settle, core.updateServiceOccurrence,
    core.refundServiceOccurrence, core.reviewInspectionException, core.recordInspectionExceptionCustomerResponse,
    core.reReviewInspectionException], "transactional-write",
    "original IdempotentAction/RentalOrderConfirmation or allocation order transaction takes Tenant/Core before original Order/facts/receipt; original funding/coupon/capacity/enterprise participants retain same tx; confirmed order result survives ancillary notification refusal, normalized persist does not re-admit"),
  ...reviewed(RentalCoreController, [core.availability, core.previewPostPickupExchange,
    core.previewPartialLineCancellation, core.previewExtension], "buffered-read",
    "original availability and preview services read scoped current facts plus original order/rule/price snapshots; preview paths do not receive write tx or submit commands, returned detached calculations recheck current access"),
  ...reviewed(RentalBusinessController, [business.createPricingPlan, business.updatePricingPlan,
    business.restorePriceVersion, business.runDuePriceAdjustments, business.createPriceAdjustment,
    business.confirmPriceAdjustment, business.cancelPriceAdjustment, business.createSpacePriceAdjustment,
    business.confirmSpacePriceAdjustment, business.cancelSpacePriceAdjustment,
    business.createDiscountPlan, business.updateDiscountPlan,
    business.createService, business.updateService, business.applyOfficialSource, business.saveCalendarDay,
    business.removeCalendarDayOverride, business.applyCalendarRange, business.applyCalendarRangeRemove,
    business.publishCalendar, business.voidCalendarVersion, business.restoreCalendarVersion, business.saveRule,
    business.restoreRule, business.publishRule, business.voidRule, business.createServiceCapacity,
    business.updateServiceCapacity], "transactional-write",
    "original configuration/price-adjustment/calendar/rule/service-capacity transaction enters lockActiveCategoryBinding -> Tenant/Core; version/revision/configuration/audit commit together; official calendar uses stored approved source, normalized business/core persist performs no second write"),
  ...reviewed(RentalBusinessController, [business.calendarRangePreview, business.calendarRangeRemovePreview], "buffered-read",
    "original calendar range preview builds detached draft changes from committed configuration, writes/audits only occur in the separate apply handlers"),
  ...reviewed(RentalBusinessController, [business.initiateFunding, business.appendFunding,
    business.captureFunding, business.refundFunding, business.releaseFunding, business.failFunding], "transactional-write",
    "mysql-funding original lockedOrderScope acquires Tenant/Core before Order; original funding event/offline disposition/audit ledger and receipt share original RC transaction with original amount/currency/actor rules"),
  ...reviewed(RentalBusinessController, [business.voidCustomerCoupon, business.claimCoupon,
    business.grantReward, business.createNotificationTemplate, business.updateNotificationTemplate,
    business.retryDueNotifications, business.queryNotificationDelivery, business.retryNotification,
    business.sendNotification, business.quote], "transactional-write",
    "original coupon/reward/quote facts retain category/Tenant/Core and original caller tx; notification template and durable queued/claim/begin transactions are gated, provider transport only after confirmed begin and result observation CAS does not re-admit; HTTP keeps last confirmed queued/unknown receipt, normalized persist is no-op"),
  ...reviewed(RentalBusinessController, [business.reverseReward], "transactional-write",
    "original full reversal rule runs in RC Tenant/Core -> reward X -> sorted existing coupon X -> template X -> account X; current facts and original reward status commit together, same-id reversed replay never debits twice; publish touched cache only after confirmed commit, no post-commit refresh")
]);

function pending(reason: string, evidence: string): RentalHttpAccessReview {
  return Object.freeze({ kind: "pending", reason, evidence });
}

function paths(metadata: unknown): string[] {
  const values = typeof metadata === "string" ? [metadata] : metadata;
  if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== "string")) {
    throw new Error("Rental HTTP 需要实际 Nest Controller/handler 路径元数据");
  }
  return values;
}

// Deliberately support the literal/:parameter syntax used by these controllers.
// Wildcard, regex, host and version routing require a separate reviewed adapter.
function matcher(path: string): RegExp | undefined {
  const segments = path.split("/");
  if (segments.some(segment => segment && !/^:[a-z0-9_]+$/iu.test(segment) && !/^[a-z0-9_.-]+$/iu.test(segment))) return;
  return new RegExp(`^${segments.map(segment => segment.startsWith(":") ? "[^/]+" : segment.replace(/\./gu, "\\.")).join("/")}$`, "u");
}

export function compileRentalHttpAccessPolicy(input: {
  controllers: readonly Type<unknown>[];
  /** Same original authorization policy as the sole Rental Guard. */
  authorization: Pick<ReturnType<typeof createRentalAuthorization>, "isClientPublicRoute">;
  declarations?: readonly RentalHttpAccessDeclaration[];
  /** Trusted host composition only. The disabled host supplies no evidence
   * participant, and this exact handler is rejected before any service executes. */
  inspectionEvidence?: "unavailable";
}) {
  const controllers = new Set(input.controllers);
  if (controllers.size !== input.controllers.length || typeof input.authorization?.isClientPublicRoute !== "function") {
    throw new Error("Rental HTTP 处理器重复或缺少原匿名入口政策");
  }
  const declarations = [...RENTAL_HTTP_REVIEWED_ACCESS.filter(item => controllers.has(item.controller)),
    ...(input.inspectionEvidence === "unavailable" && controllers.has(StaffUploadsController) ? [{
      controller: StaffUploadsController, handler: staffFiles.bindInspectionEvidence,
      review: { kind: "disabled-feature" as const, feature: "inspection-evidence" as const,
        evidence: "disabled AI host supplies no inspection evidence participant; original Guard still runs and this exact handler returns unavailable before DB or evidence writes" }
    }] : []), ...(input.declarations ?? [])];
  const routes: RentalHttpAccessRoute[] = [];
  const patterns = new Map<RentalHttpAccessRoute, RegExp>();
  const used = new Set<RentalHttpAccessDeclaration>();
  for (const declaration of declarations) {
    if (!controllers.has(declaration.controller) || typeof declaration.handler !== "function" || !declaration.review?.evidence?.trim()
      || !["buffered-read", "audited-read", "maintained-read", "transactional-write", "disabled-feature", "pending"].includes(declaration.review.kind)
      || declaration.review.kind === "pending" && !declaration.review.reason?.trim()) {
      throw new Error("Rental HTTP 审定记录必须绑定已挂载的真实处理器及依据");
    }
    if (declaration.review.ingress === "platform-identity"
      && !identityHandlers.get(declaration.controller)?.includes(declaration.handler)) {
      throw new Error("Rental 身份维护包装只接受原认证/本人订阅处理器");
    }
    if (declaration.review.ingress === "payment-callback"
      && (declaration.controller !== PaymentWebhookController || !callbackHandlers.includes(declaration.handler))) {
      throw new Error("Rental 支付回调包装只接受原五个验签处理器");
    }
    if (declaration.review.kind === "disabled-feature" && (input.inspectionEvidence !== "unavailable"
      || declaration.controller !== StaffUploadsController || declaration.handler !== staffFiles.bindInspectionEvidence
      || declaration.review.feature !== "inspection-evidence")) {
      throw new Error("Rental 未启用政策只接受本宿主明确缺失的原检查证据接点");
    }
  }
  if (declarations.some(declaration => declarations.some(other => other !== declaration
    && other.controller === declaration.controller && other.handler === declaration.handler))) {
    throw new Error("Rental HTTP 同一处理器不能登记两份审定政策");
  }
  for (const controller of controllers) {
    const bases = paths(Reflect.getMetadata(PATH_METADATA, controller));
    const seen = new Set<string>();
    for (let prototype = controller.prototype; prototype && prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype)) {
      for (const handlerName of Object.getOwnPropertyNames(prototype)) {
        if (handlerName === "constructor" || seen.has(handlerName)) continue;
        seen.add(handlerName);
        const handler = Object.getOwnPropertyDescriptor(prototype, handlerName)?.value;
        if (typeof handler !== "function" || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
        if (typeof method !== "string") throw new Error("Rental HTTP 处理器缺少实际方法元数据");
        const declaration = declarations.find(item => item.controller === controller && item.handler === handler);
        if (declaration) used.add(declaration);
        const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handlerName) as Record<string, unknown> | undefined;
        const nativeResponse = Object.keys(args ?? {}).some(key => Number(key.split(":")[0]) === RouteParamtypes.RESPONSE);
        const nativeNext = Object.keys(args ?? {}).some(key => Number(key.split(":")[0]) === RouteParamtypes.NEXT);
        for (const base of bases) for (const suffix of paths(Reflect.getMetadata(PATH_METADATA, handler))) {
          const path = matchableRequestPath(`/${base}/${suffix}`);
          const pattern = matcher(path);
          let review = declaration?.review ?? pending("unreviewed-handler", "尚未核定该处理器的全部读取副作用、写入事务与外部参加者");
          if (nativeNext || nativeResponse && review.response !== "buffered-native" || Reflect.getMetadata(SSE_METADATA, handler)
            || Reflect.getMetadata(REDIRECT_METADATA, handler) || Reflect.getMetadata(RENDER_METADATA, handler)) {
            review = pending("native-response", "@Res/@Next、SSE、重定向或模板响应需要专用输出接点；不能用缓冲返回后复验");
          } else if (input.authorization.isClientPublicRoute(method, path) && review.ingress !== "client-public"
            || controller === StaffAuthController && ["login", "refresh", "logout"].includes(handlerName)
              && review.ingress !== "platform-identity") {
            review = pending("anonymous-ingress", "需原可信租户/渠道/原刷新会话解析及同事务 Core 准入；不可构造成员身份或退回 legacy");
          } else if (controller === PaymentWebhookController
            && (review.ingress !== "payment-callback" || !isRentalPaymentCallbackRoute(method, path))) {
            review = pending("callback-ingress", "支付回调必须使用精确原路径及验签后的原单据范围");
          } else if ((controller === EnterpriseReadController && auditedEnterpriseReads.includes(handler))
            || (controller === RentalCustomersController && auditedCustomerReads.includes(handler))) {
            if (review.kind !== "audited-read") {
              review = pending("audited-read", "原读取会写敏感访问/企业读取审计，须先核原审计同事务门禁再显式登记 audited-read");
            }
          }
          if (!pattern || method === "ALL" || Reflect.getMetadata(HOST_METADATA, controller)
            || Reflect.getMetadata(VERSION_METADATA, controller) !== undefined || Reflect.getMetadata(VERSION_METADATA, handler) !== undefined) {
            review = pending("routing-adapter", "当前编译器只处理未版本化的固定路径/:参数及明确 HTTP 方法");
          }
          const readMethod = method === "GET" || method === "HEAD";
          const readReview = review.kind === "buffered-read" || review.kind === "audited-read" || review.kind === "maintained-read";
          if (review.kind !== "pending" && (readMethod && !readReview || !readMethod && readReview && !(method === "POST" && review.kind === "buffered-read"))) {
            throw new Error(`Rental HTTP 审定类型与原方法不符：${controller.name}.${handlerName}`);
          }
          const recoveryKind = recoveryHandlers.get(handler);
          const recovery = review.kind !== "pending" && recoveryKind ? declareRentalRecovery(method, path, recoveryKind) : undefined;
          const route = Object.freeze({ controller, handler, handlerName, method, path, review: Object.freeze({ ...review }),
            ...(recovery ? { recovery } : {}) });
          routes.push(route);
          if (pattern) patterns.set(route, pattern);
        }
      }
    }
  }
  if (declarations.some(item => !used.has(item))) throw new Error("Rental HTTP 审定记录未命中真实 Nest 处理器");
  const inventory = Object.freeze(routes);
  return Object.freeze({
    routes: inventory,
    pending: Object.freeze(routes.filter(route => route.review.kind === "pending")),
    /** Only used before the original Guard to choose identity lifecycle scope.
     * The actual class/handler is checked again after the Guard has run. */
    isIdentityRoute(request: { method: string; url: string }): boolean {
      const method = request.method.toUpperCase(), path = matchableRequestPath(request.url);
      return routes.some(route => route.review.kind !== "pending" && route.review.ingress === "platform-identity"
        && (route.method === method || method === "HEAD" && route.method === "GET") && patterns.get(route)?.test(path));
    },
    isPaymentCallbackRoute(request: { method: string; url: string }): boolean {
      const method = request.method.toUpperCase(), path = matchableRequestPath(request.url);
      return isRentalPaymentCallbackRoute(method, path) && routes.some(route => route.review.kind !== "pending"
        && route.review.ingress === "payment-callback" && route.method === method && route.path === path);
    },
    /** Before enabling the whole declared controller set. This is coverage evidence,
     * not a claim that service instances/commit participants have been validated. */
    assertReviewed() {
      const unresolved = routes.filter(route => route.review.kind === "pending");
      if (unresolved.length) throw new Error(`Rental HTTP 尚有 ${unresolved.length} 个处理器接点未审定：${unresolved.map(route => `${route.controller.name}.${route.handlerName}`).join(", ")}`);
    },
    requireHandler(controller: Function, handler: Function, request: { method: string; url: string }): RentalHttpAccessRoute {
      const method = request.method.toUpperCase(), path = matchableRequestPath(request.url);
      const route = routes.find(item => item.controller === controller && item.handler === handler
        && (item.method === method || method === "HEAD" && item.method === "GET") && patterns.get(item)?.test(path));
      if (!route) throw new ServiceUnavailableException("Rental HTTP 实际处理器/路径未登记当前请求包装");
      if (route.review.kind === "pending") {
        throw new ServiceUnavailableException(`Rental HTTP 待接 ${route.review.reason}：${route.review.evidence}`);
      }
      if (route.review.kind === "disabled-feature") {
        throw new ServiceUnavailableException("检查草稿证据绑定未启用");
      }
      return route;
    }
  });
}

export type RentalHttpAccessPolicy = ReturnType<typeof compileRentalHttpAccessPolicy>;
