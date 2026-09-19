import { BadRequestException, ConflictException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { MiniProgramChannelSummary, MiniProgramChannelTestResult, SaveMiniProgramChannelRequest, SystemUserRow } from "@rental-os/shared";
import { OperationLogService } from "../../common/operation-log.service";
import { requireRequestTenantId } from "../../common/request-identity";
import { SecretBox } from "../../common/secret-box";
import { assertOutboundUrl, UnsafeOutboundUrlError } from "../../common/outbound-url";
import { PrismaService } from "../database/prisma.service";
import { WechatMiniProgramAdapter } from "./wechat-mini-program.adapter";

/**
 * 租户的微信小程序渠道配置（MP-01，运营端）。
 *
 * - 一个租户一个渠道：AppID 公开，AppSecret 只写不读（AES-GCM 加密列，响应只返回“是否已配置”）。
 * - 已发布空间决定小程序对游客/客户展示哪些服务；未发布不因空间 active 自动上架。
 * - 已有客户绑定微信身份后不允许更换 AppID：openid 与 AppID 绑定，换号等于让所有绑定失效。
 * - “测试连接”只换取一次接口凭据，不读用户数据、不发消息。
 */
type ChannelRow = Prisma.MiniProgramChannelGetPayload<{ include: { publishedWorkspaces: true; _count: { select: { identities: true } } } }>;

function text(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new BadRequestException(`${label}格式无效`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new BadRequestException(`${label}最多 ${max} 个字符`);
  return normalized;
}

@Injectable()
export class MiniProgramChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretBox: SecretBox,
    private readonly adapter: WechatMiniProgramAdapter,
    @Optional() private readonly operationLog?: OperationLogService
  ) {}

  private tenantOf(user?: SystemUserRow) {
    if (user?.isSaasAdmin) throw new BadRequestException("SaaS 平台账号不能写入租户小程序渠道");
    return user?.tenantId ?? requireRequestTenantId();
  }

  private summary(row: ChannelRow | null): MiniProgramChannelSummary {
    if (!row) {
      return { configured: false, secretConfigured: false, enabled: false, revision: 0, lastTestStatus: "not_tested", publishedWorkspaceIds: [], identityCount: 0 };
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
      brandName: row.brandName ?? undefined,
      brandLogoUrl: row.brandLogoUrl ?? undefined,
      customerServicePhone: row.customerServicePhone ?? undefined,
      customerServiceHours: row.customerServiceHours ?? undefined,
      userAgreementVersion: row.userAgreementVersion ?? undefined,
      userAgreementUrl: row.userAgreementUrl ?? undefined,
      privacyPolicyVersion: row.privacyPolicyVersion ?? undefined,
      privacyPolicyUrl: row.privacyPolicyUrl ?? undefined,
      publishedWorkspaceIds: row.publishedWorkspaces.filter((item) => item.enabled).map((item) => item.workspaceId),
      identityCount: row._count.identities,
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private async load(tenantId: string): Promise<ChannelRow | null> {
    return this.prisma.miniProgramChannel.findFirst({
      where: { tenantId },
      include: { publishedWorkspaces: true, _count: { select: { identities: true } } },
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
    const brandLogoUrl = text(input.brandLogoUrl, 512, "品牌 Logo 地址");
    const userAgreementUrl = text(input.userAgreementUrl, 512, "用户协议地址");
    const privacyPolicyUrl = text(input.privacyPolicyUrl, 512, "隐私政策地址");
    for (const [label, value] of [["品牌 Logo 地址", brandLogoUrl], ["用户协议地址", userAgreementUrl], ["隐私政策地址", privacyPolicyUrl]] as const) {
      if (!value) continue;
      try {
        await assertOutboundUrl(value, label, { allowQuery: true });
      } catch (error) {
        throw new BadRequestException(error instanceof UnsafeOutboundUrlError ? error.message : `${label}无法安全使用`);
      }
    }
    const requestedWorkspaceIds = Array.from(new Set((input.publishedWorkspaceIds ?? []).map((id) => String(id).trim()).filter(Boolean)));
    const workspaces = await this.prisma.businessWorkspace.findMany({ where: { tenantId, id: { in: requestedWorkspaceIds } }, select: { id: true, status: true } });
    const unknown = requestedWorkspaceIds.filter((id) => !workspaces.some((row) => row.id === id));
    if (unknown.length) throw new BadRequestException("发布空间必须属于当前租户");
    const inactive = workspaces.filter((row) => row.status !== "ACTIVE");
    if (inactive.length) throw new BadRequestException("只能发布已启用的经营空间");
    const existing = await this.load(tenantId);
    const conflicting = await this.prisma.miniProgramChannel.findFirst({ where: { appId, NOT: { tenantId } }, select: { id: true } });
    if (conflicting) throw new ConflictException("该 AppID 已绑定其他商户");
    if (existing && existing.appId !== appId && existing._count.identities > 0) {
      throw new ConflictException(`已有 ${existing._count.identities} 位客户绑定微信身份，不能更换 AppID；如需迁移请联系平台`);
    }
    const secretEncrypted = appSecret ? this.secretBox.encrypt({ appSecret }) : existing?.appId === appId ? existing?.appSecretEncrypted ?? null : null;
    if (input.enabled && !secretEncrypted) throw new BadRequestException("启用渠道前请填写 AppSecret");
    const data = {
      appId,
      appSecretEncrypted: secretEncrypted,
      enabled: Boolean(input.enabled),
      brandName: text(input.brandName, 191, "品牌名称"),
      brandLogoUrl,
      customerServicePhone: text(input.customerServicePhone, 32, "客服电话"),
      customerServiceHours: text(input.customerServiceHours, 64, "客服时段"),
      userAgreementVersion: text(input.userAgreementVersion, 64, "用户协议版本"),
      userAgreementUrl,
      privacyPolicyVersion: text(input.privacyPolicyVersion, 64, "隐私政策版本"),
      privacyPolicyUrl
    };
    const secretChanged = Boolean(appSecret) || (existing?.appId ?? appId) !== appId;
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = existing
        ? await tx.miniProgramChannel.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 }, ...(secretChanged ? { lastTestStatus: "not_tested", lastTestAt: null, lastTestError: null } : {}) } })
        : await tx.miniProgramChannel.create({ data: { tenantId, ...data } });
      await tx.miniProgramChannelWorkspace.deleteMany({ where: { channelId: row.id, workspaceId: { notIn: requestedWorkspaceIds } } });
      for (const workspaceId of requestedWorkspaceIds) {
        await tx.miniProgramChannelWorkspace.upsert({
          where: { channelId_workspaceId: { channelId: row.id, workspaceId } },
          create: { tenantId, channelId: row.id, workspaceId, enabled: true },
          update: { enabled: true }
        });
      }
      return row;
    });
    await this.operationLog?.record({ tenantId, user, action: "mini-program-channel.save", targetType: "mini_program_channel", targetId: saved.id, detail: `保存小程序渠道 ${appId}`, metadata: { enabled: data.enabled, publishedWorkspaces: requestedWorkspaceIds.length, secretChanged: Boolean(appSecret) } });
    return this.summary(await this.load(tenantId));
  }

  async test(user?: SystemUserRow): Promise<MiniProgramChannelTestResult> {
    const tenantId = this.tenantOf(user);
    const row = await this.load(tenantId);
    if (!row) throw new BadRequestException("尚未配置小程序渠道");
    if (!row.appSecretEncrypted) throw new BadRequestException("尚未配置 AppSecret");
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
    await this.prisma.miniProgramChannel.update({ where: { id: row.id }, data: { lastTestStatus: ok ? "passed" : "failed", lastTestAt: testedAt, lastTestError: ok ? null : message.slice(0, 500) } });
    await this.operationLog?.record({ tenantId, user, action: "mini-program-channel.test", targetType: "mini_program_channel", targetId: row.id, detail: ok ? "小程序凭据测试通过" : `小程序凭据测试失败：${message}` });
    return { ok, message, testedAt: testedAt.toISOString() };
  }
}
