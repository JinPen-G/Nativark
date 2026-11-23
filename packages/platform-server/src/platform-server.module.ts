/** 独立公共API模块。宿主提供唯一持久化实例，Core及其迁移/业务HTTP另行显式装配。 */
import { Module, type CanActivate, type DynamicModule, type ModuleMetadata, type FactoryProvider } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { PlatformAuthGuard, REGISTERED_CORE_HTTP_ACCESS, type RegisteredCoreHttpAccess } from "./platform-auth.guard";
import { PlatformAuthService } from "./modules/auth/platform-auth.service";
import { AuthSessionController, AUTH_HTTP_APPLICATION, type AuthHttpApplication } from "./modules/auth/auth-session.controller";
import { PlatformAuthenticationRepository } from "./modules/platform/platform-authentication.source";
import { PLATFORM_AUTH_DATA_STORE, type PlatformAuthDataStore } from "./modules/platform/platform-auth-data-store";
import { PLATFORM_APPEARANCE_DATA_STORE, type PlatformAppearanceDataStore } from "./modules/platform/platform-appearance-data-store";
import { TenantAppearanceProfileService } from "./modules/client/tenant-appearance-profile.service";
import { AccountAppearanceService } from "./modules/client/account-appearance.service";
import { TenantAppearanceProfileController } from "./modules/client/tenant-appearance-profile.controller";
import { AccountAppearanceController } from "./modules/client/account-appearance.controller";
import { RequestIdInterceptor } from "./common/request-id.interceptor";
import { PlatformHealthController } from "./platform-http.controller";
import { PlatformOpenApiController, PLATFORM_OPENAPI_DOCUMENT, createPlatformOpenApi } from "./platform-openapi";
import type { PlatformManagementDatabase } from "./modules/platform/platform-management.store";
import { PlatformManagementService } from "./modules/platform/platform-management.service";
import { PlatformManagementController } from "./modules/platform/platform-management.controller";
import { PlatformToolsService } from "./modules/platform-tools/platform-tools.service";
import { PlatformToolsController } from "./modules/platform-tools/platform-tools.controller";
import type { PlatformToolsDatabase } from "./modules/platform-tools/platform-tools.store";
import { PlatformFilterPresetController } from "./modules/platform-tools/filter-presets.controller";
import { PlatformFilterPresetService } from "./modules/platform-tools/filter-presets.service";
import type { PlatformFilterPresetDatabase } from "./modules/platform-tools/filter-presets.store";
import { DemoRequestService } from "./modules/demo-requests/demo-request.service";
import { PublicDemoRequestController } from "./modules/demo-requests/public-demo-request.controller";
import { PlatformDemoRequestController } from "./modules/demo-requests/platform-demo-request.controller";
import { DEMO_REQUEST_RATE_LIMIT, type DemoRequestDatabase, type DemoRequestRateLimit } from "./modules/demo-requests/demo-request.store";
import { DemoRequestRateLimitService } from "./modules/public-rate-limit/demo-request-rate-limit";
import type { SqlRateLimitStore } from "./modules/public-rate-limit/rate-limit.store";
import { SubscriptionService } from "./modules/subscription/subscription.service";
import { TenantSubscriptionController } from "./modules/subscription/subscription.controller";
import { PlatformSubscriptionController } from "./modules/subscription/subscription-platform.controller";
import { PLATFORM_SUBSCRIPTION_DATA_STORE, SUBSCRIPTION_APPLICATION, SUBSCRIPTION_CATEGORY_PARTICIPANT,
  type SubscriptionDataStore, type SubscriptionCategoryParticipant } from "./modules/subscription/subscription-store";
import { PlatformOperationLogService, type PlatformOperationLogStorage } from "./common/operation-log.service";
import { SecretBox } from "./common/secret-box";
import { TenantIntegrationService } from "./modules/integrations/tenant-integration.service";
import { TenantIntegrationRuntimeService } from "./modules/integrations/tenant-integration.runtime.service";
import { TenantEmailRuntimeService } from "./modules/integrations/tenant-email.runtime.service";
import { TenantIntegrationConnectivityService } from "./modules/integrations/tenant-integration.connectivity.service";
import { TenantIntegrationController } from "./modules/integrations/tenant-integration.controller";
import { ObjectStorageProviderService } from "./modules/integrations/object-storage.provider.service";
import { INTEGRATION_PAYMENT_PROBE, INTEGRATION_EMAIL_PROBE, type PaymentIntegrationProbe } from "./modules/integrations/integration-probe";
import { INTEGRATION_DATA_STORE, INTEGRATION_BUSINESS_PARTICIPANT, INTEGRATION_RUNTIME_PROVIDERS,
  PUBLIC_INTEGRATION_RUNTIME_PROVIDERS, TENANT_INTEGRATION_APPLICATION, TENANT_INTEGRATION_CONNECTIVITY,
  type TenantIntegrationDataStore, type TenantIntegrationBusinessParticipant, type IntegrationRuntimeProviders } from "./modules/integrations/integration-store";
