import type { SaveTenantAppearanceRequest } from "@rental-os/shared";
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

/**
 * 品牌与外观（管理后台 UI 身份）保存 DTO（从客户端渠道拆出）。
 * expectedRevision 乐观并发；圆角范围由服务层精确校验（8-40 连续或 999 极致，且极致仅按钮组）。
 */
export class SaveTenantAppearanceDto implements SaveTenantAppearanceRequest {
  @IsOptional() @IsInt() @Min(0)
  expectedRevision?: number;

  @IsOptional() @IsString() @MaxLength(120)
  brandName?: string;

  @IsOptional() @IsString() @MaxLength(512)
  brandLogoUrl?: string;

  @IsOptional() @IsString() @MaxLength(512)
  faviconUrl?: string;

  /** 主题色：#RGB 或 #RRGGBB；服务层归一化为大写 #RRGGBB。留空回退系统默认色。 */
  @IsOptional() @IsString() @Matches(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u, { message: "主题色需为 #RRGGBB 十六进制颜色" })
  themeColor?: string;

  /** 旧的统一圆角（回退基准）：8-40 连续或 999 极致。 */
  @IsOptional() @IsInt() @Min(8) @Max(999)
  adminCornerRadius?: number;

  @IsOptional() @IsInt() @Min(8) @Max(999)
  adminContainerRadius?: number;

  @IsOptional() @IsInt() @Min(8) @Max(999)
  adminButtonRadius?: number;

  @IsOptional() @IsInt() @Min(8) @Max(999)
  adminInputRadius?: number;
}
