/** 运营邀请：原租户身份准备权限，发信前查重，原一次性凭证接受后原子建账号。
 * 邮件提交超时不换键重发，列表与寄件预览均不返回令牌、密码或完整激活链接。 */
import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AcceptTenantOperatorInvitationRequest, AcceptTenantOperatorInvitationResult, CheckTenantOperatorEmailResult,
  InviteTenantOperatorRequest, TenantDispatchStatus, TenantOperatorInvitationPreview, TenantOperatorInvitationRow, TenantOperatorInvitationMailPreview } from "@rental-os/shared";
import { hashPassword } from "../../common/password";
import { getRequestIdentity, requireRequestTenantId } from "../../common/request-identity";
import { PrismaService } from "../database/prisma.service";
import { PlatformRepository } from "../platform/platform.repository";
import { PlatformService } from "../platform/platform.service";
import { TenantIntegrationService } from "../integrations/tenant-integration.service";
import { TenantEmailRuntimeService } from "../integrations/tenant-email.runtime.service";
import { normalizeEmail, SmtpDeliveryUnknownError } from "../integrations/smtp-transport";
import { renderOperatorInvitation, OPERATOR_INVITATION_TEMPLATE_VERSION } from "./tenant-mail-templates";
import { requireMessagingStorage } from "./tenant-messaging-storage";

type AccessSnapshot = Pick<InviteTenantOperatorRequest, "organizationId" | "roleIds" | "workspaceAccesses"> & {
  actorName: string; tenantName: string; roleNames: string[]; workspaceNames: string[];
};
type StoredInvitation = { id: string; tenantId: string; email: string; displayName: string; tokenHash: string;
  idempotencyKey: string; requestHash: string; invitedBy: string; accessSnapshot: Prisma.JsonValue | string;
  dispatchId: string; status: string; expiresAt: Date; acceptedAt: Date | null; acceptedUserId: string | null; createdAt: Date; };
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const maskEmail = (value: string) => { const [name, domain] = value.split("@"); return `${name.slice(0, 1)}***@${domain}`; };
const snapshot = (row: StoredInvitation): AccessSnapshot => typeof row.accessSnapshot === "string" ? JSON.parse(row.accessSnapshot) : row.accessSnapshot as unknown as AccessSnapshot;

