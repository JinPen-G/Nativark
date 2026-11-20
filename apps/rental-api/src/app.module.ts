/** 独立 Rental Nest 根装配。公共 Guard、身份和数据库各一份；所有原 HTTP 通过明确的请求接点。
 * 完整挂载集合有未封口入口时，构造模块即拒绝，不能把缺失路径或批量 403 称为兼容启动。 */
import { Module, type DynamicModule } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { CoreDeploymentLock } from "@rental-os/core-contracts";
import { PlatformServerModule } from "@rental-os/platform-server";
import { CoreHostModule } from "@rental-os/platform-core-host";
import { RentalHttpModule } from "@rental-os/rental-core/http";
import { RentalPaymentsHttpModule } from "@rental-os/rental-core/http-payments";
import { RentalHttpExtensionsModule } from "@rental-os/rental-core/http-extensions";
import { RentalCustomersHttpModule } from "@rental-os/rental-core/http-customers-module";
import { RentalWorkspacesHttpModule } from "@rental-os/rental-core/http-workspaces-module";
import { createRentalAuthorization } from "@rental-os/rental-core/http-auth";
import * as shared from "@rental-os/shared";
import { RentalDatabaseClient, RentalDatabaseModule } from "./database";
import { composeRentalApplication, type RentalHostAssembly } from "./assembly";
import { createRentalHttpRequestScope } from "./http-request-scope";
import { createRentalHttpApplicationViews } from "./http-application-views";
import { RentalApplicationLifecycle } from "./lifecycle";
import { createRentalHostHttpPolicy } from "./http-policy";
import { createRentalHostOpenApi } from "./openapi";
export { RENTAL_HOST_CONTROLLERS } from "./http-policy";

export const RENTAL_HOST_ASSEMBLY = Symbol("rental.host.assembly");
export const RENTAL_HTTP_REQUEST_SCOPE = Symbol("rental.host.request-scope");
const HTTP_APPLICATIONS = Symbol("rental.host.http-applications");

@Module({})
class RentalAssemblyModule {}

@Module({})
export class RentalAppModule {
  static register(options: { lock: CoreDeploymentLock; aiMode: "disabled" }): DynamicModule {
    if (options?.aiMode !== "disabled") throw new Error("当前独立宿主尚未装配启用 AI 所需的原参加者");
    const authorization = createRentalAuthorization(shared);
    const policy = createRentalHostHttpPolicy(authorization);
    // 检查只用已加载的真实处理器元数据，不创建 Client、不预热，也不给请求提供跳过开关。
    policy.assertReviewed();
    const assembly: DynamicModule = { module: RentalAssemblyModule,
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), RentalDatabaseModule],
      providers: [
        { provide: RENTAL_HOST_ASSEMBLY, inject: [RentalDatabaseClient, ConfigService],
          useFactory: (database: RentalDatabaseClient, configuration: ConfigService) =>
            composeRentalApplication({ database, configuration, ...options }) },
        { provide: HTTP_APPLICATIONS, inject: [RENTAL_HOST_ASSEMBLY],
          useFactory: (host: RentalHostAssembly) => createRentalHttpApplicationViews(host.http) },
        { provide: RENTAL_HTTP_REQUEST_SCOPE, inject: [RENTAL_HOST_ASSEMBLY],
          useFactory: (host: RentalHostAssembly) => createRentalHttpRequestScope({ access: host.access,
            publicAccess: host.publicAccess, callbackAccess: host.callbackAccess, isClientPublicRoute: host.authorization.isClientPublicRoute,
            policy: createRentalHostHttpPolicy(host.authorization),
            routesToPlatform: host.platform.routesToPlatform }) },
        { provide: RentalApplicationLifecycle, inject: [RENTAL_HOST_ASSEMBLY],
          useFactory: (host: RentalHostAssembly) => host.lifecycle }
      ], exports: [RENTAL_HOST_ASSEMBLY, HTTP_APPLICATIONS, RENTAL_HTTP_REQUEST_SCOPE] };
    const core = CoreHostModule.register({ imports: [assembly], inject: [RENTAL_HOST_ASSEMBLY],
      useFactory: (host: RentalHostAssembly) => host.core });
    return { module: RentalAppModule, imports: [
      assembly, core,
      PlatformServerModule.register({ imports: [assembly, RentalDatabaseModule, core], inject: [RentalDatabaseClient],
        useFactory: (database: RentalDatabaseClient) => database,
        applicationsProvider: { provide: "rental.platform.applications", inject: [RENTAL_HOST_ASSEMBLY],
          useFactory: (host: RentalHostAssembly) => host.platform },
        openApiDocument: createRentalHostOpenApi(options.lock, policy) }),
      RentalHttpModule.registerFactory({ imports: [assembly], inject: [HTTP_APPLICATIONS],
        useFactory: (http: ReturnType<typeof createRentalHttpApplicationViews>) => http }),
      RentalPaymentsHttpModule.registerFactory({ imports: [assembly], inject: [RENTAL_HOST_ASSEMBLY, HTTP_APPLICATIONS],
        useFactory: (host: RentalHostAssembly, http: ReturnType<typeof createRentalHttpApplicationViews>) =>
          ({ ...host.payments, core: http.rental.core }) }),
      RentalHttpExtensionsModule.registerFactory({ imports: [assembly], inject: [RENTAL_HOST_ASSEMBLY],
        useFactory: (host: RentalHostAssembly) => host.extensions }),
      RentalCustomersHttpModule.registerFactory({ imports: [assembly], inject: [RENTAL_HOST_ASSEMBLY],
        useFactory: (host: RentalHostAssembly) => host.customers }),
      RentalWorkspacesHttpModule.registerFactory({ imports: [assembly], inject: [RENTAL_HOST_ASSEMBLY],
        useFactory: (host: RentalHostAssembly) => host.workspaces })
    ] };
  }
}
