/**
 * 同一公共主体、数据库、加密来源和审计组成 Core 包管理应用及 Nest 容器。
 * 文件目录由宿主配置，活动部署与原包材料由其实际装配提供，缺源保留 unavailable。
 */
import { ForbiddenException, Module, type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import { isAbsolute, join } from "node:path";
import { CoreAccessError, type CoreDeployedCatalogue } from "@rental-os/core-host";
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import type { RegisteredCoreHttpAccess } from "@rental-os/platform-server";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import type { SecretBox } from "@rental-os/platform-server/secret-box";
import type { PlatformCoreTransaction, PlatformCoreUsers } from "./ports";
import type { CorePackagePublicationAudit } from "./core-package-audit";
import { composeCorePackageSourceSettings, type CorePackageSourceSettingsApplication } from "./core-package-source-settings";
import { CORE_PACKAGE_SOURCE_SETTINGS, CorePackageSourceController, createCorePackageSourceHttpAccess } from "./core-package-source-http";
import { CORE_PACKAGE_APPLICATION, CorePackageController, createPlatformCorePackageHttpAccess } from "./core-package-http";
import type { CorePackageDeploymentSource, CorePackageHttpApplication, CorePackageLegacyApiRoutes } from "./core-package-ports";
import { composePlatformCorePackageManagement, createPlatformCorePackageDiscovery } from "./platform-core-package-management";
import {
  CORE_PACKAGE_PREFLIGHT_APPLICATION, CorePackagePreflightController, composePlatformCorePackagePreflight,
  createPlatformCorePackageArchiveIndexSource, createPlatformCorePackagePreflightHttpAccess,
  type CorePackageArtifactSource, type CorePackagePreflightApplication
} from "./core-package-preflight";
import {
  CORE_PACKAGE_SELECTION_APPLICATION, CorePackageSelectionController, composePlatformCorePackageSelection,
  createCorePackageReleaseReferenceFileStore, createPlatformCorePackageReleaseSource,
  createPlatformCorePackageSelectedArtifactSource, createPlatformCorePackageSelectionHttpAccess,
  type CorePackageReleaseApplication
} from "./core-package-selection";
import {
  CORE_PACKAGE_PREPARATION_APPLICATION, CorePackagePreparationController, composePlatformCorePackagePreparation,
  createCorePackagePreparationFileStore, createPlatformCorePackagePreparationHttpAccess,
  type CorePackagePreparationApplication, type CorePackagePreparationMaterialsSource, type CorePackageDeploymentSourceGuard
} from "./core-package-preparation";
import { composeCorePackageDeployment, CorePackageDeploymentController, createCorePackageDeploymentHttpAccess,
  CORE_PACKAGE_DEPLOYMENT_APPLICATION, type CorePackageDeploymentApplication, type CorePackageDeploymentExecutor
} from "./core-package-preparation";

export interface CorePackageAssembly {
  packages: CorePackageHttpApplication;
  preflight: CorePackagePreflightApplication;
  releases: CorePackageReleaseApplication;
  preparation: CorePackagePreparationApplication;
  sources: CorePackageSourceSettingsApplication;
  deploymentSourceGuard: CorePackageDeploymentSourceGuard;
  deployment: CorePackageDeploymentApplication;
  http: RegisteredCoreHttpAccess;
}

function combineHttpAccess(policies: readonly RegisteredCoreHttpAccess[]): RegisteredCoreHttpAccess {
  return {
    registered: (method, path, audience) => policies.some(policy => policy.registered(method, path, audience)),
    async authorize(method, path) {
      const audience = getRequestIdentity()?.audience;
      if (audience !== "operator") throw new ForbiddenException("缺少当前 Core HTTP 主体");
      const matched = policies.filter(policy => policy.registered(method, path, audience));
      if (matched.length !== 1) throw new ForbiddenException("Core HTTP 路径须唯一登记");
      await matched[0].authorize(method, path);
    }
  };
}

export function composePlatformCorePackageAssembly<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  users: PlatformCoreUsers<Tx>;
  audit: CorePackagePublicationAudit<Tx>;
  catalogue: CoreDeployedCatalogue;
  storageDirectory?: string;
  localArtifacts?: CorePackageArtifactSource;
  deployment?: CorePackageDeploymentSource;
  materials?: CorePackagePreparationMaterialsSource;
  legacyApiRoutes?: CorePackageLegacyApiRoutes;
  fetcher?: typeof fetch;
  sourceVault?: Pick<SecretBox, "encrypt" | "decrypt">;
  /** 目标由可信宿主静态选择；默认未装配，不从请求、环境字符串或包代码创建执行器。 */
  deploymentExecutor?: CorePackageDeploymentExecutor;
  now?: () => number;
}): CorePackageAssembly {
  if (typeof input.audit?.recordPublicationAttempt !== "function")
    throw new CoreAccessError("core_unavailable", "宿主须提供真实 Core 包提交意图审计");
  if (input.storageDirectory && !isAbsolute(input.storageDirectory))
    throw new CoreAccessError("core_unavailable", "Core 包存储根须使用宿主配置的绝对目录");
  const legacyApiRoutes = structuredClone(input.legacyApiRoutes ?? {});
  const source = input.sourceVault ? composeCorePackageSourceSettings({
    database: input.database, users: input.users, vault: input.sourceVault, now: input.now
  }) : undefined;
  const shared = { database: input.database, users: input.users, catalogue: input.catalogue,
    deployment: input.deployment, legacyApiRoutes, now: input.now };
  const references = input.storageDirectory
    ? createCorePackageReleaseReferenceFileStore({ directory: join(input.storageDirectory, "releases"), now: input.now })
    : undefined;
  const candidates = input.storageDirectory
    ? createCorePackagePreparationFileStore({ directory: join(input.storageDirectory, "candidates"), legacyApiRoutes, now: input.now })
    : undefined;
  const localArtifacts = input.localArtifacts ?? (input.storageDirectory
    ? createPlatformCorePackageArchiveIndexSource({ directory: join(input.storageDirectory, "archives"),
      privateAccess: source?.access, fetcher: input.fetcher })
    : undefined);
  const artifacts = references
    ? createPlatformCorePackageSelectedArtifactSource({ store: references, local: localArtifacts, legacyApiRoutes,
      fetcher: input.fetcher, privateAccess: source?.access })
    : localArtifacts;
  const preparation = composePlatformCorePackagePreparation({ ...shared, audit: input.audit,
    artifacts, materials: input.materials, store: candidates });
  return {
    packages: composePlatformCorePackageManagement({ ...shared,
      discovery: createPlatformCorePackageDiscovery(input.fetcher, input.now) }),
    preflight: composePlatformCorePackagePreflight({ ...shared, artifacts }),
    releases: composePlatformCorePackageSelection({ ...shared, audit: input.audit,
      releases: createPlatformCorePackageReleaseSource(input.fetcher, source?.access), store: references }),
    preparation,
    deploymentSourceGuard: preparation.deploymentSourceGuard,
    deployment: composeCorePackageDeployment({ ...shared, store: candidates, guard: preparation.deploymentSourceGuard,
      executor: input.deploymentExecutor }),
    sources: source?.settings ?? {
      async read() { throw new CoreAccessError("core_unavailable", "宿主尚未装配原服务端凭据保管"); },
      async save() { throw new CoreAccessError("core_unavailable", "宿主尚未装配原服务端凭据保管"); }
    },
    http: combineHttpAccess([
      createPlatformCorePackageHttpAccess(), createPlatformCorePackagePreflightHttpAccess(),
      createPlatformCorePackageSelectionHttpAccess(), createPlatformCorePackagePreparationHttpAccess(), createCorePackageSourceHttpAccess(),
      createCorePackageDeploymentHttpAccess()
    ])
  };
}