@Injectable()
export class TenantOperatorInvitationsService {
  private readonly publicLimits = new Map<string, { until: number; count: number }>();
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    private readonly platform: PlatformService, private readonly accounts: PlatformRepository,
    private readonly integrations: TenantIntegrationService, private readonly emailRuntime: TenantEmailRuntimeService) {}

  private actor() {
    const identity = getRequestIdentity();
    if (!identity?.userId || identity.isSaasAdmin || identity.audience !== "operator") throw new ForbiddenException("需要当前租户运营管理身份");
    return { tenantId: requireRequestTenantId(), userId: identity.userId };
  }
  private async requireManager() {
    const actor = this.actor();
    await this.accounts.assertTenantManagementPermission(actor.tenantId, actor.userId, "system:user:manage");
    return actor;
  }
  private validToken(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) throw new NotFoundException("邀请不存在、已到期或已撤回");
  }
  assertPublicRate(ip = "unknown") {
    const now = Date.now(), key = sha(ip);
    for (const [id, limit] of this.publicLimits) if (limit.until <= now) this.publicLimits.delete(id);
    if (!this.publicLimits.has(key) && this.publicLimits.size >= 10000) throw new HttpException("请稍后再试", HttpStatus.TOO_MANY_REQUESTS);
    const row = this.publicLimits.get(key) ?? { until: now + 60000, count: 0 };
    row.count++; this.publicLimits.set(key, row);
    if (row.count > 20) throw new HttpException("邀请访问过于频繁，请稍后再试", HttpStatus.TOO_MANY_REQUESTS);
  }
  private invitationUrl(token: string) {
    const raw = this.config.get<string>("ADMIN_PUBLIC_URL")?.trim();
    if (!raw) throw new ServiceUnavailableException("请由部署方配置 ADMIN_PUBLIC_URL，用于生成真实邀请链接");
    let base: URL;
    try { base = new URL(raw); } catch { throw new ServiceUnavailableException("后台公开地址配置无效"); }
    const developmentLocal = this.config.get<string>("NODE_ENV") !== "production" && ["localhost", "127.0.0.1"].includes(base.hostname);
    if (base.protocol !== "https:" && !(developmentLocal && base.protocol === "http:") || base.username || base.password || base.search || base.hash)
      throw new ServiceUnavailableException("后台公开地址需使用 HTTPS，不能包含认证或查询信息");
    base.pathname = `${base.pathname.replace(/\/$/u, "")}/invite`;
    // Fragment 不进入访问日志或Referer；页面通过 POST 读取一次性邀请。
    base.hash = `token=${token}`;
    return base.toString();
  }
  private async existingAccount(tenantId: string, email: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.user.findFirst({ where: { tenantId, account: email }, select: { id: true } });
  }
  private async byId(tenantId: string, id: string, tx: Prisma.TransactionClient = this.prisma) {
    return (await tx.$queryRaw<StoredInvitation[]>(Prisma.sql`SELECT * FROM tenant_operator_invitations WHERE tenantId = ${tenantId} AND id = ${id} LIMIT 1`))[0];
  }
  private async view(row: StoredInvitation): Promise<TenantOperatorInvitationRow> {
    const data = snapshot(row);
    const dispatch = await this.prisma.notificationSendLog.findFirst({ where: { id: row.dispatchId, tenantId: row.tenantId }, select: { status: true } });
    const status = row.status === "pending" && row.expiresAt <= new Date() ? "expired" : row.status as TenantOperatorInvitationRow["status"];
    return { id: row.id, email: row.email, displayName: row.displayName, roleNames: data.roleNames, workspaceNames: data.workspaceNames,
      status, deliveryStatus: (dispatch?.status ?? "delivery_uncertain") as TenantDispatchStatus, dispatchId: row.dispatchId,
      expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), acceptedAt: row.acceptedAt?.toISOString() };
  }
  async checkEmail(value: string): Promise<CheckTenantOperatorEmailResult> {
    const actor = await this.requireManager(), email = normalizeEmail(value);
    if (await this.existingAccount(actor.tenantId, email)) return { exists: true, pendingInvitation: false, message: "该邮箱已有当前租户运营账号，无需发送邀请" };
    const pending = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM tenant_operator_invitations WHERE tenantId = ${actor.tenantId} AND email = ${email} AND status = 'pending' AND expiresAt > NOW(3) LIMIT 1`);
    return { exists: false, pendingInvitation: pending.length > 0, message: pending.length ? "该邮箱已有待接受邀请，请查看原邀请记录" : undefined };
  }
  async list() {
    const { tenantId } = await this.requireManager();
    const rows = await requireMessagingStorage(() => this.prisma.$queryRaw<StoredInvitation[]>(Prisma.sql`SELECT * FROM tenant_operator_invitations WHERE tenantId = ${tenantId} ORDER BY createdAt DESC, id DESC LIMIT 200`));
    return Promise.all(rows.map(row => this.view(row)));
  }
  async mailPreview(input: InviteTenantOperatorRequest): Promise<TenantOperatorInvitationMailPreview> {
    const actor = await this.requireManager(), email = normalizeEmail(input.email);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true } });
    if (!tenant) throw new NotFoundException("租户不存在");
    const verified = await this.prisma.$transaction(tx => this.accounts.validateOperatorInvitationAccess(tx, actor.tenantId, actor.userId, input));
    const mail = renderOperatorInvitation({ tenantName: tenant.name, inviteeName: input.displayName?.trim() || email.split("@")[0],
      inviterName: verified.actorName, roleNames: verified.roleNames, workspaceNames: verified.workspaceNames,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() });
    return { subject: mail.subject, renderedText: mail.text, renderedHtml: mail.html };
  }
  async readByKey(key: string) {
    const { tenantId } = await this.requireManager();
    const rows = await this.prisma.$queryRaw<StoredInvitation[]>(Prisma.sql`SELECT * FROM tenant_operator_invitations WHERE tenantId = ${tenantId} AND idempotencyKey = ${key} LIMIT 1`);
    if (!rows[0]) throw new NotFoundException("尚未找到本次提交，请保留原邀请操作键核对");
    return this.view(rows[0]);
  }
  async send(input: InviteTenantOperatorRequest) {
    const actor = await this.requireManager(), email = normalizeEmail(input.email);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(input.idempotencyKey)) throw new BadRequestException("邀请操作键无效");
    const clean = structuredClone({ email, displayName: input.displayName?.trim() || email.split("@")[0], organizationId: input.organizationId,
      roleIds: input.roleIds, workspaceAccesses: input.workspaceAccesses });
    if (clean.displayName.length > 100 || /[\r\n\0]/u.test(clean.displayName)) throw new BadRequestException("姓名格式无效");
    const requestHash = sha(JSON.stringify(clean));
    const duplicateKey = await this.prisma.$queryRaw<StoredInvitation[]>(Prisma.sql`SELECT * FROM tenant_operator_invitations WHERE tenantId = ${actor.tenantId} AND idempotencyKey = ${input.idempotencyKey} LIMIT 1`);
    if (duplicateKey[0]) {
      if (duplicateKey[0].requestHash !== requestHash) throw new ConflictException("同一操作键不能用于不同邀请");
      return this.view(duplicateKey[0]);
    }
    // 查重在读取任何凭据和实际发送之前；停用账户同样算已有账户。
    if (await this.existingAccount(actor.tenantId, email)) throw new ConflictException("该邮箱已有当前租户运营账号，无需发送邀请");
    const token = randomBytes(32).toString("base64url"), activationUrl = this.invitationUrl(token);
    const config = await this.emailRuntime.configuration(actor.tenantId);
    const now = new Date(), expiresAt = new Date(now.getTime() + 7 * 86400000);
    const id = `invite_${randomUUID()}`, dispatchId = randomUUID();
    let liveMail: ReturnType<typeof renderOperatorInvitation>;
    try {
      await this.prisma.$transaction(async tx => {
        const tenant = (await tx.$queryRaw<Array<{ name: string; status: string }>>(Prisma.sql`SELECT name, status FROM Tenant WHERE id = ${actor.tenantId} FOR UPDATE`))[0];
        if (!tenant || tenant.status.toLowerCase() !== "active") throw new ForbiddenException("当前租户不可邀请运营用户");
        const original = await tx.$queryRaw<StoredInvitation[]>(Prisma.sql`SELECT * FROM tenant_operator_invitations WHERE tenantId = ${actor.tenantId} AND idempotencyKey = ${input.idempotencyKey} LIMIT 1`);
        if (original.length) throw new ConflictException("本次邀请已提交，请核对原记录");
        if (await this.existingAccount(actor.tenantId, email, tx)) throw new ConflictException("该邮箱已有当前租户运营账号，无需发送邀请");
        const pending = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM tenant_operator_invitations WHERE tenantId = ${actor.tenantId} AND email = ${email} AND status = 'pending' AND expiresAt > ${now} LIMIT 1`);
        if (pending.length) throw new ConflictException("该邮箱已有待接受邀请，不重复发送");
        const verified = await this.accounts.validateOperatorInvitationAccess(tx, actor.tenantId, actor.userId, clean);
        await this.integrations.assertEnabledInTransaction(tx, actor.tenantId, "email", "smtp", { requireDefault: true, configRevision: config.revision });
        const access: AccessSnapshot = { organizationId: clean.organizationId, roleIds: clean.roleIds, workspaceAccesses: clean.workspaceAccesses,
          ...verified, tenantName: tenant.name };
        const rendered = { tenantName: tenant.name, inviteeName: clean.displayName, inviterName: verified.actorName,
          roleNames: verified.roleNames, workspaceNames: verified.workspaceNames, expiresAt: expiresAt.toISOString() };
        const preview = renderOperatorInvitation(rendered);
        liveMail = renderOperatorInvitation({ ...rendered, activationUrl });
        await tx.notificationSendLog.create({ data: { id: dispatchId, tenantId: actor.tenantId, templateCode: OPERATOR_INVITATION_TEMPLATE_VERSION,
          businessType: "operator_invitation", businessId: id, targetType: "operator", targetName: clean.displayName, targetMasked: maskEmail(email),
          channels: ["EMAIL"], provider: "smtp", status: "queued", requestJson: { subject: preview.subject, renderedText: preview.text,
            renderedHtml: preview.html, sender: String(config.settings.fromEmail), templateVersion: OPERATOR_INVITATION_TEMPLATE_VERSION }, createdAt: now } });
        await tx.$executeRaw(Prisma.sql`INSERT INTO tenant_operator_invitations (id, tenantId, email, displayName, tokenHash, idempotencyKey, requestHash, invitedBy, accessSnapshot, dispatchId, status, expiresAt, createdAt, updatedAt)
          VALUES (${id}, ${actor.tenantId}, ${email}, ${clean.displayName}, ${sha(token)}, ${input.idempotencyKey}, ${requestHash}, ${actor.userId}, ${JSON.stringify(access)}, ${dispatchId}, 'pending', ${expiresAt}, ${now}, ${now})`);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) throw new ConflictException("账号或邀请已变化，请核对原记录");
      throw error;
    }
    // 在出站前先留下未知状态；进程在投递中退出也不会留下可自动重发的 queued。
    try {
      await this.prisma.$transaction(async tx => {
        const current = (await tx.$queryRaw<StoredInvitation[]>(Prisma.sql`SELECT * FROM tenant_operator_invitations WHERE tenantId = ${actor.tenantId} AND id = ${id} FOR UPDATE`))[0];
        if (!current || current.status !== "pending" || current.expiresAt <= new Date()) throw new ConflictException("邀请已撤回或到期，未发送邮件");
        await this.accounts.validateOperatorInvitationAccess(tx, actor.tenantId, actor.userId, clean);
        if (await this.existingAccount(actor.tenantId, email, tx)) throw new ConflictException("该邮箱已有账号，无需发送邀请");
        await this.integrations.assertEnabledInTransaction(tx, actor.tenantId, "email", "smtp", { requireDefault: true, configRevision: config.revision });
        const claimed = await tx.notificationSendLog.updateMany({ where: { id: dispatchId, tenantId: actor.tenantId, status: "queued" }, data: { status: "delivery_uncertain" } });
        if (claimed.count !== 1) throw new ConflictException("邀请投递状态已变化，请核对原记录");
      });
    } catch (error) {
      await this.prisma.notificationSendLog.updateMany({ where: { id: dispatchId, tenantId: actor.tenantId, status: "queued" },
        data: { status: "failed", responseJson: { attempts: 0, errorMessage: error instanceof Error ? error.message : "发送前条件已变化" } } });
      throw error;
    }
    let result: { messageId?: string };
    try { result = await this.emailRuntime.send(config, { to: email, subject: liveMail!.subject, text: liveMail!.text, html: liveMail!.html,
      messageId: `${dispatchId}@${String(config.settings.fromEmail).split("@")[1]}` }); }
    catch (error) {
      const uncertain = error instanceof SmtpDeliveryUnknownError;
      await this.prisma.notificationSendLog.updateMany({ where: { id: dispatchId, tenantId: actor.tenantId }, data: {
        status: uncertain ? "delivery_uncertain" : "failed", responseJson: { attempts: 1, errorMessage: error instanceof Error ? error.message : "邮件发送失败" } } });
      return this.view((await this.byId(actor.tenantId, id))!);
    }
    try { await this.prisma.notificationSendLog.updateMany({ where: { id: dispatchId, tenantId: actor.tenantId }, data: { status: "sent", sentAt: new Date(),
      responseJson: { attempts: 1, providerMessageId: result.messageId, message: "SMTP 服务器已接受邮件，不代表收件人已收到或阅读" } } }); }
    catch { throw new ServiceUnavailableException("邮件已被服务器接受，记录更新失败，请用原邀请操作键核对，不能重发"); }
    return this.view((await this.byId(actor.tenantId, id))!);
  }
  async revoke(id: string) {
    const { tenantId, userId } = await this.requireManager();
    const row = await this.byId(tenantId, id);
    if (!row) throw new NotFoundException("邀请不存在");
    await this.prisma.$transaction(async tx => {
      await this.accounts.assertTenantManagementPermission(tenantId, userId, "system:user:manage", tx);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM tenant_operator_invitations WHERE tenantId = ${tenantId} AND id = ${id} FOR UPDATE`);
      await tx.$executeRaw(Prisma.sql`UPDATE tenant_operator_invitations SET status = 'revoked', updatedAt = NOW(3) WHERE tenantId = ${tenantId} AND id = ${id} AND status = 'pending'`);
      await tx.notificationSendLog.updateMany({ where: { id: row.dispatchId, tenantId, status: "queued" }, data: {
        status: "failed", responseJson: { attempts: 0, errorMessage: "邀请已撤回，未发送邮件" }
      } });
    });
    return this.view((await this.byId(tenantId, id))!);
  }
  private async tokenRow(token: string) {
    this.validToken(token);
    const row = (await this.prisma.$queryRaw<StoredInvitation[]>(Prisma.sql`SELECT * FROM tenant_operator_invitations WHERE tokenHash = ${sha(token)} LIMIT 1`))[0];
    if (row?.status === "accepted") {
      this.assertAccepted(row);
      return row;
    }
    if (!row || row.status !== "pending" || row.expiresAt <= new Date()) throw new NotFoundException("邀请不存在、已到期或已撤回");
    if (await this.existingAccount(row.tenantId, row.email)) throw new ConflictException("该邮箱已有账号，请使用原账号登录；无需接受邀请");
    return row;
  }
  private assertAccepted(row: StoredInvitation) {
    if (row.status !== "accepted" || !row.acceptedUserId || !(row.acceptedAt instanceof Date) || !Number.isFinite(row.acceptedAt.getTime()))
      throw new ServiceUnavailableException("原邀请接受结果暂时无法核对，请稍后读取原邀请");
  }
  private acceptedResult(tenantCode: string): AcceptTenantOperatorInvitationResult {
    return { tenantCode, message: "该邀请已接受，请使用邮箱与接受时设置的密码登录" };
  }
  private async readAcceptance(row: StoredInvitation) {
    this.assertAccepted(row);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: row.tenantId }, select: { code: true } });
    if (!tenant) throw new NotFoundException("邀请所属租户不存在");
    return this.acceptedResult(tenant.code);
  }
  async inspect(token: string): Promise<TenantOperatorInvitationPreview> {
    const row = await this.tokenRow(token);
    if (row.status === "accepted") return { status: "accepted", ...await this.readAcceptance(row) };
    const access = snapshot(row);
    await this.prisma.$transaction(tx => this.accounts.validateOperatorInvitationAccess(tx, row.tenantId, row.invitedBy, access));
    const tenant = await this.prisma.tenant.findUnique({ where: { id: row.tenantId }, select: { code: true, name: true, status: true } });
    if (!tenant || tenant.status !== "ACTIVE") throw new NotFoundException("邀请所属租户当前不可加入");
    const security = await this.platform.getSecurityBaseline();
    return { status: "pending", tenantName: tenant.name, tenantCode: tenant.code, email: row.email, displayName: row.displayName, roleNames: access.roleNames,
      workspaceNames: access.workspaceNames, expiresAt: row.expiresAt.toISOString(), minPasswordLength: Math.max(8, security.passwordPolicy.minLength) };
  }
  async accept(input: AcceptTenantOperatorInvitationRequest): Promise<AcceptTenantOperatorInvitationResult> {
    const row = await this.tokenRow(input.token);
    if (row.status === "accepted") return this.readAcceptance(row);
    const security = await this.platform.getSecurityBaseline();
    const displayName = input.displayName.trim(), password = input.password;
    if (!displayName || displayName.length > 100 || /[\r\n\0]/u.test(displayName)) throw new BadRequestException("请输入有效的姓名");
    if (password.length < Math.max(8, security.passwordPolicy.minLength) || password.length > 128 || !/[A-Za-z]/u.test(password) || !/\d/u.test(password) || !/[^A-Za-z0-9]/u.test(password))
      throw new BadRequestException(`密码至少 ${Math.max(8, security.passwordPolicy.minLength)} 位，须包含字母、数字和特殊字符`);
    const passwordHash = hashPassword(password);
    try {
      const tenantCode = await this.prisma.$transaction(async tx => {
        const tenant = (await tx.$queryRaw<Array<{ code: string; status: string }>>(Prisma.sql`SELECT code, status FROM Tenant WHERE id = ${row.tenantId} FOR UPDATE`))[0];
        if (!tenant || tenant.status.toLowerCase() !== "active") throw new ForbiddenException("当前租户不可加入");
        const locked = (await tx.$queryRaw<StoredInvitation[]>(Prisma.sql`SELECT * FROM tenant_operator_invitations WHERE tenantId = ${row.tenantId} AND id = ${row.id} AND tokenHash = ${sha(input.token)} FOR UPDATE`))[0];
        if (locked?.status === "accepted") { this.assertAccepted(locked); return tenant.code; }
        if (!locked || locked.status !== "pending" || locked.expiresAt <= new Date()) throw new ConflictException("邀请已使用、到期或撤回");
        if (await this.existingAccount(row.tenantId, row.email, tx)) throw new ConflictException("该邮箱已有账号，无需接受邀请");
        const access = snapshot(locked);
        const userId = await this.accounts.acceptOperatorInvitationInTransaction(tx, row.tenantId, locked.invitedBy, {
          account: locked.email, displayName, organizationId: access.organizationId, roleIds: access.roleIds,
          workspaceAccesses: access.workspaceAccesses, isActive: true }, passwordHash);
        await tx.$executeRaw(Prisma.sql`UPDATE tenant_operator_invitations SET status = 'accepted', acceptedAt = NOW(3), acceptedUserId = ${userId}, updatedAt = NOW(3) WHERE tenantId = ${row.tenantId} AND id = ${row.id}`);
        return tenant.code;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return this.acceptedResult(tenantCode);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) throw new ConflictException("账号或邀请已变化，请使用邮箱登录核对");
      throw error;
    }
  }
}
