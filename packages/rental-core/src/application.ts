/** Rental 完整业务实例图。构造与启动分开，HTTP、作业和可选 AI 共用原服务和事务。
 * 宿主显式选择 AI 参加者；不启用时不加载其数据，启用时缺真实出箱或原草稿读取器就拒绝。 */
import type { Prisma } from "@prisma/client";
import type { ConfigService } from "@nestjs/config";
import { SecretBox } from "@rental-os/platform-server/secret-box";
import { PlatformOperationLogService } from "@rental-os/platform-server/operation-log";
import { TenantAppearanceProfileService } from "@rental-os/platform-server/tenant-appearance";
import { AccountAppearanceService } from "@rental-os/platform-server/account-appearance";
import { SubscriptionService } from "@rental-os/platform-server/subscription";
import type { SubscriptionTransaction } from "@rental-os/platform-server/subscription-store";
import { OfficialCalendarSourceService } from "@rental-os/platform-server/official-calendar-source";
import { createRentalDomainFoundation, type RentalDomainDatabase, type RentalDomainFoundation } from "./application-domain";
import { createRentalPrimaryApplications } from "./mysql-primary-application";
import { RentalMysqlAuthenticationRepository, type RentalMysqlAuthenticationDatabase } from "./mysql-auth-source";
import { RentalAuthService } from "./auth-service";
import { createRentalCustomerApplications, type RentalCustomerApplicationDatabase } from "./application-customers";
import { createRentalIntegrationFoundation, createRentalIntegrationApplications, createRentalExchangeInspectionMedia,
  type RentalIntegrationFoundationDependencies } from "./application-integrations";
import { createRentalApplicationParticipants, type RentalApplicationParticipantDependencies } from "./application-participants";
import { RentalOrderConfirmationService } from "./mysql-order-confirmation";
import { RentalExchangePreviewService } from "./mysql-exchange-preview";
import { createRentalClientApplications, type RentalClientApplicationDatabase } from "./application-client";
import { createRentalEnterpriseApplications, type RentalEnterpriseApplicationDatabase } from "./application-enterprise";
import { createRentalAiApplicationSources } from "./application-ai-sources";
import type { RentalRepositoryEvents } from "./application-repositories";
import type { RentalNotificationDraftRetention } from "./notification-draft";
import { createRentalCategoryApplications, type RentalCategoryApplicationDependencies } from "./application-category";
import { assertPublishedRentalCategoryIdentities, rentalCategoryIdentityOptions,
  type RentalCategoryIdentityReader } from "./category-identity";

type Transaction = Prisma.TransactionClient;
type IntegrationInput = RentalIntegrationFoundationDependencies;
type ParticipantInput = RentalApplicationParticipantDependencies<Transaction>;
export type RentalApplicationDatabase = RentalDomainDatabase<Transaction> & RentalMysqlAuthenticationDatabase
  & RentalCustomerApplicationDatabase & IntegrationInput["database"] & ParticipantInput["database"]
  & RentalClientApplicationDatabase & RentalEnterpriseApplicationDatabase
  & ConstructorParameters<typeof TenantAppearanceProfileService>[0]
  & ConstructorParameters<typeof AccountAppearanceService>[0]
  & ConstructorParameters<typeof RentalOrderConfirmationService<Transaction>>[0]
  & ConstructorParameters<typeof SubscriptionService>[0]
  & ConstructorParameters<typeof OfficialCalendarSourceService>[0]
  & RentalCategoryApplicationDependencies["database"];

/** 公共订阅的事务视图不声明行业字段；仅在本组合边界核验同一真实事务的两项品类读取能力。 */
function hasCategoryReader(transaction: SubscriptionTransaction): transaction is SubscriptionTransaction & RentalCategoryIdentityReader {
  return "rentalCategoryDefinition" in transaction && transaction.rentalCategoryDefinition != null
    && typeof transaction.rentalCategoryDefinition === "object"
    && "findMany" in transaction.rentalCategoryDefinition && typeof transaction.rentalCategoryDefinition.findMany === "function"
    && "count" in transaction.rentalCategoryDefinition && typeof transaction.rentalCategoryDefinition.count === "function";
}
/** AI 出箱仍归原参加者和其数据所有者。禁用模式不提供 AI 参加者，启用模式必须有完整原方法。 */
export interface RentalApplicationParticipants {
  readInspectionMedia: IntegrationInput["readInspectionMedia"];
  failures?: NonNullable<IntegrationInput["failureEvents"]>
    & NonNullable<Parameters<typeof createRentalClientApplications>[0]["failures"]>;
  events?: RentalRepositoryEvents<Transaction>;
  allocationFailures?: ParticipantInput["failureEvents"];
  knowledge?: IntegrationInput["knowledge"];
  notificationDraftRetention?: RentalNotificationDraftRetention;
}

