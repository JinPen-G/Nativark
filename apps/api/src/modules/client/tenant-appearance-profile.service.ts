import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { ADMIN_UI_CORNER_RADIUS_FULL, ADMIN_UI_CORNER_RADIUS_MAX, ADMIN_UI_CORNER_RADIUS_MIN } from "@rental-os/shared";
import type { SaveTenantAppearanceRequest, SystemUserRow, TenantAppearanceProfile } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { requireRequestTenantId } from "../../common/request-identity";

type AppearanceRow = {
  revision: number;
  brandName: string | null;
  brandLogoUrl: string | null;
  faviconUrl: string | null;
  themeColor: string | null;
  adminCornerRadius: number | null;
  adminContainerRadius: number | null;
  adminButtonRadius: number | null;
  adminInputRadius: number | null;
  updatedAt: Date;
} | null;

/** 主题色归一化：空=null（回退系统色）；#RGB 展开为 #RRGGBB 并大写；非法拒绝。 */
function normalizeThemeColor(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const raw = value.trim();
  if (!raw) return null;
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u.exec(raw);
  if (!m) throw new BadRequestException("主题色需为 #RRGGBB 十六进制颜色");
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${hex.toUpperCase()}`;
}

/**
 * 圆角归一化：空=null（前端回退旧统一值再回退平台默认）。
 * 连续区间 8-40px；极致圆角 999px 仅 allowFull（按钮组）可用，容器/输入拒绝 999。
 */
function normalizeRadius(value: number | undefined | null, allowFull: boolean): number | null {
  if (value === undefined || value === null) return null;
  if (value === ADMIN_UI_CORNER_RADIUS_FULL) {
    if (allowFull) return value;
    throw new BadRequestException(`该项圆角仅支持 ${ADMIN_UI_CORNER_RADIUS_MIN}-${ADMIN_UI_CORNER_RADIUS_MAX} 的整数（px），不支持极致圆角 ${ADMIN_UI_CORNER_RADIUS_FULL}`);
  }
  if (!Number.isInteger(value) || value < ADMIN_UI_CORNER_RADIUS_MIN || value > ADMIN_UI_CORNER_RADIUS_MAX) {
    throw new BadRequestException(`管理后台圆角必须是 ${ADMIN_UI_CORNER_RADIUS_MIN}-${ADMIN_UI_CORNER_RADIUS_MAX} 的整数（px），或极致圆角 ${ADMIN_UI_CORNER_RADIUS_FULL}`);
  }
  return value;
}

function trimText(value: string | undefined | null, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  const v = value.trim();
  if (!v) return null;
  if (v.length > max) throw new BadRequestException(`${label}最多 ${max} 个字符`);
  return v;
}

/**
 * 品牌与外观（管理后台 UI 身份）领域服务（从客户端渠道拆出）。
 * 单一真源 tenant_appearance_profiles；主题色作用于客户端+管理后台，圆角作用于管理后台。
 * 旧统一圆角 adminCornerRadius 作回退基准；容器/输入 8-40，仅按钮组可 999（极致胶囊）。
 */
@Injectable()
export class TenantAppearanceProfileService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantOf(user?: SystemUserRow): string {
    return user?.tenantId ?? requireRequestTenantId();
  }

  private toSummary(row: AppearanceRow): TenantAppearanceProfile {
    return {
      brandName: row?.brandName?.trim() || undefined,
      brandLogoUrl: row?.brandLogoUrl ?? undefined,
      faviconUrl: row?.faviconUrl ?? undefined,
      themeColor: row?.themeColor ?? undefined,
      adminCornerRadius: row?.adminCornerRadius ?? undefined,
      adminContainerRadius: row?.adminContainerRadius ?? undefined,
      adminButtonRadius: row?.adminButtonRadius ?? undefined,
      adminInputRadius: row?.adminInputRadius ?? undefined,
      revision: row?.revision ?? 0,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : undefined
    };
  }

  async get(user?: SystemUserRow): Promise<TenantAppearanceProfile> {
    const tenantId = this.tenantOf(user);
    const row = await this.prisma.tenantAppearanceProfile.findUnique({ where: { tenantId } });
    return this.toSummary(row);
  }

  async save(input: SaveTenantAppearanceRequest, user?: SystemUserRow): Promise<TenantAppearanceProfile> {
    const tenantId = this.tenantOf(user);
    const existing = await this.prisma.tenantAppearanceProfile.findUnique({ where: { tenantId } });
    if (existing && input.expectedRevision != null && existing.revision !== input.expectedRevision) {
      throw new ConflictException("品牌与外观配置已被其他管理员更新，请刷新后基于最新结果重试");
    }
    // 设置分属两个页面：省略表示保持，显式 null/空字符串才表示清空。
    const data = {
      ...(input.brandName !== undefined ? { brandName: trimText(input.brandName, 120, "品牌名称") } : {}),
      ...(input.brandLogoUrl !== undefined ? { brandLogoUrl: trimText(input.brandLogoUrl, 512, "品牌 Logo 地址") } : {}),
      ...(input.faviconUrl !== undefined ? { faviconUrl: trimText(input.faviconUrl, 512, "浏览器图标地址") } : {}),
      ...(input.themeColor !== undefined ? { themeColor: normalizeThemeColor(input.themeColor) } : {}),
      ...(input.adminCornerRadius !== undefined ? { adminCornerRadius: normalizeRadius(input.adminCornerRadius, true) } : {}),
      ...(input.adminContainerRadius !== undefined ? { adminContainerRadius: normalizeRadius(input.adminContainerRadius, false) } : {}),
      ...(input.adminButtonRadius !== undefined ? { adminButtonRadius: normalizeRadius(input.adminButtonRadius, true) } : {}),
      ...(input.adminInputRadius !== undefined ? { adminInputRadius: normalizeRadius(input.adminInputRadius, false) } : {})
    };
    try {
      if (existing) {
        const row = await this.prisma.tenantAppearanceProfile.update({
          where: { tenantId, revision: input.expectedRevision ?? existing.revision },
          data: { ...data, revision: { increment: 1 } }
        });
        return this.toSummary(row);
      }
      if (input.expectedRevision != null && input.expectedRevision !== 0) {
        throw new ConflictException("外观配置已变化，请刷新后重试");
      }
      // 首次独立保存圆角时保留旧渠道中的品牌与其他圆角，不创建空品牌覆盖已有显示。
      const legacy = await this.prisma.clientChannelProfile.findUnique({
        where: { tenantId },
        select: { brandName: true, brandLogoUrl: true, faviconUrl: true, themeColor: true, adminCornerRadius: true, adminContainerRadius: true, adminButtonRadius: true, adminInputRadius: true }
      });
      const row = await this.prisma.tenantAppearanceProfile.create({ data: { tenantId, ...legacy, ...data } });
      return this.toSummary(row);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error.code === "P2025" || error.code === "P2002")) {
        throw new ConflictException("外观配置已被其他管理员更新，请刷新后重试");
      }
      throw error;
    }
  }

  /**
   * 品牌与外观的只读读取（供 auth/客户端复用）。缺表行时返回空对象，各读取方自行回退默认。
   * P2 会把 auth / client-api / client-auth 的品牌读取切到这里，成为单一真源。
   */
  async getBranding(tenantId: string): Promise<Pick<TenantAppearanceProfile, "brandName" | "brandLogoUrl" | "faviconUrl" | "themeColor" | "adminCornerRadius" | "adminContainerRadius" | "adminButtonRadius" | "adminInputRadius">> {
    const row = await this.prisma.tenantAppearanceProfile.findUnique({ where: { tenantId } });
    const s = this.toSummary(row);
    return {
      brandName: s.brandName,
      brandLogoUrl: s.brandLogoUrl,
      faviconUrl: s.faviconUrl,
      themeColor: s.themeColor,
      adminCornerRadius: s.adminCornerRadius,
      adminContainerRadius: s.adminContainerRadius,
      adminButtonRadius: s.adminButtonRadius,
      adminInputRadius: s.adminInputRadius
    };
  }
}
