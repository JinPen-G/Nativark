import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { MiniProgramChannelSummary, MiniProgramChannelTestResult, SaveMiniProgramChannelRequest } from "./channel-contracts";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import type { RentalChannelAudit, RentalChannelSecretBox, RentalChannelWechat, RentalMiniProgramChannelStorage } from "./client-channel-ports";
import { requireRequestTenantId } from "@rental-os/platform-server/request-identity";
import { WechatMiniProgramAdapter } from "@rental-os/platform-server/integration-wechat";
import { assertRentalBusinessTenantAccessAfterLock, lockRentalBusinessTenant } from "./mysql-business-fence";

/**
 * 租户的微信小程序渠道凭证（MP-01 / CLIENT-CHANNEL-01，运营端）。
 *
 * - 一个租户一个渠道：AppID 公开，AppSecret 只写不读（AES-GCM 加密列，响应只返回“是否已配置”）。
 * - 品牌/客服/协议/帮助/发布服务已移到租户级 ClientChannelProfile；本服务只负责微信凭证与连通性测试。
 * - 已有客户绑定微信身份后不允许更换 AppID：openid 与 AppID 绑定，换号等于让所有绑定失效。
 * - “测试连接”只换取一次接口凭据，不读用户数据、不发消息。
 */
type ChannelRow = Prisma.MiniProgramChannelGetPayload<{ include: { _count: { select: { identities: true } } } }>;