/** 固定各工厂的具名实例类型，避免声明生成跨模块展开私有作业及文件清理状态。
 * 返回的仍是同一服务图；不重新构造、包装或放宽任何生命周期成员。 */
export interface RentalApplication {
  readonly database: RentalApplicationDatabase;
  readonly configuration: ConfigService;
  readonly foundation: RentalDomainFoundation<Transaction>;
  readonly authSource: RentalMysqlAuthenticationRepository;
  readonly auth: RentalAuthService;
  readonly tenantAppearance: TenantAppearanceProfileService;
  readonly accountAppearance: AccountAppearanceService;
  readonly secrets: SecretBox;
  readonly operationLog: PlatformOperationLogService;
  readonly customers: ReturnType<typeof createRentalCustomerApplications>;
  readonly primary: ReturnType<typeof createRentalPrimaryApplications<Transaction>>;
  readonly integrations: ReturnType<typeof createRentalIntegrationApplications>;
  readonly workers: ReturnType<typeof createRentalApplicationParticipants<Transaction>>;
  readonly orderConfirmation: RentalOrderConfirmationService<Transaction>;
  readonly client: ReturnType<typeof createRentalClientApplications>;
  readonly exchangePreview: RentalExchangePreviewService<Transaction>;
  readonly enterprise: ReturnType<typeof createRentalEnterpriseApplications>;
  readonly exchangeInspectionMedia: ReturnType<typeof createRentalExchangeInspectionMedia>;
  readonly aiSources: ReturnType<typeof createRentalAiApplicationSources<Transaction>>;
  readonly subscriptions: SubscriptionService;
  readonly officialCalendarSources: OfficialCalendarSourceService;
  readonly category: ReturnType<typeof createRentalCategoryApplications>;
  readonly aiMode: "enabled" | "disabled";
  readonly failureEvents: RentalApplicationParticipants["failures"];
}

