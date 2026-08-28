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
import { JobsController } from "./modules/jobs/jobs.controller";
import { NotificationsController } from "./modules/notifications/notifications.controller";
import { OpenApiController } from "./modules/openapi/openapi.controller";
import { DatabaseModule } from "./modules/database/database.module";
import { PlatformController } from "./modules/platform/platform.controller";
import { PlatformRepository } from "./modules/platform/platform.repository";
import { SharedCustomerRepository } from "./modules/platform/shared-customer.repository";
import { PlatformService } from "./modules/platform/platform.service";
import { ReportsController } from "./modules/reports/reports.controller";
import { ReportsRepository } from "./modules/reports/reports.repository";
import { ReportsService } from "./modules/reports/reports.service";
import { StoreRentalController } from "./modules/store-rental/store-rental.controller";
import { StoreRentalRepository } from "./modules/store-rental/store-rental.repository";
import { StoreRentalService } from "./modules/store-rental/store-rental.service";
import { RentalCoreController } from "./modules/rental-core/rental-core.controller";
import { RentalCoreService } from "./modules/rental-core/rental-core.service";
import { RentalBusinessController } from "./modules/rental-core/rental-business.controller";
import { OfficialCalendarSourceController } from "./modules/rental-core/official-calendar-source.controller";
import { OfficialCalendarSourceService } from "./modules/rental-core/official-calendar-source.service";
import { RentalBusinessService } from "./modules/rental-core/rental-business.service";
import { RentalStateRepository } from "./modules/rental-core/rental-state.repository";
import { RentalSnapshotBackfillService } from "./modules/rental-core/rental-snapshot-backfill.service";
import { RentalCoreConfigRepository } from "./modules/rental-core/rental-core-config.repository";
import { RentalCoreFactRepository } from "./modules/rental-core/rental-core-fact.repository";
import { RentalBusinessConfigRepository } from "./modules/rental-core/rental-business-config.repository";
import { RentalBusinessFactRepository } from "./modules/rental-core/rental-business-fact.repository";
import { RentalIdempotencyRepository } from "./modules/rental-core/rental-idempotency.repository";
import { RentalIdempotentActionService } from "./modules/rental-core/rental-idempotent-action.service";
import { RentalOrderConfirmationService } from "./modules/rental-core/rental-order-confirmation.service";
import { WorkspaceCapabilityController } from "./modules/rental-core/workspace-capability.controller";
import { WorkspaceCapabilityRepository } from "./modules/rental-core/workspace-capability.repository";
import { WorkspaceCapabilityService } from "./modules/rental-core/workspace-capability.service";
import { CapabilityHookRuntime } from "./modules/rental-core/capability-hook.runtime";
import { CapabilityHookRepository } from "./modules/rental-core/capability-hook.repository";

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
    ReportsController,
    StoreRentalController,
    RentalCoreController,
    RentalBusinessController,
    OfficialCalendarSourceController,
    WorkspaceCapabilityController,
    IntegrationsController,
    FilesController,
    NotificationsController,
    JobsController
  ],
  providers: [
    AuthService,
    PlatformService,
    PlatformRepository,
    SharedCustomerRepository,
    OperationLogService,
    ReportsService,
    ReportsRepository,
    StoreRentalService,
    StoreRentalRepository,
    RentalCoreService,
    RentalBusinessService,
    OfficialCalendarSourceService,
    RentalStateRepository,
    RentalSnapshotBackfillService,
    RentalCoreConfigRepository,
    RentalCoreFactRepository,
    RentalBusinessConfigRepository,
    RentalBusinessFactRepository,
    RentalIdempotencyRepository,
    RentalIdempotentActionService,
    RentalOrderConfirmationService,
    WorkspaceCapabilityRepository,
    WorkspaceCapabilityService,
    CapabilityHookRuntime,
    CapabilityHookRepository,
    IntegrationsService,
    IntegrationsRepository,
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
