import type { SaveTenantAppearanceRequest } from "@rental-os/shared";
import { ADMIN_UI_CORNER_RADIUS_CONTROL_MAX, ADMIN_UI_CORNER_RADIUS_MAX, ADMIN_UI_CORNER_RADIUS_MIN } from "@rental-os/shared";
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

/**
 * 品牌与外观（管理后台 UI 身份）保存 DTO（从客户端渠道拆出）。
 * expectedRevision 乐观并发；DTO 与服务层共用普通圆角范围，显式 null 清除覆盖。
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

  /** 旧统一回退基准的新写入范围与容器相同。 */
  @IsOptional() @IsInt() @Min(ADMIN_UI_CORNER_RADIUS_MIN) @Max(ADMIN_UI_CORNER_RADIUS_MAX)
  adminCornerRadius?: number | null;

  @IsOptional() @IsInt() @Min(ADMIN_UI_CORNER_RADIUS_MIN) @Max(ADMIN_UI_CORNER_RADIUS_MAX)
  adminContainerRadius?: number | null;

  @IsOptional() @IsInt() @Min(ADMIN_UI_CORNER_RADIUS_MIN) @Max(ADMIN_UI_CORNER_RADIUS_CONTROL_MAX)
  adminButtonRadius?: number | null;

  @IsOptional() @IsInt() @Min(ADMIN_UI_CORNER_RADIUS_MIN) @Max(ADMIN_UI_CORNER_RADIUS_CONTROL_MAX)
  adminInputRadius?: number | null;
}
