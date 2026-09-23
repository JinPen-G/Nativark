import { BadRequestException, ConflictException, Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  ClientChannelReadiness,
  SaveWebsiteChannelProfileRequest,
  SystemUserRow,
  WebsiteAdvantage,
  WebsiteCategoryImage,
  WebsiteChannelProfileSummary,
  WebsiteStep,
  WebsiteTestimonial
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

/** 自定义域名归一化：允许带 http(s):// 或路径的粘贴，取出小写 host；空值透传 null；非法域名拒绝。 */
export function normalizeCustomDomain(value: string | undefined): string | null {
  if (value === undefined || value === null) return null;
  let raw = value.trim().toLowerCase();
  if (!raw) return null;
  raw = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (!raw) return null;
  // 合法主机名：点分标签，字母数字与连字符，至少两段，末段为字母。
  if (raw.length > 191 || !/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(raw)) {
    throw new BadRequestException("自定义域名格式无效（示例：www.brand.com，只填域名不含 http/路径）");
  }
  return raw;
}

/** 读取品类入口图 JSON：过滤非法项，只保留 { code, imageUrl } 字符串对。 */
function readCategoryImages(value: unknown): WebsiteCategoryImage[] {
  if (!Array.isArray(value)) return [];
  const out: WebsiteCategoryImage[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const code = typeof (row as Record<string, unknown>).code === "string" ? String((row as Record<string, unknown>).code) : "";
    const imageUrl = typeof (row as Record<string, unknown>).imageUrl === "string" ? String((row as Record<string, unknown>).imageUrl) : "";
    if (code && imageUrl) out.push({ code, imageUrl });
  }
  return out;
}

const str = (row: Record<string, unknown>, key: string) => (typeof row[key] === "string" ? String(row[key]) : "");

/** 读取内容块 JSON（卖点/步骤/评价）：容错解析，丢弃缺必填项。 */
function readAdvantages(value: unknown): WebsiteAdvantage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const title = str(row as Record<string, unknown>, "title").trim();
    if (!title) return [];
    const icon = str(row as Record<string, unknown>, "icon").trim();
    const description = str(row as Record<string, unknown>, "description").trim();
    return [{ ...(icon ? { icon } : {}), title, ...(description ? { description } : {}) }];
  });
}
function readSteps(value: unknown): WebsiteStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const title = str(row as Record<string, unknown>, "title").trim();
    if (!title) return [];
    const description = str(row as Record<string, unknown>, "description").trim();
    return [{ title, ...(description ? { description } : {}) }];
  });
}
function readTestimonials(value: unknown): WebsiteTestimonial[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const name = str(row as Record<string, unknown>, "name").trim();
    const text = str(row as Record<string, unknown>, "text").trim();
    if (!name || !text) return [];
    const context = str(row as Record<string, unknown>, "context").trim();
    return [{ name, ...(context ? { context } : {}), text }];
  });
}