import { OfficialCalendarSourceService } from "./modules/official-calendars/official-calendar-source.service";
import { OfficialCalendarSourceController } from "./modules/official-calendars/official-calendar-source.controller";
import { OFFICIAL_CALENDAR_DATA_STORE, OFFICIAL_CALENDAR_APPLICATION, type OfficialCalendarDataStore } from "./modules/official-calendars/official-calendar-store";
import { OFFICIAL_CALENDAR_SOURCE_READER, createOfficialCalendarSourceReader } from "./modules/official-calendars/official-calendar-source-reader";
import { TenantOperatorInvitationsController } from "./modules/messaging/tenant-operator-invitations.controller";
import { AcceptTenantOperatorInvitationController } from "./modules/messaging/accept-operator-invitation.controller";
import { TenantDispatchController } from "./modules/messaging/tenant-dispatch.controller";
import { TenantSupportEmailController } from "./modules/messaging/tenant-support-email.controller";
import { TENANT_OPERATOR_INVITATIONS_HTTP_APPLICATION, TENANT_DISPATCH_HTTP_APPLICATION, TENANT_SUPPORT_EMAIL_HTTP_APPLICATION,
  type TenantMessagingHttpApplications } from "./modules/messaging/tenant-messaging-http.application";
import { createPublicMessagingApplications, type PublicMessagingDatabase } from "./platform-messaging";

const PUBLIC_MESSAGING_APPLICATIONS = Symbol("platform.messaging.public-applications");
const HOST_APPLICATIONS = Symbol("platform.host-applications");

/** 所选宿主已构造的唯一实例。默认零 Core 不提供此组，仍使用下方公共实现。
 * 这是受控装配接点，不能从清单、请求或任意 provider 列表注册运行代码。 */
export interface PlatformApplicationBindings {
  auth: AuthHttpApplication;
  authentication: PlatformAuthenticationRepository;
  guard: CanActivate;
  tenantAppearance: TenantAppearanceProfileService;
  accountAppearance: AccountAppearanceService;
  secrets: SecretBox;
  operationLog: PlatformOperationLogService;
  subscriptions: SubscriptionService;
  integrationStore: TenantIntegrationDataStore;
  integrationBusiness: TenantIntegrationBusinessParticipant;
  integrationRuntimeProviders: IntegrationRuntimeProviders;
  integrations: TenantIntegrationService;
  notifications: TenantIntegrationRuntimeService;
  email: TenantEmailRuntimeService;
  connectivity: TenantIntegrationConnectivityService;
  files: ObjectStorageProviderService;
  payments: PaymentIntegrationProbe;
  officialCalendarSources: OfficialCalendarSourceService;
  /** 旧宿主可保留原计数桶和唯一扣额参加者；未提供时使用本版公共持久桶。 */
  demoRequestRateLimit?: DemoRequestRateLimit;
}

function hostApplication<Key extends keyof PlatformApplicationBindings>(provide: FactoryProvider["provide"], key: Key): FactoryProvider {
  return { provide, inject: [HOST_APPLICATIONS], useFactory: (applications: PlatformApplicationBindings) => {
    if (applications?.[key] == null) throw new Error(`宿主缺少同一公共应用实例: ${key}`);
    return applications[key];
  } };
}

export type PlatformDatabase = PlatformAuthDataStore & PlatformAppearanceDataStore & PlatformManagementDatabase & PlatformToolsDatabase & SubscriptionDataStore
  & TenantIntegrationDataStore & OfficialCalendarDataStore & PlatformOperationLogStorage & PublicMessagingDatabase
  & PlatformFilterPresetDatabase & DemoRequestDatabase & SqlRateLimitStore;
