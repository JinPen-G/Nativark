import { BadRequestException, Injectable } from "@nestjs/common";
import type { AccountAppearanceProfile, SaveAccountAppearanceRequest, SystemUserRow } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { requireRequestUserId } from "../../common/request-identity";

/** 主题色归一化：空=null（回退平台默认色）；#RGB 展开为 #RRGGBB 并大写；非法拒绝。 */
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
 * 账户级外观偏好领域服务：跟随登录账户、与租户品牌色（TenantAppearanceProfile.themeColor）相互独立。
 * 目前仅存管理后台主题色，按会话 user.id 作用域（忽略请求体里的任何 userId），一账户一条。
 */
@Injectable()
export class AccountAppearanceService {
  constructor(private readonly prisma: PrismaService) {}

  private userIdOf(user?: SystemUserRow): string {
    return user?.id ?? requireRequestUserId();
  }

  async get(user?: SystemUserRow): Promise<AccountAppearanceProfile> {
    const userId = this.userIdOf(user);
    const row = await this.prisma.userAppearancePreference.findUnique({ where: { userId } });
    return { themeColor: row?.themeColor ?? undefined, updatedAt: row?.updatedAt?.toISOString() };
  }

  async save(input: SaveAccountAppearanceRequest, user?: SystemUserRow): Promise<AccountAppearanceProfile> {
    const userId = this.userIdOf(user);
    const themeColor = normalizeThemeColor(input.themeColor);
    const row = await this.prisma.userAppearancePreference.upsert({
      where: { userId },
      update: { themeColor },
      create: { userId, themeColor }
    });
    return { themeColor: row.themeColor ?? undefined, updatedAt: row.updatedAt?.toISOString() };
  }

  /** 供 auth 组装会话时按账户读取主题色；缺行返回 undefined，读失败由调用方兜底、不阻断登录。 */
  async getThemeColor(userId: string): Promise<string | undefined> {
    const row = await this.prisma.userAppearancePreference.findUnique({ where: { userId }, select: { themeColor: true } });
    return row?.themeColor ?? undefined;
  }
}
