/** 公共+工单的显式Nest组合，不修改公共Guard业务分支或公共宿主源码来识别工单页面。 */
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { CoreDeploymentLock } from "@rental-os/core-contracts";
import { PlatformServerModule, createPlatformOpenApi } from "@rental-os/platform-server";
import {
  CORE_HOST_APPLICATION, CORE_PACKAGE_ASSEMBLY, CoreHostModule, CorePackageAssemblyModule,
  createPlatformCoreHttpAccess, createPlatformCoreOpenApi, createPlatformCorePackageAssemblyHttpAccess,
  createPlatformCorePackageOpenApi, type CoreHostHttpApplication, type CorePackageAssembly
} from "@rental-os/platform-core-host";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "@rental-os/platform-api/database";
import { TicketsHttpModule } from "@rental-os/example-tickets-core/nest";
import { createTicketsOpenApi } from "@rental-os/example-tickets-core";
import { composeTicketsApplication } from "./assembly";

/** Core和公共API共用原数据库provider，生命周期由宿主唯一模块负责。 */
export function ticketsApplicationModule(lock: CoreDeploymentLock) {
  const assembledToken = Symbol("example-tickets.host-assembly");
  type Assembly = ReturnType<typeof composeTicketsApplication>;
  @Module({ imports: [PlatformDatabaseModule, ConfigModule], providers: [{
    provide: assembledToken, inject: [PlatformDatabaseClient, ConfigService],
    useFactory: (database: PlatformDatabaseClient, config: ConfigService) => composeTicketsApplication(database, lock, {
      storageDirectory: config.get<string>("CORE_PACKAGE_STORAGE_ROOT")
    })
  }], exports: [assembledToken] })
  class TicketsDependenciesModule {}
  const coreModule = CoreHostModule.register({ imports: [TicketsDependenciesModule], inject: [assembledToken],
    useFactory: (assembly: Assembly) => assembly.application });
  const businessModule = TicketsHttpModule.registerFactory({ imports: [TicketsDependenciesModule], inject: [assembledToken],
    useFactory: (assembly: Assembly) => assembly.tickets });
  const packagesModule = CorePackageAssemblyModule.register({ imports: [TicketsDependenciesModule], inject: [assembledToken],
    useFactory: (assembly: Assembly) => assembly.packages });
  @Module({ imports: [PlatformServerModule.register({ imports: [PlatformDatabaseModule, coreModule, businessModule, packagesModule],
    inject: [PlatformDatabaseClient], useFactory: (database: PlatformDatabaseClient) => database,
    coreHttpProvider: { provide: "tickets.core-http", inject: [CORE_HOST_APPLICATION, CORE_PACKAGE_ASSEMBLY],
      useFactory: (application: CoreHostHttpApplication, packages: CorePackageAssembly) =>
        createPlatformCorePackageAssemblyHttpAccess(packages, createPlatformCoreHttpAccess(application)) },
    openApiDocument: createPlatformCorePackageOpenApi(createPlatformCoreOpenApi(createPlatformOpenApi(), [
      { manifest: lock.cores[0].manifest, contribution: createTicketsOpenApi() }
    ])) })] })
  class TicketsApplicationModule {}
  return TicketsApplicationModule;
}
