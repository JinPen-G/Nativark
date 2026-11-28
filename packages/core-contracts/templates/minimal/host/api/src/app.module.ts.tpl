/** 原公共服务、Guard、Core管理和业务共用同一数据库/生命周期；只登记权限目录，不授角色。 */
import { Module, type ExecutionContext } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { CoreDeploymentLockSchema, type CoreDeploymentLock } from "@rental-os/core-contracts";
import { PlatformAuthGuard, PlatformServerModule, createPlatformOpenApi } from "@rental-os/platform-server";
import { CORE_HOST_APPLICATION, CoreHostModule, CoreHostPermissionStartup, createPlatformCoreHttpAccess,
  createPlatformCoreOpenApi, type CoreHostHttpApplication } from "@rental-os/platform-core-host";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "@rental-os/platform-api/database";
import { ItemsHttpModule } from "{{PACKAGE_NAME}}/nest";
import { createOpenApi } from "{{PACKAGE_NAME}}";
import { composeApplication } from "./assembly";
import { CoreApplicationLifecycle } from "./lifecycle";

export function coreApplicationModule(input: CoreDeploymentLock) {
  const lock = CoreDeploymentLockSchema.parse(input), assembledToken = Symbol("{{CORE_ID}}.host-assembly");
  type Assembly = ReturnType<typeof composeApplication>;
  @Module({ imports: [PlatformDatabaseModule], providers: [{ provide: assembledToken, inject: [PlatformDatabaseClient],
    useFactory: (database: PlatformDatabaseClient) => composeApplication(database, lock) }], exports: [assembledToken] })
  class DependenciesModule {}
  const coreModule = CoreHostModule.register({ imports: [DependenciesModule], inject: [assembledToken],
    useFactory: (assembly: Assembly) => assembly.application,
    permissions: { inject: [assembledToken, PlatformDatabaseClient],
      useFactory: (_assembly: Assembly, database: PlatformDatabaseClient) => new CoreHostPermissionStartup({ database,
        manifests: lock.cores.map(pin => pin.manifest) }) } });
  @Module({ imports: [PlatformDatabaseModule, coreModule], providers: [{ provide: CoreApplicationLifecycle,
    inject: [PlatformDatabaseClient, CoreHostPermissionStartup], useFactory: (database: PlatformDatabaseClient, permissions: CoreHostPermissionStartup) =>
      new CoreApplicationLifecycle(database, permissions) }], exports: [CoreApplicationLifecycle] })
  class LifecycleModule {}
  const business = ItemsHttpModule.registerFactory({ imports: [DependenciesModule], inject: [assembledToken], useFactory: (assembly: Assembly) => assembly.core });
  @Module({ imports: [LifecycleModule, PlatformServerModule.register({
    imports: [PlatformDatabaseModule, coreModule, business, LifecycleModule], inject: [PlatformDatabaseClient],
    useFactory: (database: PlatformDatabaseClient) => database,
    guardProvider: { provide: "{{CORE_ID}}.request-guard", inject: [PlatformAuthGuard, CoreApplicationLifecycle],
      useFactory: (guard: PlatformAuthGuard, lifecycle: CoreApplicationLifecycle) => ({
        canActivate: (context: ExecutionContext) => lifecycle.runRequest(() => guard.canActivate(context)) }) },
    coreHttpProvider: { provide: "{{CORE_ID}}.core-http", inject: [CORE_HOST_APPLICATION],
      useFactory: (application: CoreHostHttpApplication) => createPlatformCoreHttpAccess(application) },
    openApiDocument: createPlatformCoreOpenApi(createPlatformOpenApi(), [{ manifest: lock.cores[0].manifest, contribution: createOpenApi() }])
  })], providers: [{ provide: APP_INTERCEPTOR, useExisting: CoreApplicationLifecycle }] })
  class ApplicationModule {}
  return ApplicationModule;
}
