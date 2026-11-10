/** Current customer's task/receipt projections from durable originals, not a new
 * notification sender. Corporate queues recheck their exact action and workspace. */
import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { EnterpriseAuditView, EnterpriseTaskCenter, EnterpriseTaskItem } from "@rental-os/shared";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { PrismaService } from "../database/prisma.service";
import { EnterpriseApplicationService } from "./enterprise-application.service";
import { EnterpriseApprovalService } from "./enterprise-approval.service";
import { EnterpriseExtensionApprovalService } from "./enterprise-extension-approval.service";
import { EnterpriseCommandService } from "./enterprise-command.service";
import { EnterpriseMembersService } from "./enterprise-members.service";
import { EnterpriseManagementRequestService } from "./enterprise-management-request.service";
@Injectable()
export class EnterpriseTaskCenterService {
  constructor(private readonly prisma: PrismaService, private readonly commands: EnterpriseCommandService,
    private readonly applications: EnterpriseApplicationService, private readonly members: EnterpriseMembersService,
    private readonly approvals: EnterpriseApprovalService, private readonly access: EnterpriseAccessService, private readonly management: EnterpriseManagementRequestService, private readonly extensions: EnterpriseExtensionApprovalService) {}
  async tasks(context: ClientRequestContext, corporateId?: string): Promise<EnterpriseTaskCenter> {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const applications = await this.applications.mine(context), own = await this.members.joinRequests(context);
    const items: EnterpriseTaskItem[] = [...applications, ...own].map(row => ({ id: row.id, kind: row.kind as EnterpriseTaskItem["kind"], state: row.state,
      revision: row.revision, corporateCustomerId: row.corporateCustomerId ?? undefined, createdAt: row.createdAt,
      requiresAction: row.state === "supplement_required" || row.kind === "administrator_transfer" && row.state === "pending",
      page: row.kind === "corporate_application" ? "applications" : "join" }));
    const management = await this.management.mine(context);
    items.push(...management.map(row => ({ id: row.id, kind: "management_request" as const, state: row.state, revision: row.revision,
      corporateCustomerId: row.corporateCustomerId, createdAt: row.createdAt, requiresAction: row.state === "supplement_required", page: "profile" as const })));
    // Own originals remain readable for a restricted (not exited/closed) customer.
    // Current corporate authority comes from requireAction, never this cached status.
    {
      const approvals = await this.approvals.list(context);
      items.push(...approvals.map(row => ({ id: row.id, kind: "booking_approval" as const, state: row.state, revision: row.revision,
        corporateCustomerId: row.corporateCustomerId, expiresAt: row.expiresAt, requiresAction: ["approved", "executing"].includes(row.state), page: "approvals" as const })));
      const extensions = await this.extensions.list(context);
      items.push(...extensions.map(row => ({ id: row.id, kind: "extension_approval" as const, state: row.state, revision: row.revision,
        corporateCustomerId: row.corporateCustomerId, expiresAt: row.expiresAt, requiresAction: row.state === "approved", page: "extension-approvals" as const })));
      if (corporateId) {
        const corporate = await this.access.requireAction(context, corporateId, "portal:enter");
        if (corporate.actions.includes("members:manage")) {
          const joins = await this.members.joinRequests(context, corporateId);
          items.push(...joins.filter(row => row.state === "pending").map(row => ({ id: row.id, kind: "join_request" as const, state: row.state,
            revision: row.revision, corporateCustomerId: corporateId, createdAt: row.createdAt, requiresAction: true, page: "join-requests" as const })));
        }
        if (corporate.actions.includes("approvals:review")) {
          const queue = await this.approvals.list(context, corporateId);
          items.push(...queue.filter(row => row.state === "pending" && row.applicantCustomerId !== context.customerId).map(row => ({ id: row.id,
            kind: "booking_approval" as const, state: row.state, revision: row.revision, corporateCustomerId: corporateId,
            expiresAt: row.expiresAt, requiresAction: true, page: "approvals" as const })));
          const extensionQueue = await this.extensions.list(context, corporateId);
          items.push(...extensionQueue.filter(row => row.state === "pending" && row.applicantCustomerId !== context.customerId).map(row => ({ id: row.id,
            kind: "extension_approval" as const, state: row.state, revision: row.revision, corporateCustomerId: corporateId,
            expiresAt: row.expiresAt, requiresAction: true, page: "extension-approvals" as const })));
        }
        const after = await this.access.requireAction(context, corporateId, "portal:enter");
        if (corporate.permissionRevision !== after.permissionRevision || corporate.actions.some(action => !after.actions.includes(action))) throw new ConflictException("企业任务权限已变化，请重新读取");
      }
    }
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const unique = [...new Map(items.map(row => [`${row.kind}:${row.id}:${row.page}`, row])).values()];
    if (unique.length > 200) throw new ConflictException("企业待办超过当前有界读取范围，请按原任务页核对");
    return { items: unique,
      coverage: "own_requests_and_current_workspace_approvals", unavailable: ["order_alerts", "financial_alerts", "external_notifications"] };
  }
  async ownAudit(context: ClientRequestContext): Promise<EnterpriseAuditView[]> {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const rows = await this.prisma.$queryRaw<Array<{ operationKey: string; target: string; reason: string; createdAt: Date }>>`
      SELECT operationKey,target,reason,createdAt FROM enterprise_portal_operations
      WHERE tenantId=${context.tenantId} AND actorUserId=${`customer:${context.customerId}`} ORDER BY createdAt DESC,operationKey DESC LIMIT 201`;
    if (rows.length > 200) throw new ConflictException("本人原操作记录超出当前有界读取范围");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return rows.map(row => ({ operationKey: row.operationKey, action: row.target.split(":", 1)[0], target: row.target,
      reason: row.reason, actor: context.customerId, createdAt: row.createdAt.toISOString() }));
  }
}