/** 规范化内容块输入：裁剪长度、丢弃缺必填项、限制条数。 */
function normalizeAdvantages(input: SaveWebsiteChannelProfileRequest["advantages"]): WebsiteAdvantage[] {
  if (!input?.length) return [];
  const out: WebsiteAdvantage[] = [];
  for (const item of input) {
    const title = (item?.title ?? "").trim();
    if (!title) continue;
    if (title.length > 40) throw new BadRequestException("卖点标题最多 40 字");
    const description = (item?.description ?? "").trim();
    if (description.length > 120) throw new BadRequestException("卖点描述最多 120 字");
    const icon = (item?.icon ?? "").trim().slice(0, 32);
    out.push({ ...(icon ? { icon } : {}), title, ...(description ? { description } : {}) });
  }
  if (out.length > 8) throw new BadRequestException("卖点最多 8 条");
  return out;
}
function normalizeSteps(input: SaveWebsiteChannelProfileRequest["steps"]): WebsiteStep[] {
  if (!input?.length) return [];
  const out: WebsiteStep[] = [];
  for (const item of input) {
    const title = (item?.title ?? "").trim();
    if (!title) continue;
    if (title.length > 40) throw new BadRequestException("流程步骤标题最多 40 字");
    const description = (item?.description ?? "").trim();
    if (description.length > 120) throw new BadRequestException("流程步骤描述最多 120 字");
    out.push({ title, ...(description ? { description } : {}) });
  }
  if (out.length > 8) throw new BadRequestException("流程步骤最多 8 条");
  return out;
}
function normalizeTestimonials(input: SaveWebsiteChannelProfileRequest["testimonials"]): WebsiteTestimonial[] {
  if (!input?.length) return [];
  const out: WebsiteTestimonial[] = [];
  for (const item of input) {
    const name = (item?.name ?? "").trim();
    const text = (item?.text ?? "").trim();
    if (!name || !text) continue;
    if (name.length > 40) throw new BadRequestException("评价来源最多 40 字");
    if (text.length > 300) throw new BadRequestException("评价正文最多 300 字");
    const context = (item?.context ?? "").trim();
    if (context.length > 60) throw new BadRequestException("评价场景最多 60 字");
    out.push({ name, ...(context ? { context } : {}), text });
  }
  if (out.length > 12) throw new BadRequestException("用户评价最多 12 条");
  return out;
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

  /** 可配置入口图的一级品类 = 当前租户已启用的经营空间。 */
  private async categoryOptions(tenantId: string): Promise<Array<{ code: string; name: string }>> {
    const rows = await this.prisma.businessWorkspace.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { code: true, name: true },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }]
    });
    return rows.map((row) => ({ code: row.code, name: row.name }));
  }

  private readiness(row: ProfileRow | null): ClientChannelReadiness {
    const missing: string[] = [];
    if (!row?.enabled) missing.push("启用官网渠道");
    if (!row?.heroTitle?.trim()) missing.push("填写首页 Hero 标题");
    return { ready: missing.length === 0, missing };
  }

  private summary(row: ProfileRow | null, categories: Array<{ code: string; name: string }>): WebsiteChannelProfileSummary {
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
      customDomain: row?.customDomain ?? undefined,
      categoryImages: readCategoryImages(row?.categoryImagesJson),
      advantages: readAdvantages(row?.advantagesJson),
      steps: readSteps(row?.stepsJson),
      testimonials: readTestimonials(row?.testimonialsJson),
      categories,
      readiness: this.readiness(row),
      updatedAt: row?.updatedAt.toISOString()
    };
  }

  async get(user?: SystemUserRow): Promise<WebsiteChannelProfileSummary> {
    const tenantId = this.tenantOf(user);
    const [row, categories] = await Promise.all([this.load(tenantId), this.categoryOptions(tenantId)]);
    return this.summary(row, categories);
  }

  private async validatedUrl(value: string | null, label: string): Promise<string | null> {
    if (!value) return null;
    // 本站上传得到的图片是同源相对路径（/api/client/v1/public/website-assets/...），不发起出站请求，
    // 无 SSRF 风险，跳过出站地址校验；外部绝对地址仍逐一校验。
    if (value.startsWith("/api/client/v1/public/website-assets/")) return value;
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
    const categories = await this.categoryOptions(tenantId);
    const validCodes = new Set(categories.map((c) => c.code));
    // 品类入口图：按 code 去重、丢弃空图与非本租户品类，逐一校验出站地址。
    const categoryImages: WebsiteCategoryImage[] = [];
    const seenCodes = new Set<string>();
    for (const entry of input.categoryImages ?? []) {
      const code = text(entry?.code, 191, "品类编码");
      const imageUrl = text(entry?.imageUrl, 512, "品类入口图地址");
      if (!code || !imageUrl || seenCodes.has(code)) continue;
      if (!validCodes.has(code)) throw new BadRequestException("品类入口图只能配置本租户已启用的经营空间");
      await this.validatedUrl(imageUrl, "品类入口图地址");
      seenCodes.add(code);
      categoryImages.push({ code, imageUrl });
    }

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
      showPoweredBy: Boolean(input.showPoweredBy),
      customDomain: normalizeCustomDomain(input.customDomain),
      categoryImagesJson: categoryImages as unknown as Prisma.InputJsonValue,
      advantagesJson: normalizeAdvantages(input.advantages) as unknown as Prisma.InputJsonValue,
      stepsJson: normalizeSteps(input.steps) as unknown as Prisma.InputJsonValue,
      testimonialsJson: normalizeTestimonials(input.testimonials) as unknown as Prisma.InputJsonValue
    };

    const row = await (async () => {
      try {
        return existing
          ? await this.prisma.websiteChannelProfile.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } })
          : await this.prisma.websiteChannelProfile.create({ data: { tenantId, ...data } });
      } catch (error) {
        // 自定义域名全局唯一：被其他租户占用时 Prisma 抛 P2002。只有确实提交了域名时才归因于域名冲突，
        // 否则（如极窄并发下同租户 tenantId 唯一冲突）用通用冲突提示。
        if (error && typeof error === "object" && (error as { code?: string }).code === "P2002") {
          throw new ConflictException(data.customDomain ? "该自定义域名已被其他租户绑定" : "配置已被其他人更新，请刷新后重试");
        }
        throw error;
      }
    })();

    await this.operationLog?.record({
      tenantId,
      user,
      action: "website-channel-profile.save",
      targetType: "website_channel_profile",
      targetId: tenantId,
      detail: "保存官网渠道配置",
      metadata: { enabled: data.enabled, hasHero: Boolean(data.heroTitle), hasHeroImage: Boolean(data.heroImageUrl), categoryImages: categoryImages.length }
    });

    return this.summary(row, categories);
  }
}
