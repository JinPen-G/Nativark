import type { AdminLoginBranding, ClientChannelAgreementConfig, ClientChannelFaqItem, SaveClientChannelProfileRequest } from "@rental-os/shared";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";

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

  /** 管理后台基础控件圆角（旧字段/回退基准）：连续区间 8-20px，或极致圆角离散档 999px（服务层精确校验，拒绝 20 与 999 之间的值）。 */
  @IsOptional() @IsInt() @Min(8) @Max(999)
  adminCornerRadius?: number;

  /** 容器（卡片/弹窗/抽屉/表格）圆角；同 8-20px 连续档或 999px 极致档，留空回退旧统一值。 */
  @IsOptional() @IsInt() @Min(8) @Max(999)
  adminContainerRadius?: number;

  /** 按钮/分段/页签/选中菜单圆角；同 8-20px 连续档或 999px 极致档，留空回退旧统一值。 */
  @IsOptional() @IsInt() @Min(8) @Max(999)
  adminButtonRadius?: number;

  /** 输入/选择/日期等录入控件圆角；同 8-20px 连续档或 999px 极致档，留空回退旧统一值。 */
  @IsOptional() @IsInt() @Min(8) @Max(999)
  adminInputRadius?: number;

  @IsBoolean()
  smsLoginEnabled!: boolean;

  @IsBoolean()
  passwordLoginEnabled!: boolean;

  @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  publishedWorkspaceIds!: string[];

  @IsOptional() @IsString() @MaxLength(191)
  defaultWorkspaceId?: string;
}