export function createPlatformCorePackageAssemblyHttpAccess(
  application: CorePackageAssembly, coreHttp: RegisteredCoreHttpAccess
): RegisteredCoreHttpAccess {
  return combineHttpAccess([application.http, coreHttp]);
}

export const CORE_PACKAGE_ASSEMBLY = Symbol("platform.core-packages.assembly");
type AssemblyFactory = Pick<FactoryProvider<CorePackageAssembly>, "inject" | "useFactory">;

@Module({})
export class CorePackageAssemblyModule {
  static register(options: AssemblyFactory & { imports?: ModuleMetadata["imports"] }): DynamicModule {
    return {
      module: CorePackageAssemblyModule,
      imports: options.imports ?? [],
      controllers: [CorePackageController, CorePackagePreflightController,
        CorePackageSelectionController, CorePackagePreparationController, CorePackageSourceController, CorePackageDeploymentController],
      providers: [
        { provide: CORE_PACKAGE_ASSEMBLY, inject: options.inject ?? [], useFactory: options.useFactory },
        { provide: CORE_PACKAGE_APPLICATION, inject: [CORE_PACKAGE_ASSEMBLY],
          useFactory: (application: CorePackageAssembly) => application.packages },
        { provide: CORE_PACKAGE_PREFLIGHT_APPLICATION, inject: [CORE_PACKAGE_ASSEMBLY],
          useFactory: (application: CorePackageAssembly) => application.preflight },
        { provide: CORE_PACKAGE_SELECTION_APPLICATION, inject: [CORE_PACKAGE_ASSEMBLY],
          useFactory: (application: CorePackageAssembly) => application.releases },
        { provide: CORE_PACKAGE_PREPARATION_APPLICATION, inject: [CORE_PACKAGE_ASSEMBLY],
          useFactory: (application: CorePackageAssembly) => application.preparation },
        { provide: CORE_PACKAGE_SOURCE_SETTINGS, inject: [CORE_PACKAGE_ASSEMBLY],
          useFactory: (application: CorePackageAssembly) => application.sources },
        { provide: CORE_PACKAGE_DEPLOYMENT_APPLICATION, inject: [CORE_PACKAGE_ASSEMBLY],
          useFactory: (application: CorePackageAssembly) => application.deployment }
      ],
      exports: [CORE_PACKAGE_ASSEMBLY]
    };
  }
}
