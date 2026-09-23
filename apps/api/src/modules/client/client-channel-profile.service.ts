import { BadRequestException, ConflictException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ClientChannelFaqItem,
  ClientChannelProfileSummary,
  ClientChannelReadiness,
  ClientChannelWorkspaceOption,
  SaveClientChannelProfileRequest,
  SystemUserRow
} from "@rental-os/shared";
import { OperationLogService } from "../../common/operation-log.service";
import { assertOutboundUrl, UnsafeOutboundUrlError } from "../../common/outbound-url";
import { requireRequestTenantId } from "../../common/request-identity";
import { PrismaService } from "../database/prisma.service";

/**
 * 租户级客户端渠道配置（CLIENT-CHANNEL-01）：商户品牌、客服、协议正文/版本、帮助、首页横幅、
 * 登录方式开关与发布服务。小程序与后续 APP 读同一份（公开启动接口叠加渠道能力）；微信凭证另存。
 *
 * - 一租户一条（tenantId 唯一）；保存带 expectedRevision 乐观锁，防止两人互相覆盖。
 * - 发布空间必须是本租户已启用空间；未发布的空间不因 active 自动上架、游客目录不可读。
 * - 协议正文在客户端内直接渲染，不内置占位协议；名称/版本必须成对，供登录留痕。
 */
type ProfileRow = Prisma.ClientChannelProfileGetPayload<{ include: { publishedWorkspaces: true } }>;

const DEFAULT_AGREEMENT_NAME = { userAgreement: "用户服务协议", privacyPolicy: "隐私政策" } as const;

