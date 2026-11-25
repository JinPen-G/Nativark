/** Rental渠道HTTP的受控服务端口；平台供给当前身份，存储/外部网络留应用参加者。 */
import type { SystemUserRow } from "@rental-os/platform-contracts";
import type { ClientChannelProfileSummary, SaveClientChannelProfileRequest, WebsiteChannelProfileSummary, SaveWebsiteChannelProfileRequest, MiniProgramChannelSummary, SaveMiniProgramChannelRequest, MiniProgramChannelTestResult } from "./channel-contracts";
import type { UploadedWebsiteImage } from "./mysql-client-website-assets";

export const RENTAL_CLIENT_CHANNEL_APPLICATION = Symbol.for("rental-core.http.client-channel");
export const RENTAL_WEBSITE_CHANNEL_APPLICATION = Symbol.for("rental-core.http.website-channel");
export const RENTAL_WEBSITE_ASSET_APPLICATION = Symbol.for("rental-core.http.website-assets");
export const RENTAL_MINI_PROGRAM_CHANNEL_APPLICATION = Symbol.for("rental-core.http.mini-program-channel");

export interface RentalClientChannelHttpApplication {
  get(user?: SystemUserRow): Promise<ClientChannelProfileSummary>;
  save(input: SaveClientChannelProfileRequest, user?: SystemUserRow): Promise<ClientChannelProfileSummary>;
}
export interface RentalWebsiteChannelHttpApplication {
  get(user?: SystemUserRow): Promise<WebsiteChannelProfileSummary>;
  save(input: SaveWebsiteChannelProfileRequest, user?: SystemUserRow): Promise<WebsiteChannelProfileSummary>;
}
export interface RentalWebsiteAssetHttpApplication {
  upload(user: SystemUserRow | undefined, scene: string, file: UploadedWebsiteImage): Promise<{ assetId: string; url: string; mimeType: string }>;
}
export interface RentalMiniProgramChannelHttpApplication {
  get(user?: SystemUserRow): Promise<MiniProgramChannelSummary>;
  save(input: SaveMiniProgramChannelRequest, user?: SystemUserRow): Promise<MiniProgramChannelSummary>;
  test(user?: SystemUserRow): Promise<MiniProgramChannelTestResult>;
}
