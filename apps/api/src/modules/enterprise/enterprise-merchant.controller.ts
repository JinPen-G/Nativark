/** Merchant decisions and authority evidence remain in the original operator authentication realm. */
import { Body, Controller, Get, Param, Post, Put, Req, Res, ForbiddenException } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { FileStorageRuntimeService } from "../integrations/file-storage.runtime.service";
import { EnterpriseApplicationService } from "./enterprise-application.service";
import { EnterpriseCommandService, enterpriseJson } from "./enterprise-command.service";
import { EnterpriseMembersService } from "./enterprise-members.service";
import { EnterprisePolicyService } from "./enterprise-policy.service";
import { EnterpriseManagementRequestService } from "./enterprise-management-request.service";
import { ReviewEnterpriseManagementRequestDto } from "./enterprise-request.dto";
import { ReviewEnterpriseApplicationRequestDto, SaveEnterpriseInvitePolicyRequestDto, SaveEnterpriseScopePolicyRequestDto } from "./enterprise-request.dto";
interface OperatorRequest { user?: SystemUserRow }
@Controller("membership/enterprise-workflows")
export class EnterpriseMerchantController {
  constructor(private readonly applications: EnterpriseApplicationService, private readonly members: EnterpriseMembersService, private readonly commands: EnterpriseCommandService, private readonly prisma: PrismaService, private readonly policies: EnterprisePolicyService, private readonly files: FileStorageRuntimeService, private readonly management: EnterpriseManagementRequestService) {}
  @Get("management-requests") managementList(@Req() req: OperatorRequest) { return this.management.merchantList(req.user!); }
  @Post("management-requests/:id/decision") managementDecision(@Req() req: OperatorRequest, @Param("id") id: string, @Body() input: ReviewEnterpriseManagementRequestDto) { return this.management.review(req.user!, id, input); }
  @Get("management-requests/:id/files/:fileId") async managementFile(@Req() req: OperatorRequest, @Param("id") id: string, @Param("fileId") fileId: string, @Res() response: { setHeader: (name: string, value: string) => void; send: (body: Buffer) => void }) {
    const before = await this.management.evidenceOwner(req.user!, id, fileId);
    const result = await this.files.readAuthorityBytes(before.tenantId, fileId, before.applicantCustomerId);
    const after = await this.management.evidenceOwner(req.user!, id, fileId);
    if (after.revision !== before.revision || after.applicantCustomerId !== before.applicantCustomerId) throw new ForbiddenException("申请附件关联已变化");
    response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Type", result.mimeType); response.setHeader("Content-Disposition", "attachment; filename=enterprise-request-evidence"); response.send(result.content);
  }
  @Get("applications") applicationsList(@Req() req: OperatorRequest) { return this.applications.merchantList(req.user!); }
  @Post("applications/:id/decision") decision(@Req() req: OperatorRequest, @Param("id") id: string, @Body() input: ReviewEnterpriseApplicationRequestDto) { return this.applications.review(req.user!, id, input); }
  @Get("operations/:key") async operation(@Req() req: OperatorRequest, @Param("key") key: string) {
    const { tenantId, actor } = this.commands.operator(req.user!, "rental-os:corporate:manage");
    const rows = await this.prisma.$queryRaw<Array<{ result: string | object }>>`SELECT result FROM enterprise_portal_operations WHERE tenantId=${tenantId} AND operationKey=${key} AND actorUserId=${actor}`;
    this.commands.operator(req.user!, "rental-os:corporate:manage");
    return rows[0] ? { state: "committed", result: enterpriseJson(rows[0].result) } : { state: "not_recorded" };
  }
  @Get("applications/:id/files/:fileId") async authorityFile(@Req() req: OperatorRequest, @Param("id") id: string, @Param("fileId") fileId: string, @Res() response: { setHeader: (name: string, value: string) => void; send: (body: Buffer) => void }) {
    const { tenantId } = this.commands.operator(req.user!, "rental-os:corporate:manage");
    const rows = await this.prisma.$queryRaw<Array<{ applicantCustomerId: string; payload: string | { evidenceFileIds?: string[] } }>>`SELECT applicantCustomerId,payload FROM enterprise_workflow_requests WHERE tenantId=${tenantId} AND id=${id} AND kind='corporate_application'`;
    if (!rows[0] || !enterpriseJson(rows[0].payload).evidenceFileIds?.includes(fileId)) throw new ForbiddenException("材料不属于此商户申请");
    const result = await this.files.readAuthorityBytes(tenantId, fileId, rows[0].applicantCustomerId);
    this.commands.operator(req.user!, "rental-os:corporate:manage");
    response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Type", result.mimeType); response.setHeader("Content-Disposition", "attachment; filename=authority-evidence");
    response.send(result.content);
  }
  @Get("corporates/:corporateId/policy") scopePolicy(@Req() req: OperatorRequest, @Param("corporateId") id: string) { return this.policies.merchantView(req.user!, id); }
  @Put("corporates/:corporateId/policy") saveScopePolicy(@Req() req: OperatorRequest, @Param("corporateId") id: string, @Body() input: SaveEnterpriseScopePolicyRequestDto) { return this.policies.merchantSave(req.user!, id, input); }
  @Get("invite-policy") policy(@Req() req: OperatorRequest) { return this.members.merchantPolicy(req.user!); }
  @Put("invite-policy") savePolicy(@Req() req: OperatorRequest, @Body() input: SaveEnterpriseInvitePolicyRequestDto) { return this.members.savePolicy(req.user!, input); }
}