function text(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new BadRequestException(`${label}格式无效`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new BadRequestException(`${label}最多 ${max} 个字符`);
  return normalized;
}

export class MiniProgramChannelService {
  constructor(
    private readonly prisma: RentalMiniProgramChannelStorage,
    private readonly secretBox: RentalChannelSecretBox,
    private readonly adapter: RentalChannelWechat,
    private readonly operationLog?: RentalChannelAudit
  ) {}

  private tenantOf(user?: SystemUserRow) {
    if (user?.isSaasAdmin) throw new BadRequestException("SaaS 平台账号不能写入租户小程序渠道");
    return user?.tenantId ?? requireRequestTenantId();
  }

  private summary(row: ChannelRow | null): MiniProgramChannelSummary {
    if (!row) {
      return { configured: false, secretConfigured: false, enabled: false, revision: 0, lastTestStatus: "not_tested", identityCount: 0 };
    }
    return {
      configured: true,
      appId: row.appId,
      secretConfigured: Boolean(row.appSecretEncrypted),
      enabled: row.enabled,
      revision: row.revision,
      lastTestStatus: row.lastTestStatus as MiniProgramChannelSummary["lastTestStatus"],
      lastTestAt: row.lastTestAt?.toISOString(),
      lastTestError: row.lastTestError ?? undefined,
      identityCount: row._count.identities,
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private async load(tenantId: string, tx?: Prisma.TransactionClient): Promise<ChannelRow | null> {
    return (tx ?? this.prisma).miniProgramChannel.findFirst({
      where: { tenantId },
      include: { _count: { select: { identities: true } } },
      orderBy: { updatedAt: "desc" }
    });
  }

  async get(user?: SystemUserRow): Promise<MiniProgramChannelSummary> {
    return this.summary(await this.load(this.tenantOf(user)));
  }

  async save(input: SaveMiniProgramChannelRequest, user?: SystemUserRow): Promise<MiniProgramChannelSummary> {
    const tenantId = this.tenantOf(user);
    const appId = text(input.appId, 191, "AppID");
    if (!appId || !/^wx[0-9a-f]{16}$/iu.test(appId)) throw new BadRequestException("AppID 格式无效（wx 开头的 18 位）");
    const appSecret = text(input.appSecret, 191, "AppSecret");
    const saved = await this.prisma.$transaction(async tx => {
      // 原表没有 tenantId 唯一键；父 X 锁串行同租户首建和改号，不能先取 S 再升级。
      const tenants = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM Tenant WHERE id=${tenantId} FOR UPDATE`);
      if (!tenants.length) throw new ForbiddenException("商户不存在，不能锁定租赁事务");
      await assertRentalBusinessTenantAccessAfterLock(tx, tenantId);
      const existing = await this.load(tenantId, tx);
      const conflicting = await tx.miniProgramChannel.findFirst({ where: { appId, NOT: { tenantId } }, select: { id: true } });
      if (conflicting) throw new ConflictException("该 AppID 已绑定其他商户");
      if (existing && existing.appId !== appId && existing._count.identities > 0) {
        throw new ConflictException(`已有 ${existing._count.identities} 位客户绑定微信身份，不能更换 AppID；如需迁移请联系平台`);
      }
      const secretEncrypted = appSecret ? this.secretBox.encrypt({ appSecret }) : existing?.appId === appId ? existing?.appSecretEncrypted ?? null : null;
      if (input.enabled && !secretEncrypted) throw new BadRequestException("启用渠道前请填写 AppSecret");
      const secretChanged = Boolean(appSecret) || (existing?.appId ?? appId) !== appId;
      const data = { appId, appSecretEncrypted: secretEncrypted, enabled: Boolean(input.enabled) };
      try {
        return existing
          ? await tx.miniProgramChannel.update({ where: { id: existing.id, tenantId, revision: existing.revision,
            ...(existing.appId !== appId ? { identities: { none: {} } } : {}) },
            data: { ...data, revision: { increment: 1 }, ...(secretChanged ? { lastTestStatus: "not_tested", lastTestAt: null, lastTestError: null } : {}) } })
          : await tx.miniProgramChannel.create({ data: { tenantId, ...data } });
      } catch (error) {
        if (error && typeof error === "object" && (error as { code?: string }).code === "P2002") throw new ConflictException("该 AppID 已绑定其他商户");
        if (error && typeof error === "object" && (error as { code?: string }).code === "P2025") throw new ConflictException("配置已被其他人更新，请刷新后重试");
        throw error;
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    await this.operationLog?.record({ tenantId, user, action: "mini-program-channel.save", targetType: "mini_program_channel", targetId: saved.id, detail: `保存小程序渠道 ${appId}`, metadata: { enabled: Boolean(input.enabled), secretChanged: Boolean(appSecret) } });
    return this.summary(await this.load(tenantId));
  }

  async test(user?: SystemUserRow): Promise<MiniProgramChannelTestResult> {
    const tenantId = this.tenantOf(user);
    const row = await this.prisma.$transaction(async tx => {
      await lockRentalBusinessTenant(tx, tenantId);
      const current = await this.load(tenantId, tx);
      if (!current) throw new BadRequestException("尚未配置小程序渠道");
      if (!current.appSecretEncrypted) throw new BadRequestException("尚未配置 AppSecret");
      return { ...current, appSecretEncrypted: current.appSecretEncrypted };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    const testedAt = new Date();
    let ok = false;
    let message: string;
    try {
      const secret = this.secretBox.decrypt(row.appSecretEncrypted).appSecret ?? "";
      if (!secret) throw new Error("AppSecret 无法读取");
      await this.adapter.verifyCredentials(row.appId, secret);
      ok = true;
      message = "已验证小程序 AppID/AppSecret（仅换取接口凭据，未读取任何用户数据）。";
    } catch (error) {
      const translated = WechatMiniProgramAdapter.translate(error, "credentials");
      message = typeof translated.getResponse() === "string" ? String(translated.getResponse()) : translated.message;
    }
    // 运输不持有数据库锁，也不重试。仅记录已派发测试的结果，不重新准入；
    // 原 Tenant 锁与精确 CAS 防止覆盖期间换密钥或另一测试的记录。
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM Tenant WHERE id=${tenantId} LOCK IN SHARE MODE`);
      const current = await this.load(tenantId, tx);
      if (!current || current.id !== row.id) throw new ConflictException("小程序渠道配置或测试记录已变化，请重新读取后再测试");
      const written = await tx.miniProgramChannel.updateMany({ where: { id: row.id, tenantId, revision: row.revision,
        appId: row.appId, appSecretEncrypted: row.appSecretEncrypted, updatedAt: row.updatedAt, lastTestAt: row.lastTestAt,
        lastTestStatus: row.lastTestStatus, lastTestError: row.lastTestError },
        data: { lastTestStatus: ok ? "passed" : "failed", lastTestAt: testedAt, lastTestError: ok ? null : message.slice(0, 500) } });
      if (written.count !== 1) throw new ConflictException("小程序渠道配置或测试记录已变化，请重新读取后再测试");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    await this.operationLog?.record({ tenantId, user, action: "mini-program-channel.test", targetType: "mini_program_channel", targetId: row.id, detail: ok ? "小程序凭据测试通过" : `小程序凭据测试失败：${message}` });
    return { ok, message, testedAt: testedAt.toISOString() };
  }
}
