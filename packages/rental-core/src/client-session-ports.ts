/** Rental客户认证的私有参加者。宿主供给原数据库、短信、限流和客户行锁；
 * 当前用途证明、会员状态和事务由原实现裁定，这些MySQL类型不进入公共Core合同。 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { TenantIntegrationRuntimeService } from "@rental-os/platform-server/integration-sms";
import type { ClientApiRateLimitService } from "./mysql-client-rate-limit";

export type RentalClientAuthStorage = Pick<PrismaClient,
  "$transaction" | "$queryRaw" | "businessWorkspace" | "clientAuthSession" | "clientChannelProfile" | "clientWechatIdentity" |
  "clientRegistrationChallenge" | "customerAccount" | "customerMembership" |
  "customerMembershipReview" | "customerProfile" | "customerQualificationRef" | "tenant">;

export type RentalClientSmsIntegration = Pick<TenantIntegrationRuntimeService,
  "hasEnabledProvider" | "sendVerificationSms">;
export type RentalClientChallengeRateLimit = Pick<ClientApiRateLimitService, "assertChallengeAllowed">;
export type RentalClientRateLimitStorage = Pick<PrismaClient, "$transaction" | "clientApiRateBucket">;
export type RentalWebsiteAssetStorage = Pick<PrismaClient, "tenant" | "websiteAsset">;

export interface RentalCustomerBusinessGate {
  lockCustomerBusinessGate(tenantId: string, customerId: string, transaction: Prisma.TransactionClient): Promise<boolean>;
}
