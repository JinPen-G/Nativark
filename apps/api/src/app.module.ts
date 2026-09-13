import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ApiAuthGuard } from "./common/api-auth.guard";
import { ConfigModule } from "@nestjs/config";
import { OperationAuditInterceptor } from "./common/operation-audit.interceptor";
import { OperationLogService } from "./common/operation-log.service";
import { RequestIdInterceptor } from "./common/request-id.interceptor";
import { AuthController } from "./modules/auth/auth.controller";
import { AuthService } from "./modules/auth/auth.service";
import { FilesController } from "./modules/files/files.controller";
import { HealthController } from "./modules/health/health.controller";
import { IntegrationsController } from "./modules/integrations/integrations.controller";
import { IntegrationsRepository } from "./modules/integrations/integrations.repository";
import { IntegrationsService } from "./modules/integrations/integrations.service";
import { TenantIntegrationController } from "./modules/integrations/tenant-integration.controller";
import { TenantIntegrationService } from "./modules/integrations/tenant-integration.service";
import { TenantIntegrationRuntimeService } from "./modules/integrations/tenant-integration.runtime.service";
import { FileStorageRuntimeService } from "./modules/integrations/file-storage.runtime.service";
import { SecretBox } from "./common/secret-box";
import { JobsController } from "./modules/jobs/jobs.controller";
import { NotificationsController } from "./modules/notifications/notifications.controller";
import { OpenApiController } from "./modules/openapi/openapi.controller";
import { DatabaseModule } from "./modules/database/database.module";
import { PlatformController } from "./modules/platform/platform.controller";
import { PlatformRepository } from "./modules/platform/platform.repository";
import { SharedCustomerRepository } from "./modules/platform/shared-customer.repository";
import { CustomerOperationsRepository } from "./modules/platform/customer-operations.repository";
import { CustomerOperationsService } from "./modules/platform/customer-operations.service";
import { CustomerMergeService } from "./modules/platform/customer-merge.service";
import { CustomerCorporateService } from "./modules/platform/customer-corporate.service";
import { MembershipController } from "./modules/platform/membership.controller";
import { MembershipService } from "./modules/platform/membership.service";
import { PlatformService } from "./modules/platform/platform.service";
import { RentalCoreController } from "./modules/rental-core/rental-core.controller";
import { RentalCoreService } from "./modules/rental-core/rental-core.service";
import { RentalAllocationService } from "./modules/rental-core/rental-allocation.service";
import { RentalBusinessController } from "./modules/rental-core/rental-business.controller";
import { OfficialCalendarSourceController } from "./modules/rental-core/official-calendar-source.controller";
import { OfficialCalendarSourceService } from "./modules/rental-core/official-calendar-source.service";
import { RentalBusinessService } from "./modules/rental-core/rental-business.service";
import { RentalStateRepository } from "./modules/rental-core/rental-state.repository";
import { RentalSnapshotBackfillService } from "./modules/rental-core/rental-snapshot-backfill.service";
import { RentalCoreConfigRepository } from "./modules/rental-core/rental-core-config.repository";
import { RentalCoreFactRepository } from "./modules/rental-core/rental-core-fact.repository";
import { RentalWorkspaceReportRepository } from "./modules/rental-core/rental-workspace-report.repository";
import { RentalBusinessConfigRepository } from "./modules/rental-core/rental-business-config.repository";
import { RentalBusinessFactRepository } from "./modules/rental-core/rental-business-fact.repository";
import { RentalIdempotencyRepository } from "./modules/rental-core/rental-idempotency.repository";
import { RentalIdempotentActionService } from "./modules/rental-core/rental-idempotent-action.service";
import { RentalFundingService } from "./modules/rental-core/rental-funding.service";
import { RentalOrderConfirmationService } from "./modules/rental-core/rental-order-confirmation.service";
import { WorkspaceCapabilityController } from "./modules/rental-core/workspace-capability.controller";
import { WorkspaceCapabilityRepository } from "./modules/rental-core/workspace-capability.repository";
import { WorkspaceCapabilityService } from "./modules/rental-core/workspace-capability.service";
import { CapabilityHookRuntime } from "./modules/rental-core/capability-hook.runtime";
import { CapabilityHookRepository } from "./modules/rental-core/capability-hook.repository";
import { CapabilityHookRegistrar } from "./modules/rental-core/capability-hook.registrar";
import { RentalServiceCapacityService } from "./modules/rental-core/rental-service-capacity.service";
import { ClientApiController } from "./modules/client/client-api.controller";
import { ClientApiService } from "./modules/client/client-api.service";
import { ClientAuthService } from "./modules/client/client-auth.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"]
    }),
    DatabaseModule
  ],
  controllers: [
    HealthController,
    OpenApiController,
    AuthController,
    PlatformController,
    MembershipController,
    RentalCoreController,
    RentalBusinessController,
    OfficialCalendarSourceController,
    WorkspaceCapabilityController,
    IntegrationsController,
    TenantIntegrationController,
    FilesController,
    NotificationsController,
    JobsController,
    ClientApiController
  ],
  providers: [
    AuthService,
    PlatformService,
    PlatformRepository,
    SharedCustomerRepository,
    CustomerOperationsRepository,
    CustomerOperationsService,
    CustomerMergeService,
    CustomerCorporateService,
    MembershipService,
    OperationLogService,
    RentalCoreService,
    RentalAllocationService,
    RentalBusinessService,
    OfficialCalendarSourceService,
    RentalStateRepository,
    RentalSnapshotBackfillService,
    RentalCoreConfigRepository,
    RentalCoreFactRepository,
    RentalWorkspaceReportRepository,
    RentalBusinessConfigRepository,
    RentalBusinessFactRepository,
    RentalIdempotencyRepository,
    RentalIdempotentActionService,
    RentalFundingService,
    RentalOrderConfirmationService,
    RentalServiceCapacityService,
    WorkspaceCapabilityRepository,
    WorkspaceCapabilityService,
    CapabilityHookRuntime,
    CapabilityHookRegistrar,
    CapabilityHookRepository,
    ClientApiService,
    ClientAuthService,
    IntegrationsService,
    IntegrationsRepository,
    TenantIntegrationService,
    TenantIntegrationRuntimeService,
    FileStorageRuntimeService,
    SecretBox,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: OperationAuditInterceptor
    },
    {
      provide: APP_GUARD,
      useClass: ApiAuthGuard
    }
  ]
})
export class AppModule {}
