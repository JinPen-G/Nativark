/** 原Rental渠道HTTP请求类单源；字段、嵌套验证与原序列化保持，装配和授权由宿主负责。 */
import type { AdminLoginBranding } from "@rental-os/platform-contracts";
import { ADMIN_UI_CORNER_RADIUS_CONTROL_MAX, ADMIN_UI_CORNER_RADIUS_MAX, ADMIN_UI_CORNER_RADIUS_MIN } from "@rental-os/platform-contracts";
import type { ClientChannelAgreementConfig, ClientChannelFaqItem, SaveClientChannelProfileRequest, SaveWebsiteChannelProfileRequest, WebsiteAdvantage, WebsiteCategoryImage, WebsiteStep, WebsiteTestimonial, SaveMiniProgramChannelRequest } from "./channel-contracts";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";

/** 协议配置：名称/版本必填，外链与正文可选（正文长度在服务层再按 MediumText 上限保护）。 */
export class ClientChannelAgreementConfigDto implements ClientChannelAgreementConfig {
  @IsString() @MaxLength(64)
  name!: string;

  @IsString() @MaxLength(64)
  version!: string;

  @IsOptional() @IsString() @MaxLength(512)
  url?: string;

  @IsOptional() @IsString() @MaxLength(20000)
  body?: string;
}

export class ClientChannelFaqItemDto implements ClientChannelFaqItem {
  @IsString() @MaxLength(200)
  question!: string;

  @IsString() @MaxLength(2000)
  answer!: string;
}

/**
 * 租户级客户端渠道配置（CLIENT-CHANNEL-01）。小程序与 APP 共用；微信凭证另走 SaveMiniProgramChannelDto。
 * expectedRevision 用于并发保护：不一致则拒绝保存，防止两人互相覆盖。
 */
export class AdminLoginHighlightInputDto {
  @IsOptional() @IsString() @MaxLength(24)
  title?: string;

  @IsOptional() @IsString() @MaxLength(80)
  description?: string;
}

export class AdminLoginBrandingDto implements AdminLoginBranding {
  @IsOptional() @IsBoolean()
  showTitle?: boolean;

  @IsOptional() @IsBoolean()
  showDescription?: boolean;

  @IsOptional() @IsBoolean()
  showHighlights?: boolean;

  @IsOptional() @IsBoolean()
  showFooter?: boolean;

  @IsOptional() @IsString() @MaxLength(512)
  backgroundImageUrl?: string;

  @IsOptional() @IsString() @MaxLength(80)
  title?: string;

  @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => AdminLoginHighlightInputDto)
  highlights?: AdminLoginHighlightInputDto[];

  @IsOptional() @IsString() @MaxLength(160)
  footerText?: string;
}

export class SaveClientChannelProfileDto implements SaveClientChannelProfileRequest {
  @IsOptional() @ValidateNested() @Type(() => AdminLoginBrandingDto)
  adminLogin?: AdminLoginBrandingDto;

  @IsOptional() @IsInt() @Min(0)
  expectedRevision?: number;

  @IsOptional() @IsString() @MaxLength(191)
  brandName?: string;

  @IsOptional() @IsString() @MaxLength(512)
  brandLogoUrl?: string;

  @IsOptional() @IsString() @MaxLength(512)
  faviconUrl?: string;

  @IsOptional() @IsString() @MaxLength(32)
  customerServicePhone?: string;

  @IsOptional() @IsString() @MaxLength(64)
  customerServiceHours?: string;

  @IsOptional() @ValidateNested() @Type(() => ClientChannelAgreementConfigDto)
  userAgreement?: ClientChannelAgreementConfigDto;

  @IsOptional() @ValidateNested() @Type(() => ClientChannelAgreementConfigDto)
  privacyPolicy?: ClientChannelAgreementConfigDto;

