import type { SaveWebsiteChannelProfileRequest, WebsiteCategoryImage } from "@rental-os/shared";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from "class-validator";

export class WebsiteCategoryImageDto implements WebsiteCategoryImage {
  @IsString() @MaxLength(191)
  code!: string;

  @IsString() @MaxLength(512)
  imageUrl!: string;
}

/**
 * 租户级 web 官网渠道配置（WEBSITE-CHANNEL-01）。只承载官网特有设定项；
 * 商户名/Logo/协议/客服/帮助/发布服务仍走 SaveClientChannelProfileDto。
 * expectedRevision 用于并发保护：不一致则拒绝保存，防止两人互相覆盖。
 */
export class SaveWebsiteChannelProfileDto implements SaveWebsiteChannelProfileRequest {
  @IsOptional() @IsInt() @Min(0)
  expectedRevision?: number;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional() @IsString() @MaxLength(120)
  slogan?: string;

  @IsOptional() @IsString() @MaxLength(120)
  heroTitle?: string;

  @IsOptional() @IsString() @MaxLength(400)
  heroDescription?: string;

  @IsOptional() @IsString() @MaxLength(512)
  heroImageUrl?: string;

  /** 辅助色：#RGB 或 #RRGGBB；服务层再归一化为大写 #RRGGBB。留空表示回退默认。 */
  @IsOptional() @IsString() @Matches(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u, { message: "辅助色需为 #RRGGBB 十六进制颜色" })
  secondaryColor?: string;

  @IsOptional() @IsString() @MaxLength(600)
  footerText?: string;

  @IsOptional() @IsString() @MaxLength(256)
  contactAddress?: string;

  @IsOptional() @IsString() @MaxLength(120)
  ctaTitle?: string;

  @IsOptional() @IsString() @MaxLength(400)
  ctaDescription?: string;

  @IsOptional() @IsString() @MaxLength(120)
  seoTitle?: string;

  @IsOptional() @IsString() @MaxLength(400)
  seoDescription?: string;

  @IsOptional() @IsString() @MaxLength(256)
  seoKeywords?: string;

  @IsBoolean()
  showPoweredBy!: boolean;

  /** 自定义官网域名（如 www.brand.com）；仅 host，服务层归一化为小写并校验格式。 */
  @IsOptional() @IsString() @MaxLength(191)
  customDomain?: string;

  /** 品类入口图（按服务编码）；服务层校验地址并按 code 去重。 */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => WebsiteCategoryImageDto)
  categoryImages?: WebsiteCategoryImageDto[];
}
