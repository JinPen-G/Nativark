import type { SaveMiniProgramChannelRequest } from "@rental-os/shared";
import { ArrayMaxSize, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class SaveMiniProgramChannelDto implements SaveMiniProgramChannelRequest {
  @IsString() @IsNotEmpty() @MaxLength(191)
  appId!: string;

  @IsOptional() @IsString() @MaxLength(191)
  appSecret?: string;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional() @IsString() @MaxLength(191)
  brandName?: string;

  @IsOptional() @IsString() @MaxLength(512)
  brandLogoUrl?: string;

  @IsOptional() @IsString() @MaxLength(32)
  customerServicePhone?: string;

  @IsOptional() @IsString() @MaxLength(64)
  customerServiceHours?: string;

  @IsOptional() @IsString() @MaxLength(64)
  userAgreementVersion?: string;

  @IsOptional() @IsString() @MaxLength(512)
  userAgreementUrl?: string;

  @IsOptional() @IsString() @MaxLength(64)
  privacyPolicyVersion?: string;

  @IsOptional() @IsString() @MaxLength(512)
  privacyPolicyUrl?: string;

  @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  publishedWorkspaceIds!: string[];
}
