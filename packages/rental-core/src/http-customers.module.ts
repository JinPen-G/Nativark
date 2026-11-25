/** 原客户管理 HTTP 的独立登记。供给同一门面，旧 PlatformController 已继承这些路径时不得重复挂载。 */
import { Module, type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import { RentalCustomersController, RENTAL_CUSTOMERS_HTTP_APPLICATION,
  type RentalCustomersHttpApplication } from "./http-customers.controller";

export interface RentalCustomersHttpRegistration
  extends Pick<FactoryProvider<RentalCustomersHttpApplication>, "inject" | "useFactory"> {
  imports?: ModuleMetadata["imports"];
}

@Module({})
export class RentalCustomersHttpModule {
  static register(application: RentalCustomersHttpApplication): DynamicModule {
    return this.registerFactory({ useFactory: () => application });
  }

  static registerFactory(options: RentalCustomersHttpRegistration): DynamicModule {
    return { module: RentalCustomersHttpModule, imports: options.imports,
      controllers: [RentalCustomersController], providers: [{ provide: RENTAL_CUSTOMERS_HTTP_APPLICATION,
        inject: options.inject, useFactory: options.useFactory }], exports: [RENTAL_CUSTOMERS_HTTP_APPLICATION] };
  }
}
