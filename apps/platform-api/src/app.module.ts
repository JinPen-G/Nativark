/** 默认无Core的受控宿主装配，仅包含公共源码、公共数据库与公开设置。 */
import { Module } from "@nestjs/common";
import { PlatformServerModule, createPlatformOpenApi } from "@rental-os/platform-server";
import { createPlatformCoreHttpAccess, createPlatformCoreOpenApi, type CoreHostHttpApplication } from "@rental-os/platform-core-host";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "./database";
import { CORE_HOST_APPLICATION, publicCoreModule, publicIntegrationBusiness } from "./core-assembly";

@Module({ imports: [PlatformServerModule.register({ imports: [PlatformDatabaseModule, publicCoreModule],
  inject: [PlatformDatabaseClient], useFactory: (database: PlatformDatabaseClient) => database,
  integrationBusiness: publicIntegrationBusiness,
  coreHttpProvider: { provide: "public.core-http", inject: [CORE_HOST_APPLICATION], useFactory: (application: CoreHostHttpApplication) => createPlatformCoreHttpAccess(application) },
  openApiDocument: createPlatformCoreOpenApi(createPlatformOpenApi()) })] })
export class PlatformAppModule {}
