/** 原空间管理与开业品类选项 HTTP 的独立登记。供给同一门面，旧 PlatformController 已挂载这些路径时不得重复挂载。 */
import { Module, type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import { RentalWorkspacesController, RENTAL_WORKSPACES_HTTP_APPLICATION,
  type RentalWorkspacesHttpApplication } from "./http-workspaces.controller";

export interface RentalWorkspacesHttpRegistration
  extends Pick<FactoryProvider<RentalWorkspacesHttpApplication>, "inject" | "useFactory"> {
  imports?: ModuleMetadata["imports"];
}

@Module({})
export class RentalWorkspacesHttpModule {
  static register(application: RentalWorkspacesHttpApplication): DynamicModule {
    return this.registerFactory({ useFactory: () => application });
  }

  static registerFactory(options: RentalWorkspacesHttpRegistration): DynamicModule {
    return { module: RentalWorkspacesHttpModule, imports: options.imports,
      controllers: [RentalWorkspacesController], providers: [{ provide: RENTAL_WORKSPACES_HTTP_APPLICATION,
        inject: options.inject, useFactory: options.useFactory }], exports: [RENTAL_WORKSPACES_HTTP_APPLICATION] };
  }
}
