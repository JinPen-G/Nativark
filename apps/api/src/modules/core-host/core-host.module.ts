/** 原Nest容器中的单一Core应用工厂；复用已导出的原服务，禁止在子模块重复构建认证/数据库。 */
import { Module, type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import type { CoreSessionContext, CoreScopeObservation } from "@rental-os/core-contracts";
import { CORE_MANAGEMENT_APPLICATION, CoreManagementController } from "./core-management.controller";
import type { CoreManagementHttpApplication } from "./core-management.controller";
import { CORE_SESSION_READER, CoreSessionController } from "./core-session.controller";
import { CORE_SCOPE_READER, CoreScopeController } from "./core-scope.controller";

export const CORE_HOST_APPLICATION = Symbol("platform.core-host.application");
export interface CoreHostHttpApplication {
  management: CoreManagementHttpApplication;
  session(): Promise<CoreSessionContext>;
  scope(value: unknown): Promise<CoreScopeObservation>;
}
type ApplicationFactory = Pick<FactoryProvider<CoreHostHttpApplication>, "inject" | "useFactory">;

@Module({})
export class CoreHostModule {
  /** 父模块provider不会自动进入子模块；imports须导出inject中的实际原服务或宿主工厂。 */
  static register(options: ApplicationFactory & { imports?: ModuleMetadata["imports"] }): DynamicModule {
    return { module: CoreHostModule, imports: options.imports ?? [],
      controllers: [CoreManagementController, CoreSessionController, CoreScopeController],
      providers: [
        { provide: CORE_HOST_APPLICATION, inject: options.inject ?? [], useFactory: options.useFactory },
        { provide: CORE_MANAGEMENT_APPLICATION, inject: [CORE_HOST_APPLICATION], useFactory: (application: CoreHostHttpApplication) => application.management },
        { provide: CORE_SESSION_READER, inject: [CORE_HOST_APPLICATION], useFactory: (application: CoreHostHttpApplication) => application.session },
        { provide: CORE_SCOPE_READER, inject: [CORE_HOST_APPLICATION], useFactory: (application: CoreHostHttpApplication) => application.scope }
      ], exports: [CORE_HOST_APPLICATION] };
  }
}
