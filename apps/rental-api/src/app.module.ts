/** 独立 Rental Nest 根装配。公共 Guard、身份和数据库各一份；所有原 HTTP 通过明确的请求接点。
 * 完整挂载集合有未封口入口时，构造模块即拒绝，不能把缺失路径或批量 403 称为兼容启动。 */
import { Module, type DynamicModule } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { CoreDeploymentLock } from "@rental-os/core-contracts";
import { PlatformServerModule } from "@rental-os/platform-server";
import { JobsHttpModule } from "@rental-os/platform-server/jobs";
import { NotificationsHttpModule } from "@rental-os/platform-server/notifications";
import { CoreHostModule, CorePackageAssemblyModule } from "@rental-os/platform-core-host";
import { RentalHttpModule } from "@rental-os/rental-core/http";
import { RentalPaymentsHttpModule } from "@rental-os/rental-core/http-payments";
import { RentalHttpExtensionsModule } from "@rental-os/rental-core/http-extensions";
import { RentalCustomersHttpModule } from "@rental-os/rental-core/http-customers-module";
import { RentalWorkspacesHttpModule } from "@rental-os/rental-core/http-workspaces-module";
import { RentalIntegrationsHttpModule } from "@rental-os/rental-core/http-integrations";
import { createRentalAuthorization } from "@rental-os/rental-core/http-auth";
import { RENTAL_STAFF_INSPECTION_EVIDENCE, type RentalStaffInspectionEvidence } from "@rental-os/rental-core/http-staff-uploads";
import type { RentalHttpAccessPolicy } from "@rental-os/rental-core/http-access-policy";
import * as shared from "@rental-os/shared";
import { RentalDatabaseClient, RentalDatabaseModule } from "./database";
import { composeRentalApplication, type RentalHostAssembly } from "./assembly";
import { createRentalHttpRequestScope, type RentalAiHttpRequestScope } from "./http-request-scope";
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
class RentalHttpApplicationsModule {}

/** 仅独立 AI 宿主提供此组合；公共与无 AI 入口不导入可选 Runtime。 */
export interface RentalAiHostModule<Host extends RentalHostAssembly> {
  register(assembly: DynamicModule): DynamicModule;
  requestScope(host: Host, policy: RentalHttpAccessPolicy): RentalAiHttpRequestScope;
}

