/** Rental微信客户认证的私有参加者。公共运输不读取会员或签发客户会话，Core使用原客户行锁与同一事务。 */
import type { PrismaClient } from "@prisma/client";
import type { SecretBox } from "@rental-os/platform-server/secret-box";
import type { PlatformOperationLogService } from "@rental-os/platform-server/operation-log";
import type { WechatMiniProgramAdapter } from "@rental-os/platform-server/integration-wechat";
import type { CustomerRegistrationService } from "./mysql-customer-registration";
import type { SharedCustomerRepository } from "./mysql-customer-master";
import type { ClientAuthService } from "./mysql-client-auth";
export type { RentalCustomerBusinessGate } from "./client-session-ports";

export type RentalClientWechatStorage = Pick<PrismaClient,
  "$transaction" | "miniProgramChannel" | "tenant" | "businessWorkspace" | "clientWechatIdentity">;
export type RentalClientWechatSecrets = Pick<SecretBox, "decrypt">;
export type RentalClientWechatTransport = Pick<WechatMiniProgramAdapter, "code2Session" | "phoneNumber">;
export type RentalClientWechatRegistration = Pick<CustomerRegistrationService, "registerPersonal">;
export type RentalClientWechatCustomers = Pick<SharedCustomerRepository, "findMembership" | "ensureLoginAccount">;
export type RentalClientWechatSessions = Pick<ClientAuthService, "issueSession">;
export type RentalClientWechatLog = Pick<PlatformOperationLogService, "record">;
