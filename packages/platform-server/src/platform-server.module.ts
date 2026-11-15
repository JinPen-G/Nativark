/** 独立公共API模块。宿主提供唯一持久化实例，Core及其迁移/业务HTTP另行显式装配。 */
import { Module, type DynamicModule, type ModuleMetadata, type FactoryProvider } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
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

export type PlatformDatabase = PlatformAuthDataStore & PlatformAppearanceDataStore & PlatformManagementDatabase;
@Module({})
export class PlatformServerModule {
  static register<Dependencies extends unknown[]>(options: { imports?: ModuleMetadata["imports"]; inject?: FactoryProvider["inject"];
    useFactory: (...args: Dependencies) => PlatformDatabase | Promise<PlatformDatabase>;
    coreHttp?: RegisteredCoreHttpAccess }): DynamicModule {
    return { module: PlatformServerModule, imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ...(options.imports ?? [])],
      controllers: [AuthSessionController, TenantAppearanceProfileController, AccountAppearanceController, PlatformHealthController, PlatformOpenApiController, PlatformManagementController],
      providers: [
        { provide: PLATFORM_AUTH_DATA_STORE, inject: options.inject ?? [], useFactory: options.useFactory },
        { provide: PLATFORM_APPEARANCE_DATA_STORE, useExisting: PLATFORM_AUTH_DATA_STORE },
        { provide: PlatformAuthenticationRepository, inject: [PLATFORM_AUTH_DATA_STORE], useFactory: (database: PlatformDatabase) => new PlatformAuthenticationRepository(database) },
        TenantAppearanceProfileService, AccountAppearanceService, PlatformAuthService, PlatformAuthGuard, PlatformManagementService,
        { provide: AUTH_HTTP_APPLICATION, useExisting: PlatformAuthService },
        { provide: PLATFORM_OPENAPI_DOCUMENT, useValue: createPlatformOpenApi() },
        ...(options.coreHttp ? [{ provide: REGISTERED_CORE_HTTP_ACCESS, useValue: options.coreHttp }] : []),
        { provide: APP_GUARD, useExisting: PlatformAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor }
      ], exports: [PlatformAuthService, PlatformAuthenticationRepository, PLATFORM_AUTH_DATA_STORE, PLATFORM_APPEARANCE_DATA_STORE] };
  }
}