export function createRentalApplication(input: {
  database: RentalApplicationDatabase;
  configuration: ConfigService;
  aiMode: "enabled" | "disabled";
  workerAuthority: ParticipantInput["authority"] | ((foundation: RentalDomainFoundation<Transaction>) => ParticipantInput["authority"]);
  fileCleanupAuthority: IntegrationInput["fileCleanupAuthority"];
  participants: RentalApplicationParticipants;
}): RentalApplication {
  if (!input.participants || typeof input.participants.readInspectionMedia !== "function"
    || typeof input.fileCleanupAuthority?.assert !== "function"
    || !["enabled", "disabled"].includes(input.aiMode)) {
    throw new Error("Rental 应用须提供原媒体读取器并显式选择 AI 模式");
  }
  const aiKeys = ["failures", "events", "allocationFailures", "knowledge", "notificationDraftRetention"] as const;
  if (input.aiMode === "disabled" && aiKeys.some(key => input.participants[key] !== undefined)) {
    throw new Error("未启用 AI 的 Rental 应用不能装配 AI 数据或运行参加者");
  }
  if (input.aiMode === "enabled" && (typeof input.participants.failures?.inspection !== "function"
    || typeof input.participants.failures?.refund !== "function"
    || typeof input.participants.events?.inspection !== "function"
    || typeof input.participants.events?.notification !== "function"
    || typeof input.participants.notificationDraftRetention?.createReader !== "function"
    || typeof input.participants.notificationDraftRetention?.state !== "function"
    || typeof input.participants.notificationDraftRetention?.receiptId !== "function")) {
    throw new Error("启用 AI 的 Rental 应用缺少原出箱、事务事件或通知草稿读取器");
  }
  const { database, configuration, participants } = input;
  const foundation = createRentalDomainFoundation<Transaction>({ database, configuration, events: participants.events });
  const workerAuthority = typeof input.workerAuthority === "function" ? input.workerAuthority(foundation) : input.workerAuthority;
  const authSource = new RentalMysqlAuthenticationRepository(database);
  const tenantAppearance = new TenantAppearanceProfileService(database);
  const accountAppearance = new AccountAppearanceService(database);
  const subscriptions = new SubscriptionService(database, {
    assertPublished: async (transaction, codes) => {
      if (!hasCategoryReader(transaction)) throw new Error("Rental 订阅办理缺少同一事务的原品类读取器");
      await assertPublishedRentalCategoryIdentities(transaction, codes);
    },
    labels: tenantId => rentalCategoryIdentityOptions(database, tenantId)
  });
  const officialCalendarSources = new OfficialCalendarSourceService(database);
  const auth = new RentalAuthService(authSource, configuration, foundation.capabilities,
    tenantAppearance, accountAppearance, database);
  const secrets = new SecretBox(configuration);
  const operationLog = new PlatformOperationLogService(database);
  const customers = createRentalCustomerApplications({ database, funding: foundation.funding, principals: authSource });
  const integrationFoundation = createRentalIntegrationFoundation({ database, configuration, secrets, operationLog,
    coreFacts: foundation.coreFacts, businessFacts: foundation.businessFacts,
    customerOperations: customers.customerOperations, funding: foundation.funding, fileAuthority: auth,
    fileCleanupAuthority: input.fileCleanupAuthority,
    readInspectionMedia: participants.readInspectionMedia, failureEvents: participants.failures,
    knowledge: participants.knowledge });
  const primary = createRentalPrimaryApplications<Transaction>({ ...foundation, database,
    memberships: customers.memberships, corporateSettlement: customers.corporateSettlement,
    enterprisePolicies: customers.enterprisePolicies, files: integrationFoundation.files,
    notifications: integrationFoundation.notifications, secrets,
    notificationDraftRetention: participants.notificationDraftRetention });
  const integrations = createRentalIntegrationApplications({ foundation: integrationFoundation, core: primary.core });
  const workers = createRentalApplicationParticipants<Transaction>({ database, facts: foundation.coreFacts, ...primary,
    idempotent: foundation.idempotent, serviceCapacities: foundation.serviceCapacities,
    corporateSettlement: customers.corporateSettlement, payments: integrations.payments,
    authority: workerAuthority, failureEvents: participants.allocationFailures });
  const orderConfirmation = new RentalOrderConfirmationService<Transaction>(database, primary.core, primary.business,
    foundation.coreFacts, foundation.businessFacts, foundation.receipts, foundation.capabilityHooks,
    customers.corporate, customers.customerOperations, foundation.serviceCapacities,
    customers.memberships, customers.enterprisePolicies);
  const client = createRentalClientApplications({ database, customerApplications: customers, ...primary,
    orderConfirmation, idempotent: foundation.idempotent, funding: foundation.funding,
    serviceCapacities: foundation.serviceCapacities, coreFacts: foundation.coreFacts, categories: foundation.categories,
    smsIntegrations: integrations.notifications, integrationCatalog: integrations.integrations,
    payments: integrations.payments, files: integrations.files, documents: integrations.documents,
    failures: input.aiMode === "disabled" ? null : participants.failures!, secrets,
    wechatTransport: integrations.wechatTransport, operationLog });
  const exchangePreview = new RentalExchangePreviewService<Transaction>(primary.core, primary.business,
    workers.allocation, database, foundation.serviceCapacities);
  const enterprise = createRentalEnterpriseApplications({ database, customerApplications: customers,
    clientApplications: client, ...primary, businessFacts: foundation.businessFacts, coreFacts: foundation.coreFacts,
    orderConfirmation, receipts: foundation.receipts, idempotent: foundation.idempotent,
    exchangePreview, operatorAuth: auth, files: integrations.files });
  const exchangeInspectionMedia = createRentalExchangeInspectionMedia({ foundation: integrationFoundation,
    inspections: enterprise.exchangeInspectionPreparation });
  const category = createRentalCategoryApplications({ database, receipts: foundation.receipts, auth, principals: authSource,
    capabilities: foundation.capabilities, capabilityHooks: foundation.capabilityHooks, subscriptions });
  const aiSources = createRentalAiApplicationSources<Transaction>({ core: primary.core, memberships: customers.memberships,
    confirmation: orderConfirmation, quoteFacts: foundation.businessFacts, originalResults: foundation.idempotent });
  return Object.freeze({ database, configuration, foundation, authSource, auth, tenantAppearance, accountAppearance,
    secrets, operationLog, customers, primary, integrations, workers, orderConfirmation, client,
    exchangePreview, enterprise, exchangeInspectionMedia, aiSources, subscriptions, officialCalendarSources, category,
    aiMode: input.aiMode, failureEvents: participants.failures });
}
