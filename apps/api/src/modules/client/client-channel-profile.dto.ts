import type { ClientChannelAgreementConfig, ClientChannelFaqItem, SaveClientChannelProfileRequest } from "@rental-os/shared";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from "class-validator";

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
export class SaveClientChannelProfileDto implements SaveClientChannelProfileRequest {
  @IsOptional() @IsInt() @Min(0)
  expectedRevision?: number;

  @IsOptional() @IsString() @MaxLength(191)
  brandName?: string;

  @IsOptional() @IsString() @MaxLength(512)
  brandLogoUrl?: string;

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

  @IsBoolean()
  smsLoginEnabled!: boolean;

  @IsBoolean()
  passwordLoginEnabled!: boolean;

  @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  publishedWorkspaceIds!: string[];

  @IsOptional() @IsString() @MaxLength(191)
  defaultWorkspaceId?: string;
}
