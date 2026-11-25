/** 默认无Core的受控宿主装配，仅包含公共源码、公共数据库与公开设置。 */
import { Module, type ExecutionContext } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { PlatformAuthGuard, PlatformServerModule, createPlatformOpenApi } from "@rental-os/platform-server";
import { createPlatformCoreHttpAccess, createPlatformCoreOpenApi, createPlatformCorePackageAssemblyHttpAccess,
  createPlatformCorePackageOpenApi, type CoreHostHttpApplication, type CorePackageAssembly } from "@rental-os/platform-core-host";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "./database";
import { CORE_HOST_APPLICATION, CORE_PACKAGE_ASSEMBLY, publicCoreModule, publicCorePackagesModule, publicIntegrationBusiness } from "./core-assembly";
import { PlatformApplicationLifecycle } from "./lifecycle";

@Module({ imports: [PlatformDatabaseModule], providers: [{
  provide: PlatformApplicationLifecycle, inject: [PlatformDatabaseClient],
  useFactory: (database: PlatformDatabaseClient) => new PlatformApplicationLifecycle(database)
}], exports: [PlatformApplicationLifecycle] })
class PlatformLifecycleModule {}

@Module({ imports: [PlatformLifecycleModule, PlatformServerModule.register({ imports: [PlatformDatabaseModule, publicCoreModule, publicCorePackagesModule, PlatformLifecycleModule],
  inject: [PlatformDatabaseClient], useFactory: (database: PlatformDatabaseClient) => database,
  integrationBusiness: publicIntegrationBusiness,
  guardProvider: { provide: "public.request-guard", inject: [PlatformAuthGuard, PlatformApplicationLifecycle],
    useFactory: (guard: PlatformAuthGuard, lifecycle: PlatformApplicationLifecycle) => ({
      canActivate: (context: ExecutionContext) => lifecycle.runRequest(() => guard.canActivate(context))
    }) },
  coreHttpProvider: { provide: "public.core-http", inject: [CORE_HOST_APPLICATION, CORE_PACKAGE_ASSEMBLY],
    useFactory: (application: CoreHostHttpApplication, packages: CorePackageAssembly) =>
      createPlatformCorePackageAssemblyHttpAccess(packages, createPlatformCoreHttpAccess(application)) },
  openApiDocument: createPlatformCorePackageOpenApi(createPlatformCoreOpenApi(createPlatformOpenApi())) })], providers: [{ provide: APP_INTERCEPTOR, useExisting: PlatformApplicationLifecycle }] })
export class PlatformAppModule {}
