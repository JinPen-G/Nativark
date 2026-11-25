/** Rental渠道的私有MySQL与公共服务参加者；生成模型只用于本适配，不进入Core公共合同。 */
import type { PrismaClient } from "@prisma/client";
import type { PlatformOperationLogService } from "@rental-os/platform-server/operation-log";
import type { SecretBox } from "@rental-os/platform-server/secret-box";
import type { WechatMiniProgramAdapter } from "@rental-os/platform-server/integration-wechat";

export type RentalClientChannelStorage = Pick<PrismaClient,
  "$transaction" | "clientChannelProfile" | "clientChannelWorkspace" | "businessWorkspace" | "tenantAppearanceProfile" | "websiteAsset">;
export type RentalWebsiteChannelStorage = Pick<PrismaClient, "$transaction" | "websiteChannelProfile" | "businessWorkspace">;
export type RentalMiniProgramChannelStorage = Pick<PrismaClient, "$transaction" | "miniProgramChannel">;
export type RentalChannelAudit = Pick<PlatformOperationLogService, "record">;
export type RentalChannelSecretBox = Pick<SecretBox, "encrypt" | "decrypt">;
export type RentalChannelWechat = Pick<WechatMiniProgramAdapter, "verifyCredentials">;
