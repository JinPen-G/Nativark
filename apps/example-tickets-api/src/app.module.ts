/** 公共+工单的显式Nest组合，不修改公共Guard业务分支或公共宿主源码来识别工单页面。 */
import { Module } from "@nestjs/common";
import type { CoreDeploymentLock } from "@rental-os/core-contracts";
import { PlatformServerModule, createPlatformOpenApi } from "@rental-os/platform-server";
import { CORE_HOST_APPLICATION, CoreHostModule, createPlatformCoreHttpAccess, createPlatformCoreOpenApi, type CoreHostHttpApplication } from "@rental-os/platform-core-host";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "@rental-os/platform-api/database";
import { TicketsHttpModule } from "@rental-os/example-tickets-core/nest";
import { createTicketsOpenApi } from "@rental-os/example-tickets-core";
import { composeTicketsApplication } from "./assembly";

/** Core和公共API共用原数据库provider，生命周期由宿主唯一模块负责。 */
export function ticketsApplicationModule(lock: CoreDeploymentLock) {
  const assembledToken = Symbol("example-tickets.host-assembly");
  type Assembly = ReturnType<typeof composeTicketsApplication>;
  @Module({ imports: [PlatformDatabaseModule], providers: [{ provide: assembledToken, inject: [PlatformDatabaseClient],
    useFactory: (database: PlatformDatabaseClient) => composeTicketsApplication(database, lock) }], exports: [assembledToken] })
  class TicketsDependenciesModule {}
  const coreModule = CoreHostModule.register({ imports: [TicketsDependenciesModule], inject: [assembledToken],
    useFactory: (assembly: Assembly) => assembly.application });
  const businessModule = TicketsHttpModule.registerFactory({ imports: [TicketsDependenciesModule], inject: [assembledToken],
    useFactory: (assembly: Assembly) => assembly.tickets });
  @Module({ imports: [PlatformServerModule.register({ imports: [PlatformDatabaseModule, coreModule, businessModule],
    inject: [PlatformDatabaseClient], useFactory: (database: PlatformDatabaseClient) => database,
    coreHttpProvider: { provide: "tickets.core-http", inject: [CORE_HOST_APPLICATION],
      useFactory: (application: CoreHostHttpApplication) => createPlatformCoreHttpAccess(application) },
    openApiDocument: createPlatformCoreOpenApi(createPlatformOpenApi(), [{ manifest: lock.cores[0].manifest, contribution: createTicketsOpenApi() }]) })] })
  class TicketsApplicationModule {}
  return TicketsApplicationModule;
}
