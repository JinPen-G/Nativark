import { BadRequestException, ConflictException, Injectable, Optional } from "@nestjs/common";
import type {
  ClientChannelReadiness,
  SaveWebsiteChannelProfileRequest,
  SystemUserRow,
  WebsiteChannelProfileSummary
} from "@rental-os/shared";
import { OperationLogService } from "../../common/operation-log.service";
import { assertOutboundUrl, UnsafeOutboundUrlError } from "../../common/outbound-url";
import { requireRequestTenantId } from "../../common/request-identity";
import { PrismaService } from "../database/prisma.service";

/**
 * 租户级 web 官网渠道配置（WEBSITE-CHANNEL-01）：只存官网特有设定项（标语、Hero、辅助色、页脚、
 * 联系地址、底部 CTA、SEO、Powered by 与官网启用开关）。商户名/Logo/协议/客服/帮助/发布服务复用
 * 通用的 ClientChannelProfile，不在此重复。
 *
 * - 一租户一条（tenantId 唯一）；保存带 expectedRevision 乐观锁。
 * - Hero 大图地址做出站地址安全校验；辅助色归一化为大写 #RRGGBB。
 */
type ProfileRow = NonNullable<Awaited<ReturnType<PrismaService["websiteChannelProfile"]["findUnique"]>>>;

function text(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new BadRequestException(`${label}格式无效`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new BadRequestException(`${label}最多 ${max} 个字符`);
  return normalized;
}

/** 辅助色归一化：空值透传 null（回退默认）；#RGB 展开为 #RRGGBB 并统一大写；非法值拒绝。 */
function normalizeColor(value: string | undefined): string | null {
  if (value === undefined || value === null) return null;
  const raw = value.trim();
  if (!raw) return null;
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u.exec(raw);
  if (!m) throw new BadRequestException("辅助色需为 #RRGGBB 十六进制颜色");
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${hex.toUpperCase()}`;
}

@Injectable()
export class WebsiteChannelProfileService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly operationLog?: OperationLogService
  ) {}

  private tenantOf(user?: SystemUserRow) {
    if (user?.isSaasAdmin) throw new BadRequestException("SaaS 平台账号不能写入租户官网渠道配置");
    return user?.tenantId ?? requireRequestTenantId();
  }

  private load(tenantId: string): Promise<ProfileRow | null> {
    return this.prisma.websiteChannelProfile.findUnique({ where: { tenantId } });
  }

  private readiness(row: ProfileRow | null): ClientChannelReadiness {
    const missing: string[] = [];
    if (!row?.enabled) missing.push("启用官网渠道");
    if (!row?.heroTitle?.trim()) missing.push("填写首页 Hero 标题");
    return { ready: missing.length === 0, missing };
  }

  private summary(row: ProfileRow | null): WebsiteChannelProfileSummary {
    return {
      configured: Boolean(row),
      revision: row?.revision ?? 0,
      enabled: row?.enabled ?? false,
      slogan: row?.slogan ?? undefined,
      heroTitle: row?.heroTitle ?? undefined,
      heroDescription: row?.heroDescription ?? undefined,
      heroImageUrl: row?.heroImageUrl ?? undefined,
      secondaryColor: row?.secondaryColor ?? undefined,
      footerText: row?.footerText ?? undefined,
      contactAddress: row?.contactAddress ?? undefined,
      ctaTitle: row?.ctaTitle ?? undefined,
      ctaDescription: row?.ctaDescription ?? undefined,
      seoTitle: row?.seoTitle ?? undefined,
      seoDescription: row?.seoDescription ?? undefined,
      seoKeywords: row?.seoKeywords ?? undefined,
      showPoweredBy: row?.showPoweredBy ?? true,
      readiness: this.readiness(row),
      updatedAt: row?.updatedAt.toISOString()
    };
  }

  async get(user?: SystemUserRow): Promise<WebsiteChannelProfileSummary> {
    const tenantId = this.tenantOf(user);
    return this.summary(await this.load(tenantId));
  }

  private async validatedUrl(value: string | null, label: string): Promise<string | null> {
    if (!value) return null;
    try {
      await assertOutboundUrl(value, label, { allowQuery: true });
    } catch (error) {
      throw new BadRequestException(error instanceof UnsafeOutboundUrlError ? error.message : `${label}无法安全使用`);
    }
    return value;
  }

  async save(input: SaveWebsiteChannelProfileRequest, user?: SystemUserRow): Promise<WebsiteChannelProfileSummary> {
    const tenantId = this.tenantOf(user);
    const existing = await this.load(tenantId);
    if (typeof input.expectedRevision === "number" && existing && existing.revision !== input.expectedRevision) {
      throw new ConflictException("配置已被其他人更新，请刷新后重试");
    }

    const heroImageUrl = await this.validatedUrl(text(input.heroImageUrl, 512, "Hero 大图地址"), "Hero 大图地址");
    const data = {
      enabled: Boolean(input.enabled),
      slogan: text(input.slogan, 120, "站点标语"),
      heroTitle: text(input.heroTitle, 120, "Hero 标题"),
      heroDescription: text(input.heroDescription, 400, "Hero 副文案"),
      heroImageUrl,
      secondaryColor: normalizeColor(input.secondaryColor),
      footerText: text(input.footerText, 600, "页脚文案"),
      contactAddress: text(input.contactAddress, 256, "联系地址"),
      ctaTitle: text(input.ctaTitle, 120, "底部行动区标题"),
      ctaDescription: text(input.ctaDescription, 400, "底部行动区文案"),
      seoTitle: text(input.seoTitle, 120, "SEO 标题"),
      seoDescription: text(input.seoDescription, 400, "SEO 描述"),
      seoKeywords: text(input.seoKeywords, 256, "SEO 关键词"),
      showPoweredBy: Boolean(input.showPoweredBy)
    };

    const row = existing
      ? await this.prisma.websiteChannelProfile.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } })
      : await this.prisma.websiteChannelProfile.create({ data: { tenantId, ...data } });

    await this.operationLog?.record({
      tenantId,
      user,
      action: "website-channel-profile.save",
      targetType: "website_channel_profile",
      targetId: tenantId,
      detail: "保存官网渠道配置",
      metadata: { enabled: data.enabled, hasHero: Boolean(data.heroTitle), hasHeroImage: Boolean(data.heroImageUrl) }
    });

    return this.summary(row);
  }
}
