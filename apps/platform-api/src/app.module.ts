/** 默认无Core的受控宿主装配，仅包含公共源码、公共数据库与公开设置。 */
import { Module } from "@nestjs/common";
import { PlatformServerModule, createPlatformOpenApi } from "@rental-os/platform-server";
import { createPlatformCoreHttpAccess, createPlatformCoreOpenApi, createPlatformCorePackageAssemblyHttpAccess,
  createPlatformCorePackageOpenApi, type CoreHostHttpApplication, type CorePackageAssembly } from "@rental-os/platform-core-host";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "./database";
import { CORE_HOST_APPLICATION, CORE_PACKAGE_ASSEMBLY, publicCoreModule, publicCorePackagesModule, publicIntegrationBusiness } from "./core-assembly";

@Module({ imports: [PlatformServerModule.register({ imports: [PlatformDatabaseModule, publicCoreModule, publicCorePackagesModule],
  inject: [PlatformDatabaseClient], useFactory: (database: PlatformDatabaseClient) => database,
  integrationBusiness: publicIntegrationBusiness,
  coreHttpProvider: { provide: "public.core-http", inject: [CORE_HOST_APPLICATION, CORE_PACKAGE_ASSEMBLY],
    useFactory: (application: CoreHostHttpApplication, packages: CorePackageAssembly) =>
      createPlatformCorePackageAssemblyHttpAccess(packages, createPlatformCoreHttpAccess(application)) },
  openApiDocument: createPlatformCorePackageOpenApi(createPlatformCoreOpenApi(createPlatformOpenApi())) })] })
export class PlatformAppModule {}
