import type { SaveMiniProgramChannelRequest } from "@rental-os/shared";
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * 微信小程序渠道凭证（CLIENT-CHANNEL-01 后只剩凭证）。
 * 品牌/客服/协议/帮助/发布服务由租户级 ClientChannelProfile 承接（见 client-channel-profile.dto.ts）。
 */
export class SaveMiniProgramChannelDto implements SaveMiniProgramChannelRequest {
  @IsString() @IsNotEmpty() @MaxLength(191)
  appId!: string;

  @IsOptional() @IsString() @MaxLength(191)
  appSecret?: string;

  @IsBoolean()
  enabled!: boolean;
}
