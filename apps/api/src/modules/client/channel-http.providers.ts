/** 原渠道HTTP复用现有服务实例，父模块显式登记；不创建另一套配置/图片或网络执行者。 */
import type { Provider } from "@nestjs/common";
import { RENTAL_CLIENT_CHANNEL_APPLICATION, RENTAL_WEBSITE_CHANNEL_APPLICATION, RENTAL_WEBSITE_ASSET_APPLICATION, RENTAL_MINI_PROGRAM_CHANNEL_APPLICATION } from "@rental-os/rental-core/http-channel-applications";
import { ClientChannelProfileService } from "./client-channel-profile.service";
import { WebsiteChannelProfileService } from "./website-channel-profile.service";
import { MiniProgramChannelService } from "./mini-program-channel.service";
import { WebsiteAssetService } from "./website-asset.service";

export const RENTAL_CHANNEL_HTTP_PROVIDERS: Provider[] = [
  { provide: RENTAL_CLIENT_CHANNEL_APPLICATION, useExisting: ClientChannelProfileService },
  { provide: RENTAL_WEBSITE_CHANNEL_APPLICATION, useExisting: WebsiteChannelProfileService },
  { provide: RENTAL_WEBSITE_ASSET_APPLICATION, useExisting: WebsiteAssetService },
  { provide: RENTAL_MINI_PROGRAM_CHANNEL_APPLICATION, useExisting: MiniProgramChannelService }
];
