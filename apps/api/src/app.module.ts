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
import { PlatformService } from "./modules/platform/platform.service";
import { ReportsController } from "./modules/reports/reports.controller";
import { ReportsRepository } from "./modules/reports/reports.repository";
import { ReportsService } from "./modules/reports/reports.service";
import { StoreRentalController } from "./modules/store-rental/store-rental.controller";
import { StoreRentalRepository } from "./modules/store-rental/store-rental.repository";
import { StoreRentalService } from "./modules/store-rental/store-rental.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
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
    IntegrationsController,
    FilesController,
    NotificationsController,
    JobsController
  ],
  providers: [
    AuthService,
    PlatformService,
    PlatformRepository,
    OperationLogService,
    ReportsService,
    ReportsRepository,
    StoreRentalService,
    StoreRentalRepository,
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
