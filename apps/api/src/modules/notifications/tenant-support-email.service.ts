/** 租户客服邮箱：受权人员显式同步原IMAP邮件，以原服务器UID幂等保存安全文本。
 * 不修改邮箱、不生成客户/订单关联、不自动回复或执行邮件正文中的指令。 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type { SyncTenantSupportEmailsResult, TenantSupportEmailDetail, TenantSupportEmailPage, TenantSupportEmailQuery, TenantSupportEmailRow } from "@rental-os/shared";
import { isDeepStrictEqual } from "node:util";
import { getRequestIdentity, requireRequestTenantId } from "../../common/request-identity";
import { OperationLogService } from "../../common/operation-log.service";
import { PrismaService } from "../database/prisma.service";
import { PlatformRepository } from "../platform/platform.repository";
import { TenantEmailRuntimeService } from "../integrations/tenant-email.runtime.service";
import { imapConnection, readImapMailbox } from "../integrations/imap-reader";
import { smtpConnection } from "../integrations/smtp-transport";
import { requireMessagingStorage } from "./tenant-messaging-storage";

type StoredEmail = { id: string; tenantId: string; senderEmail: string; senderName: string; recipient: string; subject: string;
  bodyText: string; attachments: TenantSupportEmailDetail["attachments"] | string; messageId: string | null; receivedAt: Date; };
type StoredMailbox = { id: string; uidValidity: string | null; lastUid: bigint; lastSyncedAt: Date | null; };
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const attachmentRows = (value: StoredEmail["attachments"]) => typeof value === "string" ? JSON.parse(value) as TenantSupportEmailDetail["attachments"] : value;

@Injectable()
export class TenantSupportEmailService {
  constructor(private readonly prisma: PrismaService, private readonly accounts: PlatformRepository,
    private readonly emailRuntime: TenantEmailRuntimeService, private readonly audit: OperationLogService) {}
  private async authorize() {
    const identity = getRequestIdentity();
    if (!identity?.userId || identity.isSaasAdmin || identity.audience !== "operator") throw new ForbiddenException("需要当前租户客服邮箱管理身份");
    const tenantId = requireRequestTenantId();
    await this.accounts.assertTenantManagementPermission(tenantId, identity.userId, "system:integration:manage");
    return { tenantId, userId: identity.userId };
  }
  private project(row: StoredEmail): TenantSupportEmailRow {
    return { id: row.id, senderEmail: row.senderEmail, senderName: row.senderName, subject: row.subject,
      preview: row.bodyText.replace(/\s+/gu, " ").slice(0, 160), receivedAt: row.receivedAt.toISOString(), attachmentCount: attachmentRows(row.attachments).length };
  }
  async list(query: TenantSupportEmailQuery = {}): Promise<TenantSupportEmailPage> {
    const { tenantId } = await this.authorize();
    const page = query.page ?? 1, pageSize = query.pageSize ?? 30, keyword = query.search?.trim() ?? "";
    if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || keyword.length > 100)
      throw new BadRequestException("邮件查询参数无效");
    const where = Prisma.sql`WHERE tenantId = ${tenantId} ${keyword ? Prisma.sql`AND (LOCATE(${keyword}, subject) > 0 OR LOCATE(${keyword}, senderEmail) > 0 OR LOCATE(${keyword}, senderName) > 0)` : Prisma.empty}`;
    const [rows, counts, config, sync] = await requireMessagingStorage(() => Promise.all([
      this.prisma.$queryRaw<StoredEmail[]>(Prisma.sql`SELECT id, tenantId, senderEmail, senderName, recipient, subject, LEFT(bodyText, 320) AS bodyText, attachments, messageId, receivedAt FROM tenant_support_emails ${where} ORDER BY receivedAt DESC, id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
      this.prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*) AS total FROM tenant_support_emails ${where}`),
      this.prisma.tenantIntegrationConfig.findFirst({ where: { tenantId, capability: "email", provider: "smtp", enabled: true, isDefault: true }, select: { settings: true, lastTestStatus: true, lastTestMode: true } }),
      this.prisma.$queryRaw<Array<{ lastSyncedAt: Date | null }>>(Prisma.sql`SELECT MAX(lastSyncedAt) AS lastSyncedAt FROM tenant_support_mailboxes WHERE tenantId = ${tenantId}`)
    ]));
    const receiving = Boolean(config && (config.settings as Record<string, unknown> | null)?.receiveEnabled === true && config.lastTestStatus === "passed" && config.lastTestMode === "live");
    return { rows: rows.map(row => this.project(row)), total: Number(counts[0]?.total ?? 0), page, pageSize,
      receiverConfigured: receiving, lastSyncedAt: sync[0]?.lastSyncedAt?.toISOString() };
  }
  async detail(id: string): Promise<TenantSupportEmailDetail> {
    const actor = await this.authorize();
    if (!/^[A-Za-z0-9._:-]{1,191}$/u.test(id)) throw new BadRequestException("邮件定位无效");
    const row = (await this.prisma.$queryRaw<StoredEmail[]>(Prisma.sql`SELECT id, tenantId, senderEmail, senderName, recipient, subject, bodyText, attachments, messageId, receivedAt FROM tenant_support_emails WHERE tenantId = ${actor.tenantId} AND id = ${id} LIMIT 1`))[0];
    if (!row) throw new NotFoundException("客诉邮件不存在");
    await this.audit.record({ ...actor, action: "support.email.read", targetType: "support-email", targetId: id, requireSuccess: true });
    return { ...this.project(row), recipient: row.recipient, bodyText: row.bodyText, messageId: row.messageId ?? undefined, attachments: attachmentRows(row.attachments) };
  }
  async sync(): Promise<SyncTenantSupportEmailsResult> {
    const actor = await this.authorize(), identity = structuredClone(getRequestIdentity());
    const config = await this.emailRuntime.configuration(actor.tenantId);
    if (config.settings.receiveEnabled !== true) throw new BadRequestException("请先在邮箱配置中启用客诉邮件接收");
    const connection = imapConnection(config.settings, smtpConnection(config.settings, config.credentials));
    const fingerprint = sha(JSON.stringify([connection.host, connection.port, connection.mailbox, connection.username]));
    const mailboxId = `mailbox_${sha(`${actor.tenantId}:${config.id}:${fingerprint}`).slice(0, 48)}`, lease = randomUUID();
    await this.prisma.$executeRaw(Prisma.sql`INSERT INTO tenant_support_mailboxes (id, tenantId, configId, mailboxFingerprint, lastUid, createdAt, updatedAt)
      VALUES (${mailboxId}, ${actor.tenantId}, ${config.id}, ${fingerprint}, 0, NOW(3), NOW(3)) ON DUPLICATE KEY UPDATE id = id`);
    const claimed = await this.prisma.$executeRaw(Prisma.sql`UPDATE tenant_support_mailboxes SET leaseToken = ${lease}, leaseUntil = DATE_ADD(NOW(3), INTERVAL 120 SECOND), updatedAt = NOW(3)
      WHERE tenantId = ${actor.tenantId} AND id = ${mailboxId} AND (leaseUntil IS NULL OR leaseUntil < NOW(3))`);
    if (claimed !== 1) throw new ConflictException("邮箱正在同步，请稍后刷新");
    try {
      const mailbox = (await this.prisma.$queryRaw<StoredMailbox[]>(Prisma.sql`SELECT id, uidValidity, lastUid, lastSyncedAt FROM tenant_support_mailboxes WHERE tenantId = ${actor.tenantId} AND id = ${mailboxId}`))[0];
      const result = await readImapMailbox(connection, { cursor: mailbox.uidValidity ? { uidValidity: mailbox.uidValidity, uid: Number(mailbox.lastUid) } : undefined });
      if (!isDeepStrictEqual(identity, getRequestIdentity())) throw new ForbiddenException("同步期间身份或范围已变化");
      const syncedAt = new Date();
      const saved = await this.prisma.$transaction(async tx => {
        await this.accounts.assertTenantManagementPermission(actor.tenantId, actor.userId, "system:integration:manage", tx);
        const activeConfig = await tx.tenantIntegrationConfig.findFirst({ where: { id: config.id, tenantId: actor.tenantId, enabled: true, isDefault: true }, select: { updatedAt: true, settings: true } });
        if (!activeConfig || !config.revision || activeConfig.updatedAt.getTime() !== config.revision.updatedAt.getTime()
          || !isDeepStrictEqual(activeConfig.settings, config.settings)) throw new ConflictException("邮箱配置已变化，旧同步结果未保存");
        const ownsLease = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM tenant_support_mailboxes WHERE tenantId = ${actor.tenantId} AND id = ${mailboxId} AND leaseToken = ${lease} AND leaseUntil > NOW(3) FOR UPDATE`);
        if (!ownsLease.length) throw new ConflictException("本次同步窗口已变化，未更新游标");
        let imported = 0, quarantined = 0;
        for (const item of result.messages) {
          const id = `mail_${sha(`${actor.tenantId}:${config.id}:${fingerprint}:${item.uidValidity}:${item.uid}`)}`;
          const exists = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM tenant_support_emails WHERE tenantId = ${actor.tenantId} AND id = ${id} LIMIT 1`);
          if (exists.length) continue;
          await tx.$executeRaw(Prisma.sql`INSERT INTO tenant_support_emails (id, tenantId, configId, mailboxFingerprint, uidValidity, uid, senderEmail, senderName, recipient, subject, bodyText, attachments, messageId, receivedAt, createdAt)
            VALUES (${id}, ${actor.tenantId}, ${config.id}, ${fingerprint}, ${item.uidValidity}, ${item.uid}, ${item.message.senderEmail}, ${item.message.senderName},
              ${item.message.recipient}, ${item.message.subject}, ${item.message.text}, ${JSON.stringify(item.message.attachments)}, ${item.message.messageId ?? null}, ${item.receivedAt}, ${syncedAt})`);
          if (item.issue) {
            await tx.operationLog.create({ data: { id: `quarantine_${id}`, tenantId: actor.tenantId, userId: actor.userId,
              action: "support.email.import.quarantined", detail: { emailId: id, mailboxId, configId: config.id,
                uidValidity: item.uidValidity, uid: item.uid, reason: item.issue.reason, sourceSize: item.issue.size }, createdAt: syncedAt } });
            quarantined++;
          } else imported++;
        }
        await tx.$executeRaw(Prisma.sql`UPDATE tenant_support_mailboxes SET uidValidity = ${result.uidValidity}, lastUid = ${result.nextUid}, lastSyncedAt = ${syncedAt}, updatedAt = ${syncedAt}
          WHERE tenantId = ${actor.tenantId} AND id = ${mailboxId} AND leaseToken = ${lease}`);
        return { imported, quarantined };
      });
      return { ...saved, checked: result.checked, hasMore: result.hasMore, syncedAt: syncedAt.toISOString() };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException) throw error;
      throw new ServiceUnavailableException(error instanceof Error ? error.message : "客服邮箱同步失败");
    } finally {
      await this.prisma.$executeRaw(Prisma.sql`UPDATE tenant_support_mailboxes SET leaseToken = NULL, leaseUntil = NULL WHERE tenantId = ${actor.tenantId} AND id = ${mailboxId} AND leaseToken = ${lease}`).catch(() => undefined);
    }
  }
}
