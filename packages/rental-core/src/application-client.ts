/** Rental 客户与渠道应用组合，复用同一客户主档、Core、付款、文件和失败出箱。
 * 原应用继续核验本人会话、业务资格和操作收据；构造不启限流计时器或外部连接，HTTP Guard 由宿主供给。 */
import type { Prisma } from "@prisma/client";
import type { RentalCustomerApplications } from "./application-customers";
import { ClientApiService } from "./mysql-client-application";
import { ClientAuthService } from "./mysql-client-auth";
import { ClientApiRateLimitService } from "./mysql-client-rate-limit";
import { ClientWechatAuthService } from "./mysql-client-wechat-auth";
import { ClientDeliveryAddressService } from "./mysql-client-delivery-address";
import { ClientAccountClosureService } from "./mysql-client-account-closure";
import { WebsiteAssetService } from "./mysql-client-website-assets";
import { ClientChannelProfileService } from "./mysql-client-channel-profile";
import { WebsiteChannelProfileService } from "./mysql-website-channel-profile";
import { MiniProgramChannelService } from "./mysql-mini-program-channel";

type ClientApiDependencies = ConstructorParameters<typeof ClientApiService>;
type ClientClosureDependencies = ConstructorParameters<typeof ClientAccountClosureService<Prisma.TransactionClient>>;

/** 仅此 MySQL 应用适配使用生成模型；公共 Core 契约不依赖这些存储类型。 */
export type RentalClientApplicationDatabase = ClientApiDependencies[0]
  & ConstructorParameters<typeof ClientAuthService>[0]
  & ConstructorParameters<typeof ClientApiRateLimitService>[0]
  & ConstructorParameters<typeof ClientWechatAuthService>[0]
  & ConstructorParameters<typeof ClientDeliveryAddressService>[0]
  & ClientClosureDependencies[0]
  & ConstructorParameters<typeof WebsiteAssetService>[0]
  & ConstructorParameters<typeof ClientChannelProfileService>[0]
  & ConstructorParameters<typeof WebsiteChannelProfileService>[0]
  & ConstructorParameters<typeof MiniProgramChannelService>[0];

export interface RentalClientApplicationDependencies {
  database: RentalClientApplicationDatabase;
  customerApplications: Pick<RentalCustomerApplications, "customers" | "registration" | "customerStates"
    | "customerOperations" | "customerMerge" | "memberships" | "corporateSettlement" | "enterpriseAccess">;
  core: ClientApiDependencies[3] & ConstructorParameters<typeof ClientDeliveryAddressService>[1];
  business: ClientApiDependencies[4];
  orderConfirmation: ClientApiDependencies[5];
  idempotent: ClientApiDependencies[6];
  funding: ClientApiDependencies[7];
  serviceCapacities: ClientApiDependencies[8];
  smsIntegrations: ConstructorParameters<typeof ClientAuthService>[1];
  integrationCatalog: ClientApiDependencies[9];
  payments: ClientApiDependencies[10];
  files: ClientApiDependencies[11];
  documents: ClientApiDependencies[12];
  failures: ClientApiDependencies[13];
  categories: NonNullable<ClientApiDependencies[17]>;
  coreFacts: NonNullable<ClientApiDependencies[18]>;
  secrets: ConstructorParameters<typeof ClientWechatAuthService>[1]
    & ConstructorParameters<typeof MiniProgramChannelService>[1];
  wechatTransport: ConstructorParameters<typeof ClientWechatAuthService>[2]
    & ConstructorParameters<typeof MiniProgramChannelService>[2];
  operationLog: NonNullable<ConstructorParameters<typeof ClientWechatAuthService>[7]>
    & NonNullable<ClientClosureDependencies[4]>
    & NonNullable<ConstructorParameters<typeof ClientChannelProfileService>[1]>
    & NonNullable<ConstructorParameters<typeof WebsiteChannelProfileService>[1]>
    & NonNullable<ConstructorParameters<typeof MiniProgramChannelService>[3]>;
}

const dependencyNames = ["database", "customerApplications", "core", "business", "orderConfirmation", "idempotent",
  "funding", "serviceCapacities", "smsIntegrations", "integrationCatalog", "payments", "files", "documents",
  "categories", "coreFacts", "secrets", "wechatTransport", "operationLog"] as const;
const customerDependencyNames = ["customers", "registration", "customerStates", "customerOperations", "customerMerge",
  "memberships", "corporateSettlement", "enterpriseAccess"] as const;

/** 返回的 auth/rateLimit/api 同时供 HTTP、企业应用和 AI 消费，宿主只为该 rateLimit 实例登记一次生命周期。 */
export function createRentalClientApplications(input: RentalClientApplicationDependencies) {
  for (const name of dependencyNames) {
    if (input[name] == null) throw new Error(`Rental 客户装配缺少依赖: ${name}`);
  }
  for (const name of customerDependencyNames) {
    if (input.customerApplications[name] == null) throw new Error(`Rental 客户装配缺少客户应用: ${name}`);
  }
  if (input.failures !== null && typeof input.failures?.inspection !== "function") throw new Error("Rental 客户装配须提供原出箱或显式 null");
  const { database, customerApplications: customers } = input;
  const rateLimit = new ClientApiRateLimitService(database);
  const auth = new ClientAuthService(database, input.smsIntegrations, customers.customers, customers.registration, rateLimit);
  const wechat = new ClientWechatAuthService(database, input.secrets, input.wechatTransport,
    customers.registration, customers.customers, customers.customerStates, auth, input.operationLog);
  const addresses = new ClientDeliveryAddressService(database, input.core);
  const closure = new ClientAccountClosureService<Prisma.TransactionClient>(database, auth,
    customers.customerOperations, customers.customerMerge, input.operationLog);
  const websiteAssets = new WebsiteAssetService(database);
  const channelProfile = new ClientChannelProfileService(database, input.operationLog);
  const websiteChannelProfile = new WebsiteChannelProfileService(database, input.operationLog);
  const miniProgramChannel = new MiniProgramChannelService(database, input.secrets, input.wechatTransport, input.operationLog);
  const api = new ClientApiService(database, auth, customers.memberships, input.core, input.business,
    input.orderConfirmation, input.idempotent, input.funding, input.serviceCapacities, input.integrationCatalog,
    input.payments, input.files, input.documents, input.failures, customers.corporateSettlement,
    addresses, wechat, input.categories, input.coreFacts);
  return Object.freeze({ api, auth, rateLimit, wechat, addresses, closure, websiteAssets,
    channelProfile, websiteChannelProfile, miniProgramChannel, enterprise: customers.enterpriseAccess });
}

export type RentalClientApplications = ReturnType<typeof createRentalClientApplications>;