export function createRentalHostModule<Host extends RentalHostAssembly>(input: {
  lock: CoreDeploymentLock;
  assemble(database: RentalDatabaseClient, configuration: ConfigService): Host;
  createPolicy(authorization: ReturnType<typeof createRentalAuthorization>): RentalHttpAccessPolicy;
  openApi(lock: CoreDeploymentLock, policy: RentalHttpAccessPolicy): ReturnType<typeof createRentalHostOpenApi>;
  ai?: RentalAiHostModule<Host>;
  /** 静态宿主用导出的同一组装令牌接各 Core 自有模块；不重建 Rental 或公共服务。 */
  additionalHttp?(assembly: DynamicModule): readonly DynamicModule[];
}): DynamicModule {
  const policy = input.createPolicy(createRentalAuthorization(shared));
  // 核查不创建 Client，不预热；只有真实 handler 与审定接点对应才接受装配。
  policy.assertReviewed();
  const assembly: DynamicModule = { module: RentalAssemblyModule,
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), RentalDatabaseModule],
    providers: [
      { provide: RENTAL_HOST_ASSEMBLY, inject: [RentalDatabaseClient, ConfigService], useFactory: input.assemble },
      { provide: RENTAL_HTTP_REQUEST_SCOPE, inject: [RENTAL_HOST_ASSEMBLY],
        useFactory: (host: Host) => {
          const currentPolicy = input.createPolicy(host.authorization);
          return createRentalHttpRequestScope({ access: host.access, publicAccess: host.publicAccess,
            callbackAccess: host.callbackAccess, isClientPublicRoute: host.authorization.isClientPublicRoute,
            policy: currentPolicy, routesToPlatform: host.platform.routesToPlatform,
            runRequest: consume => host.lifecycle.runRequest(consume),
            ...(input.ai ? { ai: input.ai.requestScope(host, currentPolicy) } : {}) });
        } },
      { provide: RentalApplicationLifecycle, inject: [RENTAL_HOST_ASSEMBLY], useFactory: (host: Host) => host.lifecycle }
    ], exports: [RENTAL_HOST_ASSEMBLY, RENTAL_HTTP_REQUEST_SCOPE] };
  const ai = input.ai?.register(assembly);
  const httpApplications: DynamicModule = { module: RentalHttpApplicationsModule,
    imports: [assembly, ...(ai ? [ai] : [])], providers: [{ provide: HTTP_APPLICATIONS,
      inject: [RENTAL_HOST_ASSEMBLY, { token: RENTAL_STAFF_INSPECTION_EVIDENCE, optional: true }],
      useFactory: (host: Host, evidence?: RentalStaffInspectionEvidence) => {
        if (Boolean(evidence) !== Boolean(ai)) throw new Error("Rental HTTP 与可选 AI 检查参加者不属于同一组合");
        return createRentalHttpApplicationViews({ ...host.http,
          staff: { ...host.http.staff, inspectionEvidence: evidence } });
      } }], exports: [HTTP_APPLICATIONS] };
  const core = CoreHostModule.register({ imports: [assembly], inject: [RENTAL_HOST_ASSEMBLY],
    useFactory: (host: Host) => host.core,
    permissions: { inject: [RENTAL_HOST_ASSEMBLY], useFactory: (host: Host) => host.permissionStartup } });
  const packages = CorePackageAssemblyModule.register({ imports: [assembly], inject: [RENTAL_HOST_ASSEMBLY],
    useFactory: (host: Host) => host.packages });
  return { module: RentalAppModule, imports: [assembly, httpApplications, core, packages,
    PlatformServerModule.register({ imports: [assembly, RentalDatabaseModule, core, packages], inject: [RentalDatabaseClient],
      useFactory: (database: RentalDatabaseClient) => database,
      applicationsProvider: { provide: "rental.platform.applications", inject: [RENTAL_HOST_ASSEMBLY],
        useFactory: (host: Host) => host.platform }, openApiDocument: input.openApi(input.lock, policy) }),
    RentalHttpModule.registerFactory({ imports: [httpApplications], inject: [HTTP_APPLICATIONS],
      useFactory: (http: ReturnType<typeof createRentalHttpApplicationViews>) => http }),
    RentalPaymentsHttpModule.registerFactory({ imports: [assembly, httpApplications], inject: [RENTAL_HOST_ASSEMBLY, HTTP_APPLICATIONS],
      useFactory: (host: Host, http: ReturnType<typeof createRentalHttpApplicationViews>) => ({ ...host.payments, core: http.rental.core }) }),
    RentalIntegrationsHttpModule.register({ imports: [assembly], inject: [RENTAL_HOST_ASSEMBLY],
      useFactory: (host: Host) => host.rental.integrations.ledger }),
    JobsHttpModule.register({ imports: [assembly], inject: [RENTAL_HOST_ASSEMBLY], useFactory: (host: Host) => host.jobs }),
    NotificationsHttpModule.register({ imports: [assembly], inject: [RENTAL_HOST_ASSEMBLY], useFactory: (host: Host) => host.notifications }),
    RentalHttpExtensionsModule.registerFactory({ imports: [assembly], inject: [RENTAL_HOST_ASSEMBLY], useFactory: (host: Host) => host.extensions }),
    RentalCustomersHttpModule.registerFactory({ imports: [assembly], inject: [RENTAL_HOST_ASSEMBLY], useFactory: (host: Host) => host.customers }),
    RentalWorkspacesHttpModule.registerFactory({ imports: [assembly], inject: [RENTAL_HOST_ASSEMBLY], useFactory: (host: Host) => host.workspaces }),
    ...(input.additionalHttp?.(assembly) ?? [])
  ] };
}

@Module({})
export class RentalAppModule {
  static register(options: { lock: CoreDeploymentLock; aiMode: "disabled" }): DynamicModule {
    if (options?.aiMode !== "disabled") throw new Error("当前独立宿主尚未装配启用 AI 所需的原参加者");
    return createRentalHostModule({ lock: options.lock,
      assemble: (database, configuration) => composeRentalApplication({ database, configuration, ...options }),
      createPolicy: createRentalHostHttpPolicy, openApi: createRentalHostOpenApi });
  }
}
