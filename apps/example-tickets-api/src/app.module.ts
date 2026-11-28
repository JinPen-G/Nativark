/** 公共+工单的显式Nest组合；唯一宿主生命周期等待原Guard/处理器与权限登记。
 * 公共权限、ALS和工单业务各沿原实例，不复制授权逻辑或提前断开同一数据库。 */
import { Module, type ExecutionContext, type DynamicModule, type Type } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CoreDeploymentLockSchema, type CoreDeploymentLock, type CoreOpenApiContribution } from "@rental-os/core-contracts";
import { PlatformAuthGuard, PlatformServerModule, createPlatformOpenApi } from "@rental-os/platform-server";
import {
  CORE_HOST_APPLICATION, CORE_PACKAGE_ASSEMBLY, CoreHostModule, CorePackageAssemblyModule, CoreHostPermissionStartup,
  createPlatformCoreHttpAccess, createPlatformCoreOpenApi, createPlatformCorePackageAssemblyHttpAccess,
  createPlatformCorePackageOpenApi, type CoreHostHttpApplication, type CorePackageAssembly
} from "@rental-os/platform-core-host";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "@rental-os/platform-api/database";
import { TicketsHttpModule } from "@rental-os/example-tickets-core/nest";
import { createTicketsOpenApi, TICKETS_FILTER_PRESET_CONTRIBUTION } from "@rental-os/example-tickets-core";
import { composeTicketsApplication, type TicketsOptionalCapabilities } from "./assembly";
import { TicketsApplicationLifecycle } from "./lifecycle";

/** Core和公共API共用原数据库provider，生命周期由宿主唯一模块负责。 */
export type TicketsAssembly = ReturnType<typeof composeTicketsApplication>;
export function ticketsApplicationModule(lock: CoreDeploymentLock, optional: {
  capabilities?: TicketsOptionalCapabilities;
  openapi?: CoreOpenApiContribution;
  business?(host: { platformServer: DynamicModule; dependencies: Type<unknown>; assembledToken: symbol }): {
    business: DynamicModule; additional: DynamicModule[] };
} = {}) {
  const selectedLock = CoreDeploymentLockSchema.parse(lock);
  const assembledToken = Symbol("example-tickets.host-assembly");
  type Assembly = ReturnType<typeof composeTicketsApplication>;
  @Module({ imports: [PlatformDatabaseModule, ConfigModule], providers: [{
    provide: assembledToken, inject: [PlatformDatabaseClient, ConfigService],
    useFactory: (database: PlatformDatabaseClient, config: ConfigService) => composeTicketsApplication(database, selectedLock, {
      storageDirectory: config.get<string>("CORE_PACKAGE_STORAGE_ROOT"),
      platformReference: config.get<string>("CORE_PLATFORM_PACKAGE_REFERENCE")
    }, optional.capabilities)
  }], exports: [assembledToken] })
  class TicketsDependenciesModule {}
  const coreModule = CoreHostModule.register({ imports: [TicketsDependenciesModule], inject: [assembledToken],
    useFactory: (assembly: Assembly) => assembly.application,
    permissions: { inject: [assembledToken, PlatformDatabaseClient],
      useFactory: (_assembly: Assembly, database: PlatformDatabaseClient) => new CoreHostPermissionStartup({ database,
        manifests: selectedLock.cores.map(pin => pin.manifest) }) } });
  @Module({ imports: [PlatformDatabaseModule, coreModule], providers: [{
    provide: TicketsApplicationLifecycle, inject: [PlatformDatabaseClient, CoreHostPermissionStartup],
    useFactory: (database: PlatformDatabaseClient, permissions: CoreHostPermissionStartup) =>
      new TicketsApplicationLifecycle(database, permissions)
  }], exports: [TicketsApplicationLifecycle] })
  class TicketsLifecycleModule {}
  const packagesModule = CorePackageAssemblyModule.register({ imports: [TicketsDependenciesModule], inject: [assembledToken],
    useFactory: (assembly: Assembly) => assembly.packages });
  const platformServer = PlatformServerModule.register({
    imports: [PlatformDatabaseModule, coreModule, packagesModule, TicketsLifecycleModule],
    inject: [PlatformDatabaseClient], useFactory: (database: PlatformDatabaseClient) => database,
    filterPresetContributions: [TICKETS_FILTER_PRESET_CONTRIBUTION],
    guardProvider: { provide: "tickets.request-guard", inject: [PlatformAuthGuard, TicketsApplicationLifecycle],
      useFactory: (guard: PlatformAuthGuard, lifecycle: TicketsApplicationLifecycle) => ({
        canActivate: (context: ExecutionContext) => lifecycle.runRequest(() => guard.canActivate(context))
      }) },
    coreHttpProvider: { provide: "tickets.core-http", inject: [CORE_HOST_APPLICATION, CORE_PACKAGE_ASSEMBLY],
      useFactory: (application: CoreHostHttpApplication, packages: CorePackageAssembly) =>
        createPlatformCorePackageAssemblyHttpAccess(packages, createPlatformCoreHttpAccess(application)) },
    openApiDocument: createPlatformCorePackageOpenApi(createPlatformCoreOpenApi(createPlatformOpenApi({
      filterPresetContributions: [TICKETS_FILTER_PRESET_CONTRIBUTION] }), [
      { manifest: selectedLock.cores[0].manifest, contribution: optional.openapi ?? createTicketsOpenApi() }
    ])) });
  const business = optional.business?.({ platformServer, dependencies: TicketsDependenciesModule, assembledToken }) ?? {
    business: TicketsHttpModule.registerFactory({ imports: [TicketsDependenciesModule], inject: [assembledToken],
      useFactory: (assembly: Assembly) => assembly.tickets }), additional: [] };
  @Module({ imports: [TicketsLifecycleModule, platformServer, business.business, ...business.additional],
    providers: [{ provide: APP_INTERCEPTOR, useExisting: TicketsApplicationLifecycle }] })
  class TicketsApplicationModule {}
  return TicketsApplicationModule;
}
