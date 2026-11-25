/** Rental 运营集成的受控 HTTP 装配。打印通过公共 Jobs 的真实 Rental 参加者提供。 */
import { Module, type DynamicModule, type FactoryProvider, type ModuleMetadata } from "@nestjs/common";
import {
  IntegrationsController,
  RENTAL_INTEGRATIONS_HTTP_APPLICATION,
  type RentalIntegrationsHttpApplication
} from "./http-integrations.controller";

export * from "./http-integrations.controller";

@Module({})
export class RentalIntegrationsHttpModule {
  static register<Dependencies extends unknown[]>(options: {
    imports?: ModuleMetadata["imports"];
    inject?: FactoryProvider["inject"];
    useFactory: (...dependencies: Dependencies) => RentalIntegrationsHttpApplication | Promise<RentalIntegrationsHttpApplication>;
  }): DynamicModule {
    return {
      module: RentalIntegrationsHttpModule,
      imports: options.imports ?? [],
      controllers: [IntegrationsController],
      providers: [{
        provide: RENTAL_INTEGRATIONS_HTTP_APPLICATION,
        inject: options.inject ?? [],
        useFactory: async (...dependencies: Dependencies) => {
          const application = await options.useFactory(...dependencies);
          if (application == null) throw new Error("缺少 Rental 运营集成 HTTP 应用");
          return application;
        }
      }],
      exports: [RENTAL_INTEGRATIONS_HTTP_APPLICATION]
    };
  }
}
