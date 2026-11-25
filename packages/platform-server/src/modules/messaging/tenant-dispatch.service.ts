/** 租户寄件中心读取各空间的原投递事实，不复制日志或改变业务通知状态。
 * 仅基础租户全范围授权可读；认证短信内容、凭据和邀请令牌不进入公开投影。 */
import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { empty, sqltag } from "@prisma/client/runtime/library";
import type { TenantDispatchChannel, TenantDispatchDetail, TenantDispatchPage, TenantDispatchQuery, TenantDispatchRow,
  TenantDispatchSource, TenantDispatchStatus } from "@rental-os/platform-contracts/tenant-messaging";
import { getRequestIdentity, requireRequestTenantId } from "../../common/request-identity";
import type { PlatformOperationLogService } from "../../common/operation-log.service";

import type { StoredTenantDispatchRow, TenantDispatchBusinessParticipant, TenantDispatchDataStore, TenantSensitiveReadAuthority } from "./messaging-store";

const Prisma = { sql: sqltag, empty };
const status = (value: string): TenantDispatchStatus => value === "mock_success" ? "simulated" : value === "mock_failed" ? "simulation_failed"
  : ["queued", "sent", "delivery_pending", "delivered", "delivery_failed", "failed", "delivery_uncertain", "simulated", "simulation_failed"].includes(value)
    ? value as TenantDispatchStatus : "delivery_uncertain";
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : "";