  @IsOptional() @IsString() @MaxLength(2000)
  helpIntro?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ClientChannelFaqItemDto)
  helpFaq?: ClientChannelFaqItemDto[];

  @IsOptional() @IsString() @MaxLength(64)
  bannerTitle?: string;

  @IsOptional() @IsString() @MaxLength(120)
  bannerSubtitle?: string;

  /** 主题色：#RGB 或 #RRGGBB；服务层再归一化为大写 #RRGGBB。留空表示回退系统默认色。 */
  @IsOptional() @IsString() @Matches(/^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))?$/u, { message: "主题色需为 #RRGGBB 十六进制颜色" })
  themeColor?: string;

  /** 旧统一基准：只校验明确提交的新值，省略保留、null 清除。 */
  @IsOptional() @IsInt() @Min(ADMIN_UI_CORNER_RADIUS_MIN) @Max(ADMIN_UI_CORNER_RADIUS_MAX)
  adminCornerRadius?: number | null;

  /** 容器圆角：4–20px 整数，null 回退。 */
  @IsOptional() @IsInt() @Min(ADMIN_UI_CORNER_RADIUS_MIN) @Max(ADMIN_UI_CORNER_RADIUS_MAX)
  adminContainerRadius?: number | null;

  /** 按钮/分段/页签/选中菜单圆角：4–16px 整数，null 回退。 */
  @IsOptional() @IsInt() @Min(ADMIN_UI_CORNER_RADIUS_MIN) @Max(ADMIN_UI_CORNER_RADIUS_CONTROL_MAX)
  adminButtonRadius?: number | null;

  /** 输入/选择/日期等录入圆角：4–16px 整数，null 回退。 */
  @IsOptional() @IsInt() @Min(ADMIN_UI_CORNER_RADIUS_MIN) @Max(ADMIN_UI_CORNER_RADIUS_CONTROL_MAX)
  adminInputRadius?: number | null;

  @IsBoolean()
  smsLoginEnabled!: boolean;

  @IsBoolean()
  passwordLoginEnabled!: boolean;

  @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  publishedWorkspaceIds!: string[];

  @IsOptional() @IsString() @MaxLength(191)
  defaultWorkspaceId?: string;
}

export class WebsiteCategoryImageDto implements WebsiteCategoryImage {
  @IsString() @MaxLength(191)
  code!: string;

  @IsString() @MaxLength(512)
  imageUrl!: string;
}

export class WebsiteAdvantageDto implements WebsiteAdvantage {
  @IsOptional() @IsString() @MaxLength(32)
  icon?: string;

  @IsString() @MaxLength(40)
  title!: string;

  @IsOptional() @IsString() @MaxLength(120)
  description?: string;
}

export class WebsiteStepDto implements WebsiteStep {
  @IsString() @MaxLength(40)
  title!: string;

  @IsOptional() @IsString() @MaxLength(120)
  description?: string;
}

export class WebsiteTestimonialDto implements WebsiteTestimonial {
  @IsString() @MaxLength(40)
  name!: string;

  @IsOptional() @IsString() @MaxLength(60)
  context?: string;

  @IsString() @MaxLength(300)
  text!: string;
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

  /** 官网首页内容块（可编辑）；服务层再裁剪长度与条数。 */
  @IsOptional() @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => WebsiteAdvantageDto)
  advantages?: WebsiteAdvantageDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => WebsiteStepDto)
  steps?: WebsiteStepDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => WebsiteTestimonialDto)
  testimonials?: WebsiteTestimonialDto[];
}

/**
 * 微信小程序渠道凭证（CLIENT-CHANNEL-01 后只剩凭证）。
 * 品牌/客服/协议/帮助/发布服务由租户级 ClientChannelProfile 承接（见本文件 SaveClientChannelProfileDto）。
 */
export class SaveMiniProgramChannelDto implements SaveMiniProgramChannelRequest {
  @IsString() @IsNotEmpty() @MaxLength(191)
  appId!: string;

  @IsOptional() @IsString() @MaxLength(191)
  appSecret?: string;

  @IsBoolean()
  enabled!: boolean;
}
