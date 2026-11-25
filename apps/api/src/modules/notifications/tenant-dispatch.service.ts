/** 原寄件中心注入入口。Rental原日志和空间联接通过真实业务参加者进入公共查询及安全投影。 */
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PlatformTenantDispatchService } from "@rental-os/platform-server/messaging";
import { OperationLogService } from "../../common/operation-log.service";
import { PrismaService } from "../database/prisma.service";
import { PlatformRepository } from "../platform/platform.repository";

@Injectable()
export class TenantDispatchService extends PlatformTenantDispatchService {
  constructor(prisma: PrismaService, accounts: PlatformRepository, audit: OperationLogService) {
    super(prisma, accounts, audit, {
      query(tenantId) {
        return Prisma.sql`
      SELECT n.id, 'rental' AS source, n.channel, n.recipient, n.renderedTitle AS subject, n.status, n.provider,
        w.name AS workspaceName, n.businessObjectType AS businessType, n.businessObjectId AS businessId, n.createdAt, n.sentAt
      FROM rental_notification_logs n JOIN business_workspaces w ON w.tenantId = n.tenantId AND w.id = n.workspaceId
      WHERE n.tenantId = ${tenantId} AND n.channel IN ('sms', 'email')`;
      },
      async detail(tenantId, id, channel) {
        const row = await prisma.rentalNotificationLog.findFirst({ where: { id, tenantId, channel },
          select: { id: true, channel: true, recipient: true, renderedTitle: true, renderedBody: true, status: true, provider: true,
            templateVersion: true, providerMessageId: true, errorMessage: true, attempts: true, businessObjectType: true,
            businessObjectId: true, createdAt: true, sentAt: true, workspace: { select: { name: true } } } });
        if (!row) return null;
        return { ...row, source: "rental", channel, subject: row.renderedTitle, workspaceName: row.workspace.name,
          businessType: row.businessObjectType, businessId: row.businessObjectId, renderedText: row.renderedBody,
          templateVersion: row.templateVersion, providerMessageId: row.providerMessageId ?? undefined,
          errorMessage: row.errorMessage ?? undefined, attempts: row.attempts };
      }
    });
  }
}