@Module({})
export class PlatformServerModule {
  static register<Dependencies extends unknown[]>(options: { imports?: ModuleMetadata["imports"]; inject?: FactoryProvider["inject"];
    useFactory: (...args: Dependencies) => PlatformDatabase | Promise<PlatformDatabase>;
    coreHttp?: RegisteredCoreHttpAccess;
    /** 可选标准Core模块导出的准入provider；不在公共包反向导入具体Core宿主。 */
    coreHttpProvider?: FactoryProvider<RegisteredCoreHttpAccess>;
    /** 宿主的真实行业目录参加者，空Core组合只接受公共无品类范围。 */
    subscriptionCategories?: SubscriptionCategoryParticipant;
    /** 结算币种与原支付/通知/文件依赖，按实际受控宿主供给。 */
    integrationBusiness?: TenantIntegrationBusinessParticipant;
    integrationBusinessProvider?: FactoryProvider<TenantIntegrationBusinessParticipant>;
    integrationPaymentProbe?: PaymentIntegrationProbe;
    integrationRuntimeProviders?: IntegrationRuntimeProviders;
    /** 完整宿主可提供同实例组合；与单项集成选项互斥，避免重复执行者。 */
    applicationsProvider?: FactoryProvider<PlatformApplicationBindings>;
    openApiDocument?: unknown }): DynamicModule {
    if (options.coreHttp && options.coreHttpProvider) throw new Error("Core HTTP只能登记一个实际准入提供者");
    if (options.integrationBusiness && options.integrationBusinessProvider) throw new Error("集成业务依赖只能登记一个实际参加者");
    if (options.applicationsProvider && (options.integrationBusiness || options.integrationBusinessProvider
      || options.integrationPaymentProbe || options.integrationRuntimeProviders || options.subscriptionCategories))
      throw new Error("完整宿主应用与单项集成/订阅参加者不能重复登记");
    const applications = options.applicationsProvider ? [
      { ...options.applicationsProvider, provide: HOST_APPLICATIONS },
      hostApplication(PlatformAuthService, "auth"), hostApplication(PlatformAuthenticationRepository, "authentication"),
      hostApplication(PlatformAuthGuard, "guard"), hostApplication(TenantAppearanceProfileService, "tenantAppearance"),
      hostApplication(AccountAppearanceService, "accountAppearance"), hostApplication(SecretBox, "secrets"),
      hostApplication(PlatformOperationLogService, "operationLog"), hostApplication(SubscriptionService, "subscriptions"),
      hostApplication(INTEGRATION_DATA_STORE, "integrationStore"), hostApplication(INTEGRATION_BUSINESS_PARTICIPANT, "integrationBusiness"),
      hostApplication(INTEGRATION_RUNTIME_PROVIDERS, "integrationRuntimeProviders"), hostApplication(TenantIntegrationService, "integrations"),
      hostApplication(TenantIntegrationRuntimeService, "notifications"), hostApplication(TenantEmailRuntimeService, "email"),
      hostApplication(TenantIntegrationConnectivityService, "connectivity"), hostApplication(ObjectStorageProviderService, "files"),
      hostApplication(INTEGRATION_PAYMENT_PROBE, "payments"), hostApplication(OfficialCalendarSourceService, "officialCalendarSources"),
      { provide: DEMO_REQUEST_RATE_LIMIT, inject: [HOST_APPLICATIONS, PLATFORM_AUTH_DATA_STORE],
        useFactory: (host: PlatformApplicationBindings, database: PlatformDatabase) =>
          host.demoRequestRateLimit ?? new DemoRequestRateLimitService(database) }
    ] : [
      { provide: INTEGRATION_DATA_STORE, useExisting: PLATFORM_AUTH_DATA_STORE },
      { provide: PlatformOperationLogService, inject: [PLATFORM_AUTH_DATA_STORE], useFactory: (database: PlatformDatabase) => new PlatformOperationLogService(database) },
      { provide: PlatformAuthenticationRepository, inject: [PLATFORM_AUTH_DATA_STORE], useFactory: (database: PlatformDatabase) => new PlatformAuthenticationRepository(database) },
      TenantAppearanceProfileService, AccountAppearanceService, PlatformAuthService, PlatformAuthGuard, SubscriptionService,
      SecretBox, TenantIntegrationService, TenantIntegrationRuntimeService, TenantEmailRuntimeService, TenantIntegrationConnectivityService,
      ObjectStorageProviderService, OfficialCalendarSourceService,
      { provide: DEMO_REQUEST_RATE_LIMIT, inject: [PLATFORM_AUTH_DATA_STORE],
        useFactory: (database: PlatformDatabase) => new DemoRequestRateLimitService(database) },
      { provide: INTEGRATION_RUNTIME_PROVIDERS, useValue: options.integrationRuntimeProviders ?? PUBLIC_INTEGRATION_RUNTIME_PROVIDERS },
      ...(options.integrationBusiness ? [{ provide: INTEGRATION_BUSINESS_PARTICIPANT, useValue: options.integrationBusiness }] : []),
      ...(options.integrationBusinessProvider ? [{ ...options.integrationBusinessProvider, provide: INTEGRATION_BUSINESS_PARTICIPANT }] : []),
      ...(options.integrationPaymentProbe ? [{ provide: INTEGRATION_PAYMENT_PROBE, useValue: options.integrationPaymentProbe }] : []),
      ...(options.subscriptionCategories ? [{ provide: SUBSCRIPTION_CATEGORY_PARTICIPANT, useValue: options.subscriptionCategories }] : [])
    ];
    return { module: PlatformServerModule, imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ...(options.imports ?? [])],
      controllers: [AuthSessionController, TenantAppearanceProfileController, AccountAppearanceController, PlatformHealthController, PlatformOpenApiController, PlatformManagementController,
        TenantSubscriptionController, PlatformSubscriptionController, TenantIntegrationController, OfficialCalendarSourceController, PlatformToolsController,
        PlatformFilterPresetController, PublicDemoRequestController, PlatformDemoRequestController,
        TenantOperatorInvitationsController, AcceptTenantOperatorInvitationController, TenantDispatchController, TenantSupportEmailController],
      providers: [
        { provide: PLATFORM_AUTH_DATA_STORE, inject: options.inject ?? [], useFactory: options.useFactory },
        { provide: PLATFORM_APPEARANCE_DATA_STORE, useExisting: PLATFORM_AUTH_DATA_STORE },
        { provide: PLATFORM_SUBSCRIPTION_DATA_STORE, useExisting: PLATFORM_AUTH_DATA_STORE },
        { provide: OFFICIAL_CALENDAR_DATA_STORE, useExisting: PLATFORM_AUTH_DATA_STORE },
        ...applications,
        { provide: PUBLIC_MESSAGING_APPLICATIONS,
          inject: [PLATFORM_AUTH_DATA_STORE, ConfigService, TenantIntegrationService, TenantEmailRuntimeService, PlatformOperationLogService],
          useFactory: createPublicMessagingApplications },
        { provide: TENANT_OPERATOR_INVITATIONS_HTTP_APPLICATION, inject: [PUBLIC_MESSAGING_APPLICATIONS],
          useFactory: (applications: TenantMessagingHttpApplications) => applications.invitations },
        { provide: TENANT_DISPATCH_HTTP_APPLICATION, inject: [PUBLIC_MESSAGING_APPLICATIONS],
          useFactory: (applications: TenantMessagingHttpApplications) => applications.dispatch },
        { provide: TENANT_SUPPORT_EMAIL_HTTP_APPLICATION, inject: [PUBLIC_MESSAGING_APPLICATIONS],
          useFactory: (applications: TenantMessagingHttpApplications) => applications.support },
        PlatformManagementService, PlatformToolsService, PlatformFilterPresetService, DemoRequestService,
        { provide: SUBSCRIPTION_APPLICATION, useExisting: SubscriptionService },
        { provide: INTEGRATION_EMAIL_PROBE, useExisting: TenantEmailRuntimeService },
        { provide: TENANT_INTEGRATION_APPLICATION, useExisting: TenantIntegrationService },
        { provide: TENANT_INTEGRATION_CONNECTIVITY, useExisting: TenantIntegrationConnectivityService },
        { provide: OFFICIAL_CALENDAR_APPLICATION, useExisting: OfficialCalendarSourceService },
        { provide: OFFICIAL_CALENDAR_SOURCE_READER, inject: [OfficialCalendarSourceService], useFactory: createOfficialCalendarSourceReader },
        { provide: AUTH_HTTP_APPLICATION, useExisting: PlatformAuthService },
        { provide: PLATFORM_OPENAPI_DOCUMENT, useValue: options.openApiDocument ?? createPlatformOpenApi() },
        ...(options.coreHttp ? [{ provide: REGISTERED_CORE_HTTP_ACCESS, useValue: options.coreHttp }] : []),
        ...(options.coreHttpProvider ? [{ ...options.coreHttpProvider, provide: REGISTERED_CORE_HTTP_ACCESS }] : []),
        { provide: APP_GUARD, useExisting: PlatformAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor }
      ], exports: [PlatformAuthService, PlatformAuthenticationRepository, PlatformManagementService, PlatformToolsService,
        PlatformFilterPresetService, DemoRequestService, SubscriptionService, SUBSCRIPTION_APPLICATION,
        TenantIntegrationService, TenantIntegrationRuntimeService, ObjectStorageProviderService, SecretBox, TENANT_INTEGRATION_APPLICATION,
        OfficialCalendarSourceService, OFFICIAL_CALENDAR_APPLICATION, OFFICIAL_CALENDAR_SOURCE_READER,
        TENANT_OPERATOR_INVITATIONS_HTTP_APPLICATION, TENANT_DISPATCH_HTTP_APPLICATION, TENANT_SUPPORT_EMAIL_HTTP_APPLICATION,
        PLATFORM_AUTH_DATA_STORE, PLATFORM_APPEARANCE_DATA_STORE, PLATFORM_SUBSCRIPTION_DATA_STORE, INTEGRATION_DATA_STORE,
        OFFICIAL_CALENDAR_DATA_STORE] };
  }
}
