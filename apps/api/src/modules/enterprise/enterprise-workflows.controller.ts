/** Customer enterprise workflows and merchant decisions use separate authentication realms. */
import { Body, Controller, Get, Param, Post, Put, Req, UnauthorizedException, ServiceUnavailableException } from "@nestjs/common";
import type { ClientRequestContext } from "../client/client-auth.service";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { FileStorageRuntimeService } from "../integrations/file-storage.runtime.service";
import { TenantIntegrationService } from "../integrations/tenant-integration.service";
import { ClientQualificationUploadCompleteRequestDto } from "../client/client-request.dto";
import { EnterpriseApplicationService } from "./enterprise-application.service";
import { EnterpriseCommandService, enterpriseJson } from "./enterprise-command.service";
import { EnterpriseMembersService } from "./enterprise-members.service";
import { EnterprisePolicyService } from "./enterprise-policy.service";
import { EnterpriseApprovalService } from "./enterprise-approval.service";
import { EnterpriseExtensionApprovalService } from "./enterprise-extension-approval.service";
import { RequestEnterpriseExtensionApprovalDto, DecideEnterpriseExtensionApprovalDto, SubmitEnterpriseExtensionApprovalDto, CloseEnterpriseExtensionExecutionDto } from "./enterprise-extension-request.dto";
import { EnterpriseTaskCenterService } from "./enterprise-task-center.service";
import { EnterpriseManagementRequestService } from "./enterprise-management-request.service";
import { CloseEnterpriseApprovalExecutionDto, SaveEnterpriseManagementRequestDto } from "./enterprise-request.dto";
import { PreviewEnterpriseInviteRequestDto, ChangeEnterpriseAdministratorRequestDto, ChangeEnterpriseMemberRequestDto, CreateEnterpriseInviteRequestDto, DecideEnterpriseTransferRequestDto, EnterpriseChangeRequestDto, JoinEnterpriseRequestDto, ReviewEnterpriseJoinRequestDto, SaveEnterpriseApplicationRequestDto, TransferEnterpriseAdministratorRequestDto, SaveEnterpriseScopePolicyRequestDto, RequestEnterpriseBookingApprovalDto, DecideEnterpriseBookingApprovalDto, SubmitEnterpriseApprovedBookingDto, EnterpriseAuthorityUploadRequestDto } from "./enterprise-request.dto";
interface CustomerRequest { client?: ClientRequestContext }
const client = (request: CustomerRequest) => { if (!request.client) throw new UnauthorizedException("请先登录客户账号"); return request.client; };
@Controller("client/v1/enterprise")
export class EnterpriseWorkflowsController {
  constructor(private readonly applications: EnterpriseApplicationService, private readonly members: EnterpriseMembersService, private readonly commands: EnterpriseCommandService, private readonly prisma: PrismaService, private readonly files: FileStorageRuntimeService, private readonly integrations: TenantIntegrationService, private readonly policies: EnterprisePolicyService, private readonly approvals: EnterpriseApprovalService, private readonly tasks: EnterpriseTaskCenterService, private readonly management: EnterpriseManagementRequestService, private readonly extensions: EnterpriseExtensionApprovalService) {}
  @Get("corporates/:corporateId/profile") profile(@Req() req: CustomerRequest, @Param("corporateId") id: string) { return this.management.profile(client(req), id); }
  @Get("management-requests") managementMine(@Req() req: CustomerRequest) { return this.management.mine(client(req)); }
  @Post("corporates/:corporateId/management-requests") saveManagement(@Req() req: CustomerRequest, @Param("corporateId") id: string, @Body() input: SaveEnterpriseManagementRequestDto) { return this.management.save(client(req), id, input); }
  @Post("management-requests/:id/withdraw") withdrawManagement(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: EnterpriseChangeRequestDto) { return this.management.withdraw(client(req), id, input); }
  @Get("tasks") tasksMine(@Req() req: CustomerRequest) { return this.tasks.tasks(client(req)); }
  @Get("corporates/:corporateId/tasks") corporateTasks(@Req() req: CustomerRequest, @Param("corporateId") id: string) { return this.tasks.tasks(client(req), id); }
  @Get("my-audit") auditMine(@Req() req: CustomerRequest) { return this.tasks.ownAudit(client(req)); }
  @Get("applications") applicationsMine(@Req() req: CustomerRequest) { return this.applications.mine(client(req)); }
  @Post("applications") saveApplication(@Req() req: CustomerRequest, @Body() input: SaveEnterpriseApplicationRequestDto) { return this.applications.save(client(req), input); }
  @Post("applications/:id/withdraw") withdraw(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: EnterpriseChangeRequestDto) { return this.applications.withdraw(client(req), id, input); }
  @Get("my-requests") mine(@Req() req: CustomerRequest) { return this.members.joinRequests(client(req)); }
  @Get("my-relations") ownRelations(@Req() req: CustomerRequest) { return this.members.ownRelations(client(req)); }
  @Post("join-requests/:id/withdraw") withdrawJoin(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: EnterpriseChangeRequestDto) { return this.members.withdrawJoin(client(req), id, input); }
  @Post("invites/preview") previewInvite(@Req() req: CustomerRequest, @Body() input: PreviewEnterpriseInviteRequestDto) { return this.members.previewInvite(client(req), input.inviteCode); }
  @Post("join") join(@Req() req: CustomerRequest, @Body() input: JoinEnterpriseRequestDto) { return this.members.join(client(req), input); }
  @Get("corporates/:corporateId/invites") invites(@Req() req: CustomerRequest, @Param("corporateId") id: string) { return this.members.invites(client(req), id); }
  @Post("corporates/:corporateId/invites") createInvite(@Req() req: CustomerRequest, @Param("corporateId") id: string, @Body() input: CreateEnterpriseInviteRequestDto) { return this.members.createInvite(client(req), id, input); }
  @Post("corporates/:corporateId/invites/:id/revoke") revoke(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Body() input: EnterpriseChangeRequestDto) { return this.members.revokeInvite(client(req), corporate, id, input); }
  @Get("corporates/:corporateId/join-requests") joins(@Req() req: CustomerRequest, @Param("corporateId") id: string) { return this.members.joinRequests(client(req), id); }
  @Post("corporates/:corporateId/join-requests/:id/decision") decideJoin(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Body() input: ReviewEnterpriseJoinRequestDto) { return this.members.decideJoin(client(req), corporate, id, input); }
  @Put("corporates/:corporateId/members/:id") changeMember(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Body() input: ChangeEnterpriseMemberRequestDto) { return this.members.changeMember(client(req), corporate, id, input); }
  @Get("corporates/:corporateId/members/:id/administrator") readAdministrator(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string) {
    return this.members.administrator(client(req), corporate, id);
  }
  @Put("corporates/:corporateId/members/:id/administrator") administrator(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Body() input: ChangeEnterpriseAdministratorRequestDto) {
    return this.members.changeAdministrator(client(req), corporate, id, input);
  }
  @Post("corporates/:corporateId/members/:id/exit") exit(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Body() input: ChangeEnterpriseMemberRequestDto) { return this.members.changeMember(client(req), corporate, id, input, true); }
  @Post("corporates/:corporateId/transfers") transfer(@Req() req: CustomerRequest, @Param("corporateId") id: string, @Body() input: TransferEnterpriseAdministratorRequestDto) { return this.members.transfer(client(req), id, input); }
  @Post("transfers/:id/decision") accept(@Req() req: CustomerRequest, @Param("id") id: string, @Body() input: DecideEnterpriseTransferRequestDto) { return this.members.acceptTransfer(client(req), id, input); }
  @Get("corporates/:corporateId/policy") policy(@Req() req: CustomerRequest, @Param("corporateId") id: string) { return this.policies.companyView(client(req), id); }
  @Put("corporates/:corporateId/policy") savePolicy(@Req() req: CustomerRequest, @Param("corporateId") id: string, @Body() input: SaveEnterpriseScopePolicyRequestDto) { return this.policies.companySave(client(req), id, input); }
  @Get("corporates/:corporateId/members/:id/policy") memberPolicy(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string) { return this.policies.companyView(client(req), corporate, id); }
  @Put("corporates/:corporateId/members/:id/policy") saveMemberPolicy(@Req() req: CustomerRequest, @Param("corporateId") corporate: string, @Param("id") id: string, @Body() input: SaveEnterpriseScopePolicyRequestDto) { return this.policies.companySave(client(req), corporate, input, id); }
  @Get("my-rental-policies") ownRentalPolicies(@Req() req: CustomerRequest) { return this.policies.ownRentalPolicies(client(req)); }
  @Get("quotes/:quoteId/order-operations/:key") orderOriginal(@Req() req: CustomerRequest, @Param("quoteId") quoteId: string, @Param("key") key: string) {
    return this.approvals.orderOriginal(client(req), quoteId, key);
  }
  @Get("orders/:orderId/extension-eligibility") extensionEligibility(@Req() req: CustomerRequest, @Param("orderId") id: string) { return this.extensions.eligibility(client(req), id); }
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