function text(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new BadRequestException(`${label}格式无效`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new BadRequestException(`${label}最多 ${max} 个字符`);
  return normalized;
}

/** 主题色归一化：空值透传 null（回退系统色）；#RGB 展开为 #RRGGBB 并统一大写；非法值拒绝。 */
function normalizeThemeColor(value: string | undefined): string | null {
  if (value === undefined || value === null) return null;
  const raw = value.trim();
  if (!raw) return null;
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u.exec(raw);
  if (!m) throw new BadRequestException("主题色需为 #RRGGBB 十六进制颜色");
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${hex.toUpperCase()}`;
}

function normalizeFaq(items: SaveClientChannelProfileRequest["helpFaq"]): ClientChannelFaqItem[] {
  if (!items?.length) return [];
  const out: ClientChannelFaqItem[] = [];
  for (const item of items) {
    const question = (item?.question ?? "").trim();
    const answer = (item?.answer ?? "").trim();
    if (!question || !answer) continue;
    if (question.length > 200 || answer.length > 2000) throw new BadRequestException("常见问题的单条问题最多 200 字、答案最多 2000 字");
    out.push({ question, answer });
  }
  if (out.length > 30) throw new BadRequestException("常见问题最多 30 条");
  return out;
}

function readFaq(value: Prisma.JsonValue | null): ClientChannelFaqItem[] {
  if (!Array.isArray(value)) return [];
  const out: ClientChannelFaqItem[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const question = typeof (row as Record<string, unknown>).question === "string" ? String((row as Record<string, unknown>).question) : "";
    const answer = typeof (row as Record<string, unknown>).answer === "string" ? String((row as Record<string, unknown>).answer) : "";
    if (question && answer) out.push({ question, answer });
  }
  return out;
}

@Injectable()
export class ClientChannelProfileService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly operationLog?: OperationLogService
  ) {}

  private tenantOf(user?: SystemUserRow) {
    if (user?.isSaasAdmin) throw new BadRequestException("SaaS 平台账号不能写入租户客户端渠道配置");
    return user?.tenantId ?? requireRequestTenantId();
  }

  private async load(tenantId: string): Promise<ProfileRow | null> {
    return this.prisma.clientChannelProfile.findUnique({ where: { tenantId }, include: { publishedWorkspaces: true } });
  }

  private async workspaceOptions(tenantId: string): Promise<ClientChannelWorkspaceOption[]> {
    const rows = await this.prisma.businessWorkspace.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { id: true, code: true, name: true, categoryCode: true, status: true },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }]
    });
    return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, categoryCode: String(row.categoryCode), status: row.status }));
  }

  private readiness(row: ProfileRow | null, options: ClientChannelWorkspaceOption[]): ClientChannelReadiness {
    const missing: string[] = [];
    if (!row?.brandName?.trim()) missing.push("填写商户展示名");
    if (!row?.customerServicePhone?.trim()) missing.push("填写客服电话");
    if (!row?.userAgreementVersion?.trim() || !row?.userAgreementBody?.trim()) missing.push("填写用户服务协议版本与正文");
    if (!row?.privacyPolicyVersion?.trim() || !row?.privacyPolicyBody?.trim()) missing.push("填写隐私政策版本与正文");
    const publishedEnabled = (row?.publishedWorkspaces ?? []).filter((w) => w.enabled && options.some((o) => o.id === w.workspaceId));
    if (!publishedEnabled.length) missing.push("至少发布一个服务到客户端");
    return { ready: missing.length === 0, missing };
  }

  private agreement(name: string | null, version: string | null, url: string | null, body: string | null, fallbackName: string) {
    if (!version?.trim()) return undefined;
    return { name: name?.trim() || fallbackName, version: version.trim(), url: url?.trim() || undefined, body: body?.trim() || undefined };
  }

  private summary(row: ProfileRow | null, options: ClientChannelWorkspaceOption[]): ClientChannelProfileSummary {
    const validIds = new Set(options.map((o) => o.id));
    const publishedWorkspaceIds = (row?.publishedWorkspaces ?? []).filter((w) => w.enabled && validIds.has(w.workspaceId)).map((w) => w.workspaceId);
    const defaultWorkspaceId = row?.defaultWorkspaceId && publishedWorkspaceIds.includes(row.defaultWorkspaceId) ? row.defaultWorkspaceId : undefined;
    return {
      configured: Boolean(row),
      revision: row?.revision ?? 0,
      brandName: row?.brandName ?? undefined,
      brandLogoUrl: row?.brandLogoUrl ?? undefined,
      customerServicePhone: row?.customerServicePhone ?? undefined,
      customerServiceHours: row?.customerServiceHours ?? undefined,
      userAgreement: this.agreement(row?.userAgreementName ?? null, row?.userAgreementVersion ?? null, row?.userAgreementUrl ?? null, row?.userAgreementBody ?? null, DEFAULT_AGREEMENT_NAME.userAgreement),
      privacyPolicy: this.agreement(row?.privacyPolicyName ?? null, row?.privacyPolicyVersion ?? null, row?.privacyPolicyUrl ?? null, row?.privacyPolicyBody ?? null, DEFAULT_AGREEMENT_NAME.privacyPolicy),
      helpIntro: row?.helpIntro ?? undefined,
      helpFaq: readFaq(row?.helpFaqJson ?? null),
      bannerTitle: row?.bannerTitle ?? undefined,
      bannerSubtitle: row?.bannerSubtitle ?? undefined,
      themeColor: row?.themeColor ?? undefined,
      smsLoginEnabled: row?.smsLoginEnabled ?? true,
      passwordLoginEnabled: row?.passwordLoginEnabled ?? true,
      publishedWorkspaceIds,
      defaultWorkspaceId,
      workspaces: options,
      readiness: this.readiness(row, options),
      updatedAt: row?.updatedAt.toISOString()
    };
  }

  async get(user?: SystemUserRow): Promise<ClientChannelProfileSummary> {
    const tenantId = this.tenantOf(user);
    const [row, options] = await Promise.all([this.load(tenantId), this.workspaceOptions(tenantId)]);
    return this.summary(row, options);
  }

  /**
   * 登录/会话上下文使用的最小字段。
   *
   * 管理后台的主题色属于租户品牌事实，但不能让普通运营账号为了换肤去调用
   * 需要 system:integration:manage 的完整客户端配置接口；这里只返回主题色，
   * 不泄露协议、渠道凭证或其他客户端配置。
   */
  async getThemeColor(tenantId: string): Promise<string | undefined> {
    const row = await this.prisma.clientChannelProfile.findUnique({
      where: { tenantId },
      select: { themeColor: true }
    });
    return row?.themeColor ?? undefined;
  }

  private async validatedUrl(value: string | null, label: string): Promise<string | null> {
    if (!value) return null;
    // 本站上传得到的品牌图是同源相对路径，不发起出站请求，跳过 SSRF 校验；外链仍逐一校验。
    if (value.startsWith("/api/client/v1/public/website-assets/")) return value;
    try {
      await assertOutboundUrl(value, label, { allowQuery: true });
    } catch (error) {
      throw new BadRequestException(error instanceof UnsafeOutboundUrlError ? error.message : `${label}无法安全使用`);
    }
    return value;
  }

  private agreementData(input: SaveClientChannelProfileRequest["userAgreement"], fallbackName: string) {
    if (!input) return { name: null, version: null, url: null, body: null };
    const version = text(input.version, 64, "协议版本");
    if (!version) throw new BadRequestException("填写协议正文/外链前必须先填协议版本");
    return {
      name: text(input.name, 64, "协议名称") ?? fallbackName,
      version,
      url: text(input.url, 512, "协议外链"),
      body: text(input.body, 20000, "协议正文")
    };
  }

  async save(input: SaveClientChannelProfileRequest, user?: SystemUserRow): Promise<ClientChannelProfileSummary> {
    const tenantId = this.tenantOf(user);
    const existing = await this.load(tenantId);
    if (typeof input.expectedRevision === "number" && existing && existing.revision !== input.expectedRevision) {
      throw new ConflictException("配置已被其他人更新，请刷新后重试");
    }
    const requestedWorkspaceIds = Array.from(new Set((input.publishedWorkspaceIds ?? []).map((id) => String(id).trim()).filter(Boolean)));
    const workspaces = await this.prisma.businessWorkspace.findMany({ where: { tenantId, id: { in: requestedWorkspaceIds } }, select: { id: true, status: true } });
    const unknown = requestedWorkspaceIds.filter((id) => !workspaces.some((row) => row.id === id));
    if (unknown.length) throw new BadRequestException("发布服务必须属于当前租户");
    if (workspaces.some((row) => row.status !== "ACTIVE")) throw new BadRequestException("只能发布已启用的经营空间");
    const defaultWorkspaceId = text(input.defaultWorkspaceId, 191, "默认服务");
    if (defaultWorkspaceId && !requestedWorkspaceIds.includes(defaultWorkspaceId)) throw new BadRequestException("默认服务必须在已发布服务之内");

    const brandLogoUrl = await this.validatedUrl(text(input.brandLogoUrl, 512, "品牌 Logo 地址"), "品牌 Logo 地址");
    const userAgreement = this.agreementData(input.userAgreement, DEFAULT_AGREEMENT_NAME.userAgreement);
    const privacyPolicy = this.agreementData(input.privacyPolicy, DEFAULT_AGREEMENT_NAME.privacyPolicy);
    userAgreement.url = await this.validatedUrl(userAgreement.url, "用户协议外链");
    privacyPolicy.url = await this.validatedUrl(privacyPolicy.url, "隐私政策外链");
    const faq = normalizeFaq(input.helpFaq);

    const data = {
      brandName: text(input.brandName, 191, "商户展示名"),
      brandLogoUrl,
      customerServicePhone: text(input.customerServicePhone, 32, "客服电话"),
      customerServiceHours: text(input.customerServiceHours, 64, "客服时段"),
      userAgreementName: userAgreement.name,
      userAgreementVersion: userAgreement.version,
      userAgreementUrl: userAgreement.url,
      userAgreementBody: userAgreement.body,
      privacyPolicyName: privacyPolicy.name,
      privacyPolicyVersion: privacyPolicy.version,
      privacyPolicyUrl: privacyPolicy.url,
      privacyPolicyBody: privacyPolicy.body,
      helpIntro: text(input.helpIntro, 2000, "帮助说明"),
      helpFaqJson: faq as unknown as Prisma.InputJsonValue,
      bannerTitle: text(input.bannerTitle, 64, "首页横幅标题"),
      bannerSubtitle: text(input.bannerSubtitle, 120, "首页横幅副标题"),
      themeColor: normalizeThemeColor(input.themeColor),
      smsLoginEnabled: Boolean(input.smsLoginEnabled),
      passwordLoginEnabled: Boolean(input.passwordLoginEnabled),
      defaultWorkspaceId
    };

    await this.prisma.$transaction(async (tx) => {
      const row = existing
        ? await tx.clientChannelProfile.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } })
        : await tx.clientChannelProfile.create({ data: { tenantId, ...data } });
      await tx.clientChannelWorkspace.deleteMany({ where: { profileId: row.id, workspaceId: { notIn: requestedWorkspaceIds } } });
      for (const workspaceId of requestedWorkspaceIds) {
        await tx.clientChannelWorkspace.upsert({
          where: { tenantId_workspaceId: { tenantId, workspaceId } },
          create: { tenantId, profileId: row.id, workspaceId, enabled: true },
          update: { profileId: row.id, enabled: true }
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await this.operationLog?.record({ tenantId, user, action: "client-channel-profile.save", targetType: "client_channel_profile", targetId: tenantId, detail: "保存客户端渠道配置", metadata: { publishedWorkspaces: requestedWorkspaceIds.length, hasUserAgreementBody: Boolean(userAgreement.body), hasPrivacyBody: Boolean(privacyPolicy.body), faqCount: faq.length } });
    const [row, options] = await Promise.all([this.load(tenantId), this.workspaceOptions(tenantId)]);
    return this.summary(row, options);
  }
}
