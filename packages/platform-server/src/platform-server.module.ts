/** 独立公共API模块。宿主提供唯一持久化实例，Core及其迁移/业务HTTP另行显式装配。 */
import { Module, type DynamicModule, type ModuleMetadata, type FactoryProvider } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { PlatformAuthGuard, REGISTERED_CORE_HTTP_ACCESS, type RegisteredCoreHttpAccess } from "./platform-auth.guard";
import { PlatformAuthService } from "./modules/auth/platform-auth.service";
import { AuthSessionController, AUTH_HTTP_APPLICATION } from "./modules/auth/auth-session.controller";
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

export type PlatformDatabase = PlatformAuthDataStore & PlatformAppearanceDataStore & PlatformManagementDatabase & PlatformToolsDatabase & SubscriptionDataStore
  & TenantIntegrationDataStore & OfficialCalendarDataStore & PlatformOperationLogStorage & PublicMessagingDatabase;
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
    openApiDocument?: unknown }): DynamicModule {
    if (options.coreHttp && options.coreHttpProvider) throw new Error("Core HTTP只能登记一个实际准入提供者");
    if (options.integrationBusiness && options.integrationBusinessProvider) throw new Error("集成业务依赖只能登记一个实际参加者");
    return { module: PlatformServerModule, imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ...(options.imports ?? [])],
      controllers: [AuthSessionController, TenantAppearanceProfileController, AccountAppearanceController, PlatformHealthController, PlatformOpenApiController, PlatformManagementController,
        TenantSubscriptionController, PlatformSubscriptionController, TenantIntegrationController, OfficialCalendarSourceController, PlatformToolsController,
        TenantOperatorInvitationsController, AcceptTenantOperatorInvitationController, TenantDispatchController, TenantSupportEmailController],
      providers: [
        { provide: PLATFORM_AUTH_DATA_STORE, inject: options.inject ?? [], useFactory: options.useFactory },
        { provide: PLATFORM_APPEARANCE_DATA_STORE, useExisting: PLATFORM_AUTH_DATA_STORE },
        { provide: PLATFORM_SUBSCRIPTION_DATA_STORE, useExisting: PLATFORM_AUTH_DATA_STORE },
        { provide: INTEGRATION_DATA_STORE, useExisting: PLATFORM_AUTH_DATA_STORE },
        { provide: OFFICIAL_CALENDAR_DATA_STORE, useExisting: PLATFORM_AUTH_DATA_STORE },
        { provide: PlatformOperationLogService, inject: [PLATFORM_AUTH_DATA_STORE], useFactory: (database: PlatformDatabase) => new PlatformOperationLogService(database) },
        { provide: PlatformAuthenticationRepository, inject: [PLATFORM_AUTH_DATA_STORE], useFactory: (database: PlatformDatabase) => new PlatformAuthenticationRepository(database) },
        { provide: PUBLIC_MESSAGING_APPLICATIONS,
          inject: [PLATFORM_AUTH_DATA_STORE, ConfigService, TenantIntegrationService, TenantEmailRuntimeService, PlatformOperationLogService],
          useFactory: createPublicMessagingApplications },
        { provide: TENANT_OPERATOR_INVITATIONS_HTTP_APPLICATION, inject: [PUBLIC_MESSAGING_APPLICATIONS],
          useFactory: (applications: TenantMessagingHttpApplications) => applications.invitations },
        { provide: TENANT_DISPATCH_HTTP_APPLICATION, inject: [PUBLIC_MESSAGING_APPLICATIONS],
          useFactory: (applications: TenantMessagingHttpApplications) => applications.dispatch },
        { provide: TENANT_SUPPORT_EMAIL_HTTP_APPLICATION, inject: [PUBLIC_MESSAGING_APPLICATIONS],
          useFactory: (applications: TenantMessagingHttpApplications) => applications.support },
        TenantAppearanceProfileService, AccountAppearanceService, PlatformAuthService, PlatformAuthGuard, PlatformManagementService, PlatformToolsService, SubscriptionService,
        { provide: SUBSCRIPTION_APPLICATION, useExisting: SubscriptionService },
        SecretBox, TenantIntegrationService, TenantIntegrationRuntimeService, TenantEmailRuntimeService, TenantIntegrationConnectivityService, ObjectStorageProviderService,
        { provide: INTEGRATION_EMAIL_PROBE, useExisting: TenantEmailRuntimeService },
        { provide: TENANT_INTEGRATION_APPLICATION, useExisting: TenantIntegrationService },
        { provide: TENANT_INTEGRATION_CONNECTIVITY, useExisting: TenantIntegrationConnectivityService },
        OfficialCalendarSourceService,
        { provide: OFFICIAL_CALENDAR_APPLICATION, useExisting: OfficialCalendarSourceService },
        { provide: OFFICIAL_CALENDAR_SOURCE_READER, inject: [OfficialCalendarSourceService], useFactory: createOfficialCalendarSourceReader },
        { provide: INTEGRATION_RUNTIME_PROVIDERS, useValue: options.integrationRuntimeProviders ?? PUBLIC_INTEGRATION_RUNTIME_PROVIDERS },
        ...(options.integrationBusiness ? [{ provide: INTEGRATION_BUSINESS_PARTICIPANT, useValue: options.integrationBusiness }] : []),
        ...(options.integrationBusinessProvider ? [{ ...options.integrationBusinessProvider, provide: INTEGRATION_BUSINESS_PARTICIPANT }] : []),
        ...(options.integrationPaymentProbe ? [{ provide: INTEGRATION_PAYMENT_PROBE, useValue: options.integrationPaymentProbe }] : []),
        ...(options.subscriptionCategories ? [{ provide: SUBSCRIPTION_CATEGORY_PARTICIPANT, useValue: options.subscriptionCategories }] : []),
        { provide: AUTH_HTTP_APPLICATION, useExisting: PlatformAuthService },
        { provide: PLATFORM_OPENAPI_DOCUMENT, useValue: options.openApiDocument ?? createPlatformOpenApi() },
        ...(options.coreHttp ? [{ provide: REGISTERED_CORE_HTTP_ACCESS, useValue: options.coreHttp }] : []),
        ...(options.coreHttpProvider ? [{ ...options.coreHttpProvider, provide: REGISTERED_CORE_HTTP_ACCESS }] : []),
        { provide: APP_GUARD, useExisting: PlatformAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor }
      ], exports: [PlatformAuthService, PlatformAuthenticationRepository, PlatformManagementService, PlatformToolsService, SubscriptionService, SUBSCRIPTION_APPLICATION,
        TenantIntegrationService, TenantIntegrationRuntimeService, ObjectStorageProviderService, SecretBox, TENANT_INTEGRATION_APPLICATION,
        OfficialCalendarSourceService, OFFICIAL_CALENDAR_APPLICATION, OFFICIAL_CALENDAR_SOURCE_READER,
        TENANT_OPERATOR_INVITATIONS_HTTP_APPLICATION, TENANT_DISPATCH_HTTP_APPLICATION, TENANT_SUPPORT_EMAIL_HTTP_APPLICATION,
        PLATFORM_AUTH_DATA_STORE, PLATFORM_APPEARANCE_DATA_STORE, PLATFORM_SUBSCRIPTION_DATA_STORE, INTEGRATION_DATA_STORE,
        OFFICIAL_CALENDAR_DATA_STORE] };
  }
}