export class PlatformTenantDispatchService {
  constructor(private readonly prisma: TenantDispatchDataStore, private readonly accounts: TenantSensitiveReadAuthority,
    private readonly audit: Pick<PlatformOperationLogService, "record">, private readonly business?: TenantDispatchBusinessParticipant) {}
  private async authorize() {
    const identity = getRequestIdentity();
    if (!identity?.userId || identity.isSaasAdmin || identity.audience !== "operator") throw new ForbiddenException("需要租户寄件查看权限");
    const tenantId = requireRequestTenantId();
    await this.accounts.assertTenantManagementPermission(tenantId, identity.userId, "system:integration:manage");
    return { tenantId, userId: identity.userId };
  }
  private row(value: StoredTenantDispatchRow): TenantDispatchRow {
    return { id: value.id, source: value.source, channel: value.channel, recipient: value.recipient ?? "—", subject: value.subject || "通知",
      status: status(value.status), provider: value.provider, workspaceName: value.workspaceName ?? undefined,
      businessType: value.businessType ?? undefined, businessId: value.businessId ?? undefined,
      createdAt: value.createdAt.toISOString(), sentAt: value.sentAt?.toISOString() };
  }
  async list(query: TenantDispatchQuery = {}): Promise<TenantDispatchPage> {
    const { tenantId } = await this.authorize();
    const page = query.page ?? 1, pageSize = query.pageSize ?? 30;
    if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
      throw new BadRequestException("寄件分页无效");
    const keyword = query.search?.trim() ?? "";
    if (keyword.length > 100) throw new BadRequestException("搜索文字过长");
    const union = Prisma.sql`
      SELECT id, 'platform' AS source, 'email' AS channel, targetMasked AS recipient,
        JSON_UNQUOTE(JSON_EXTRACT(requestJson, '$.subject')) AS subject, status, provider,
        NULL AS workspaceName, businessType, businessId, createdAt, sentAt
      FROM NotificationSendLog WHERE tenantId = ${tenantId} AND JSON_CONTAINS(channels, '"EMAIL"')
      UNION ALL
      SELECT id, 'platform' AS source, 'sms' AS channel, targetMasked AS recipient,
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(requestJson, '$.subject')), templateCode, '短信通知') AS subject, status, provider,
        NULL AS workspaceName, businessType, businessId, createdAt, sentAt
      FROM NotificationSendLog WHERE tenantId = ${tenantId} AND JSON_CONTAINS(channels, '"SMS"')
      ${this.business ? Prisma.sql`UNION ALL ${this.business.query(tenantId)}` : Prisma.empty}
      UNION ALL
      SELECT id, 'verification' AS source, 'sms' AS channel, JSON_UNQUOTE(JSON_EXTRACT(requestJson, '$.phone')) AS recipient,
        '验证码短信' AS subject, CASE WHEN status = 'success' THEN 'sent'
          WHEN status = 'failed' AND JSON_UNQUOTE(JSON_EXTRACT(responseJson, '$.deliveryStatus')) = 'failed' THEN 'failed'
          ELSE 'delivery_uncertain' END AS status, provider,
        NULL AS workspaceName, 'verification' AS businessType, NULL AS businessId, createdAt,
        IF(status = 'success', createdAt, NULL) AS sentAt
      FROM ExternalAdapterLog WHERE tenantId = ${tenantId} AND capability = 'sms' AND operation = 'send_verification_sms'`;
    const filters = Prisma.sql`WHERE 1 = 1
      ${query.channel ? Prisma.sql`AND d.channel = ${query.channel}` : Prisma.empty}
      ${query.status ? Prisma.sql`AND CASE WHEN d.status = 'mock_success' THEN 'simulated' WHEN d.status = 'mock_failed' THEN 'simulation_failed' ELSE d.status END = ${query.status}` : Prisma.empty}
      ${keyword ? Prisma.sql`AND (LOCATE(${keyword}, COALESCE(d.subject, '')) > 0 OR LOCATE(${keyword}, COALESCE(d.recipient, '')) > 0 OR LOCATE(${keyword}, COALESCE(d.businessId, '')) > 0)` : Prisma.empty}`;
    const [rows, counts] = await Promise.all([
      this.prisma.$queryRaw<StoredTenantDispatchRow[]>(Prisma.sql`SELECT d.* FROM (${union}) d ${filters} ORDER BY d.createdAt DESC, d.source, d.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
      this.prisma.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`SELECT COUNT(*) AS total FROM (${union}) d ${filters}`)
    ]);
    return { rows: rows.map(row => this.row(row)), total: Number(counts[0]?.total ?? 0), page, pageSize };
  }
  async detail(source: TenantDispatchSource, id: string, channel: TenantDispatchChannel): Promise<TenantDispatchDetail> {
    const identity = structuredClone(getRequestIdentity() ?? {});
    const result = await this.readDetail(source, id, channel);
    await this.accounts.revalidateTenantManagementRead(identity, "system:integration:manage");
    return result;
  }
  private async readDetail(source: TenantDispatchSource, id: string, channel: TenantDispatchChannel): Promise<TenantDispatchDetail> {
    const actor = await this.authorize();
    if (!["platform", "rental", "verification"].includes(source) || !["sms", "email"].includes(channel) || !/^[A-Za-z0-9._:-]{1,191}$/u.test(id))
      throw new BadRequestException("寄件定位无效");
    await this.audit.record({ ...actor, action: "notification.dispatch.detail.read", targetType: "tenant-dispatch", targetId: id,
      metadata: { source, channel }, requireSuccess: true });
    if (source === "platform") {
      const row = await this.prisma.notificationSendLog.findFirst({ where: { id, tenantId: actor.tenantId } });
      if (!row || !Array.isArray(row.channels) || !row.channels.includes(channel.toUpperCase())) throw new NotFoundException("寄件记录不存在");
      const request = obj(row.requestJson), result = obj(row.responseJson);
      return { ...this.row({ ...row, source, channel, recipient: row.targetMasked, subject: text(request.subject) || row.templateCode,
        workspaceName: null }), sender: text(request.sender) || undefined,
        renderedText: text(request.renderedText) || "此历史记录未保存发送正文",
        renderedHtml: channel === "email" && row.templateCode === "operator-invitation-1" ? text(request.renderedHtml) || undefined : undefined,
        templateVersion: text(request.templateVersion) || row.templateCode || undefined,
        providerMessageId: text(result.providerMessageId) || undefined, errorMessage: text(result.errorMessage) || undefined, attempts: Number(result.attempts ?? 0) };
    }
    if (source === "rental") {
      if (!this.business) throw new ServiceUnavailableException("当前业务寄件来源尚未接入");
      const row = await this.business.detail(actor.tenantId, id, channel);
      if (!row) throw new NotFoundException("寄件记录不存在");
      return { ...this.row(row), renderedText: row.renderedText,
        templateVersion: row.templateVersion, providerMessageId: row.providerMessageId, errorMessage: row.errorMessage, attempts: row.attempts };
    }
    const row = await this.prisma.externalAdapterLog.findFirst({ where: { id, tenantId: actor.tenantId, capability: "sms", operation: "send_verification_sms" } });
    if (!row || channel !== "sms") throw new NotFoundException("验证码寄件记录不存在");
    const request = obj(row.requestJson), result = obj(row.responseJson);
    return { ...this.row({ ...row, source, channel, recipient: text(request.phone), subject: "验证码短信",
      workspaceName: null, status: row.status === "success" ? "sent"
        : row.status === "failed" && result.deliveryStatus === "failed" ? "failed" : "delivery_uncertain", businessType: "verification", businessId: null,
      sentAt: row.status === "success" ? row.createdAt : null }), renderedText: "验证码正文不在日志中保留。", attempts: 1,
      providerMessageId: text(result.externalRequestId) || undefined, errorMessage: row.errorMessage ?? undefined };
  }
}
