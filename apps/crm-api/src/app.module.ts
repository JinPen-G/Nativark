/** 单 CRM Nest 装配：公共 Guard/ALS、数据库与权限目录复用原实例，CRM 提供业务入口。 */
import { Module, type ExecutionContext } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CoreDeploymentLockSchema, type CoreDeploymentLock } from "@rental-os/core-contracts";
import { PlatformAuthGuard, PlatformServerModule, createPlatformOpenApi } from "@rental-os/platform-server";
import {
  CORE_HOST_APPLICATION, CORE_PACKAGE_ASSEMBLY, CoreHostModule, CorePackageAssemblyModule, CoreHostPermissionStartup,
  createPlatformCoreHttpAccess, createPlatformCoreOpenApi, createPlatformCorePackageAssemblyHttpAccess,
  createPlatformCorePackageOpenApi, type CoreHostHttpApplication, type CorePackageAssembly
} from "@rental-os/platform-core-host";
import { PlatformDatabaseClient, PlatformDatabaseModule } from "@rental-os/platform-api/database";
import { CrmHttpModule } from "@rental-os/crm-core/nest";
import { createCrmOpenApi } from "@rental-os/crm-core";
import { composeCrmApplication } from "./assembly";
import { selectCrmDeployment } from "./configuration";
import { CrmApplicationLifecycle } from "./lifecycle";

export function crmApplicationModule(input: CoreDeploymentLock) {
  const lock = CoreDeploymentLockSchema.parse(input), pin = selectCrmDeployment(lock);
  const assembledToken = Symbol("crm.host-assembly");
  type Assembly = ReturnType<typeof composeCrmApplication>;
  @Module({ imports: [PlatformDatabaseModule, ConfigModule], providers: [{
    provide: assembledToken, inject: [PlatformDatabaseClient, ConfigService],
    useFactory: (database: PlatformDatabaseClient, config: ConfigService) => composeCrmApplication(database, lock, {
      storageDirectory: config.get<string>("CORE_PACKAGE_STORAGE_ROOT")
    })
  }], exports: [assembledToken] })
  class CrmDependenciesModule {}
  const coreModule = CoreHostModule.register({ imports: [CrmDependenciesModule], inject: [assembledToken],
    useFactory: (assembly: Assembly) => assembly.application,
    permissions: { inject: [assembledToken, PlatformDatabaseClient],
      useFactory: (_assembly: Assembly, database: PlatformDatabaseClient) => new CoreHostPermissionStartup({ database,
        manifests: [pin.manifest] }) } });
  @Module({ imports: [PlatformDatabaseModule, coreModule], providers: [{
    provide: CrmApplicationLifecycle, inject: [PlatformDatabaseClient, CoreHostPermissionStartup],
    useFactory: (database: PlatformDatabaseClient, permissions: CoreHostPermissionStartup) =>
      new CrmApplicationLifecycle(database, permissions)
  }], exports: [CrmApplicationLifecycle] })
  class CrmLifecycleModule {}
  const businessModule = CrmHttpModule.registerFactory({ imports: [CrmDependenciesModule], inject: [assembledToken],
    useFactory: (assembly: Assembly) => assembly.crm });
  const packagesModule = CorePackageAssemblyModule.register({ imports: [CrmDependenciesModule], inject: [assembledToken],
    useFactory: (assembly: Assembly) => assembly.packages });
  @Module({ imports: [CrmLifecycleModule, PlatformServerModule.register({
    imports: [PlatformDatabaseModule, coreModule, businessModule, packagesModule, CrmLifecycleModule],
    inject: [PlatformDatabaseClient], useFactory: (database: PlatformDatabaseClient) => database,
    guardProvider: { provide: "crm.request-guard", inject: [PlatformAuthGuard, CrmApplicationLifecycle],
      useFactory: (guard: PlatformAuthGuard, lifecycle: CrmApplicationLifecycle) => ({
        canActivate: (context: ExecutionContext) => lifecycle.runRequest(() => guard.canActivate(context))
      }) },
    coreHttpProvider: { provide: "crm.core-http", inject: [CORE_HOST_APPLICATION, CORE_PACKAGE_ASSEMBLY],
      useFactory: (application: CoreHostHttpApplication, packages: CorePackageAssembly) =>
        createPlatformCorePackageAssemblyHttpAccess(packages, createPlatformCoreHttpAccess(application)) },
    openApiDocument: createPlatformCorePackageOpenApi(createPlatformCoreOpenApi(createPlatformOpenApi(), [
      { manifest: pin.manifest, contribution: createCrmOpenApi() }
    ])) })], providers: [{ provide: APP_INTERCEPTOR, useExisting: CrmApplicationLifecycle }] })
  class CrmApplicationModule {}
  return CrmApplicationModule;
}
