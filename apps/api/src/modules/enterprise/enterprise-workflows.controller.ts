/** Customer enterprise workflows and merchant decisions use separate authentication realms. */
import { Body, Controller, Get, Param, Post, Put, Query, Req, UnauthorizedException, ServiceUnavailableException } from "@nestjs/common";
import type { ClientRequestContext } from "../client/client-auth.service";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { FileStorageRuntimeService } from "../integrations/file-storage.runtime.service";
import { TenantIntegrationService } from "../integrations/tenant-integration.service";
import { ClientQualificationUploadCompleteRequestDto } from "../client/client-request.dto";
import { EnterpriseApplicationService } from "./enterprise-application.service";
import { EnterpriseRentalHandoffService } from "./enterprise-rental-handoff.service";
import { EnterpriseMembershipAuditService } from "./enterprise-membership-audit.service";
import { WithdrawEnterpriseRentalHandoffRequestDto, CreateEnterpriseRentalHandoffRequestDto } from "./enterprise-request.dto";
import { EnterpriseCommandService, enterpriseJson } from "./enterprise-command.service";
import { EnterpriseMembersService } from "./enterprise-members.service";
import { EnterprisePolicyService } from "./enterprise-policy.service";
import { EnterpriseApprovalService } from "./enterprise-approval.service";
import { EnterpriseExchangeApprovalService } from "./enterprise-exchange-approval.service";
import { RentalExchangeInspectionConsentService } from "../rental-core/rental-exchange-inspection-consent.service";
import { ConfirmEnterpriseExchangeInspectionDto, ConfirmEnterpriseExchangeExpenseDto, CloseEnterpriseExchangeRequestDto, EnterpriseExchangeChoicesQueryDto, RequestEnterpriseExchangeApprovalDto, DecideEnterpriseExchangeApprovalDto } from "./enterprise-exchange-request.dto";
import { EnterpriseExtensionApprovalService } from "./enterprise-extension-approval.service";
import { RequestEnterpriseExtensionApprovalDto, DecideEnterpriseExtensionApprovalDto, SubmitEnterpriseExtensionApprovalDto, CloseEnterpriseExtensionExecutionDto, CloseEnterpriseExtensionRequestDto } from "./enterprise-extension-request.dto";
import { EnterpriseTaskCenterService } from "./enterprise-task-center.service";
import { EnterpriseManagementRequestService } from "./enterprise-management-request.service";
import { CloseEnterpriseApprovalExecutionDto, SaveEnterpriseManagementRequestDto } from "./enterprise-request.dto";
import { CloseEnterpriseTransferDecisionDto } from "./enterprise-transfer-decision.dto";
import { PreviewEnterpriseInviteRequestDto, ChangeEnterpriseAdministratorRequestDto, ChangeEnterpriseMemberRequestDto, CreateEnterpriseInviteRequestDto, DecideEnterpriseTransferRequestDto, EnterpriseChangeRequestDto, JoinEnterpriseRequestDto, ReviewEnterpriseJoinRequestDto, SaveEnterpriseApplicationRequestDto, TransferEnterpriseAdministratorRequestDto, SaveEnterpriseScopePolicyRequestDto, RequestEnterpriseBookingApprovalDto, DecideEnterpriseBookingApprovalDto, SubmitEnterpriseApprovedBookingDto, EnterpriseAuthorityUploadRequestDto } from "./enterprise-request.dto";
interface CustomerRequest { client?: ClientRequestContext; headers?: { authorization?: string } }
const client = (request: CustomerRequest) => { if (!request.client) throw new UnauthorizedException("请先登录客户账号"); return request.client; };
@Controller("client/v1/enterprise")
export class EnterpriseWorkflowsController {
  constructor(private readonly applications: EnterpriseApplicationService, private readonly members: EnterpriseMembersService, private readonly commands: EnterpriseCommandService, private readonly prisma: PrismaService, private readonly files: FileStorageRuntimeService, private readonly integrations: TenantIntegrationService, private readonly policies: EnterprisePolicyService, private readonly approvals: EnterpriseApprovalService, private readonly tasks: EnterpriseTaskCenterService, private readonly management: EnterpriseManagementRequestService, private readonly extensions: EnterpriseExtensionApprovalService, private readonly exchanges: EnterpriseExchangeApprovalService, private readonly rentalHandoffs: EnterpriseRentalHandoffService, private readonly membershipAudit: EnterpriseMembershipAuditService,
    private readonly exchangeInspections: RentalExchangeInspectionConsentService) {}
  private inspectionConsentReader() {
    if (!this.exchangeInspections) throw new ServiceUnavailableException("原本人换货检查同意尚未装配");
    return this.exchangeInspections;
  }
  @Get("orders/:orderId/exchange-inspections/:preparationId")
  exchangeInspectionMaterial(@Req() req: CustomerRequest, @Param("orderId") orderId: string, @Param("preparationId") preparationId: string) {
    return this.inspectionConsentReader().material(req.headers?.authorization, client(req), orderId, preparationId);
  }
  @Post("orders/:orderId/exchange-inspection-consents")
  confirmExchangeInspection(@Req() req: CustomerRequest, @Param("orderId") orderId: string, @Body() input: ConfirmEnterpriseExchangeInspectionDto) {
    return this.inspectionConsentReader().confirm(req.headers?.authorization, client(req), orderId, input);
  }
  @Get("orders/:orderId/exchange-inspection-consents/operations/:key")
  exchangeInspectionConsentOriginal(@Req() req: CustomerRequest, @Param("orderId") orderId: string, @Param("key") key: string) {
    return this.inspectionConsentReader().original(req.headers?.authorization, client(req), orderId, key);
  }
  @Get("corporates/:corporateId/profile") profile(@Req() req: CustomerRequest, @Param("corporateId") id: string) { return this.management.profile(client(req), id); }
  @Get("management-requests") managementMine(@Req() req: CustomerRequest) { return this.management.mine(client(req)); }
  @Get("management-requests/:id") managementDetail(@Req() req: CustomerRequest, @Param("id") id: string) { return this.management.detail(client(req), id); }
  @Get("corporates/:corporateId/management-requests/save-operations/:key") managementSaveOriginal(@Req() req: CustomerRequest, @Param("corporateId") id: string, @Param("key") key: string) { return this.management.readSave(client(req), id, key); }
  @Post("corporates/:corporateId/management-requests") saveManagement(@Req() req: CustomerRequest, @Param("corporateId") id: string, @Body() input: SaveEnterpriseManagementRequestDto) { return this.management.save(client(req), id, input); }
  @Get("management-requests/:id/withdraw-operations/:key") managementWithdrawalOriginal(@Req() req: CustomerRequest, @Param("id") id: string, @Param("key") key: string) { return this.management.readWithdrawal(client(req), id, key); }
  @Post("management-requests/:id/withdraw") withdrawManagement(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: EnterpriseChangeRequestDto) { return this.management.withdraw(client(req), id, input); }
  @Get("tasks") tasksMine(@Req() req: CustomerRequest) { return this.tasks.tasks(client(req)); }
  @Get("corporates/:corporateId/tasks") corporateTasks(@Req() req: CustomerRequest, @Param("corporateId") id: string) { return this.tasks.tasks(client(req), id); }
  @Get("corporates/:corporateId/membership-audit")
  auditMembership(@Req() req: CustomerRequest, @Param("corporateId") id: string, @Query("readerCursor") readerCursor?: string) {
    return this.membershipAudit.read(client(req), id, readerCursor);
  }
  @Get("my-approval-notices") approvalNoticesMine(@Req() req: CustomerRequest) { return this.tasks.approvalNotices(client(req)); }
  @Get("corporates/:corporateId/approval-notices") approvalNoticesReview(@Req() req: CustomerRequest, @Param("corporateId") id: string) { return this.tasks.approvalNotices(client(req), id); }
  @Get("my-retained-merge-messages") retainedMergeMessagesMine(@Req() req: CustomerRequest) { return this.tasks.retainedMergeMessages(client(req)); }
  @Get("my-employee-policy-messages") employeePolicyMessagesMine(@Req() req: CustomerRequest) { return this.tasks.employeePolicyMessages(client(req)); }
  @Get("my-corporate-status-messages") corporateStatusMessagesMine(@Req() req: CustomerRequest) { return this.tasks.corporateStatusMessages(client(req)); }
  @Get("my-status-messages") statusMessagesMine(@Req() req: CustomerRequest) { return this.tasks.statusMessages(client(req)); }
  @Get("my-transfer-messages") transferMessagesMine(@Req() req: CustomerRequest) { return this.tasks.transferMessages(client(req)); }
  @Get("my-relationship-messages") relationshipMessagesMine(@Req() req: CustomerRequest) { return this.tasks.relationshipMessages(client(req)); }
  @Get("my-management-review-messages") managementReviewMessagesMine(@Req() req: CustomerRequest) { return this.tasks.managementReviewMessages(client(req)); }
  @Get("my-join-review-messages") joinReviewMessagesMine(@Req() req: CustomerRequest) { return this.tasks.joinReviewMessages(client(req)); }
  @Get("my-application-review-messages") applicationReviewMessagesMine(@Req() req: CustomerRequest) { return this.tasks.applicationReviewMessages(client(req)); }
  @Get("my-messages") messagesMine(@Req() req: CustomerRequest) { return this.tasks.messages(client(req)); }
  @Get("my-audit") auditMine(@Req() req: CustomerRequest) { return this.tasks.ownAudit(client(req)); }
  @Post("orders/:orderId/handoff-requests") createRentalHandoff(@Req() req: CustomerRequest, @Param("orderId") orderId: string, @Body() input: CreateEnterpriseRentalHandoffRequestDto) { return this.rentalHandoffs.create(client(req), orderId, input); }
  @Get("orders/:orderId/handoff-requests/create-operations/:key") rentalHandoffCreateOriginal(@Req() req: CustomerRequest, @Param("orderId") orderId: string, @Param("key") key: string) { return this.rentalHandoffs.readCreate(client(req), orderId, key); }
  @Get("handoff-orders") rentalHandoffOrderSource(@Req() req: CustomerRequest) { return this.rentalHandoffs.orderSource(client(req)); }
  @Get("handoff-requests") rentalHandoffsMine(@Req() req: CustomerRequest) { return this.rentalHandoffs.mine(client(req)); }
  @Post("handoff-requests/:id/withdraw") withdrawRentalHandoff(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: WithdrawEnterpriseRentalHandoffRequestDto) { return this.rentalHandoffs.withdraw(client(req), id, input); }
  @Get("handoff-requests/:id/withdraw-operations/:key") rentalHandoffWithdrawalOriginal(@Req() req: CustomerRequest, @Param("id") id: string, @Param("key") key: string) { return this.rentalHandoffs.readWithdrawal(client(req), id, key); }
  @Get("handoff-requests/:id") rentalHandoffDetail(@Req() req: CustomerRequest, @Param("id") id: string) { return this.rentalHandoffs.detail(client(req), id); }
  @Get("applications") applicationsMine(@Req() req: CustomerRequest) { return this.applications.mine(client(req)); }
  @Get("applications/:id") applicationDetail(@Req() req: CustomerRequest, @Param("id") id: string) { return this.applications.detail(client(req), id); }
  @Get("applications/save-operations/:key") applicationSaveOriginal(@Req() req: CustomerRequest, @Param("key") key: string) { return this.applications.readSave(client(req), key); }
  @Post("applications") saveApplication(@Req() req: CustomerRequest, @Body() input: SaveEnterpriseApplicationRequestDto) { return this.applications.save(client(req), input); }
  @Post("applications/:id/withdraw") withdraw(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: EnterpriseChangeRequestDto) { return this.applications.withdraw(client(req), id, input); }
  @Get("applications/:id/withdraw-operations/:key") applicationWithdrawalOriginal(@Req() req: CustomerRequest, @Param("id") id: string, @Param("key") key: string) {
    return this.applications.readWithdrawal(client(req), id, key);
  }
  @Get("my-requests") mine(@Req() req: CustomerRequest) { return this.members.joinRequests(client(req)); }
  @Get("my-relations") ownRelations(@Req() req: CustomerRequest) { return this.members.ownRelations(client(req)); }
  @Post("join-requests/:id/withdraw") withdrawJoin(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: EnterpriseChangeRequestDto) { return this.members.withdrawJoin(client(req), id, input); }
  @Get("join-requests/:id/withdraw-operations/:key") joinWithdrawalOriginal(@Req() req: CustomerRequest, @Param("id") id: string, @Param("key") key: string) {
    return this.members.readJoinWithdrawal(client(req), id, key);
  }
  @Post("invites/preview") previewInvite(@Req() req: CustomerRequest, @Body() input: PreviewEnterpriseInviteRequestDto) { return this.members.previewInvite(client(req), input.inviteCode); }
  @Post("join") join(@Req() req: CustomerRequest, @Body() input: JoinEnterpriseRequestDto) { return this.members.join(client(req), input); }
  @Get("join/request-operations/:key") joinSubmissionOriginal(@Req() req: CustomerRequest, @Param("key") key: string) { return this.members.readJoinSubmission(client(req), key); }
  @Get("corporates/:corporateId/invites") invites(@Req() req: CustomerRequest, @Param("corporateId") id: string) { return this.members.invites(client(req), id); }
  @Get("corporates/:corporateId/invites/create-operations/:key") inviteCreationOriginal(@Req() req: CustomerRequest, @Param("corporateId") id: string, @Param("key") key: string) {
    return this.members.readInviteCreation(client(req), id, key);
  }
  @Post("corporates/:corporateId/invites") createInvite(@Req() req: CustomerRequest, @Param("corporateId") id: string, @Body() input: CreateEnterpriseInviteRequestDto) { return this.members.createInvite(client(req), id, input); }
  @Get("corporates/:corporateId/invites/:id/revoke-operations/:key") inviteRevocationOriginal(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Param("key") key: string) {
    return this.members.readInviteRevocation(client(req), corporate, id, key);
  }
  @Post("corporates/:corporateId/invites/:id/revoke") revoke(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Body() input: EnterpriseChangeRequestDto) { return this.members.revokeInvite(client(req), corporate, id, input); }
  @Get("corporates/:corporateId/join-requests") joins(@Req() req: CustomerRequest, @Param("corporateId") id: string) { return this.members.joinRequests(client(req), id); }
  @Get("corporates/:corporateId/join-requests/:id/decision-operations/:key") joinReviewOriginal(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Param("key") key: string) {
    return this.members.readJoinReview(client(req), corporate, id, key);
  }
  @Post("corporates/:corporateId/join-requests/:id/decision") decideJoin(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Body() input: ReviewEnterpriseJoinRequestDto) { return this.members.decideJoin(client(req), corporate, id, input); }
  @Put("corporates/:corporateId/members/:id") changeMember(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Body() input: ChangeEnterpriseMemberRequestDto) { return this.members.changeMember(client(req), corporate, id, input); }
  @Get("corporates/:corporateId/members/:id/change-operations/:key") memberChangeOriginal(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Param("key") key: string) {
    return this.members.readMemberChange(client(req), corporate, id, key);
  }
  @Get("corporates/:corporateId/members/:id/administrator/change-operations/:key") administratorChangeOriginal(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Param("key") key: string) {
    return this.members.readAdministratorChange(client(req), corporate, id, key);
  }
  @Get("corporates/:corporateId/members/:id/administrator") readAdministrator(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string) {
    return this.members.administrator(client(req), corporate, id);
  }
  @Put("corporates/:corporateId/members/:id/administrator") administrator(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Body() input: ChangeEnterpriseAdministratorRequestDto) {
    return this.members.changeAdministrator(client(req), corporate, id, input);
  }
  @Post("corporates/:corporateId/members/:id/exit") exit(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Body() input: ChangeEnterpriseMemberRequestDto) { return this.members.changeMember(client(req), corporate, id, input, true); }
  @Get("corporates/:corporateId/members/:id/exit-operations/:key") memberExitOriginal(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Param("key") key: string) {
    return this.members.readMemberExit(client(req), corporate, id, key);
  }
  @Post("corporates/:corporateId/transfers") transfer(@Req() req: CustomerRequest, @Param("corporateId") id: string, @Body() input: TransferEnterpriseAdministratorRequestDto) { return this.members.transfer(client(req), id, input); }
  @Get("corporates/:corporateId/transfers/request-operations/:key") transferInitiationOriginal(@Req() req: CustomerRequest, @Param("corporateId") id: string, @Param("key") key: string) {
    return this.members.readTransferInitiation(client(req), id, key);
  }
  @Post("transfers/:id/decision") accept(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: DecideEnterpriseTransferRequestDto) { return this.members.acceptTransfer(client(req), id, input); }
  @Get("transfers/:id/decision-operations/:key") transferDecisionOriginal(@Req() req: CustomerRequest, @Param("id") id: string, @Param("key") key: string) {
    return this.members.readTransferDecision(client(req), id, key);
  }
  @Post("transfers/:id/decision-operations/:key/close") closeTransferDecision(@Req() req: CustomerRequest, @Param("id") id: string, @Param("key") key: string, @Body() input: CloseEnterpriseTransferDecisionDto) {
    return this.members.closeTransferDecision(client(req), id, key, input);
  }
  @Get("corporates/:corporateId/policy") policy(@Req() req: CustomerRequest, @Param("corporateId") id: string) { return this.policies.companyView(client(req), id); }
  @Put("corporates/:corporateId/policy") savePolicy(@Req() req: CustomerRequest, @Param("corporateId") id: string, @Body() input: SaveEnterpriseScopePolicyRequestDto) { return this.policies.companySave(client(req), id, input); }
  @Get("corporates/:corporateId/members/:id/policy") memberPolicy(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string) { return this.policies.companyView(client(req), corporate, id); }
  @Put("corporates/:corporateId/members/:id/policy") saveMemberPolicy(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Body() input: SaveEnterpriseScopePolicyRequestDto) { return this.policies.companySave(client(req), corporate, input, id); }
  @Get("corporates/:corporateId/policy/save-operations/:key") policySaveOriginal(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("key") key: string) { return this.policies.readCompanySave(client(req), corporate, key); }
  @Get("corporates/:corporateId/members/:id/policy/save-operations/:key") memberPolicySaveOriginal(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Param("key") key: string) { return this.policies.readCompanySave(client(req), corporate, key, id); }
  @Get("my-rental-policies") ownRentalPolicies(@Req() req: CustomerRequest) { return this.policies.ownRentalPolicies(client(req)); }
  @Get("quotes/:quoteId/order-operations/:key") orderOriginal(@Req() req: CustomerRequest, @Param("quoteId") quoteId: string, @Param("key") key: string) {
    return this.approvals.orderOriginal(client(req), quoteId, key);
  }
  @Get("orders/:orderId/extension-eligibility") extensionEligibility(@Req() req: CustomerRequest, @Param("orderId") id: string) { return this.extensions.eligibility(client(req), id); }
  @Get("orders/:orderId/extension-request-operations/:key") extensionRequestOriginal(@Req() req: CustomerRequest, @Param("orderId") id: string, @Param("key") key: string) { return this.extensions.requestOriginal(client(req), id, key); }
  @Post("orders/:orderId/extension-request-operations/:key/close") closeExtensionRequest(@Req() req: CustomerRequest, @Param("orderId") id: string, @Param("key") key: string, @Body() input: CloseEnterpriseExtensionRequestDto) { return this.extensions.closeRequest(client(req), id, key, input); }
  @Get("orders/:orderId/exchange-request-operations/:key") exchangeRequestOriginal(@Req() req: CustomerRequest, @Param("orderId") id: string, @Param("key") key: string) { return this.exchanges.requestOriginal(client(req), id, key); }
  @Post("orders/:orderId/exchange-request-operations/:key/close") closeExchangeRequest(@Req() req: CustomerRequest, @Param("orderId") id: string, @Param("key") key: string, @Body() input: CloseEnterpriseExchangeRequestDto) { return this.exchanges.closeRequest(client(req), id, key, input); }
  @Get("orders/:orderId/exchange-approvals") orderExchangeApprovals(@Req() req: CustomerRequest, @Param("orderId") id: string) { return this.exchanges.orderApprovals(client(req), id); }
  @Get("orders/:orderId/exchange-choices") exchangeChoices(@Req() req: CustomerRequest, @Param("orderId") id: string, @Query() query: EnterpriseExchangeChoicesQueryDto) { return this.exchanges.choices(client(req), id, query); }
  @Get("my-exchange-approvals") ownExchangeApprovals(@Req() req: CustomerRequest) { return this.exchanges.list(client(req)); }
  @Get("corporates/:corporateId/exchange-approvals") exchangeApprovals(@Req() req: CustomerRequest, @Param("corporateId") id: string) { return this.exchanges.list(client(req), id); }
  @Post("exchange-approvals") requestExchangeApproval(@Req() req: CustomerRequest, @Body() input: RequestEnterpriseExchangeApprovalDto) { return this.exchanges.request(client(req), input); }
  @Get("exchange-approvals/:id") exchangeOriginal(@Req() req: CustomerRequest, @Param("id") id: string) { return this.exchanges.original(client(req), id); }
  @Post("exchange-approvals/:id/expense-confirmation") confirmExchangeExpense(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: ConfirmEnterpriseExchangeExpenseDto) { return this.exchanges.confirmExpense(client(req), id, input); }
  @Get("exchange-approvals/:id/expense-confirmation") exchangeConfirmationOriginal(@Req() req: CustomerRequest, @Param("id") id: string) { return this.exchanges.confirmationOriginal(client(req), id); }
  @Post("exchange-approvals/:id/decision") decideExchangeApproval(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: DecideEnterpriseExchangeApprovalDto) { return this.exchanges.decide(client(req), id, input); }
  @Get("my-extension-approvals") ownExtensionApprovals(@Req() req: CustomerRequest) { return this.extensions.list(client(req)); }
  @Get("corporates/:corporateId/extension-approvals") extensionApprovals(@Req() req: CustomerRequest, @Param("corporateId") id: string) { return this.extensions.list(client(req), id); }
  @Post("extension-approvals") requestExtensionApproval(@Req() req: CustomerRequest, @Body() input: RequestEnterpriseExtensionApprovalDto) { return this.extensions.request(client(req), input); }
  @Post("extension-approvals/:id/decision") decideExtensionApproval(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: DecideEnterpriseExtensionApprovalDto) { return this.extensions.decide(client(req), id, input); }
  @Get("extension-approvals/:id/result") extensionOriginal(@Req() req: CustomerRequest, @Param("id") id: string) { return this.extensions.result(client(req), id); }
  @Post("extension-approvals/:id/close-execution") closeExtensionApproval(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: CloseEnterpriseExtensionExecutionDto) { return this.extensions.closeExecution(client(req), id, input); }
  @Post("extension-approvals/submit") submitExtensionApproval(@Req() req: CustomerRequest, @Body() input: SubmitEnterpriseExtensionApprovalDto) { return this.extensions.submit(client(req), input); }
  @Get("my-approvals") ownApprovals(@Req() req: CustomerRequest) { return this.approvals.list(client(req)); }
  @Post("approvals") requestApproval(@Req() req: CustomerRequest, @Body() input: RequestEnterpriseBookingApprovalDto) { return this.approvals.request(client(req), input); }
  @Get("corporates/:corporateId/approvals") approvalsList(@Req() req: CustomerRequest, @Param("corporateId") id: string) { return this.approvals.list(client(req), id); }
  @Post("approvals/:id/decision") decideApproval(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: DecideEnterpriseBookingApprovalDto) { return this.approvals.decide(client(req), id, input); }
  @Get("approvals/:id/result") approvalResult(@Req() req: CustomerRequest, @Param("id") id: string) { return this.approvals.result(client(req), id); }
  @Post("approvals/:id/close-execution") closeApproval(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: CloseEnterpriseApprovalExecutionDto) { return this.approvals.closeExecution(client(req), id, input); }
  @Post("approvals/submit") submitApproval(@Req() req: CustomerRequest, @Body() input: SubmitEnterpriseApprovedBookingDto) { return this.approvals.submit(client(req), input); }
  @Get("operations/:key") async operation(@Req() req: CustomerRequest, @Param("key") key: string) {
    const context = client(req); await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const rows = await this.prisma.$queryRaw<Array<{ result: string | object }>>`SELECT result FROM enterprise_portal_operations WHERE tenantId=${context.tenantId} AND operationKey=${key} AND actorUserId=${`customer:${context.customerId}`}`;
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return rows[0] ? { state: "committed", result: enterpriseJson(rows[0].result) } : { state: "not_recorded" };
  }
  @Get("authority/upload-operations/:key") async authorityOriginal(@Req() req: CustomerRequest, @Param("key") key: string) {
    const context = client(req); await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const session = await this.prisma.fileUploadSession.findFirst({ where: { tenantId: context.tenantId, idempotencyKey: key }, include: { fileAsset: true } });
    const asset = session?.fileAsset;
    if (!session || !asset || asset.businessType !== "customer" || asset.businessId !== context.customerId || asset.uploadedBy !== context.customerId || asset.uploadScene !== "enterprise-authority") return { state: "not_recorded" };
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return { state: "observed", session: { sessionId: session.id, fileAssetId: asset.id, provider: session.provider, mode: session.provider === "local_mock" ? "simulation" : "provider", status: session.status, expiresAt: session.expiresAt.toISOString() }, file: { id: asset.id, fileName: asset.fileName, status: asset.status } };
  }
  @Post("authority/upload-sessions") async authorityUpload(@Req() req: CustomerRequest, @Body() input: EnterpriseAuthorityUploadRequestDto) {
    const context = client(req); await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const config = await this.integrations.runtimeConfig("file", context.tenantId);
    if (!config) throw new ServiceUnavailableException("授权材料需要已配置真实文件存储，不能模拟归档");
    return this.files.createUploadSession(context.tenantId, { ...input, businessModule: "membership", businessType: "customer", businessId: context.customerId, uploadScene: "enterprise-authority" }, { businessType: "customer", businessId: context.customerId, uploadScene: "enterprise-authority", actorUserId: context.customerId });
  }
  @Post("authority/upload-sessions/:id/complete") async authorityComplete(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: ClientQualificationUploadCompleteRequestDto) {
    const context = client(req); await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return this.files.completeUpload(context.tenantId, id, input, { businessType: "customer", businessId: context.customerId, uploadScene: "enterprise-authority", actorUserId: context.customerId });
  }
}
